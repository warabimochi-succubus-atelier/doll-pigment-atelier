// バックアップ用の ZIP（js/zip.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { load } = require('./load');

const { Zip } = load();

const bytes = async (blob) => Buffer.from(await blob.arrayBuffer());

test('書き出した ZIP を読み戻すと、中身が一致する', async () => {
  const bin = new Blob([Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) & 0xFF)], { type: 'image/jpeg' });
  const zip = await Zip.create([
    { name: 'data.json', data: JSON.stringify({ name: 'くすみローズ' }) },
    { name: 'images/a.jpg', data: bin },
  ]);
  const files = await Zip.read(zip);
  assert.deepEqual([...files.keys()], ['data.json', 'images/a.jpg']);
  assert.equal(await files.get('data.json').text(), '{"name":"くすみローズ"}');
  assert.ok((await bytes(files.get('images/a.jpg'))).equals(await bytes(bin)));
});

test('書き出した ZIP の CRC が正しい（ほかのソフトで展開できる）', async () => {
  const data = 'hello';
  const buf = await bytes(await Zip.create([{ name: 'a.txt', data }]));
  // ローカルヘッダーの CRC（オフセット 14）が zlib の CRC-32 と一致する
  assert.equal(buf.readUInt32LE(14), zlib.crc32(data));
  assert.equal(Zip.crc32(new TextEncoder().encode(data)), zlib.crc32(data));
});

// deflate で圧縮した1ファイルだけの ZIP を作る（usize は申告する展開後の大きさ）
function deflateZip(name, content, usize = content.length) {
  const comp = zlib.deflateRawSync(content);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(zlib.crc32(content), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(usize, 22);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014B50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(zlib.crc32(content), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(usize, 24);
  cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdAt = 30 + n.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cdAt, 16);
  return new Blob([local, n, comp, cd, n, end]);
}

test('deflate で圧縮された ZIP も読める', async () => {
  const content = Buffer.from('あいうえお'.repeat(1000));
  const files = await Zip.read(deflateZip('data.json', content));
  assert.ok((await bytes(files.get('data.json'))).equals(content));
});

test('展開後の大きさをごまかした ZIP（ZIP 爆弾）は途中で止める', async () => {
  const content = Buffer.alloc(1024 * 1024); // 0 が 1MB（よく縮む）
  await assert.rejects(Zip.read(deflateZip('bomb.bin', content, 1000)), (e) => e instanceof Zip.ZipLimitError);
});

test('ファイル全体は読み込まず、必要な部分だけを切り出して読む', async () => {
  const real = await Zip.create([{ name: 'a.txt', data: 'x'.repeat(10000) }, { name: 'b.bin', data: new Blob([new Uint8Array(50000)]) }]);
  // 全体を読もうとすると失敗する Blob の代わり（size と slice だけを持つ）
  const sliced = [];
  const fake = { size: real.size, slice: (a, b) => { sliced.push((b ?? real.size) - a); return real.slice(a, b); }, arrayBuffer: () => { throw new Error('read whole file'); } };
  const files = await Zip.read(fake);
  assert.equal((await files.get('a.txt').text()).length, 10000);
  assert.equal(files.get('b.bin').size, 50000);
});

test('中身が化けた ZIP は、壊れていると分かる（CRC）', async () => {
  const buf = await bytes(await Zip.create([{ name: 'a.txt', data: 'hello world' }]));
  buf[30 + 'a.txt'.length + 2] ^= 0xFF; // 中身の1バイトを変える
  await assert.rejects(Zip.read(new Blob([buf])), (e) => e instanceof Zip.ZipCorruptError);
});

test('圧縮されたデータが壊れた ZIP も、壊れていると分かる', async () => {
  const blob = deflateZip('a.txt', Buffer.from('abc'.repeat(500)));
  const buf = await bytes(blob);
  for (let i = 40; i < 50; i++) buf[i] ^= 0x5A; // 圧縮データの途中を壊す
  await assert.rejects(Zip.read(new Blob([buf])), (e) => e instanceof Zip.ZipCorruptError);
});

test('途中が欠けた ZIP は読まない', async () => {
  const buf = await bytes(await Zip.create([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'world' }]));
  // 中央ディレクトリと末尾は残したまま、前の方を切り詰めると、位置が合わなくなる
  const cut = Buffer.concat([buf.subarray(0, 10), buf.subarray(buf.length - 120)]);
  await assert.rejects(Zip.read(new Blob([cut])));
});

test('ZIP でないファイルは例外になる', async () => {
  await assert.rejects(Zip.read(new Blob(['not a zip file at all, just text'])));
});
