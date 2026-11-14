// 標準DB（リキテックス レギュラー / ソフト / ベーシックス）と、Mixbox による混色・逆引き調色
// 混色は Mixbox（js/vendor/mixbox.js。Kubelka-Munk 理論にもとづく顔料の混色モデル）で計算する（仕様書 2.3）。
// 各絵具の色（カラーチャートの色見本の色）を Mixbox の潜在表現（latent。7つの数）にしておき、
// 割合で重み付けして足し合わせてから色に戻す。絵具ごとの着色力の違いは扱わない
const PaintDB = (() => {
  const OPACITY = { opaque: '不透明', semi: '半透明', transparent: '透明' };

  const lines = PAINT_LINES;
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));
  const LATENT = mixbox.LATENT_SIZE;

  const paints = PAINT_DATA.map(([id, line, no, name, hex, opacity, group, discontinued = false]) => {
    // メタリック・蛍光・イリディッセントは混色計算で表せないので、逆引き調色に使わない
    const mixable = group !== 'special';
    const rgb = Color.parseHex(hex);
    // label は画面表示用（品番＋色名。ベーシックスは品番がないので色名だけ）
    // fullLabel はラインの違う同じ色と区別するための表示（ラインを添える）
    const label = no ? `${no} ${name}` : name;
    const fullLabel = `${label}（${lineById[line].name}）`;
    return { id, line, no, name, label, fullLabel, hex, rgb, lab: Color.rgbToLab(rgb), z: mixbox.rgbToLatent(...rgb), opacity, group, mixable, discontinued };
  });
  const byId = Object.fromEntries(paints.map((p) => [p.id, p]));

  // 制作条件で選ぶメディウム（混色計算には含めない）
  const mediums = [
    { id: 'painting-medium', name: 'ペインティング メディウム' },
    { id: 'gradation-medium', name: 'グラデーション メディウム' },
    { id: 'slow-dri-blending', name: 'スロードライ ブレンディング メディウム' },
    { id: 'none', name: 'なし' },
  ];
  const mediumById = Object.fromEntries(mediums.map((m) => [m.id, m]));

  // チタニウムホワイト（ラインごとに1色。白との混色見本と、明るさの調整に使う）
  const WHITE_ID = 'lq101'; // レギュラーのチタニウムホワイト（どの白も所持していないときの既定）
  const whiteOf = Object.fromEntries(lines.map((l) => [l.id, paints.find((p) => p.line === l.id && p.name === 'チタニウムホワイト')]));
  const WHITE_IDS = Object.values(whiteOf).filter(Boolean).map((p) => p.id);
  // サンプルデータの調色記録を作るときに使う12色
  // ナフソールレッドライト、ナフソールクリムソン、ビビッドレッドオレンジ、イエローミディアムアゾ、パーマネントグリーンライト、
  // フタロシアニングリーン、フタロシアニンブルー、ウルトラマリンブルー、ディオキサジンパープル、バーントシェンナ、マースブラック、チタニウムホワイト
  const STARTER_IDS = ['lq013', 'lq016', 'lq025', 'lq029', 'lq040', 'lq043', 'lq067', 'lq068', 'lq074', 'lq081', 'lq095', 'lq101'];

  // 割合 weights（任意スケール）で混色した線形 RGB
  const zMix = new Array(LATENT);
  function mixLinear(list, weights) {
    let tw = 0;
    for (const w of weights) tw += w;
    zMix.fill(0);
    for (let i = 0; i < list.length; i++) {
      const w = weights[i] / tw, z = list[i].z;
      for (let k = 0; k < LATENT; k++) zMix[k] += w * z[k];
    }
    return mixbox.latentToLinearFloatRgb(zMix);
  }
  const mixRgb = (list, weights) => Color.linearToRgb(mixLinear(list, weights));

  // 合計 total を k 個の正の整数に分ける全組み合わせ（5%刻み = 20単位）
  const UNITS = 20;
  const COMPS = [null];
  for (let k = 1; k <= 4; k++) {
    const out = [], cur = [];
    (function rec(rem, left) {
      if (left === 1) { out.push([...cur, rem]); return; }
      for (let i = 1; i <= rem - (left - 1); i++) { cur.push(i); rec(rem - i, left - 1); cur.pop(); }
    })(UNITS, k);
    COMPS.push(out);
  }

  // 探索は2段階にする（Mixbox の色への戻し〈latentToLinearFloatRgb〉は重いので、回数を減らす）
  // 1. 潜在表現の距離で探す：Mixbox の混色は潜在表現の重み付きの和なので、
  //    目標の色の潜在表現に近い組み合わせほど、混ぜた色も目標に近い。戻しの計算はしない
  // 2. 有望な組み合わせだけ色に戻し、ΔE76 でいちばん近い割合を選ぶ
  const KEEP = 8; // 1つの組み合わせで、2. に回す割合の数
  function latentFit(set, zt) {
    const comps = COMPS[set.length], n = set.length;
    const top = []; // { ci, d } 距離の小さい順に KEEP 個
    for (let ci = 0; ci < comps.length; ci++) {
      const comp = comps[ci];
      let d = 0;
      for (let k = 0; k < LATENT; k++) {
        let v = -zt[k];
        for (let i = 0; i < n; i++) v += (comp[i] / UNITS) * set[i].z[k];
        d += v * v;
      }
      if (top.length < KEEP || d < top[top.length - 1].d) {
        let j = top.length < KEEP ? top.length : KEEP - 1;
        while (j > 0 && top[j - 1].d > d) { if (j < KEEP) top[j] = top[j - 1]; j--; }
        top[j] = { ci, d };
      }
    }
    return { set, top, d: top[0].d };
  }

  // 割合 comp で混ぜた色と目標の ΔE76 の2乗
  const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const zBuf = new Array(LATENT);
  function colorDist(set, comp, targetLab) {
    zBuf.fill(0);
    for (let i = 0; i < set.length; i++) {
      const w = comp[i] / UNITS, z = set[i].z;
      for (let k = 0; k < LATENT; k++) zBuf[k] += w * z[k];
    }
    const [r, g, b] = mixbox.latentToLinearFloatRgb(zBuf);
    // 線形 RGB → Lab（Color.linearToLab と同じ式）
    const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const fy = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const fz = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    const dL = 116 * fy - 16 - targetLab[0], da = 500 * (fx - fy) - targetLab[1], db = 200 * (fy - fz) - targetLab[2];
    return dL * dL + da * da + db * db;
  }
  // 1. で残した割合の中から、色に戻していちばん近いものを選ぶ
  function refine(fit, targetLab) {
    const comps = COMPS[fit.set.length];
    let best = null;
    for (const { ci } of fit.top) {
      const d = colorDist(fit.set, comps[ci], targetLab);
      if (!best || d < best.d) best = { set: fit.set, comp: comps[ci], d };
    }
    return { ...best, d: Math.sqrt(best.d) };
  }
  // 組み合わせ set の中で、すべての割合を色に戻して比べる（絵具置換のように、組み合わせが1つのとき）
  function bestForSet(set, targetLab) {
    const comps = COMPS[set.length];
    let bestI = 0, bestD = Infinity;
    for (let ci = 0; ci < comps.length; ci++) {
      const d = colorDist(set, comps[ci], targetLab);
      if (d < bestD) { bestD = d; bestI = ci; }
    }
    return { set, comp: comps[bestI], d: Math.sqrt(bestD) };
  }

  function finalize(r, targetLab) {
    const rgb = mixRgb(r.set, r.comp);
    const lab = Color.rgbToLab(rgb);
    const de = Color.dE00(lab, targetLab);
    const items = r.set
      .map((p, i) => ({ paintId: p.id, pct: r.comp[i] * (100 / UNITS) }))
      .sort((a, b) => b.pct - a.pct);
    return { items, rgb, hex: Color.toHex(rgb), de, score: de + 0.35 * (items.length - 1) };
  }

  // 逆引き調色：使える絵具の中から最大4色・5%刻みで候補を探す
  // 手持ちが多いときは、2色の組み合わせで有望な絵具に絞ってから3色・4色を探す（計算時間を抑えるため）
  const MAX_POOL = 18;
  const REFINE = 120; // 潜在表現の距離で上位のこの数の組み合わせだけ、色に戻して比べる
  // ラインが違うだけの同じ色名の絵具（例：レギュラーとベーシックスのチタニウムホワイト）は、1つの候補に同時に使わない
  const sameName = (set, p) => set.some((q) => q.name === p.name);
  function reverse(targetRgb, availableIds, top = 3) {
    const targetLab = Color.rgbToLab(targetRgb);
    const zt = mixbox.rgbToLatent(...targetRgb);
    let pool = availableIds.map((id) => byId[id]).filter((p) => p && p.mixable);
    const found = [];
    const pairBest = new Map(pool.map((p) => [p, Infinity]));
    for (let i = 0; i < pool.length; i++) {
      const one = latentFit([pool[i]], zt);
      found.push(one);
      pairBest.set(pool[i], Math.min(pairBest.get(pool[i]), one.d));
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[i].name === pool[j].name) continue;
        const two = latentFit([pool[i], pool[j]], zt);
        found.push(two);
        pairBest.set(pool[i], Math.min(pairBest.get(pool[i]), two.d));
        pairBest.set(pool[j], Math.min(pairBest.get(pool[j]), two.d));
      }
    }
    if (pool.length > MAX_POOL) {
      pool = [...pool].sort((a, b) => pairBest.get(a) - pairBest.get(b)).slice(0, MAX_POOL);
      // 白は明るさの調整に使うので、持っていれば必ず1色は残す
      const white = WHITE_IDS.map((id) => byId[id]).find((p) => availableIds.includes(p.id));
      if (white && !pool.some((p) => WHITE_IDS.includes(p.id))) pool[pool.length - 1] = white;
    }
    const n = pool.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (pool[i].name === pool[j].name) continue;
        for (let k = j + 1; k < n; k++) {
          if (sameName([pool[i], pool[j]], pool[k])) continue;
          found.push(latentFit([pool[i], pool[j], pool[k]], zt));
        }
      }
    }
    found.sort((a, b) => a.d - b.d);
    const seeds = found.filter((r) => r.set.length >= 2).slice(0, 6);
    for (const s of seeds) {
      for (const p of pool) {
        if (s.set.includes(p) || sameName(s.set, p)) continue;
        found.push(latentFit([...s.set, p], zt));
      }
    }
    const seen = new Set();
    return found
      .sort((a, b) => a.d - b.d)
      .slice(0, REFINE)
      .map((f) => refine(f, targetLab))
      .sort((a, b) => a.d - b.d)
      .slice(0, 60)
      .map((r) => finalize(r, targetLab))
      .sort((a, b) => a.score - b.score)
      .filter((c) => {
        // 色名の組み合わせが同じ候補（ラインが違うだけ）は、いちばん近いものだけを残す
        const key = c.items.map((x) => byId[x.paintId].name).sort().join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, top);
  }

  function evaluate(items, targetRgb) {
    const valid = items.filter((x) => byId[x.paintId] && x.pct > 0);
    if (!valid.length) return null;
    const rgb = mixRgb(valid.map((x) => byId[x.paintId]), valid.map((x) => x.pct));
    const out = { rgb, hex: Color.toHex(rgb) };
    if (targetRgb) out.de = Color.dE00(Color.rgbToLab(rgb), Color.rgbToLab(targetRgb));
    return out;
  }

  return { lines, lineById, paints, byId, OPACITY, WHITE_ID, WHITE_IDS, whiteOf, STARTER_IDS, mediums, mediumById, mixRgb, reverse, evaluate };
})();
