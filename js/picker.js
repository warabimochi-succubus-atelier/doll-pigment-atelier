// 画像上でドラッグして範囲を選び、色を取得するキャンバス
class Picker {
  constructor(host, { onPick, onGray, overlays }) {
    this.host = host;
    this.onPick = onPick;
    this.onGray = onGray;
    this.overlays = overlays || (() => []);
    this.img = null;
    this.drag = null;
    this.grayMode = false;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pick-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.draw(); });
  }

  // img: { canvas(原寸), gains? }
  setImage(img) {
    this.img = img;
    this.host.innerHTML = '';
    if (!img) return;
    this.canvas.width = img.canvas.width;
    this.canvas.height = img.canvas.height;
    this.host.appendChild(this.canvas);
    this.draw();
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) / r.width) * this.canvas.width),
      Math.round(((e.clientY - r.top) / r.height) * this.canvas.height),
    ];
  }
  down(e) {
    if (!this.img) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    this.drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
  }
  move(e) {
    if (!this.drag) return;
    [this.drag.x1, this.drag.y1] = this.pos(e);
    this.draw();
  }
  up() {
    if (!this.drag) return;
    let { x0, y0, x1, y1 } = this.drag;
    this.drag = null;
    let rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (rect.w < 6 || rect.h < 6) rect = { x: x0 - 4, y: y0 - 4, w: 9, h: 9 }; // クリック = 点取得
    rect = this.clamp(rect);
    if (this.grayMode) {
      const lin = this.sample(rect, null);
      this.onGray && this.onGray(lin, rect);
    } else {
      const lin = this.sample(rect, this.img.gains);
      this.onPick && this.onPick(Color.linearToRgb(lin), rect);
    }
    this.draw();
  }
  clamp(r) {
    const W = this.canvas.width, H = this.canvas.height;
    const x = Math.max(0, Math.min(W - 1, r.x)), y = Math.max(0, Math.min(H - 1, r.y));
    return { x, y, w: Math.max(1, Math.min(W - x, r.w)), h: Math.max(1, Math.min(H - y, r.h)) };
  }

  // 範囲の平均を線形空間で取る（グレーカード補正のゲインを適用）
  sample(r, gains) {
    const d = this.img.canvas.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lin = Color.rgbToLinear([d[i], d[i + 1], d[i + 2]]);
      sum[0] += lin[0]; sum[1] += lin[1]; sum[2] += lin[2];
      n++;
    }
    return sum.map((v, c) => (v / n) * (gains ? gains[c] : 1));
  }

  draw() {
    if (!this.img) return;
    const ctx = this.ctx, W = this.canvas.width;
    ctx.drawImage(this.img.canvas, 0, 0);
    const lw = Math.max(2, W / 300);
    ctx.lineWidth = lw;
    for (const o of this.overlays()) {
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
      ctx.strokeStyle = o.color || '#B85C74';
      ctx.setLineDash([lw * 3, lw * 2]);
      ctx.strokeRect(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
      ctx.setLineDash([]);
      if (o.label) {
        ctx.font = `bold ${Math.round(lw * 7)}px sans-serif`;
        const tw = ctx.measureText(o.label).width + lw * 4;
        ctx.fillStyle = o.color || '#B85C74';
        ctx.fillRect(o.rect.x, o.rect.y - lw * 9, tw, lw * 9);
        ctx.fillStyle = '#fff';
        ctx.fillText(o.label, o.rect.x + lw * 2, o.rect.y - lw * 2);
      }
    }
    if (this.drag) {
      const { x0, y0, x1, y1 } = this.drag;
      ctx.strokeStyle = this.grayMode ? '#888' : '#fff';
      ctx.setLineDash([lw * 2, lw * 2]);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
    }
  }
}

// File → 長辺 maxSide に縮めたキャンバス
function fileToCanvas(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, maxSide / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * s);
      c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    im.onerror = reject;
    im.src = url;
  });
}

function canvasThumb(canvas, maxSide = 240) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s);
  c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
