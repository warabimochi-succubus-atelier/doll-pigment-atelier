// 標準DB（リキテックス）と Kubelka-Munk による混色・逆引き調色
// ※モック: K・S は実測ではなく、マストーン色と着色力から RGB 3チャンネルで近似した仮の値
const PaintDB = (() => {
  // [id, 名称, マストーンHEX, 着色力（K・S の倍率。白 = 1）]
  const RAW = [
    ['titanium-white', 'Titanium White', '#F5F4F0', 1.0],
    ['unbleached-titanium', 'Unbleached Titanium', '#E3D3B6', 1.0],
    ['light-portrait-pink', 'Light Portrait Pink', '#F2B8A4', 1.0],
    ['cad-yellow-med-hue', 'Cadmium Yellow Medium Hue', '#F0B000', 0.56],
    ['yellow-ochre', 'Yellow Ochre', '#BE8A30', 0.48],
    ['raw-sienna', 'Raw Sienna', '#A6652B', 0.48],
    ['pyrrole-orange', 'Pyrrole Orange', '#DF561E', 0.64],
    ['cad-red-med-hue', 'Cadmium Red Medium Hue', '#C4252C', 0.64],
    ['naphthol-crimson', 'Naphthol Crimson', '#A81D34', 0.72],
    ['quinacridone-magenta', 'Quinacridone Magenta', '#8C1F50', 0.8],
    ['burnt-sienna', 'Burnt Sienna', '#86391F', 0.52],
    ['burnt-umber', 'Burnt Umber', '#4A2E22', 0.6],
    ['raw-umber', 'Raw Umber', '#4B3E2F', 0.6],
    ['dioxazine-purple', 'Dioxazine Purple', '#3B1F50', 1.2],
    ['ultramarine-blue', 'Ultramarine Blue (Green Shade)', '#24317C', 0.64],
    ['cerulean-blue-hue', 'Cerulean Blue Hue', '#2B70A8', 0.64],
    ['phthalo-blue', 'Phthalocyanine Blue (Green Shade)', '#103A6A', 1.6],
    ['hookers-green', "Hooker's Green Hue Permanent", '#2E4B2B', 0.8],
    ['mars-black', 'Mars Black', '#1E1D1D', 1.2],
  ];

  const paints = RAW.map(([id, name, hex, strength]) => {
    const rgb = Color.parseHex(hex);
    const R = Color.rgbToLinear(rgb).map((r) => Math.min(0.97, Math.max(0.035, r)));
    const ks = R.map((r) => ((1 - r) * (1 - r)) / (2 * r));
    const S = [strength, strength, strength];
    const K = ks.map((v) => v * strength);
    return { id, name, hex, rgb, lab: Color.rgbToLab(rgb), K, S, strength };
  });
  const byId = Object.fromEntries(paints.map((p) => [p.id, p]));

  // 調色記録で選べるメディウム（初期版は混色計算に含めない）
  const mediums = [
    { id: 'water', name: '水' },
    { id: 'matte-medium', name: 'Matte Medium' },
    { id: 'gloss-medium', name: 'Gloss Medium' },
    { id: 'glazing-medium', name: 'Glazing Medium' },
    { id: 'slow-dri-blending', name: 'Slow-Dri Blending Medium' },
    { id: 'flow-aid', name: 'Flow-Aid' },
  ];
  const mediumById = Object.fromEntries(mediums.map((m) => [m.id, m]));

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

  function bestForSet(set, targetLab) {
    let best = null;
    for (const comp of COMPS[set.length]) {
      const lab = Color.linearToLab(mixLinear(set, comp));
      const d = Color.dE76(lab, targetLab);
      if (!best || d < best.d) best = { set, comp, d };
    }
    return best;
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
  function reverse(targetRgb, availableIds, top = 3) {
    const targetLab = Color.rgbToLab(targetRgb);
    const pool = availableIds.map((id) => byId[id]).filter(Boolean);
    const found = [];
    const n = pool.length;
    for (let i = 0; i < n; i++) {
      found.push(bestForSet([pool[i]], targetLab));
      for (let j = i + 1; j < n; j++) {
        found.push(bestForSet([pool[i], pool[j]], targetLab));
        for (let k = j + 1; k < n; k++) found.push(bestForSet([pool[i], pool[j], pool[k]], targetLab));
      }
    }
    found.sort((a, b) => a.d - b.d);
    const seeds = found.filter((r) => r.set.length >= 2).slice(0, 6);
    for (const s of seeds) {
      for (const p of pool) {
        if (s.set.includes(p)) continue;
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
        const key = c.items.map((x) => x.paintId).sort().join('|');
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
    const alt = availableIds
      .filter((id) => !used.has(id) && id !== paintId)
      .map((id) => byId[id])
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

  return { paints, byId, mediums, mediumById, mixRgb, reverse, substitute, evaluate };
})();
