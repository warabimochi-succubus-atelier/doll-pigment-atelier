// 調色の画面で使う計算（画面の状態に頼らない純粋な関数。tests/calc.test.js でテストする）
const Calc = (() => {
  // 抽出色の平均（線形空間で平均してから sRGB に戻す）。list は { rgb } の配列
  function averageRgb(list) {
    const lin = list.map((x) => Color.rgbToLinear(x.rgb));
    return Color.linearToRgb([0, 1, 2].map((c) => lin.reduce((s, l) => s + l[c], 0) / lin.length));
  }

  // 外れた色：その色を除いた残りの平均から ΔE2000 がこれ以上離れている抽出色（3色以上のとき）。
  // ただし、残りの抽出色のばらつき（残りの平均から最も離れた色の ΔE）の2倍以上離れているときに限る。
  // 照明の違う画像から取って色が広がっているときに、両端の色にまで印が付かないようにするため
  const OUTLIER_DE = 10;
  const OUTLIER_SPREAD_RATIO = 2;
  // xs は { id, rgb } の配列。外れた色の id → ΔE
  function outliers(xs) {
    const out = new Map();
    if (xs.length < 3) return out;
    const labs = new Map(xs.map((x) => [x.id, Color.rgbToLab(x.rgb)]));
    for (const x of xs) {
      const rest = xs.filter((y) => y !== x);
      const restLab = Color.rgbToLab(averageRgb(rest));
      const de = Color.dE00(labs.get(x.id), restLab);
      if (de < OUTLIER_DE) continue;
      const spread = Math.max(...rest.map((y) => Color.dE00(labs.get(y.id), restLab)));
      if (de >= spread * OUTLIER_SPREAD_RATIO) out.set(x.id, de);
    }
    return out;
  }
  // 2色だけのときは、どちらが外れているか決められないので差だけを知らせる（離れていなければ 0）
  function pairGap(xs) {
    if (xs.length !== 2) return 0;
    const de = Color.dE00(Color.rgbToLab(xs[0].rgb), Color.rgbToLab(xs[1].rgb));
    return de >= OUTLIER_DE ? de : 0;
  }

  // 実際の調色を、比率を変えずに合計100%（整数）にそろえる。0%の絵具は外す
  // （端数は、切り捨てで減った分の大きい絵具から1%ずつ足す）
  function normalizeMix(items) {
    const valid = items.filter((x) => x.pct > 0);
    const total = valid.reduce((s, x) => s + x.pct, 0);
    if (!total) return [];
    const raw = valid.map((x) => (x.pct * 100) / total);
    const out = valid.map((x, i) => ({ ...x, pct: Math.floor(raw[i]) }));
    let rest = 100 - out.reduce((s, x) => s + x.pct, 0);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
      .forEach(([, i]) => { if (rest > 0) { out[i].pct++; rest--; } });
    return out;
  }

  // 数値で指定した色：HEX（#D98C8C）または RGB（217, 140, 140）。読めなければ null
  function parseColorText(text) {
    const hex = Color.parseHex(text);
    if (hex) return hex;
    const m = String(text).match(/\d+/g);
    return m && m.length === 3 && m.every((v) => +v <= 255) ? m.map(Number) : null;
  }

  return { averageRgb, outliers, pairGap, normalizeMix, parseColorText, OUTLIER_DE };
})();
