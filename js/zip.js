// バックアップ用の ZIP の書き出しと読み込み（ビルド工程を持たないので自前で実装する）
// 書き出しは無圧縮（画像は JPEG ですでに圧縮されているため）。読み込みは無圧縮と deflate に対応する
const Zip = (() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }
  const enc = new TextEncoder();

  // files: [{ name, data: Blob | string }] → ZIP の Blob
  async function create(files) {
    const parts = [], central = [];
    let offset = 0;
    const { time, date } = dosTime(new Date());
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034B50, true);
      local.setUint16(4, 20, true);         // 展開に必要なバージョン
      local.setUint16(6, 0x0800, true);     // ファイル名は UTF-8
      local.setUint16(8, 0, true);          // 無圧縮
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, data);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014B50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, b) => n + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  // 展開の上限（展開すると巨大になる ZIP〈ZIP 爆弾〉でタブが落ちないようにする）
  const LIMITS = {
    files: 20000,                 // ファイルの数
    entryBytes: 200 * 1024 * 1024, // 1つのファイルの展開後の大きさ
    totalBytes: 2 * 1024 * 1024 * 1024, // 展開後の合計
  };
  class ZipLimitError extends Error {}

  // deflate を展開する。limit バイトを超えたら途中でやめて例外
  async function inflate(raw, limit) {
    const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > limit) { reader.cancel().catch(() => {}); throw new ZipLimitError('entry too large'); }
      chunks.push(value);
    }
    return new Blob(chunks);
  }

  // ZIP の Blob → Map(ファイル名 → Blob)。ZIP として読めなければ例外（上限を超えたら ZipLimitError）
  async function read(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xFFFF); i--) {
      if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    if (count > LIMITS.files) throw new ZipLimitError('too many files');
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map();
    let total = 0;
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014B50) throw new Error('broken zip');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);    // 圧縮後
      const usize = dv.getUint32(p + 24, true);   // 展開後（申告の値）
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const localAt = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue; // フォルダ
      if (usize > LIMITS.entryBytes) throw new ZipLimitError('entry too large');
      const start = localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
      if (start + size > buf.length) throw new Error('broken zip');
      const raw = new Blob([buf.subarray(start, start + size)]);
      let file;
      if (method === 0) file = raw;
      // 申告の大きさを超えて展開しない（申告をごまかした ZIP 爆弾を止める）
      else if (method === 8 && typeof DecompressionStream === 'function') file = await inflate(raw, usize);
      else throw new Error(`unsupported method ${method}`);
      total += file.size;
      if (total > LIMITS.totalBytes) throw new ZipLimitError('total too large');
      out.set(name, file);
    }
    return out;
  }

  return { create, read, crc32, LIMITS, ZipLimitError };
})();
