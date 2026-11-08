// ユーザーDB（ブラウザの IndexedDB に保存する。仕様書 5）
//
// データベース dpa.atelier（github.io のドメインは他のアプリと共有するため、名前に dpa. を付ける。仕様書 5.1）
//   entries … カラーエントリ（keyPath: id）
//   meta    … 所持している絵具・前回のメディウムなど（keyPath: key）
//   images  … 参考画像と記録画像（keyPath: id）。{ id, name, type, w, h, full: 本画像の Blob, thumb: サムネイルの Blob }
//             カラーエントリの refImages / recordImages は { imageId, name, ... } で画像を参照する。
//             どのエントリからも参照されなくなった画像は消す（起動時と、エントリを保存・削除したとき）
//
// 画面からは同期的に読めるよう、起動時（Store.init）に全件をメモリに読み込み、
// 書き込みはメモリを更新してから IndexedDB に反映する。書き込みの関数は保存できたかどうかを Promise で返す。
// 以前の版（localStorage の dpa.userdb.v3）のデータは、初回の起動で IndexedDB に移し、localStorage からは消す。
const Store = (() => {
  const DB_NAME = 'dpa.atelier';
  const DB_VERSION = 2; // 2：images を追加
  const LEGACY_KEY = 'dpa.userdb.v3';
  const SKINS = ['セミホワイト', 'フレッシュ', 'ノーマル', 'ホワイト', 'その他'];
  const TOPCOATS = ['つや消し', '半つや', 'つや有り'];
  const DEFAULT_BRAND = 'リキテックス'; // 制作条件「使用絵具」（固定。ライン〈レギュラー・ソフト・ベーシックス〉は実際の調色の絵具でわかる）

  const uid = () => Math.random().toString(36).slice(2, 10);

  function sample() {
    const mk = (o, daysAgo) => ({
      id: uid(),
      createdAt: Date.now() - daysAgo * 86400000,
      refImages: [], recordImages: [], extracted: [o.hex], method: 'average',
      comment: '',
      cond: { head: 'DDH-29', skin: 'セミホワイト', topcoat: 'つや消し', brand: DEFAULT_BRAND, medium: 'painting-medium' },
      estimated: [],
      ...o,
    });
    // サンプルの調色記録は、代表色を STARTER_IDS の12色で逆引きした結果から作る
    const withMix = (e) => {
      const cands = PaintDB.reverse(Color.parseHex(e.hex), PaintDB.STARTER_IDS, 3);
      e.estimated = cands.map((c) => ({ items: c.items, de: +c.de.toFixed(2) }));
      e.actual = cands[0].items.map((x) => ({ ...x }));
      return e;
    };
    return [
      withMix(mk({ name: 'コーラルピンクチーク', hex: '#E9A3A0', rating: 5, comment: '少し暖色寄り。3回重ねる' }, 2)),
      withMix(mk({ name: '幼い魔性チーク', hex: '#E494A6', rating: 5, comment: '頬の中心だけ重ねる（4回）。青みピンク',
        cond: { head: 'DDH-27', skin: 'セミホワイト', topcoat: 'つや消し', brand: DEFAULT_BRAND, medium: 'painting-medium' } }, 9)),
      withMix(mk({ name: 'くすみローズの唇', hex: '#B9646C', rating: 4, comment: 'グラデの濃い側' }, 20)),
      withMix(mk({ name: 'ブラウン系アイシャドウ', hex: '#B08A72', rating: 3, comment: 'もう少し赤みが欲しい',
        cond: { head: 'DDH-10', skin: 'フレッシュ', topcoat: 'つや消し', brand: DEFAULT_BRAND, medium: 'painting-medium' } }, 35)),
      withMix(mk({ name: 'こげ茶アイライン', hex: '#3E2A24', rating: 4, comment: '細筆で2回' }, 41)),
      withMix(mk({ name: 'ピーチチーク（室内光）', hex: '#EFB49A', rating: 2, comment: '黄みが強すぎた' }, 60)),
    ];
  }

  // ---------------- 読み込んだデータの確認 ----------------
  // バックアップや以前の版のデータは外から来るので、形をそろえ、画面に出す値を安全なものだけにする
  // （HEX は正しい色だけ、id は英数字だけ、など。画面では一部の値をそのまま HTML に入れているため）
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : def);
  const oneOf = (v, list, def) => (list.includes(v) ? v : def);
  const hexOf = (v) => { const rgb = Color.parseHex(v); return rgb ? Color.toHex(rgb) : null; };
  function cleanItems(items) {
    return (Array.isArray(items) ? items : [])
      .filter((x) => x && PaintDB.byId[x.paintId])
      .map((x) => ({ paintId: x.paintId, pct: num(x.pct, 0, 100, 0) }));
  }
  function cleanRefs(refs) {
    return (Array.isArray(refs) ? refs : []).filter((r) => r && typeof r === 'object').map((r) => {
      const out = { name: str(r.name, 200) };
      if (ID_RE.test(r.imageId)) out.imageId = r.imageId;
      else if (typeof r.src === 'string' && r.src.startsWith('data:image/')) out.src = r.src; // 以前の版のサムネイル（あとで画像に取り出す）
      else return null;
      if ('corrected' in r) out.corrected = !!r.corrected;
      if (Array.isArray(r.gains) && r.gains.length === 3 && r.gains.every((g) => Number.isFinite(g) && g > 0)) out.gains = r.gains.map(Number);
      else if ('gains' in r) out.gains = null;
      return out;
    }).filter(Boolean);
  }
  // 1件のカラーエントリをそろえる。色（HEX）が読めないものは null
  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const hex = hexOf(e.hex);
    if (!hex) return null;
    const c = e.cond && typeof e.cond === 'object' ? e.cond : {};
    return {
      id: ID_RE.test(e.id) ? e.id : uid(),
      name: str(e.name, 200).trim() || '（名称なし）',
      // 部位（part・customPart。以前の版の項目）は取り込まない
      rating: Math.round(num(e.rating, 1, 5, 3)),
      comment: str(e.comment),
      createdAt: num(e.createdAt, 0, 8.64e15, Date.now()),
      hex,
      method: oneOf(e.method, ['average', 'manual'], 'average'),
      extracted: (Array.isArray(e.extracted) ? e.extracted : []).map(hexOf).filter(Boolean),
      cond: {
        head: str(c.head, 100),
        skin: oneOf(c.skin, SKINS, 'その他'),
        topcoat: oneOf(c.topcoat, TOPCOATS, TOPCOATS[0]),
        brand: DEFAULT_BRAND,
        medium: PaintDB.mediumById[c.medium] ? c.medium : 'none',
      },
      estimated: (Array.isArray(e.estimated) ? e.estimated : [])
        .map((x) => ({ items: cleanItems(x?.items), de: +num(x?.de, 0, 1000, 0).toFixed(2) }))
        .filter((x) => x.items.length),
      actual: cleanItems(e.actual),
      refImages: cleanRefs(e.refImages),
      recordImages: cleanRefs(e.recordImages),
    };
  }
  // ユーザーDB 全体をそろえる。id が重なったエントリは新しい id にする
  function cleanDb(d) {
    const seen = new Set();
    const entries = (Array.isArray(d?.entries) ? d.entries : []).map(cleanEntry).filter(Boolean).map((e) => {
      if (seen.has(e.id)) e.id = uid();
      seen.add(e.id);
      return e;
    });
    return {
      version: 1,
      entries: byNewest(entries),
      owned: [...new Set((Array.isArray(d?.owned) ? d.owned : []).filter((id) => PaintDB.byId[id]))],
      lastMedium: PaintDB.mediumById[d?.lastMedium] ? d.lastMedium : 'painting-medium',
    };
  }
  // 画像の記録をそろえる（id は英数字だけ。Blob がないものは除く）
  const cleanImage = (im) => (im && ID_RE.test(im.id) && im.full instanceof Blob && im.thumb instanceof Blob
    ? { id: im.id, name: str(im.name, 200), type: str(im.type, 50) || im.full.type, w: num(im.w, 0, 1e5, 0), h: num(im.h, 0, 1e5, 0), full: im.full, thumb: im.thumb }
    : null);

  // 所持している絵具は、最初は何もない状態から選んでもらう
  function fresh(entries) { return { version: 1, entries, owned: [], lastMedium: 'painting-medium' }; }
  const byNewest = (list) => list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // ---------------- IndexedDB ----------------
  let idb = null;          // 開いたデータベース（使えないときは null。そのときはメモリだけで動く）
  let db = fresh([]);      // メモリ上のユーザーDB { version, entries, owned, lastMedium }
  let persistAsked = false;
  let images = new Map();  // 画像 id → { id, name, type, w, h, full, thumb }
  const urls = new Map();  // `${id}:thumb|full` → オブジェクト URL（表示用。画像を消したら解放する）

  const reqP = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // 1つのトランザクションで書き込み、完了（コミット）したら true を返す
  // IndexedDB が使えないときはメモリだけで動かす（起動時に、画面を閉じると消えることを知らせる）ので true を返す
  function write(stores, fn) {
    if (!idb) return Promise.resolve(true);
    return new Promise((resolve) => {
      let tx;
      try {
        tx = idb.transaction(stores, 'readwrite');
        fn(Object.fromEntries([].concat(stores).map((s) => [s, tx.objectStore(s)])));
      } catch (e) { console.warn(e); resolve(false); return; }
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => { console.warn(tx.error); resolve(false); };
    });
  }
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  const putMeta = (key) => write('meta', (s) => s.meta.put({ key, value: db[key] }));
  // db の内容で全部を書き直す（インポート・サンプルに戻す・すべて削除・移行）
  function writeAll() {
    return write(['entries', 'meta', 'images'], (s) => {
      s.entries.clear();
      s.meta.clear();
      s.images.clear();
      db.entries.forEach((e) => s.entries.put(e));
      images.forEach((im) => s.images.put(im));
      s.meta.put({ key: 'owned', value: db.owned });
      s.meta.put({ key: 'lastMedium', value: db.lastMedium });
      s.meta.put({ key: 'initialized', value: Date.now() });
    });
  }
  // エントリと設定だけを書き直す（起動時にデータの形をそろえたとき。画像は書き直さない）
  function writeEntriesAndMeta() {
    return write(['entries', 'meta'], (s) => {
      s.entries.clear();
      db.entries.forEach((e) => s.entries.put(e));
      s.meta.put({ key: 'owned', value: db.owned });
      s.meta.put({ key: 'lastMedium', value: db.lastMedium });
    });
  }
  // ---------------- 画像 ----------------
  const imageRefs = (e) => [...(e.refImages || []), ...(e.recordImages || [])];
  function dataUrlToBlob(src) {
    const [head, b64] = String(src).split(',');
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64 || '');
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type });
  }
  // 以前の版はエントリの中にサムネイルを data URL（src）で持っていた。画像として取り出して参照に置き換える
  // 本画像は残っていないので、サムネイルを本画像としても使う。置き換えたら true
  function extractInlineImages(entries) {
    let changed = false;
    for (const e of entries) {
      for (const key of ['refImages', 'recordImages']) {
        e[key] = (e[key] || []).map((ref) => {
          if (ref.imageId || !ref.src) return ref;
          changed = true;
          const blob = dataUrlToBlob(ref.src);
          const id = uid();
          images.set(id, { id, name: ref.name || '', type: blob.type, w: 0, h: 0, full: blob, thumb: blob });
          const { src, ...rest } = ref;
          return { ...rest, imageId: id };
        });
      }
    }
    return changed;
  }
  function forgetImage(id) {
    images.delete(id);
    for (const k of ['thumb', 'full']) {
      const u = urls.get(`${id}:${k}`);
      if (u) { URL.revokeObjectURL(u); urls.delete(`${id}:${k}`); }
    }
  }
  // どのエントリからも参照されていない画像を消す
  function collectGarbage() {
    const used = new Set(db.entries.flatMap((e) => imageRefs(e).map((r) => r.imageId)));
    const unused = [...images.keys()].filter((id) => !used.has(id));
    if (!unused.length) return Promise.resolve(true);
    unused.forEach(forgetImage);
    return write('images', (s) => unused.forEach((id) => s.images.delete(id)));
  }
  function imageUrl(id, kind = 'thumb') {
    const im = images.get(id);
    if (!im) return '';
    const key = `${id}:${kind}`;
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(kind === 'full' ? im.full : im.thumb));
    return urls.get(key);
  }

  function readLegacy() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 起動時に一度呼ぶ。{ ok: IndexedDB に保存できるか, migrated: 以前の版のデータを移したか }
  async function init() {
    try {
      idb = await open();
      const tx = idb.transaction(['entries', 'meta', 'images'], 'readonly');
      const [entries, meta, imgs] = await Promise.all(['entries', 'meta', 'images'].map((n) => reqP(tx.objectStore(n).getAll())));
      const m = Object.fromEntries(meta.map((x) => [x.key, x.value]));
      images = new Map(imgs.map((im) => [im.id, im]));
      if (m.initialized) {
        // 保存済みのデータも確かめてから使う（以前の版でインポートしたデータは確かめていないため）。
        // 形が変わったときだけ書き直す（エントリと設定だけ。画像はそのまま）
        const raw = { entries, owned: m.owned || [], lastMedium: m.lastMedium || 'painting-medium' };
        db = cleanDb(raw);
        if (JSON.stringify(db) !== JSON.stringify({ version: 1, ...raw, entries: byNewest([...entries]) })) await writeEntriesAndMeta();
        // 以前の版で保存したサムネイル（data URL）を画像として取り出す
        if (extractInlineImages(db.entries)) await writeAll();
        await collectGarbage();
        return { ok: true, migrated: false };
      }
      // 初めての起動：以前の版のデータがあれば移し、なければ空のレシピ帳で始める（サンプルは設定やレシピ帳から追加できる）
      const legacy = readLegacy();
      db = legacy ? cleanDb(legacy) : fresh([]);
      extractInlineImages(db.entries);
      const ok = await writeAll();
      if (ok && legacy) { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* 消せなくても続ける */ } }
      return { ok, migrated: !!legacy && ok };
    } catch (e) {
      // プライベートブラウズなどで IndexedDB が使えない：この画面を閉じるまでメモリだけで動かす
      console.warn(e);
      idb = null;
      images = new Map();
      const legacy = readLegacy();
      db = legacy ? cleanDb(legacy) : fresh([]);
      extractInlineImages(db.entries);
      return { ok: false, migrated: false };
    }
  }

  // 初めてカラーを保存したときに、ブラウザに永続保存を要求する（仕様書 5）
  async function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (e) { /* 対応していないブラウザ */ }
  }

  // db と images を fn で入れ替えて全部を書き直す。保存できなければメモリを元に戻す（IndexedDB は1つのトランザクションなので元のまま）
  async function replaceWith(fn) {
    const prevDb = db, prevImages = images;
    fn();
    const ok = await writeAll();
    if (!ok) { db = prevDb; images = prevImages; return false; }
    // 入れ替えで使わなくなった画像の表示用 URL を解放する
    for (const [id, im] of prevImages) {
      if (images.get(id) === im) continue;
      for (const k of ['thumb', 'full']) {
        const u = urls.get(`${id}:${k}`);
        if (u) { URL.revokeObjectURL(u); urls.delete(`${id}:${k}`); }
      }
    }
    return true;
  }

  function setOwnedMany(ids, owned) {
    const set = new Set(db.owned);
    ids.forEach((id) => (owned ? set.add(id) : set.delete(id)));
    db.owned = [...set];
    return putMeta('owned');
  }

  return {
    SKINS, TOPCOATS, DEFAULT_BRAND, DB_NAME, uid, init,
    // ---- 画像 ----
    // 画像を保存して id を返す（保存できなければ null）。{ full: Blob, thumb: Blob, name, w, h }
    // 保存した画像は、エントリから参照しないと次の起動時に消える
    async putImage({ full, thumb, name = '', w = 0, h = 0 }) {
      const im = { id: uid(), name, type: full.type, w, h, full, thumb };
      images.set(im.id, im);
      const ok = await write('images', (s) => s.images.put(im));
      if (!ok) { forgetImage(im.id); return null; }
      return im.id;
    },
    hasImage: (id) => images.has(id),
    thumbUrl: (id) => imageUrl(id, 'thumb'),
    fullUrl: (id) => imageUrl(id, 'full'),
    imageRecords: () => [...images.values()], // バックアップ用
    get db() { return db; },
    get available() { return !!idb; }, // IndexedDB に保存できているか
    entries: () => db.entries,
    get: (id) => db.entries.find((e) => e.id === id),
    // 保存できたら true。保存できなければメモリも元に戻す
    async upsert(entry) {
      const i = db.entries.findIndex((e) => e.id === entry.id);
      const prev = i >= 0 ? db.entries[i] : null;
      if (i >= 0) db.entries[i] = entry; else db.entries.unshift(entry);
      const ok = await write('entries', (s) => s.entries.put(entry));
      if (!ok) {
        const j = db.entries.indexOf(entry);
        if (prev) db.entries[j] = prev; else db.entries.splice(j, 1);
      }
      if (ok) { askPersist(); collectGarbage(); } // 上書きで参照しなくなった画像を消す
      return ok;
    },
    // 削除できたら true。削除できなければメモリも元に戻す
    async remove(id) {
      const prev = db.entries;
      db.entries = db.entries.filter((e) => e.id !== id);
      const ok = await write('entries', (s) => s.entries.delete(id));
      if (ok) collectGarbage(); else db.entries = prev;
      return ok;
    },
    isOwned: (id) => db.owned.includes(id),
    ownedIds: () => [...db.owned],
    setOwned(id, owned) { return setOwnedMany([id], owned); },
    setOwnedMany,
    // 前回保存したカラーの使用メディウム（新しく保存するときの初期値）
    lastMedium: () => db.lastMedium || 'none',
    setLastMedium(id) { db.lastMedium = id; return putMeta('lastMedium'); },
    // 全部を入れ替える（インポート）。imageRecords は画像 { id, name, type, w, h, full, thumb } の一覧
    // 以前の版のバックアップ（エントリの中にサムネイルの data URL がある）も読み込める
    // 中身は確かめてから取り込む（cleanDb / cleanImage）。保存できなければ、メモリも元に戻す
    replaceAll(next, imageRecords = []) {
      return replaceWith(() => {
        images = new Map(imageRecords.map(cleanImage).filter(Boolean).map((im) => [im.id, im]));
        db = cleanDb(next);
        extractInlineImages(db.entries);
        // 画像が見つからない参照は外し、どこからも参照されない画像は取り込まない
        for (const e of db.entries) {
          for (const k of ['refImages', 'recordImages']) e[k] = e[k].filter((r) => images.has(r.imageId));
        }
        const used = new Set(db.entries.flatMap((e) => imageRefs(e).map((r) => r.imageId)));
        [...images.keys()].filter((id) => !used.has(id)).forEach((id) => images.delete(id));
      });
    },
    // サンプルのカラー（6件）を追加する。今のカラーは消さない
    async addSamples() {
      const list = sample().map((e) => ({ ...e, name: `${e.name}（サンプル）` })); // 自分のカラーと見分けられるようにする
      const prev = db.entries;
      db.entries = byNewest([...list, ...db.entries]);
      const ok = await write('entries', (s) => list.forEach((e) => s.entries.put(e)));
      if (!ok) db.entries = prev;
      return ok;
    },
    // レシピ帳のカラーと画像をすべて消す。絵具箱の所持の設定と、前回のメディウムは残す
    wipe() {
      return replaceWith(() => {
        images = new Map();
        db = { ...fresh([]), owned: db.owned, lastMedium: db.lastMedium };
      });
    },
    // このアプリのデータの大きさ（バイト。github.io のドメインは他のアプリと共有するので、ブラウザ全体の使用量ではなく自分の分を数える）
    sizeBytes: () => new Blob([JSON.stringify(db)]).size
      + [...images.values()].reduce((n, im) => n + im.full.size + (im.thumb === im.full ? 0 : im.thumb.size), 0),
    imageCount: () => images.size,
  };
})();
