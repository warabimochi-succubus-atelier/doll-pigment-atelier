// 画像上で範囲を選び、色を取得するキャンバス。拡大・スクロールにも対応する
//
// マウス（PC）
//   ・左ボタンのドラッグ：範囲選択（クリックはその点）
//   ・ホイール：スクロール（枠の端まで行ったら画面がスクロールする）
//   ・Ctrl＋ホイール（トラックパッドのピンチ）：拡大縮小
//   ・中ボタンのドラッグ、「移動」モードでのドラッグ：画像を動かす
// タッチ（スマホ・タブレット）
//   ・1本指のスワイプ：スクロール（ブラウザ標準。拡大中は枠の中、端まで行ったら画面）
//   ・タップ：その点の色を取る
//   ・長押ししてからドラッグ：範囲選択
//   ・2本指：拡大縮小と移動
class Picker {
  static MIN_ZOOM = 1;
  static MAX_ZOOM = 8;
  static LONG_PRESS_MS = 350;
  static TAP_SLOP = 10; // これ以上動いたらタップ・長押しではなくスクロールとみなす（px）

  constructor(host, { onPick, onGray, overlays, onZoom }) {
    this.host = host;
    this.onPick = onPick;
    this.onGray = onGray;
    this.onZoom = onZoom;
    this.overlays = overlays || (() => []);
    this.img = null;
    this.drag = null;      // 範囲選択中 { x0, y0, x1, y1 }
    this.pan = null;       // マウスで画像を動かしている { x, y }
    this.pinch = null;     // 2本指での拡大・移動中 { d0, z0, mx, my }
    this.press = null;     // タッチの長押し待ち { id, x, y, timer }
    this.pointers = new Map();
    this.grayMode = false;
    this.panMode = false;
    this.zoom = 1;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pick-canvas';
    this.ctx = this.canvas.getContext('2d');
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.cancel(e));
    // 長押し後のドラッグと2本指の操作では、ブラウザのスクロールを止める
    c.addEventListener('touchmove', (e) => {
      if (this.drag || this.pinch || e.touches.length >= 2) e.preventDefault();
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しのメニューを出さない
    this.host.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('resize', () => this.applyWidth());
  }

  // img: { canvas(原寸), gains?, view? }  view は画像ごとの拡大率とスクロール位置
  setImage(img) {
    if (this.img) this.img.view = { zoom: this.zoom, sl: this.host.scrollLeft, st: this.host.scrollTop };
    this.img = img;
    this.resetGesture();
    this.host.innerHTML = '';
    this.host.classList.toggle('has-img', !!img);
    if (!img) return;
    this.canvas.width = img.canvas.width;
    this.canvas.height = img.canvas.height;
    this.host.appendChild(this.canvas);
    const v = img.view || { zoom: 1, sl: 0, st: 0 };
    this.zoom = v.zoom;
    this.applyWidth();
    this.host.scrollLeft = v.sl;
    this.host.scrollTop = v.st;
    this.onZoom && this.onZoom(this.zoom);
    this.draw();
  }

  // ---- 表示の大きさ ----
  // 100% は画像全体が枠に収まる大きさ（横は枠の幅、縦は枠の最大の高さまで）
  fitFraction() {
    const host = this.host;
    const maxH = parseFloat(getComputedStyle(host).maxHeight);
    const w = host.clientWidth;
    if (!w || !maxH || !this.canvas.width) return 1;
    return Math.min(1, (maxH * this.canvas.width) / this.canvas.height / w);
  }
  applyWidth() {
    if (!this.img) return;
    this.canvas.style.width = `${this.zoom * this.fitFraction() * 100}%`;
  }

  // (cx, cy) は拡大の中心（画面座標）。省略時は表示範囲の中央
  setZoom(z, cx, cy) {
    if (!this.img) return;
    z = Math.min(Picker.MAX_ZOOM, Math.max(Picker.MIN_ZOOM, z));
    const old = this.zoom;
    if (Math.abs(z - old) < 1e-3) return;
    const host = this.host, hr = host.getBoundingClientRect(), cr = this.canvas.getBoundingClientRect();
    const px = (cx ?? hr.left + host.clientWidth / 2), py = (cy ?? hr.top + host.clientHeight / 2);
    // 中心にある画像上の位置（0〜1）を、拡大後も同じ画面位置に保つ
    const fx = (px - cr.left) / cr.width, fy = (py - cr.top) / cr.height;
    this.zoom = z;
    this.applyWidth();
    const nr = this.canvas.getBoundingClientRect();
    host.scrollLeft += nr.left + fx * nr.width - px;
    host.scrollTop += nr.top + fy * nr.height - py;
    this.onZoom && this.onZoom(z);
  }
  zoomBy(f, cx, cy) { this.setZoom(this.zoom * f, cx, cy); }
  fit() { this.setZoom(1); this.host.scrollLeft = 0; this.host.scrollTop = 0; }

  wheel(e) {
    if (!this.img || !e.ctrlKey) return; // ふつうのホイールはブラウザ標準のスクロール
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
  }

  // ---- ポインター操作 ----
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) / r.width) * this.canvas.width),
      Math.round(((e.clientY - r.top) / r.height) * this.canvas.height),
    ];
  }
  midAndDist() {
    const [a, b] = [...this.pointers.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  }
  clearPress() {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }
  resetGesture() {
    this.clearPress();
    this.drag = this.pan = this.pinch = null;
    this.pointers.clear();
    this.host.classList.remove('panning', 'selecting');
  }
  startDrag(clientX, clientY) {
    const p = this.pos({ clientX, clientY });
    this.drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
  }

  down(e) {
    if (!this.img) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 取得できなくても操作は続ける */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      // 2本指：範囲選択や長押し待ちをやめて、拡大・移動に切り替える
      this.clearPress();
      this.drag = this.pan = null;
      this.host.classList.remove('selecting');
      const { mx, my, d } = this.midAndDist();
      this.pinch = { d0: d, z0: this.zoom, mx, my };
      this.draw();
      return;
    }
    if (this.pointers.size > 2) return;

    if (e.pointerType === 'touch') {
      // 1本指：すぐには選択を始めない。動かずに長押しされたら範囲選択、すぐ離したらタップ
      const press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      press.timer = setTimeout(() => {
        if (this.press !== press) return;
        this.press = null;
        this.startDrag(press.x, press.y);
        this.host.classList.add('selecting');
        navigator.vibrate?.(15);
        this.draw();
      }, Picker.LONG_PRESS_MS);
      this.press = press;
      return;
    }
    if (this.panMode || e.button === 1) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY };
      this.host.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    this.startDrag(e.clientX, e.clientY);
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const { mx, my, d } = this.midAndDist();
      this.setZoom(this.pinch.z0 * (d / this.pinch.d0), mx, my);
      this.host.scrollLeft -= mx - this.pinch.mx;
      this.host.scrollTop -= my - this.pinch.my;
      this.pinch.mx = mx;
      this.pinch.my = my;
      return;
    }
    if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > Picker.TAP_SLOP) {
      this.clearPress(); // 指が動いた＝スクロール。ブラウザに任せる
      return;
    }
    if (this.pan) {
      this.host.scrollLeft -= e.clientX - this.pan.x;
      this.host.scrollTop -= e.clientY - this.pan.y;
      this.pan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!this.drag) return;
    [this.drag.x1, this.drag.y1] = this.pos(e);
    this.draw();
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null; // 指を離しても範囲選択にはしない
      return;
    }
    if (this.press && this.press.id === e.pointerId) {
      // 長押しになる前に離した＝タップ：その点の色を取る
      const { x, y } = this.press;
      this.clearPress();
      this.startDrag(x, y);
    }
    if (this.pan) {
      this.pan = null;
      this.host.classList.remove('panning');
      return;
    }
    if (!this.drag) return;
    this.host.classList.remove('selecting');
    const { x0, y0, x1, y1 } = this.drag;
    this.drag = null;
    let rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (rect.w < 6 || rect.h < 6) rect = { x: x0 - 4, y: y0 - 4, w: 9, h: 9 }; // クリック・タップ = 点取得
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

  // ブラウザがスクロールを始めたときなどに呼ばれる
  cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.clearPress();
    this.drag = this.pan = null;
    this.host.classList.remove('panning', 'selecting');
    this.draw();
  }

  setPanMode(on) {
    this.panMode = on;
    this.host.classList.toggle('pan-mode', on);
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
    // 拡大しても枠線が太くなりすぎないように、表示倍率で割る
    const lw = Math.max(1.2, W / 300 / Math.sqrt(this.zoom));
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

// 画像（img / video / canvas）→ 長辺 maxSide に縮めたキャンバス
function drawableToCanvas(src, w, h, maxSide = 1200) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// File → 長辺 maxSide に縮めたキャンバス
function fileToCanvas(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const c = drawableToCanvas(im, im.width, im.height, maxSide);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    im.onerror = reject;
    im.src = url;
  });
}

function canvasThumb(canvas, maxSide = 240) {
  return drawableToCanvas(canvas, canvas.width, canvas.height, maxSide).toDataURL('image/jpeg', 0.8);
}
