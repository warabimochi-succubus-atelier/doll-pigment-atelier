// ユーザーDB（モック：localStorage。本実装では IndexedDB）
const Store = (() => {
  const KEY = 'dpa.userdb.v2';
  const PARTS = ['頬', '唇', 'アイシャドウ', 'アイライン', 'カスタム'];
  const SKINS = ['セミホワイト', 'フレッシュ', 'ノーマル', 'ホワイト', 'その他'];
  const TOPCOATS = ['つや消し', '半つや', 'つや有り'];

  const uid = () => Math.random().toString(36).slice(2, 10);

  function sample() {
    const mk = (o, daysAgo) => ({
      id: uid(),
      createdAt: Date.now() - daysAgo * 86400000,
      refImages: [], recordImages: [], extracted: [o.hex], method: 'average',
      coats: 2, mediums: [], comment: '',
      cond: { head: 'DDH-29', skin: 'セミホワイト', topcoat: 'つや消し', brand: 'リキテックス' },
      estimated: [], customPart: '',
      ...o,
    });
    // サンプルの調色記録は、代表色を標準DBで逆引きした結果から作る
    const withMix = (e) => {
      const cands = PaintDB.reverse(Color.parseHex(e.hex), PaintDB.paints.map((p) => p.id), 3);
      e.estimated = cands.map((c) => ({ items: c.items, de: +c.de.toFixed(2) }));
      e.actual = cands[0].items.map((x) => ({ ...x }));
      return e;
    };
    return [
      withMix(mk({ name: 'DDH-29 チークA', part: '頬', hex: '#E9A3A0', rating: 5, comment: '少し暖色寄り', coats: 3,
        mediums: [{ mediumId: 'glazing-medium', pct: 200 }, { mediumId: 'water', pct: 50 }] }, 2)),
      withMix(mk({ name: '幼い魔性チーク', part: '頬', hex: '#E494A6', rating: 5, comment: '頬の中心だけ重ねる。青みピンク', coats: 4,
        mediums: [{ mediumId: 'water', pct: 150 }, { mediumId: 'flow-aid', pct: 10 }],
        cond: { head: 'DDH-27', skin: 'セミホワイト', topcoat: 'つや消し', brand: 'リキテックス' } }, 9)),
      withMix(mk({ name: 'くすみローズの唇', part: '唇', hex: '#B9646C', rating: 4, comment: 'グラデの濃い側', coats: 2,
        mediums: [{ mediumId: 'matte-medium', pct: 50 }] }, 20)),
      withMix(mk({ name: 'ブラウン系アイシャドウ', part: 'アイシャドウ', hex: '#B08A72', rating: 3, comment: 'もう少し赤みが欲しい', coats: 2,
        mediums: [{ mediumId: 'slow-dri-blending', pct: 100 }],
        cond: { head: 'DDH-10', skin: 'フレッシュ', topcoat: 'つや消し', brand: 'リキテックス' } }, 35)),
      withMix(mk({ name: 'こげ茶アイライン', part: 'アイライン', hex: '#3E2A24', rating: 4, comment: '細筆で2回', coats: 2,
        mediums: [{ mediumId: 'water', pct: 20 }] }, 41)),
      withMix(mk({ name: 'ピーチチーク（室内光）', part: '頬', hex: '#EFB49A', rating: 2, comment: '黄みが強すぎた', coats: 2,
        mediums: [{ mediumId: 'glazing-medium', pct: 300 }] }, 60)),
    ];
  }

  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { version: 1, entries: sample(), unowned: [] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { console.warn(e); return false; }
  }

  return {
    PARTS, SKINS, TOPCOATS, uid,
    get db() { return db; },
    entries: () => db.entries,
    get: (id) => db.entries.find((e) => e.id === id),
    upsert(entry) {
      const i = db.entries.findIndex((e) => e.id === entry.id);
      if (i >= 0) db.entries[i] = entry; else db.entries.unshift(entry);
      return save();
    },
    remove(id) { db.entries = db.entries.filter((e) => e.id !== id); save(); },
    isOwned: (id) => !db.unowned.includes(id),
    setOwned(id, owned) {
      db.unowned = db.unowned.filter((x) => x !== id);
      if (!owned) db.unowned.push(id);
      save();
    },
    replaceAll(next) { db = next; save(); },
    resetSample() { db = { version: 1, entries: sample(), unowned: [] }; save(); },
    wipe() { db = { version: 1, entries: [], unowned: [] }; save(); },
    sizeBytes: () => (localStorage.getItem(KEY) || '').length * 2,
  };
})();
