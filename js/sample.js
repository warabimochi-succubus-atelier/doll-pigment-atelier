// デモ用サンプル画像：アニメ系ドールの顔（照明違い・グレーカード入り）
// variant: 'natural'（自然光・やや青み） / 'warm'（室内光・黄みが強く暗め）
function makeSampleCanvas(variant = 'natural') {
  const W = 900, H = 640, cx = 450;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  const ellipse = (x, y, rx, ry, fill, rot = 0) => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  };
  const radial = (x, y, r, stops) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    return g;
  };

  // ---- 背景 ----
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#f7e6ef');
  bg.addColorStop(1, '#e6e1f4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  [[90, 90, 60], [810, 120, 46], [120, 520, 70], [760, 420, 36], [60, 300, 26], [850, 280, 22]].forEach(([x, y, r]) =>
    ellipse(x, y, r, r, radial(x, y, r, [[0, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']])));
  // きらきら
  const star = (x, y, s, col) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fillStyle = col; ctx.fill();
  };
  [[150, 160, 14], [740, 70, 11], [800, 520, 12], [70, 420, 9], [690, 200, 8]].forEach(([x, y, s]) => star(x, y, s, 'rgba(255,255,255,.9)'));

  // ---- 後ろ髪 ----
  const HAIR = '#eeaec4', HAIR_SH = '#d98aa6', HAIR_LINE = 'rgba(176,92,128,.7)';
  ctx.fillStyle = HAIR_SH;
  ctx.beginPath();
  ctx.moveTo(cx - 300, H);
  ctx.bezierCurveTo(cx - 330, 380, cx - 330, 60, cx, 50);
  ctx.bezierCurveTo(cx + 330, 60, cx + 330, 380, cx + 300, H);
  ctx.closePath();
  ctx.fill();

  // ---- 首 ----
  ctx.fillStyle = '#f3dccf';
  ctx.fillRect(cx - 60, 540, 120, 120);

  // ---- 顔 ----
  const face = () => {
    ctx.beginPath();
    ctx.moveTo(cx, 95);
    ctx.bezierCurveTo(cx + 190, 95, cx + 245, 200, cx + 240, 320);
    ctx.bezierCurveTo(cx + 235, 445, cx + 125, 570, cx, 588);
    ctx.bezierCurveTo(cx - 125, 570, cx - 235, 445, cx - 240, 320);
    ctx.bezierCurveTo(cx - 245, 200, cx - 190, 95, cx, 95);
    ctx.closePath();
  };
  face();
  ctx.fillStyle = radial(cx, 300, 330, [[0, '#fdf3ec'], [0.7, '#f9e6dc'], [1, '#efd2c4']]);
  ctx.fill();

  // チーク（抽出用にしっかりめ）
  for (const s of [-1, 1]) {
    const x = cx + s * 150, y = 455;
    ellipse(x, y, 92, 70, radial(x, y, 92, [[0, 'rgba(240,138,155,.85)'], [0.5, 'rgba(240,138,155,.55)'], [1, 'rgba(240,138,155,0)']]));
  }

  // ---- 目 ----
  for (const s of [-1, 1]) {
    const ex = cx + s * 112, ey = 372;
    // アイシャドウ
    ellipse(ex, ey - 28, 100, 66, radial(ex, ey - 28, 100, [[0, 'rgba(214,132,120,.6)'], [0.6, 'rgba(214,132,120,.35)'], [1, 'rgba(214,132,120,0)']]));
    // 白目
    ctx.save();
    ellipse(ex, ey, 56, 64, '#ffffff');
    ctx.clip();
    // 虹彩
    const ig = ctx.createLinearGradient(0, ey - 60, 0, ey + 60);
    ig.addColorStop(0, '#5b2340');
    ig.addColorStop(0.55, '#b8456c');
    ig.addColorStop(1, '#f39ab4');
    ellipse(ex + s * 4, ey + 6, 46, 58, ig);
    ellipse(ex + s * 4, ey + 6, 46, 58, radial(ex + s * 4, ey + 26, 46, [[0, 'rgba(255,200,215,.55)'], [1, 'rgba(255,200,215,0)']]));
    // 瞳孔
    ellipse(ex + s * 4, ey + 4, 19, 25, '#3a1428');
    // 上まぶたの影
    ellipse(ex, ey - 62, 70, 30, 'rgba(120,60,80,.35)');
    ctx.restore();
    // ハイライト
    ellipse(ex - 16, ey - 20, 15, 19, '#ffffff', -0.3);
    ellipse(ex + 18, ey + 30, 7, 7, '#ffffff');
    ellipse(ex - 4, ey + 40, 4, 4, 'rgba(255,255,255,.8)');
    // 上まつげ
    const o = s; // 外側方向
    ctx.strokeStyle = '#3b2430'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(ex - o * 60, ey - 14);
    ctx.quadraticCurveTo(ex - o * 10, ey - 82, ex + o * 66, ey - 34);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); // 目尻のはね
    ctx.moveTo(ex + o * 60, ey - 38);
    ctx.quadraticCurveTo(ex + o * 80, ey - 44, ex + o * 88, ey - 60);
    ctx.moveTo(ex + o * 52, ey - 46);
    ctx.quadraticCurveTo(ex + o * 66, ey - 62, ex + o * 70, ey - 80);
    ctx.stroke();
    // 下まつげ
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(80,40,55,.7)';
    ctx.beginPath();
    ctx.moveTo(ex - o * 40, ey + 58);
    ctx.quadraticCurveTo(ex + o * 10, ey + 72, ex + o * 50, ey + 48);
    ctx.stroke();
    // 二重のライン
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(150,90,100,.6)';
    ctx.beginPath();
    ctx.moveTo(ex - o * 50, ey - 50);
    ctx.quadraticCurveTo(ex, ey - 96, ex + o * 58, ey - 58);
    ctx.stroke();
  }

  // 鼻・口
  ctx.strokeStyle = 'rgba(200,140,130,.8)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 4, 455); ctx.quadraticCurveTo(cx + 2, 462, cx + 6, 458); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 30, 500);
  ctx.quadraticCurveTo(cx, 508, cx + 30, 500);
  ctx.quadraticCurveTo(cx, 540, cx - 30, 500);
  ctx.closePath();
  ctx.fillStyle = '#d95a72'; ctx.fill();
  ellipse(cx, 520, 13, 6, '#f08aa0');
  ellipse(cx - 8, 504, 6, 2, 'rgba(255,255,255,.6)');

  // ---- 前髪・横髪 ----
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(cx - 262, 360);
  ctx.bezierCurveTo(cx - 280, 120, cx - 160, 40, cx, 40);
  ctx.bezierCurveTo(cx + 160, 40, cx + 280, 120, cx + 262, 360);
  const tips = [
    [235, 300], [195, 238], [160, 292], [112, 228], [70, 282], [20, 226],
    [-28, 284], [-78, 230], [-122, 290], [-170, 236], [-212, 298], [-240, 250],
  ];
  let [px, py] = [262, 360];
  for (const [tx, ty] of tips) {
    ctx.quadraticCurveTo(cx + (px + tx) / 2 + 6, (py + ty) / 2 - 18, cx + tx, ty);
    [px, py] = [tx, ty];
  }
  ctx.quadraticCurveTo(cx - 250, 300, cx - 262, 360);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = HAIR_LINE; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.stroke();
  // 横髪
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 262, 250);
    ctx.bezierCurveTo(cx + s * 280, 420, cx + s * 250, 540, cx + s * 215, 630);
    ctx.lineTo(cx + s * 190, 630);
    ctx.bezierCurveTo(cx + s * 215, 520, cx + s * 225, 400, cx + s * 220, 260);
    ctx.closePath();
    ctx.fillStyle = HAIR; ctx.fill();
    ctx.strokeStyle = HAIR_LINE; ctx.lineWidth = 3; ctx.stroke();
  }
  // 髪の毛束の線
  ctx.strokeStyle = HAIR_LINE; ctx.lineWidth = 2.5;
  [[-150, 236], [-60, 240], [40, 236], [140, 236]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.moveTo(cx + x * 0.6, 80); ctx.quadraticCurveTo(cx + x * 0.9, 150, cx + x, y); ctx.stroke();
  });
  // 天使の輪
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.ellipse(cx, 175, 175, 70, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();

  // 眉（前髪から透ける）
  ctx.strokeStyle = 'rgba(185,125,146,.75)'; ctx.lineWidth = 4;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 70, 290);
    ctx.quadraticCurveTo(cx + s * 110, 276, cx + s * 150, 286);
    ctx.stroke();
  }

  // ---- リボン ----
  const bow = (x, y) => {
    ctx.fillStyle = '#9b86e0';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + s * 30, y - 60, x + s * 85, y - 50, x + s * 80, y);
      ctx.bezierCurveTo(x + s * 85, y + 45, x + s * 30, y + 50, x, y);
      ctx.fill();
      ctx.beginPath(); // たれ
      ctx.moveTo(x, y);
      ctx.lineTo(x + s * 35, y + 80);
      ctx.lineTo(x + s * 55, y + 70);
      ctx.closePath();
      ctx.fill();
    }
    ellipse(x, y, 18, 20, '#7461c4');
    ellipse(x - 5, y - 6, 6, 5, 'rgba(255,255,255,.45)');
  };
  bow(cx - 175, 105);
  // ハートの髪飾り
  const heart = (x, y, s, col) => {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.4);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
    ctx.fillStyle = col; ctx.fill();
  };
  heart(cx + 205, 150, 22, '#f07a95');

  // ---- グレーカード（18%） ----
  ctx.fillStyle = '#777777';
  ctx.fillRect(W - 130, H - 130, 100, 100);
  ctx.fillStyle = '#8c7f88';
  ctx.font = '14px sans-serif';
  ctx.fillText('GRAY 18%', W - 122, H - 140);

  // ---- 照明の違い（線形空間でチャンネルごとにゲインを掛ける）＋ノイズ ----
  const gains = variant === 'warm' ? [0.86, 0.70, 0.48] : [0.97, 1.0, 1.05];
  const lut = gains.map((g) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const lin = Color.rgbToLinear([v, v, v])[0] * g;
      t[v] = Color.linearToRgb([lin, lin, lin])[0];
    }
    return t;
  });
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 8;
    d[i] = lut[0][d[i]] + n;
    d[i + 1] = lut[1][d[i + 1]] + n;
    d[i + 2] = lut[2][d[i + 2]] + n;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
