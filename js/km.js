// 標準DB（リキテックス レギュラー / ソフト / ベーシックス）と Kubelka-Munk による混色・逆引き調色
// K・S は RGB 3チャンネルで近似する。js/paints-ks.js に実測値（仕様書 3.5）がある絵具はそれを使い、
// ない絵具は、仮の色（チャートの色見本の平均色）と仮の着色力から求めた仮の値を使う
const PaintDB = (() => {
  const OPACITY = { opaque: '不透明', semi: '半透明', transparent: '透明' };

  const lines = PAINT_LINES;
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));

  const MEASURED = typeof PAINT_KS === 'object' && PAINT_KS ? PAINT_KS : {};

  const paints = PAINT_DATA.map(([id, line, no, name, chartHex, opacity, group, strength, discontinued = false]) => {
    // メタリック・蛍光・イリディッセントは混色計算で表せないので、逆引き調色に使わない
    const mixable = group !== 'special';
    const m = mixable ? MEASURED[id] : null;
    let K, S, rgb;
    if (m) {
      // 実測値：色見本も K・S から求めた絵具だけの色にする
      K = [...m.K];
      S = [...m.S];
      rgb = Color.linearToRgb(K.map((k, c) => { const ks = k / S[c]; return 1 + ks - Math.sqrt(ks * ks + 2 * ks); }));
    } else {
      rgb = Color.parseHex(chartHex);
      const R = Color.rgbToLinear(rgb).map((r) => Math.min(0.97, Math.max(0.035, r)));
      const ks = R.map((r) => ((1 - r) * (1 - r)) / (2 * r));
      S = [strength, strength, strength];
      K = ks.map((v) => v * strength);
    }
    const hex = Color.toHex(rgb);
    // label は画面表示用（品番＋色名。ベーシックスは品番がないので色名だけ）
    // fullLabel はラインの違う同じ色と区別するための表示（ラインを添える）
    const label = no ? `${no} ${name}` : name;
    const fullLabel = `${label}（${lineById[line].name}）`;
    return { id, line, no, name, label, fullLabel, hex, chartHex, rgb, lab: Color.rgbToLab(rgb), K, S, strength, opacity, group, mixable, discontinued, measured: !!m };
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

  // 重量比 weights（任意スケール）で混色した線形反射率
  function mixLinear(list, weights) {
    let tw = 0;
    for (const w of weights) tw += w;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let K = 0, S = 0;
      for (let i = 0; i < list.length; i++) {
        const w = weights[i] / tw;
        K += w * list[i].K[c];
        S += w * list[i].S[c];
      }
      const ks = K / S;
      out[c] = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
    }
    return out;
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

  // 組み合わせ set の中で、目標に最も近い割合を探す（探索の中心なので、配列を作らずに計算する）
  // K/S は重みの合計で割っても変わらないので、割合は整数のまま使う。比較は ΔE76 の2乗で行う
  const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const KM_R = (K, S) => { const ks = K / S; return 1 + ks - Math.sqrt(ks * ks + 2 * ks); };
  function bestForSet(set, targetLab) {
    const comps = COMPS[set.length], n = set.length;
    const [tL, ta, tb] = targetLab;
    let bestI = 0, bestD = Infinity;
    for (let ci = 0; ci < comps.length; ci++) {
      const comp = comps[ci];
      let K0 = 0, K1 = 0, K2 = 0, S0 = 0, S1 = 0, S2 = 0;
      for (let i = 0; i < n; i++) {
        const w = comp[i], p = set[i];
        K0 += w * p.K[0]; K1 += w * p.K[1]; K2 += w * p.K[2];
        S0 += w * p.S[0]; S1 += w * p.S[1]; S2 += w * p.S[2];
      }
      const r = KM_R(K0, S0), g = KM_R(K1, S1), b = KM_R(K2, S2);
      // 線形 RGB → Lab（Color.linearToLab と同じ式）
      const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
      const fy = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
      const fz = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
      const dL = 116 * fy - 16 - tL, da = 500 * (fx - fy) - ta, db = 200 * (fy - fz) - tb;
      const d = dL * dL + da * da + db * db;
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
  // ラインが違うだけの同じ色名の絵具（例：レギュラーとベーシックスのチタニウムホワイト）は、1つの候補に同時に使わない
  const sameName = (set, p) => set.some((q) => q.name === p.name);
  function reverse(targetRgb, availableIds, top = 3) {
    const targetLab = Color.rgbToLab(targetRgb);
    let pool = availableIds.map((id) => byId[id]).filter((p) => p && p.mixable);
    const found = [];
    const pairBest = new Map(pool.map((p) => [p, Infinity]));
    for (let i = 0; i < pool.length; i++) {
      const one = bestForSet([pool[i]], targetLab);
      found.push(one);
      pairBest.set(pool[i], Math.min(pairBest.get(pool[i]), one.d));
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[i].name === pool[j].name) continue;
        const two = bestForSet([pool[i], pool[j]], targetLab);
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
          found.push(bestForSet([pool[i], pool[j], pool[k]], targetLab));
        }
      }
    }
    found.sort((a, b) => a.d - b.d);
    const seeds = found.filter((r) => r.set.length >= 2).slice(0, 6);
    for (const s of seeds) {
      for (const p of pool) {
        if (s.set.includes(p) || sameName(s.set, p)) continue;
        found.push(bestForSet([...s.set, p], targetLab));
      }
    }
    const seen = new Set();
    return found
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

  // 絵具置換：指定絵具を、マストーンが最も近い別の絵具に置き換えて割合を再計算
  function substitute(candidate, paintId, targetRgb, availableIds) {
    const targetLab = Color.rgbToLab(targetRgb);
    const used = new Set(candidate.items.map((x) => x.paintId));
    const from = byId[paintId];
    const rest = candidate.items.filter((x) => x.paintId !== paintId).map((x) => byId[x.paintId]);
    const alt = availableIds
      .filter((id) => !used.has(id) && id !== paintId)
      .map((id) => byId[id])
      .filter((p) => p && p.mixable && !sameName(rest, p))
      .sort((a, b) => Color.dE00(a.lab, from.lab) - Color.dE00(b.lab, from.lab))[0];
    if (!alt) return null;
    const set = candidate.items.map((x) => (x.paintId === paintId ? alt : byId[x.paintId]));
    const res = finalize(bestForSet(set, targetLab), targetLab);
    res.substituted = { from: from.id, to: alt.id };
    return res;
  }

  function evaluate(items, targetRgb) {
    const valid = items.filter((x) => byId[x.paintId] && x.pct > 0);
    if (!valid.length) return null;
    const rgb = mixRgb(valid.map((x) => byId[x.paintId]), valid.map((x) => x.pct));
    const out = { rgb, hex: Color.toHex(rgb) };
    if (targetRgb) out.de = Color.dE00(Color.rgbToLab(rgb), Color.rgbToLab(targetRgb));
    return out;
  }

  return { lines, lineById, paints, byId, OPACITY, WHITE_ID, WHITE_IDS, whiteOf, STARTER_IDS, mediums, mediumById, mixRgb, reverse, substitute, evaluate };
})();
