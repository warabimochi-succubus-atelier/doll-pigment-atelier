// ユーザーDB（ブラウザの IndexedDB に保存する。仕様書 6）
//
// データベース dpa.atelier（github.io のドメインは他のアプリと共有するため、名前に dpa. を付ける。仕様書 6.1）
//   entries … カラーエントリ（keyPath: id）
//   meta    … 所持している絵具・前回のメディウムなど（keyPath: key）
//
// 画面からは同期的に読めるよう、起動時（Store.init）に全件をメモリに読み込み、
// 書き込みはメモリを更新してから IndexedDB に反映する。書き込みの関数は保存できたかどうかを Promise で返す。
// 以前の版（localStorage の dpa.userdb.v3）のデータは、初回の起動で IndexedDB に移し、localStorage からは消す。
const Store = (() => {
  const DB_NAME = 'dpa.atelier';
  const DB_VERSION = 1;
  const LEGACY_KEY = 'dpa.userdb.v3';
  const PARTS = ['頬', '唇', 'アイシャドウ', 'アイライン', 'カスタム'];
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
      estimated: [], customPart: '',
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
      withMix(mk({ name: 'DDH-29 チークA', part: '頬', hex: '#E9A3A0', rating: 5, comment: '少し暖色寄り。3回重ねる' }, 2)),
      withMix(mk({ name: '幼い魔性チーク', part: '頬', hex: '#E494A6', rating: 5, comment: '頬の中心だけ重ねる（4回）。青みピンク',
        cond: { head: 'DDH-27', skin: 'セミホワイト', topcoat: 'つや消し', brand: DEFAULT_BRAND, medium: 'painting-medium' } }, 9)),
      withMix(mk({ name: 'くすみローズの唇', part: '唇', hex: '#B9646C', rating: 4, comment: 'グラデの濃い側' }, 20)),
      withMix(mk({ name: 'ブラウン系アイシャドウ', part: 'アイシャドウ', hex: '#B08A72', rating: 3, comment: 'もう少し赤みが欲しい',
        cond: { head: 'DDH-10', skin: 'フレッシュ', topcoat: 'つや消し', brand: DEFAULT_BRAND, medium: 'painting-medium' } }, 35)),
      withMix(mk({ name: 'こげ茶アイライン', part: 'アイライン', hex: '#3E2A24', rating: 4, comment: '細筆で2回' }, 41)),
      withMix(mk({ name: 'ピーチチーク（室内光）', part: '頬', hex: '#EFB49A', rating: 2, comment: '黄みが強すぎた' }, 60)),
    ];
  }

  // 使用絵具は「リキテックス」に固定する（以前の版で「リキテックス レギュラー」などと記録したデータもそろえる）
  function migrate(d) {
    for (const e of d.entries || []) {
      if (e.cond) e.cond.brand = DEFAULT_BRAND;
    }
    return d;
  }
  // 所持している絵具は、最初は何もない状態から選んでもらう
  function fresh(entries) { return { version: 1, entries, owned: [], lastMedium: 'painting-medium' }; }
  const byNewest = (list) => list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // ---------------- IndexedDB ----------------
  let idb = null;          // 開いたデータベース（使えないときは null。そのときはメモリだけで動く）
  let db = fresh([]);      // メモリ上のユーザーDB { version, entries, owned, lastMedium }
  let persistAsked = false;

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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  const putMeta = (key) => write('meta', (s) => s.meta.put({ key, value: db[key] }));
  // db の内容で全部を書き直す（インポート・サンプルに戻す・すべて削除・移行）
  function writeAll() {
    return write(['entries', 'meta'], (s) => {
      s.entries.clear();
      s.meta.clear();
      db.entries.forEach((e) => s.entries.put(e));
      s.meta.put({ key: 'owned', value: db.owned });
      s.meta.put({ key: 'lastMedium', value: db.lastMedium });
      s.meta.put({ key: 'initialized', value: Date.now() });
    });
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
      const tx = idb.transaction(['entries', 'meta'], 'readonly');
      const [entries, meta] = await Promise.all([reqP(tx.objectStore('entries').getAll()), reqP(tx.objectStore('meta').getAll())]);
      const m = Object.fromEntries(meta.map((x) => [x.key, x.value]));
      if (m.initialized) {
        db = migrate({ version: 1, entries: byNewest(entries), owned: m.owned || [], lastMedium: m.lastMedium || 'painting-medium' });
        return { ok: true, migrated: false };
      }
      // 初めての起動：以前の版のデータがあれば移し、なければサンプルデータで始める
      const legacy = readLegacy();
      db = legacy ? migrate({ ...fresh([]), ...legacy, entries: byNewest(legacy.entries || []) }) : fresh(sample());
      const ok = await writeAll();
      if (ok && legacy) { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* 消せなくても続ける */ } }
      return { ok, migrated: !!legacy && ok };
    } catch (e) {
      // プライベートブラウズなどで IndexedDB が使えない：この画面を閉じるまでメモリだけで動かす
      console.warn(e);
      idb = null;
      const legacy = readLegacy();
      db = legacy ? migrate({ ...fresh([]), ...legacy }) : fresh(sample());
      return { ok: false, migrated: false };
    }
  }

  // 初めてカラーを保存したときに、ブラウザに永続保存を要求する（仕様書 6）
  async function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (e) { /* 対応していないブラウザ */ }
  }

  function setOwnedMany(ids, owned) {
    const set = new Set(db.owned);
    ids.forEach((id) => (owned ? set.add(id) : set.delete(id)));
    db.owned = [...set];
    return putMeta('owned');
  }

  return {
    PARTS, SKINS, TOPCOATS, DEFAULT_BRAND, DB_NAME, uid, init,
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
      if (ok) askPersist();
      return ok;
    },
    remove(id) {
      db.entries = db.entries.filter((e) => e.id !== id);
      return write('entries', (s) => s.entries.delete(id));
    },
    isOwned: (id) => db.owned.includes(id),
    ownedIds: () => [...db.owned],
    setOwned(id, owned) { return setOwnedMany([id], owned); },
    setOwnedMany,
    // 前回保存したカラーの使用メディウム（新しく保存するときの初期値）
    lastMedium: () => db.lastMedium || 'none',
    setLastMedium(id) { db.lastMedium = id; return putMeta('lastMedium'); },
    replaceAll(next) { db = migrate({ ...fresh([]), ...next, entries: byNewest(next.entries || []) }); return writeAll(); },
    resetSample() { db = { ...fresh(sample()), owned: db.owned }; return writeAll(); },
    wipe() { db = fresh([]); return writeAll(); },
    // このアプリのデータの大きさ（バイト。github.io のドメインは他のアプリと共有するので、ブラウザ全体の使用量ではなく自分の分を数える）
    sizeBytes: () => new Blob([JSON.stringify(db)]).size,
  };
})();
