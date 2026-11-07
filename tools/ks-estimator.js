// K・S 推定ツール（開発用。仕様書 3.5）
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const linHex = (lin) => Color.toHex(Color.linearToRgb(lin));
  const f3 = (v) => v.map((x) => x.toFixed(4)).join(', ');
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 2800);
  }

  // ---------------- 状態 ----------------
  // 見本：{ id, paintId, pw, ww, lin: 補正後の線形の反射率, imgId, imgName, rect }
  // 写真は保存しない（見本の色は、囲んだ時点の補正で求めた値を保存する）
  const KEY = 'dpa.ks-tool.v1';
  const S = { images: [], active: null, samples: [], test: null };
  try { S.samples = JSON.parse(localStorage.getItem(KEY) || '{}').samples || []; } catch (e) { /* 読めなければ空で始める */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ samples: S.samples })); } catch (e) { /* 保存できなくても続ける */ } };
  const curImg = () => S.images.find((i) => i.id === S.active);

  // ---------------- 絵具の選択 ----------------
  const mixable = PaintDB.paints.filter((p) => p.mixable);
  $('#ks-line').innerHTML = PaintDB.lines.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  function fillPaints() {
    const line = $('#ks-line').value;
    const white = PaintDB.whiteOf[line];
    $('#ks-paint').innerHTML = mixable.filter((p) => p.line === line)
      .map((p) => `<option value="${p.id}">${esc(p.label)}${p === white ? '（白）' : ''}</option>`).join('');
  }
  $('#ks-line').addEventListener('change', () => { fillPaints(); syncRatio(); });
  fillPaints();
  const isWhite = (id) => PaintDB.WHITE_IDS.includes(id);
  // 白を選んだら「白だけ」の見本にする
  function syncRatio() {
    const white = isWhite($('#ks-paint').value);
    $('#ks-preset').disabled = white;
    if (white) $('#ks-preset').value = '1:0';
    const custom = $('#ks-preset').value === 'custom';
    $('#ks-pw').hidden = $('#ks-ww').hidden = !custom;
  }
  $('#ks-paint').addEventListener('change', syncRatio);
  $('#ks-preset').addEventListener('change', syncRatio);
  function ratioNow() {
    const v = $('#ks-preset').value;
    if (v !== 'custom') { const [pw, ww] = v.split(':').map(Number); return { pw, ww }; }
    return { pw: Math.max(0, +$('#ks-pw').value || 0), ww: Math.max(0, +$('#ks-ww').value || 0) };
  }
  syncRatio();

  // ---------------- 写真と範囲の指定 ----------------
  // 範囲の平均を線形で取る（ゲインはグレーカード補正）
  function sampleCanvas(canvas, r, gains) {
    const d = canvas.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const lin = Color.rgbToLinear([d[i], d[i + 1], d[i + 2]]);
      sum[0] += lin[0]; sum[1] += lin[1]; sum[2] += lin[2];
    }
    const n = d.length / 4;
    return sum.map((v, c) => (v / n) * (gains ? gains[c] : 1));
  }
  const grayGains = (lin) => lin.map((v) => 0.18 / Math.max(0.001, v)); // 18% のグレーカード

  const picker = new Picker($('#ks-stage'), {
    onPick(rgb, rect) {
      const img = curImg();
      if (!img.gains) return toast('先に「グレーカードを指定」でグレーカードを囲んでください');
      const paintId = $('#ks-paint').value;
      const { pw, ww } = isWhite(paintId) ? { pw: 1, ww: 0 } : ratioNow();
      if (!(pw > 0)) return toast('絵具の重さを入れてください');
      S.samples.push({ id: uid(), paintId, pw, ww, lin: sampleCanvas(img.canvas, rect, img.gains), imgId: img.id, imgName: img.name, rect });
      save();
      render();
    },
    onGray(lin) {
      const img = curImg();
      img.gains = grayGains(lin);
      setGray(false);
      // この写真から取った見本を、補正し直した値で取り直す
      for (const s of S.samples.filter((x) => x.imgId === img.id)) s.lin = sampleCanvas(img.canvas, s.rect, img.gains);
      save();
      render();
      toast('グレーカードで補正しました');
    },
    overlays: () => S.samples.filter((s) => s.imgId === S.active).map((s) => ({
      rect: s.rect, color: linHex(s.lin),
      label: `${PaintDB.byId[s.paintId]?.no || ''}${isWhite(s.paintId) ? ' 白' : ` ${s.pw}:${s.ww}`}`.trim(),
    })),
    onZoom(z) {
      $('#ks-zoom-val').textContent = `${Math.round(z * 100)}%`;
      picker.draw();
    },
  });
  function setGray(on) {
    picker.grayMode = on;
    $('#ks-gray').classList.toggle('on', on);
    $('#ks-stage').classList.toggle('gray-mode', on);
    $('#ks-hint').textContent = on ? 'グレーカードの部分をドラッグしてください' : 'ドラッグで見本の範囲を囲む（拡大：Ctrl＋ホイール）';
  }
  $('#ks-gray').addEventListener('click', () => setGray(!picker.grayMode));
  $('#ks-zoom-in').addEventListener('click', () => picker.zoomBy(1.5));
  $('#ks-zoom-out').addEventListener('click', () => picker.zoomBy(1 / 1.5));
  $('#ks-zoom-fit').addEventListener('click', () => picker.fit());
  setGray(false);

  function addImage(canvas, name, gains = null) {
    const img = { id: uid(), name, canvas, gains };
    S.images.push(img);
    S.active = img.id;
    renderImages();
    return img;
  }
  function renderImages() {
    $('#ks-imgs').innerHTML = S.images.map((i) => `<button class="btn btn-ghost btn-s ${i.id === S.active ? 'on' : ''}" data-img="${i.id}">${esc(i.name)}${i.gains ? ' ✓' : ''}</button>`).join('');
    const img = curImg();
    $('#ks-tools').hidden = !img;
    $('#ks-gray-state').textContent = img ? (img.gains ? 'グレーカード補正済み' : 'グレーカード未補正') : '';
    if (img && picker.img !== img) picker.setImage(img);
    else picker.draw();
  }
  $('#ks-imgs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-img]');
    if (b) { S.active = b.dataset.img; setGray(false); renderImages(); }
  });
  // 写真は縮めずに読み込む（見本の範囲を正確に囲むため。大きすぎる写真だけ長辺 4000px に縮める）
  $('#ks-file').addEventListener('change', async (e) => {
    for (const f of e.target.files) addImage(await fileToCanvas(f, 4000), f.name);
    e.target.value = '';
    toast('「グレーカードを指定」を押して、グレーカードを囲んでください');
  });

  // ---------------- 見本の一覧 ----------------
  const ratioText = (s) => (isWhite(s.paintId) ? '白のみ' : s.ww ? `${s.pw} : ${s.ww}` : '絵具のみ');
  function renderSamples() {
    $('#ks-count').textContent = `${S.samples.length} 件`;
    $('#ks-samples').innerHTML = S.samples.length ? S.samples.map((s) => `<tr>
        <td>${esc(PaintDB.byId[s.paintId]?.fullLabel || s.paintId)}</td>
        <td class="num">${ratioText(s)}</td>
        <td><span class="sw" style="background:${linHex(s.lin)}"></span> <span class="num">${linHex(s.lin)}</span></td>
        <td class="num">${f3(s.lin)}</td>
        <td class="hint">${esc(s.imgName || '')}</td>
        <td><button class="icon-btn" data-rm="${s.id}" title="この見本を消す" aria-label="この見本を消す">×</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty small">写真の上で見本を囲むと、ここに並びます</td></tr>';
  }
  $('#ks-samples').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    S.samples = S.samples.filter((s) => s.id !== b.dataset.rm);
    save();
    render();
  });

  // ---------------- 計算 ----------------
  // 白（ラインごと）を先に求め、ほかの絵具は同じラインの白を基準にする
  function compute() {
    const whites = {}, results = [];
    for (const l of PaintDB.lines) {
      const w = PaintDB.whiteOf[l.id];
      const ws = S.samples.filter((s) => s.paintId === w.id);
      const fit = KSFit.fitWhite(ws.map((s) => s.lin));
      whites[l.id] = fit ? { ...fit, measured: true } : { K: [...w.K], S: [...w.S], measured: false };
      if (ws.length) {
        const res = KSFit.residuals(ws.map((s) => ({ c: 1, lin: s.lin })), fit, fit);
        results.push({ paint: w, isWhite: true, n: ws.length, ok: true, K: fit.K, S: fit.S, res, samples: ws });
      }
    }
    const ids = [...new Set(S.samples.map((s) => s.paintId))].filter((id) => !isWhite(id));
    for (const id of ids) {
      const p = PaintDB.byId[id];
      const white = whites[p.line];
      const ss = S.samples.filter((s) => s.paintId === id);
      const pts = ss.map((s) => ({ c: KSFit.fraction(s.pw, s.ww), lin: s.lin }));
      const fit = KSFit.fitPaint(pts, white.K);
      const res = fit.ok ? KSFit.residuals(pts, fit, white) : [];
      results.push({ paint: p, n: ss.length, ...fit, res, pts, base: white, samples: ss });
    }
    return results;
  }

  function renderResults() {
    const results = compute();
    S.lastResults = results;
    $('#ks-results').innerHTML = results.length ? results.map((r) => {
      const avg = r.res.length ? r.res.reduce((a, b) => a + b, 0) / r.res.length : null;
      const max = r.res.length ? Math.max(...r.res) : null;
      const cls = max == null ? '' : max < 2 ? 'ks-ok' : max >= 5 ? 'ks-bad' : '';
      const pairs = r.ok && !r.isWhite ? r.pts.map((x) => `<span class="ks-pair" title="絵具の割合 ${(x.c * 100).toFixed(1)}%"><span style="background:${linHex(x.lin)}"></span><span style="background:${linHex(KSFit.predict(r, r.base, x.c))}"></span></span>`).join('') : '';
      const truth = S.test?.truth[r.paint.id];
      const truthNote = truth && r.ok ? `<div class="hint">テストの正解 K ${f3(truth.K)} / S ${f3(truth.S)}</div>` : '';
      const note = r.isWhite ? '<div class="hint">白（S = 1 の基準）</div>'
        : !r.base.measured ? '<div class="hint ks-bad">同じラインの白の見本がないため、白は仮の値で計算しています</div>' : '';
      return `<tr>
        <td>${esc(r.paint.fullLabel)}${note}</td>
        <td class="num">${r.n}</td>
        <td class="num">${r.ok ? f3(r.K) : '—'}</td>
        <td class="num">${r.ok ? f3(r.S) : `<span class="ks-bad">${esc(r.error)}</span>`}${truthNote}</td>
        <td class="num ${cls}">${avg == null ? '—' : `${avg.toFixed(2)} / ${max.toFixed(2)}`}</td>
        <td><div class="ks-pairs">${pairs}</div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="empty small">見本を指定すると、ここに K・S が出ます</td></tr>';
  }

  function render() {
    renderSamples();
    renderResults();
    picker.draw();
  }

  // ---------------- 書き出し・読み込み ----------------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const round = (v) => v.map((x) => +x.toPrecision(6));
  $('#ks-export').addEventListener('click', () => {
    const ok = (S.lastResults || []).filter((r) => r.ok);
    if (!ok.length) return toast('書き出せる結果がありません');
    const today = new Date().toISOString().slice(0, 10);
    const merged = { ...PAINT_KS };
    for (const r of ok) {
      const de = r.res.length ? +(r.res.reduce((a, b) => a + b, 0) / r.res.length).toFixed(2) : 0;
      merged[r.paint.id] = { K: round(r.K), S: round(r.S), n: r.n, de, at: today };
    }
    const lines = Object.keys(merged).sort().map((id) => {
      const p = PaintDB.byId[id];
      return `  ${JSON.stringify(id)}: ${JSON.stringify(merged[id])}, // ${p ? p.fullLabel : '（標準DBにない絵具）'}`;
    });
    const text = `// 絵具係数（K・S）の実測値（仕様書 3.5）
// tools/ks-estimator.html（開発用の K・S 推定ツール）で、白との混色見本の写真から求めて書き出したものに置き換える。
// { 絵具 id: { K: [r, g, b], S: [r, g, b], n: 使った見本の数, de: 見本と予測の平均 ΔE2000, at: 測定日 } }
//   白（チタニウムホワイト）は S = [1, 1, 1] とし、ほかの絵具の K・S は白の S を基準にした値
// ここにない絵具は、カラーチャートの色と仮の着色力から求めた仮の値を使う
const PAINT_KS = {
${lines.join('\n')}
};
`;
    download('paints-ks.js', text, 'text/javascript');
    toast(`${ok.length} 色の値を加えて書き出しました。js/paints-ks.js と置き換えてください`);
  });
  $('#ks-save').addEventListener('click', () => {
    download(`ks-samples-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ tool: 'dpa-ks-estimator', samples: S.samples }, null, 2), 'application/json');
  });
  $('#ks-load').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.samples)) throw new Error('format');
      S.samples = data.samples.filter((s) => PaintDB.byId[s.paintId] && Array.isArray(s.lin));
      save();
      render();
      toast(`見本 ${S.samples.length} 件を読み込みました`);
    } catch (err) { toast('作業ファイルを読み込めませんでした'); }
  });
  $('#ks-clear').addEventListener('click', () => {
    if (!S.samples.length || !confirm(`見本 ${S.samples.length} 件をすべて消します。よろしいですか？`)) return;
    S.samples = [];
    save();
    render();
  });

  // ---------------- テスト画像 ----------------
  // 標準DB の仮の K・S を「正解」として見本の写真を作り、照明の色かぶり・露出・ノイズを加える。
  // グレーカードを指定して見本を取ると、正解に近い K・S が戻ることを確かめられる
  $('#ks-test').addEventListener('click', () => {
    const line = 'regular';
    const white = PaintDB.whiteOf[line];
    const ids = ['lq013', 'lq067', 'lq085']; // ナフソールレッドライト、フタロシアニンブルー、イエローオキサイド
    const ladder = [[1, 0], [1, 1], [1, 4], [1, 10]];
    const cast = [1.08, 1.0, 0.8], exposure = 0.85; // 室内灯のような黄みと、やや暗い露出
    const W = 1200, H = 760, cell = 150, gap = 30, x0 = 60, y0 = 80;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#555'; g.fillRect(0, 0, W, H);
    let seed = 11;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.006;
    const paintRect = (x, y, w, h, lin) => {
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const rgb = Color.linearToRgb(lin.map((v, ch) => Math.max(0, v * cast[ch] * exposure + noise())));
        img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
      }
      g.putImageData(img, x, y);
    };
    const rects = [];
    ids.forEach((id, row) => {
      const p = PaintDB.byId[id];
      ladder.forEach(([pw, ww], col) => {
        const x = x0 + col * (cell + gap), y = y0 + row * (cell + gap);
        paintRect(x, y, cell, cell, KSFit.predict(p, white, KSFit.fraction(pw, ww)));
        rects.push({ paintId: id, pw, ww, rect: { x: x + 25, y: y + 25, w: cell - 50, h: cell - 50 } });
      });
    });
    const wx = x0 + 4 * (cell + gap), gy = y0 + (cell + gap);
    paintRect(wx, y0, cell, cell, KSFit.predict(white, white, 1));
    rects.push({ paintId: white.id, pw: 1, ww: 0, rect: { x: wx + 25, y: y0 + 25, w: cell - 50, h: cell - 50 } });
    paintRect(wx, gy, cell, cell, [0.18, 0.18, 0.18]); // グレーカード（18%）
    g.fillStyle = '#fff'; g.font = '20px sans-serif';
    g.fillText('テスト画像：左から 絵具のみ / 1:1 / 1:4 / 1:10、右上が白、右の灰色がグレーカード', 40, 40);
    g.fillText('GRAY 18%', wx + 20, gy + cell + 28);

    const grayRect = { x: wx + 25, y: gy + 25, w: cell - 50, h: cell - 50 };
    const img = addImage(c, 'テスト画像');
    img.gains = grayGains(sampleCanvas(c, grayRect, null));
    S.samples = S.samples.filter((s) => !s.test);
    for (const r of rects) S.samples.push({ id: uid(), test: true, ...r, lin: sampleCanvas(c, r.rect, img.gains), imgId: img.id, imgName: img.name });
    S.test = { truth: Object.fromEntries([...ids, white.id].map((id) => [id, { K: PaintDB.byId[id].K, S: PaintDB.byId[id].S }])) };
    save();
    renderImages();
    render();
    toast('テスト画像を作り、グレーカード補正と見本の指定を自動で行いました');
  });

  render();
  renderImages();
  window.KSTool = { compute, state: S }; // 確認用
})();
