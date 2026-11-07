// 白との混色見本の反射率から、絵具の K・S を求める（仕様書 3.5 の手順 4〜5）
//
// Kubelka-Munk（下地が透けない厚さ）では、反射率 R と K/S の関係は  K/S = (1 − R)² ÷ 2R
// 絵具の割合 c、白の割合 w = 1 − c で混ぜた見本の K/S は
//   q = (c·Kp + w·Kw) / (c·Sp + w·Sw)
// 白の S を 1 とする（Sw = 1）。白の K は白だけの見本から Kw = q_white として求める。
// 式を変形すると、未知数 Kp・Sp について1次式になる：
//   c·Kp − q·c·Sp = w·(q − Kw)
// 割合の違う見本を2つ以上（そのうち1つは白を混ぜたもの）使い、RGB チャンネルごとに最小二乗法で解く。
const KSFit = (() => {
  const MIN_R = 1e-4, MAX_R = 0.9999;
  const ksOf = (R) => {
    const r = Math.min(MAX_R, Math.max(MIN_R, R));
    return ((1 - r) * (1 - r)) / (2 * r);
  };
  const rOf = (ks) => 1 + ks - Math.sqrt(ks * ks + 2 * ks);

  // 白だけの見本（線形の反射率 [r, g, b] の一覧）から、白の K を求める（S = 1）
  function fitWhite(samples) {
    if (!samples.length) return null;
    const K = [0, 1, 2].map((ch) => samples.reduce((s, x) => s + ksOf(x[ch]), 0) / samples.length);
    return { K, S: [1, 1, 1] };
  }

  // samples: [{ c: 絵具の割合 (0〜1], lin: 線形の反射率 [r, g, b] }]、whiteK: 白の K [r, g, b]
  // 返す：{ ok, K, S, error }
  function fitPaint(samples, whiteK) {
    const cs = [...new Set(samples.map((x) => +x.c.toFixed(4)))];
    if (cs.length < 2) return { ok: false, error: '割合の違う見本が2つ以上必要です' };
    if (!samples.some((x) => x.c < 0.999)) return { ok: false, error: '白を混ぜた見本が必要です' };
    const K = [], S = [];
    for (let ch = 0; ch < 3; ch++) {
      // 正規方程式 [Saa Sab; Sab Sbb] [Kp; Sp] = [Sa_y; Sb_y]
      let saa = 0, sab = 0, sbb = 0, say = 0, sby = 0;
      const rows = samples.map((x) => {
        const q = ksOf(x.lin[ch]);
        return { a: x.c, b: -q * x.c, y: (1 - x.c) * (q - whiteK[ch]) };
      });
      for (const r of rows) {
        saa += r.a * r.a; sab += r.a * r.b; sbb += r.b * r.b; say += r.a * r.y; sby += r.b * r.y;
      }
      const det = saa * sbb - sab * sab;
      let kp = det ? (say * sbb - sab * sby) / det : NaN;
      let sp = det ? (saa * sby - sab * say) / det : NaN;
      if (!(kp >= 0)) {
        // K が負になったら K = 0 として S だけを求める（白に近い色で起こりやすい）
        kp = 0;
        sp = sbb ? sby / sbb : NaN;
      }
      if (!(sp > 0) || !Number.isFinite(sp)) return { ok: false, error: `${'RGB'[ch]} チャンネルの S を求められませんでした（見本の色や割合を確認してください）` };
      K.push(kp);
      S.push(sp);
    }
    return { ok: true, K, S };
  }

  // 求めた K・S で、割合 c の見本の線形の反射率を予測する
  function predict(paint, white, c) {
    return [0, 1, 2].map((ch) => {
      const k = c * paint.K[ch] + (1 - c) * white.K[ch];
      const s = c * paint.S[ch] + (1 - c) * white.S[ch];
      return rOf(k / s);
    });
  }

  // 見本ごとの ΔE2000（実測した色と、求めた K・S から予測した色の差）
  function residuals(samples, paint, white) {
    return samples.map((x) => Color.dE00(Color.linearToLab(x.lin), Color.linearToLab(predict(paint, white, x.c))));
  }

  // 絵具:白 の重量比 → 絵具の割合
  const fraction = (paintW, whiteW) => paintW / (paintW + whiteW);

  return { ksOf, rOf, fitWhite, fitPaint, predict, residuals, fraction };
})();
