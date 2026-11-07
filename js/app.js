// 画面ロジック
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stars = (n) => '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span>';
  const paintName = (id) => PaintDB.byId[id]?.fullLabel || id; // 品番＋色名（ライン）
  const sw = (hex, cls = '') => `<span class="sw ${cls}" style="background:${hex}"></span>`;
  const mixableOwnedCount = () => PaintDB.paints.filter((p) => p.mixable && Store.isOwned(p.id)).length;
  const owned = () => PaintDB.paints.map((p) => p.id).filter(Store.isOwned);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------------- 状態 ----------------
  const S = {
    images: [],        // { id, name, canvas, gains, thumb }  gains はグレーカード補正のゲイン（未補正なら null）
    active: null,
    extracted: [],     // { id, imgId, rect, rgb }
    fixed: null,       // 画像を使わない代表色 { rgb, from: 'recall' | 'input', label, src? }（レシピ帳からの呼び出し・数値指定）
                       // src は呼び出し元の色の取得記録 { method, extracted, refImages }（保存するときに引き継ぐ）
    similarAll: false, // レシピ帳の近い色をすべて表示するか
    candidates: [],
    candKey: null,     // 表示中の調色候補を計算した「代表色＋所持絵具」（変わったら自動で計算し直す）
    mix: [],           // [{ paintId, pct }]
    recalled: null,    // 呼び出し元エントリ id
  };

  // ---------------- タブ ----------------
  function route() {
    let tab = (location.hash || '#mix').slice(1);
    if (!$('#view-' + tab)) tab = 'mix'; // 存在しないタブは調色を表示
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    if (tab === 'mix') { renderCandidates(); renderMix(); scheduleReverse(); } // 絵具箱で所持を変えたときに反映する
    if (tab === 'library') renderLibrary();
    if (tab === 'paints') renderPaints();
    if (tab === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ================= 調色 =================
  const picker = new Picker($('#img-stage'), {
    onPick(rgb, rect) {
      const n = S.extracted.length + 1;
      S.extracted.push({ id: Store.uid(), imgId: S.active, rect, rgb, label: '#' + n });
      S.fixed = null; // 画像から色を取ったら、画像の色に切り替える
      renderExtracted();
      picker.draw();
    },
    onGray(lin) {
      const img = curImg();
      img.gains = lin.map((v) => 0.18 / Math.max(0.001, v));
      setGrayMode(false);
      // 補正後に既存の抽出色を取り直す
      for (const ex of S.extracted.filter((x) => x.imgId === img.id)) {
        ex.rgb = Color.linearToRgb(picker.sample(ex.rect, img.gains));
      }
      renderImages();
      renderExtracted();
      toast('グレーカードでホワイトバランスと明るさを補正しました');
    },
    overlays: () => S.extracted
      .filter((x) => x.imgId === S.active)
      .map((x) => ({ rect: x.rect, label: x.label, color: Color.toHex(x.rgb) })),
    onZoom(z) {
      $('#zoom-val').textContent = `${Math.round(z * 100)}%`;
      $('#zoom-out').disabled = z <= Picker.MIN_ZOOM;
      $('#zoom-in').disabled = z >= Picker.MAX_ZOOM;
      picker.draw(); // 枠線の太さを表示倍率に合わせる
    },
  });
  const curImg = () => S.images.find((i) => i.id === S.active);

  function addImage(canvas, name) {
    const img = { id: Store.uid(), name, canvas, gains: null, thumb: canvasThumb(canvas, 160) };
    S.images.push(img);
    S.active = img.id;
    renderImages();
  }

  function renderImages() {
    $('#img-strip').innerHTML = S.images.map((i) => `
      <button class="thumb ${i.id === S.active ? 'on' : ''}" data-id="${i.id}" title="${esc(i.name)}">
        <img src="${i.thumb}" alt="">
        ${i.gains ? '<span class="thumb-tag own">補正済</span>' : ''}
        <span class="thumb-x" data-del="${i.id}" title="削除">×</span>
      </button>`).join('');
    const img = curImg();
    $('#img-tools').hidden = !img;
    if (!img) {
      picker.setImage(null);
      setPanMode(false);
      $('#img-stage').innerHTML = `<div class="empty">画像を追加するか、カメラで撮影してください（正面・斜め・自然光・室内光など複数枚可）
        <div class="sample-try"><button class="link" data-sample>サンプル画像で試してみる</button></div></div>`;
      return;
    }
    if (picker.img !== img) picker.setImage(img); else picker.draw();
  }

  $('#img-strip').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      S.images = S.images.filter((i) => i.id !== id);
      S.extracted = S.extracted.filter((x) => x.imgId !== id);
      if (S.active === id) S.active = S.images[0]?.id || null;
      renderImages(); renderExtracted();
      return;
    }
    const b = e.target.closest('.thumb');
    if (b) { S.active = b.dataset.id; setGrayMode(false); renderImages(); }
  });

  $('#img-input').addEventListener('change', async (e) => {
    for (const f of e.target.files) addImage(await fileToCanvas(f), f.name);
    e.target.value = '';
  });
  // 画像が1枚もないときだけ、案内文の中に「サンプル画像で試してみる」を出す
  $('#img-stage').addEventListener('click', (e) => {
    if (!e.target.closest('[data-sample]')) return;
    addImage(makeSampleCanvas('natural'), 'サンプル（自然光）');
    addImage(makeSampleCanvas('warm'), 'サンプル（室内光）');
    toast(`サンプル画像を2枚追加しました。チークを${isTouch ? 'タップ' : 'ドラッグ'}してみてください`);
  });

  // ---- 操作モード（範囲選択 / 移動 / グレーカード補正）----
  const isTouch = matchMedia('(pointer: coarse)').matches;
  function updateHint() {
    $('#img-hint').textContent = isTouch
      ? (picker.grayMode
        ? 'グレーカードの部分をタップするか、長押ししてから囲んでください'
        : 'タップで色を取得。長押ししてから指を動かすと範囲で選べます（2本指で拡大）')
      : (picker.grayMode ? 'グレーカードの部分をドラッグしてください'
        : picker.panMode ? 'ドラッグで画像を動かします'
          : 'ドラッグで範囲を選択 → 色を取得（拡大：Ctrl＋ホイール）');
  }
  // スマホ・タブレットでは1本指のスワイプで画像を動かせるので、「移動」ボタンは出さない
  $('#btn-pan').hidden = isTouch;
  function setGrayMode(on) {
    if (on) setPanMode(false);
    picker.grayMode = on;
    $('#btn-gray').classList.toggle('on', on);
    $('#img-stage').classList.toggle('gray-mode', on);
    updateHint();
  }
  function setPanMode(on) {
    if (on && picker.grayMode) setGrayMode(false);
    picker.setPanMode(on);
    $('#btn-pan').classList.toggle('on', on);
    $('#btn-pan').setAttribute('aria-pressed', on);
    updateHint();
  }
  $('#btn-gray').addEventListener('click', () => setGrayMode(!picker.grayMode));
  $('#btn-pan').addEventListener('click', () => setPanMode(!picker.panMode));
  $('#zoom-in').addEventListener('click', () => picker.zoomBy(1.5));
  $('#zoom-out').addEventListener('click', () => picker.zoomBy(1 / 1.5));
  $('#zoom-fit').addEventListener('click', () => picker.fit());
  updateHint();

  // ---- カメラで撮影 ----
  // スマホ：端末のカメラアプリ（capture 属性つきの input）で撮影する
  // PC など：アプリ内でカメラ映像を表示して撮影する。使えなければファイル選択に切り替える
  const camDlg = $('#camera-dialog');
  const camVideo = $('#cam-video');
  let camStream = null, camFacing = 'environment';
  const shotName = () => `撮影 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;

  function stopCamera() {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    camVideo.srcObject = null;
  }
  async function startCamera() {
    stopCamera();
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: camFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    camVideo.srcObject = camStream;
    await camVideo.play().catch(() => {});
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('#cam-switch').hidden = cams.length < 2;
  }
  async function openCamera() {
    if (isTouch || !navigator.mediaDevices?.getUserMedia) {
      $('#cam-input').click();
      return;
    }
    try {
      await startCamera();
      camDlg.showModal();
    } catch (err) {
      stopCamera();
      toast(err?.name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください'
        : 'カメラが見つかりませんでした。画像を追加から写真を選んでください');
    }
  }
  $('#btn-camera').addEventListener('click', openCamera);
  $('#cam-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) addImage(await fileToCanvas(f), shotName());
    e.target.value = '';
  });
  $('#cam-shoot').addEventListener('click', () => {
    const w = camVideo.videoWidth, h = camVideo.videoHeight;
    if (!w || !h) return toast('カメラの準備ができていません。少し待ってから撮影してください');
    addImage(drawableToCanvas(camVideo, w, h), shotName());
    closeCamera();
    toast('撮影した写真を追加しました');
  });
  $('#cam-switch').addEventListener('click', async () => {
    camFacing = camFacing === 'environment' ? 'user' : 'environment';
    try { await startCamera(); } catch { toast('カメラを切り替えられませんでした'); }
  });
  // 閉じたらすぐカメラを止める（Esc で閉じたときは close イベントで止める）
  function closeCamera() {
    stopCamera();
    if (camDlg.open) camDlg.close();
  }
  $('#cam-cancel').addEventListener('click', closeCamera);
  camDlg.addEventListener('close', stopCamera);

  // ---- 抽出色と代表色 ----
  // 抽出色の平均（線形空間で平均してから sRGB に戻す）
  function averageRgb(list) {
    const lin = list.map((x) => Color.rgbToLinear(x.rgb));
    return Color.linearToRgb([0, 1, 2].map((c) => lin.reduce((s, l) => s + l[c], 0) / lin.length));
  }
  function representative() {
    if (S.fixed) return S.fixed.rgb;
    return S.extracted.length ? averageRgb(S.extracted) : null;
  }

  // 外れた色：その色を除いた残りの平均から ΔE2000 がこれ以上離れている抽出色（3色以上のとき）
  const OUTLIER_DE = 10;
  function outliers() {
    const xs = S.extracted;
    const out = new Map(); // id → ΔE
    if (xs.length < 3) return out;
    for (const x of xs) {
      const rest = averageRgb(xs.filter((y) => y !== x));
      const de = Color.dE00(Color.rgbToLab(x.rgb), Color.rgbToLab(rest));
      if (de >= OUTLIER_DE) out.set(x.id, de);
    }
    return out;
  }
  // 2色だけのときは、どちらが外れているか決められないので差だけを知らせる
  function pairGap() {
    const xs = S.extracted;
    if (xs.length !== 2) return 0;
    const de = Color.dE00(Color.rgbToLab(xs[0].rgb), Color.rgbToLab(xs[1].rgb));
    return de >= OUTLIER_DE ? de : 0;
  }

  // 代表色の出どころ（保存データ用）
  const METHOD_LABEL = { manual: '数値で指定' }; // 抽出色から算出した場合は表示しない

  function renderExtracted() {
    const xs = S.extracted;
    const out = S.fixed ? new Map() : outliers();
    $('#extracted').classList.toggle('dim', !!S.fixed);
    $('#extracted').innerHTML = xs.length
      ? xs.map((x) => {
        const img = S.images.find((i) => i.id === x.imgId);
        const de = out.get(x.id);
        return `<div class="chip ${de ? 'outlier' : ''}" data-id="${x.id}" ${de ? `title="ほかの抽出色から ΔE ${de.toFixed(1)} 離れています"` : ''}>
          ${sw(Color.toHex(x.rgb))}
          <span><b>${x.label}</b> ${Color.toHex(x.rgb)}<small>${esc(img?.name || '')}</small>${de ? `<em class="flag">ほかと色が離れています（ΔE ${de.toFixed(1)}）</em>` : ''}</span>
          <button class="chip-x" data-del="${x.id}" title="取り消す" aria-label="${x.label} を取り消す">×</button></div>`;
      }).join('')
      : '<div class="empty small">手順1の画像上をドラッグすると、ここに抽出色が並びます</div>';
    // 呼び出し・数値指定の色を代表色にしているときだけ案内する
    $('#method-hint').hidden = !S.fixed;
    $('#method-hint').textContent = S.fixed
      ? `いまは${S.fixed.label}を代表色にしています。画像から色を取り出すと、抽出色からの代表色に切り替わります。`
      : '';
    renderTarget();
  }

  $('#extracted').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    S.extracted = S.extracted.filter((x) => x.id !== del.dataset.del);
    S.extracted.forEach((x, i) => (x.label = '#' + (i + 1)));
    renderExtracted(); picker.draw();
  });
  function targetCard(rgb, note = '') {
    if (!rgb) return '<div class="empty small">代表色はまだありません</div>';
    const lab = Color.rgbToLab(rgb);
    return `<div class="target-sw" style="background:${Color.toHex(rgb)}"></div>
      <div class="kv">
        <span>HEX</span><b class="mono">${Color.toHex(rgb)}</b>
        <span>RGB</span><b class="mono">${rgb.join(', ')}</b>
        <span>Lab</span><b class="mono">${Color.fmtLab(lab)}</b>
      </div>${note}`;
  }

  function renderTarget() {
    const rgb = representative();
    let note = '';
    if (S.fixed) {
      note = `<div class="note">${esc(S.fixed.label)}</div>`;
    } else if (S.extracted.length) {
      const used = new Set(S.extracted.map((x) => x.imgId));
      const imgs = S.images.filter((i) => used.has(i.id));
      const uncorrected = imgs.filter((i) => !i.gains).length;
      note = `<div class="note">${S.extracted.length}色 / ${imgs.length}枚から算出</div>`;
      const out = outliers();
      if (out.size) {
        const labels = S.extracted.filter((x) => out.has(x.id)).map((x) => x.label).join('・');
        note += `<div class="note warn">ほかと色が離れた抽出色（${labels}）は、× で除いてください。意図して条件の違う画像を入れている場合は、そのままで構いません</div>`;
      }
      const gap = pairGap();
      if (gap) note += `<div class="note warn">2つの抽出色の差が大きめです（ΔE ${gap.toFixed(1)}）。照明の違いや、取る場所がずれていないか確認してください</div>`;
      if (uncorrected) note += `<div class="note warn">グレーカード補正していない画像（${uncorrected}枚）を含むため、色は目安です。グレーカードが写っている画像は補正すると精度が上がります</div>`;
    }
    $('#target').innerHTML = targetCard(rgb, note);
    renderSimilar();
    renderMix();
    scheduleReverse();
  }

  // ---- 逆引き調色（自動）----
  // 代表色か所持している絵具が変わったら、変化が止まってから少し待って計算する
  // （カラーピッカーを動かしている間や、抽出色を続けて取っている間は計算しない）
  const REVERSE_DELAY = 300;
  let reverseTimer = null;
  // いま表示している候補が、どの「代表色＋所持絵具」で計算したものか
  function candKeyNow() {
    const rgb = representative();
    if (!rgb) return null;
    return `${Color.toHex(rgb)}|${owned().filter((id) => PaintDB.byId[id].mixable).join(',')}`;
  }
  function scheduleReverse() {
    clearTimeout(reverseTimer);
    const key = candKeyNow();
    if (key === S.candKey) return; // 変わっていなければ計算し直さない
    if (!key || !mixableOwnedCount()) {
      S.candidates = [];
      S.candKey = key;
      renderCandidates();
      return;
    }
    $('#candidates').innerHTML = '<div class="empty">計算中…</div>';
    reverseTimer = setTimeout(() => {
      const rgb = representative();
      if (!rgb) return;
      const t0 = performance.now();
      S.candidates = PaintDB.reverse(rgb, owned(), 3);
      S.candTime = performance.now() - t0;
      S.candKey = candKeyNow();
      renderCandidates();
    }, REVERSE_DELAY);
  }

  function deBadge(de) {
    const cls = de < 2 ? 'good' : de < 5 ? 'ok' : 'bad';
    const word = de < 2 ? 'ほぼ同じ' : de < 5 ? '近い' : '差あり';
    return `<span class="de ${cls}">ΔE ${de.toFixed(1)} · ${word}</span>`;
  }

  function renderCandidates() {
    const rgb = representative();
    if (!S.candidates.length) {
      $('#candidates').innerHTML = mixableOwnedCount()
        ? '<div class="empty">代表色が決まると、自動で調色候補を計算します</div>'
        : '<div class="empty">調色候補は、持っている絵具だけで計算します。<br>先に絵具箱で、持っている絵具を選んでください。<div class="sample-try"><a class="btn btn-ghost btn-s" href="#paints">絵具箱を開く</a></div></div>';
      return;
    }
    $('#candidates').innerHTML = S.candidates.map((c, i) => `
      <div class="cand">
        <div class="cand-sw">
          <div style="background:${rgb ? Color.toHex(rgb) : '#ccc'}"><span>目標</span></div>
          <div style="background:${c.hex}"><span>混色</span></div>
        </div>
        <div class="cand-body">
          <div class="row between"><b>候補 ${i + 1}</b>${deBadge(c.de)}</div>
          ${c.substituted ? `<div class="note">${esc(paintName(c.substituted.from))} → ${esc(paintName(c.substituted.to))} に置換して再計算</div>` : ''}
          <ul class="recipe">
            ${c.items.map((x) => `<li>${sw(PaintDB.byId[x.paintId].hex)}<span class="pname">${esc(paintName(x.paintId))}</span>
              <span class="bar"><i style="width:${x.pct}%"></i></span><b class="mono">${x.pct}%</b>
              <button class="link" data-sub="${i}" data-paint="${x.paintId}" title="持っていない絵具を代替に置換">持っていない</button></li>`).join('')}
          </ul>
          <button class="btn btn-ghost btn-s" data-use="${i}">この候補で調整する ↓</button>
        </div>
      </div>`).join('') + (S.candTime == null
        ? '<div class="hint small">呼び出したカラーに保存されていた候補です</div>'
        : `<div class="hint small">所持している ${mixableOwnedCount()} 色から計算しました（${S.candTime.toFixed(0)} ms）</div>`);
  }

  $('#candidates').addEventListener('click', (e) => {
    const use = e.target.closest('[data-use]');
    if (use) {
      S.mix = S.candidates[+use.dataset.use].items.map((x) => ({ ...x }));
      renderMix();
      $('#mix-rows').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const sub = e.target.closest('[data-sub]');
    if (sub) {
      const i = +sub.dataset.sub, pid = sub.dataset.paint;
      Store.setOwned(pid, false);
      const res = PaintDB.substitute(S.candidates[i], pid, representative(), owned());
      if (!res) return toast('代替できる絵具がありません');
      S.candidates[i] = res;
      S.candKey = candKeyNow(); // 未所持にした分で計算し直さず、置き換えた候補を残す
      renderCandidates();
      toast(`${paintName(pid)} を「未所持」にしました（絵具箱で戻せます）`);
    }
  });

  // ---- 手動調整 ----
  // 所持している絵具を先に並べ、残りはラインごとにまとめる
  const paintOptions = (sel) => {
    const opt = (p, text) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(text)}</option>`;
    const own = PaintDB.paints.filter((p) => Store.isOwned(p.id));
    return (own.length ? `<optgroup label="所持している絵具">${own.map((p) => opt(p, p.fullLabel)).join('')}</optgroup>` : '')
      + PaintDB.lines.map((l) => {
        const rest = PaintDB.paints.filter((p) => p.line === l.id && !Store.isOwned(p.id));
        return rest.length ? `<optgroup label="${esc(l.name)}${own.length ? '（未所持）' : ''}">${rest.map((p) => opt(p, p.label)).join('')}</optgroup>` : '';
      }).join('');
  };

  function renderMix() {
    const rows = $('#mix-rows');
    rows.innerHTML = S.mix.length
      ? S.mix.map((m, i) => `
        <div class="mix-row" data-i="${i}">
          ${sw(PaintDB.byId[m.paintId]?.hex || '#ccc')}
          <select data-k="paintId">${paintOptions(m.paintId)}</select>
          <input type="number" data-k="pct" value="${m.pct}" min="0" max="100" step="5" class="mono">
          <span class="unit">%</span>
          <button class="icon-btn" data-rm="${i}" title="削除">×</button>
        </div>`).join('')
      : '<div class="empty small">候補の「この候補で調整する」か「＋ 絵具を追加」から始めます</div>';
    renderMixPreview();
  }
  function renderMixPreview() {
    const target = representative();
    const total = S.mix.reduce((s, m) => s + (+m.pct || 0), 0);
    const ev = PaintDB.evaluate(S.mix, target);
    $('#mix-preview').innerHTML = ev
      ? `<div class="cand-sw tall">
          <div style="background:${target ? Color.toHex(target) : 'transparent'}"><span>${target ? '目標' : '目標なし'}</span></div>
          <div style="background:${ev.hex}"><span>予測</span></div>
        </div>
        <div class="kv"><span>予測色</span><b class="mono">${ev.hex}</b>
          <span>絵具の合計</span><b class="mono ${total === 100 ? '' : 'warn-t'}">${total}%${total === 100 ? '' : '（100%にしてください）'}</b></div>
        ${ev.de != null ? deBadge(ev.de) : ''}`
      : '<div class="empty small">混色の予測がここに出ます</div>';
  }
  $('#mix-rows').addEventListener('input', (e) => {
    const row = e.target.closest('.mix-row');
    if (!row) return;
    const m = S.mix[+row.dataset.i];
    const k = e.target.dataset.k;
    m[k] = k === 'pct' ? Math.max(0, +e.target.value || 0) : e.target.value;
    if (k === 'paintId') renderMix(); else renderMixPreview();
  });
  $('#mix-rows').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { S.mix.splice(+rm.dataset.rm, 1); renderMix(); }
  });
  $('#btn-add-row').addEventListener('click', () => {
    if (S.mix.length >= 6) return toast('絵具は6色までにしましょう');
    const first = PaintDB.WHITE_IDS.find(Store.isOwned) || Store.ownedIds()[0] || PaintDB.WHITE_ID;
    S.mix.push({ paintId: first, pct: S.mix.length ? 5 : 100 });
    renderMix();
  });
  $('#btn-clear-mix').addEventListener('click', () => { S.mix = []; renderMix(); });

  $('#btn-save').addEventListener('click', () => {
    const rgb = representative() || PaintDB.evaluate(S.mix)?.rgb;
    if (!rgb) return toast('代表色か実際の調色を決めてから保存してください');
    const base = S.recalled ? Store.get(S.recalled) : null;
    // 呼び出した色をそのまま代表色にしているときは、呼び出し元の色の取得記録を引き継ぐ
    // （呼び出し案内を閉じて上書き先がなくなっても引き継ぐ。画面に残っている画像と抽出色は、この色とは関係がないので保存しない）
    const src = S.fixed?.from === 'recall' ? S.fixed.src : null;
    const draft = {
      ...(base ? structuredClone(base) : {
        name: '', part: '頬', customPart: '', rating: 3, comment: '',
        cond: { head: '', skin: 'セミホワイト', topcoat: 'つや消し', brand: Store.DEFAULT_BRAND, medium: Store.lastMedium() }, recordImages: [],
      }),
      hex: Color.toHex(rgb),
      method: src ? src.method : S.fixed ? 'manual' : 'average',
      // 数値・カラーピッカーで指定した色は抽出色を使っていないので、抽出色は記録しない
      extracted: src ? [...src.extracted] : S.fixed ? [] : S.extracted.map((x) => Color.toHex(x.rgb)),
      refImages: src ? structuredClone(src.refImages) : S.images.map((i) => ({ src: i.thumb, name: i.name, corrected: !!i.gains })),
      estimated: S.candidates.map((c) => ({ items: c.items, de: +c.de.toFixed(2) })),
      actual: S.mix.map((x) => ({ ...x })),
    };
    openEditor(draft, { fromMix: true, baseId: base?.id });
  });

  // ================= エントリ編集ダイアログ =================
  const dlg = $('#entry-dialog');

  function openEditor(entry, opt = {}) {
    const e = entry;
    const recipe = (items) => items?.length
      ? `<ul class="recipe compact">${items.map((x) => `<li>${sw(PaintDB.byId[x.paintId]?.hex || '#ccc')}<span class="pname">${esc(paintName(x.paintId))}</span><b class="mono">${x.pct}%</b></li>`).join('')}</ul>`
      : '<div class="empty small">なし</div>';
    const methodName = METHOD_LABEL[e.method];
    const rgb = Color.parseHex(e.hex);
    const isNew = !e.id;

    $('#entry-form').innerHTML = `
      <div class="dlg-head">
        <div class="dlg-sw" style="background:${e.hex}"></div>
        <div class="grow">
          <input name="name" class="title-input" placeholder="名称（例：DDH-29 チークA）" value="${esc(e.name)}" required>
          <div class="mono small">${e.hex} · RGB ${rgb.join(', ')} · Lab ${Color.fmtLab(Color.rgbToLab(rgb))}</div>
        </div>
        <button type="button" class="icon-btn" data-act="close" title="閉じる">×</button>
      </div>
      <div class="dlg-body">
        <div class="form-grid">
          <label>部位
            <select name="part">${Store.PARTS.map((p) => `<option ${p === e.part ? 'selected' : ''}>${p}</option>`).join('')}</select>
          </label>
          <label class="custom-part" ${e.part === 'カスタム' ? '' : 'hidden'}>カスタム部位名
            <input name="customPart" value="${esc(e.customPart)}" placeholder="例：涙袋">
          </label>
          <label>評価
            <div class="stars-input" data-v="${e.rating}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" class="${n <= e.rating ? 'on' : ''}">★</button>`).join('')}</div>
          </label>
          <label class="span2">コメント<textarea name="comment" rows="2" placeholder="例：少し暖色寄り。頬の中心だけ3回重ねる">${esc(e.comment)}</textarea></label>
        </div>

        <h3>制作条件</h3>
        <div class="form-grid">
          <label>ヘッド<input name="head" value="${esc(e.cond?.head)}" placeholder="DDH-27" list="heads"></label>
          <label>肌色<select name="skin">${Store.SKINS.map((s) => `<option ${s === e.cond?.skin ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>トップコート<select name="topcoat">${Store.TOPCOATS.map((s) => `<option ${s === e.cond?.topcoat ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>使用絵具<input value="${esc(Store.DEFAULT_BRAND)}" readonly tabindex="-1" class="readonly" title="使用絵具はリキテックスに固定です。ライン（レギュラー・ソフト・ベーシックス）は調色記録の絵具に表示されます"></label>
          <label>使用メディウム<select name="medium">${PaintDB.mediums.map((m) => `<option value="${m.id}" ${m.id === (e.cond?.medium || 'none') ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        </div>
        <datalist id="heads">${['DDH-01', 'DDH-06', 'DDH-09', 'DDH-10', 'DDH-27', 'DDH-28', 'DDH-29'].map((h) => `<option value="${h}">`).join('')}</datalist>

        <h3>調色記録</h3>
        <div class="grid-2 tight">
          <div><div class="sub">実際の調色</div>${recipe(e.actual)}</div>
          <div><div class="sub">推定調色候補（逆引き）</div>${e.estimated?.length ? e.estimated.map((c, i) => `<div class="mini-cand"><small>候補${i + 1} · ΔE ${c.de}</small>${recipe(c.items)}</div>`).join('') : '<div class="empty small">なし</div>'}</div>
        </div>

        <h3>色の取得</h3>
        <div class="kv">${methodName ? `<span>代表色</span><b>${methodName}</b>` : ''}
          <span>抽出色</span><b>${e.extracted?.length ? e.extracted.map((h) => sw(h, 'sm') + `<span class="mono small">${h}</span>`).join(' ') : '—'}</b></div>

        <h3>参考画像</h3>
        <div class="thumbs">${e.refImages?.length ? e.refImages.map((i) => `<img src="${i.src}" title="${esc(i.name)}">`).join('') : '<div class="empty small">なし</div>'}</div>
        <h3>記録画像 <label class="btn btn-ghost btn-s">追加<input type="file" accept="image/*" multiple hidden data-rec></label></h3>
        <div class="thumbs" id="rec-thumbs">${(e.recordImages || []).map((i) => `<img src="${i.src}">`).join('') || '<div class="empty small">仕上がりの写真を追加できます</div>'}</div>
      </div>
      <div class="dlg-foot">
        ${!isNew && !opt.fromMix ? `<button type="button" class="link link-danger" data-act="delete">削除</button>
          <span class="grow"></span>
          <button type="submit" class="btn btn-ghost" data-act="save" disabled title="書き換えた内容をレシピ帳に保存します">変更を保存</button>
          <button type="button" class="btn btn-primary" data-act="recall" title="このレシピを調色の画面に読み込みます">調色に呼び出す →</button>`
        : `<span class="grow"></span>
          ${opt.baseId ? '<button type="submit" class="btn btn-ghost" data-act="overwrite" title="レシピ帳の呼び出し元のカラーを更新します">上書き保存</button>' : ''}
          <button type="submit" class="btn btn-primary" data-act="new" ${opt.baseId ? 'title="呼び出し元を残して、別のカラーとしてレシピ帳に追加します"' : ''}>${opt.baseId ? 'レシピ帳に追加' : 'レシピ帳に保存'}</button>`}
      </div>`;

    const form = $('#entry-form');
    const work = structuredClone(e);
    // 書き換えたら「変更を保存」を押せるようにする
    let dirty = false;
    const markDirty = () => {
      dirty = true;
      const b = form.querySelector('[data-act=save]');
      if (b) b.disabled = false;
    };
    form.oninput = markDirty;
    form.onchange = markDirty;

    form.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const st = b.closest('.stars-input');
      if (st) { work.rating = +b.dataset.v; $$('button', st).forEach((x) => x.classList.toggle('on', +x.dataset.v <= work.rating)); markDirty(); return; }
      const act = b.dataset.act;
      if (act === 'close') { ev.preventDefault(); dlg.close(); }
      if (act === 'delete') {
        if (!confirm(`「${e.name}」を削除します。よろしいですか？`)) return;
        Store.remove(e.id); dlg.close(); renderLibrary(); toast('削除しました');
      }
      if (act === 'recall') {
        // 書き換えてあれば、先に保存してから呼び出す
        if (dirty) {
          const data = collect();
          if (!data.name) return toast('名称を入力してください');
          if (!saveEntry(data)) return;
          toast('変更を保存しました');
        }
        dlg.close();
        recall(e.id);
      }
    };
    form.querySelector('[name=part]').onchange = (ev) => {
      form.querySelector('.custom-part').hidden = ev.target.value !== 'カスタム';
    };
    form.querySelector('[data-rec]').onchange = async (ev) => {
      work.recordImages = work.recordImages || [];
      for (const f of ev.target.files) {
        const c = await fileToCanvas(f, 800);
        work.recordImages.push({ src: canvasThumb(c, 320), name: f.name });
      }
      $('#rec-thumbs').innerHTML = work.recordImages.map((i) => `<img src="${i.src}">`).join('');
      markDirty();
    };

    function collect() {
      const fd = new FormData(form);
      return {
        ...work,
        name: fd.get('name').trim(),
        part: fd.get('part'),
        customPart: fd.get('customPart') || '',
        comment: fd.get('comment'),
        cond: { head: fd.get('head').trim(), skin: fd.get('skin'), topcoat: fd.get('topcoat'), brand: Store.DEFAULT_BRAND, medium: fd.get('medium') },
      };
    }

    function saveEntry(data) {
      const ok = Store.upsert(data);
      Store.setLastMedium(data.cond.medium);
      if (!ok) { toast('保存容量が不足しています（画像を減らしてください）'); return false; }
      renderLibrary();
      return true;
    }

    form.onsubmit = (ev) => {
      ev.preventDefault();
      const act = ev.submitter?.dataset.act;
      const data = collect();
      if (!data.name) return toast('名称を入力してください');
      if (act === 'overwrite') { data.id = opt.baseId; data.createdAt = Store.get(opt.baseId)?.createdAt || Date.now(); }
      else if (act === 'new') { data.id = Store.uid(); data.createdAt = Date.now(); }
      dlg.close();
      if (!saveEntry(data)) return;
      toast(act === 'overwrite' ? `レシピ帳の「${data.name}」を上書き保存しました`
        : act === 'new' ? `「${data.name}」をレシピ帳に${opt.baseId ? '追加' : '保存'}しました`
          : `「${data.name}」の変更を保存しました`);
      if (opt.fromMix) S.recalled = data.id;
    };

    dlg.showModal();
  }

  // ================= レシピ帳 =================
  $('#lib-part').innerHTML += Store.PARTS.map((p) => `<option>${p}</option>`).join('');
  ['#lib-q', '#lib-part', '#lib-rating', '#lib-sort'].forEach((s) => $(s).addEventListener('input', renderLibrary));

  function entryCard(e, extra = '') {
    const part = e.part === 'カスタム' && e.customPart ? e.customPart : e.part;
    return `<button class="entry" data-id="${e.id}">
      <div class="entry-sw" style="background:${e.hex}">
        ${e.recordImages?.[0] ? `<img src="${e.recordImages[0].src}" alt="">` : ''}
      </div>
      <div class="entry-body">
        <div class="entry-name">${esc(e.name)}</div>
        <div class="stars">${stars(e.rating)}</div>
        <div class="entry-comment">${esc(e.comment)}</div>
        <div class="tags"><span class="tag">${esc(part)}</span>${e.cond?.head ? `<span class="tag">${esc(e.cond.head)}</span>` : ''}<span class="tag mono">${e.hex}</span></div>
        ${extra}
      </div></button>`;
  }

  // 検索の対象：名称・コメント・カスタム部位名と、制作条件（ヘッド・肌色・トップコート・使用絵具・使用メディウム）
  const searchText = (e) => [
    e.name, e.comment, e.customPart,
    e.cond?.head, e.cond?.skin, e.cond?.topcoat, e.cond?.brand, PaintDB.mediumById[e.cond?.medium]?.name,
  ].join(' ').toLowerCase();

  function renderLibrary() {
    const q = $('#lib-q').value.trim().toLowerCase();
    const part = $('#lib-part').value, minR = +$('#lib-rating').value, sort = $('#lib-sort').value;
    let list = Store.entries().filter((e) =>
      (!part || e.part === part) && e.rating >= minR &&
      (!q || searchText(e).includes(q)));
    list = list.sort(sort === 'rating' ? (a, b) => b.rating - a.rating || b.createdAt - a.createdAt
      : sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ja') : (a, b) => b.createdAt - a.createdAt);
    $('#lib-grid').innerHTML = list.length ? list.map((e) => entryCard(e)).join('')
      : '<div class="card empty">該当するカラーはありません</div>';
    renderSimilar(); // レシピ帳が変わったら、調色画面の「近い色」も更新する
  }
  $('#lib-grid').addEventListener('click', (ev) => {
    const c = ev.target.closest('.entry');
    if (c) openEditor(Store.get(c.dataset.id));
  });

  // ワンクリック呼び出し
  function recall(id) {
    const e = Store.get(id);
    if (!e) return;
    Object.assign(S, {
      fixed: {
        rgb: Color.parseHex(e.hex), from: 'recall', label: `「${e.name}」から呼び出した色`,
        src: { method: e.method || 'average', extracted: [...(e.extracted || [])], refImages: structuredClone(e.refImages || []) },
      },
      candidates: (e.estimated || []).map((c) => ({ ...c, ...PaintDB.evaluate(c.items, Color.parseHex(e.hex)) })),
      mix: (e.actual || []).map((x) => ({ ...x })),
      candTime: null,
      recalled: e.id,
    });
    S.candKey = candKeyNow();
    const b = $('#recall-banner');
    b.innerHTML = `${sw(e.hex)} <span>「<b>${esc(e.name)}</b>」の調色を呼び出しました。下の絵具と割合を微調整して、上書き保存するか、別のカラーとしてレシピ帳に追加できます。</span><button class="icon-btn" id="btn-unrecall" title="呼び出しをやめる">×</button>`;
    b.hidden = false;
    $('#btn-unrecall').onclick = () => { S.recalled = null; b.hidden = true; };
    renderImages(); renderExtracted(); renderCandidates(); renderMix();
    // 呼び出した内容が入る「4 実際の調色」までスクロールし、一瞬強調する
    const showMixCard = () => {
      const card = $('#mix-card');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.remove('flash');
      void card.offsetWidth; // アニメーションをやり直す
      card.classList.add('flash');
    };
    if (location.hash !== '#mix') {
      location.hash = '#mix'; // タブ切り替え（先頭へのスクロール）のあとで移動する
      setTimeout(showMixCard, 60);
    } else {
      showMixCard();
    }
  }

  // ================= 数値で指定（手順1） =================
  // HEX（#D98C8C）または RGB（217, 140, 140）を受け付ける
  function parseColorText(text) {
    const hex = Color.parseHex(text);
    if (hex) return hex;
    const m = String(text).match(/\d+/g);
    return m && m.length === 3 && m.every((v) => +v <= 255) ? m.map(Number) : null;
  }
  function setInputColor(rgb, label) {
    S.fixed = { rgb, from: 'input', label };
    renderExtracted();
  }
  function useNumber() {
    const rgb = parseColorText($('#num-input').value);
    if (!rgb) return toast('HEX（#D98C8C）または RGB（217, 140, 140）で入力してください');
    $('#num-color').value = Color.toHex(rgb).toLowerCase();
    setInputColor(rgb, '数値で指定した色');
    toast('数値で指定した色を代表色にしました');
  }
  $('#btn-num').addEventListener('click', useNumber);
  $('#num-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') useNumber(); });
  // 正しい数値が入力されたら、カラーピッカーの色も合わせる
  $('#num-input').addEventListener('input', (e) => {
    const rgb = parseColorText(e.target.value);
    if (rgb) $('#num-color').value = Color.toHex(rgb).toLowerCase();
  });
  // カラーピッカー：選んでいる間も代表色に反映し、確定したときに知らせる
  const fromPicker = (e) => {
    const rgb = Color.parseHex(e.target.value);
    $('#num-input').value = Color.toHex(rgb);
    setInputColor(rgb, 'カラーピッカーで指定した色');
    return rgb;
  };
  $('#num-color').addEventListener('input', fromPicker);
  $('#num-color').addEventListener('change', (e) => {
    fromPicker(e);
    toast('カラーピッカーで指定した色を代表色にしました');
  });

  // ================= レシピ帳の近い色（手順3） =================
  function renderSimilar() {
    const box = $('#similar');
    const rgb = representative();
    if (!rgb) {
      box.innerHTML = '<div class="empty small">代表色が決まると、レシピ帳から近い色を自動で探します</div>';
      return;
    }
    const lab = Color.rgbToLab(rgb);
    const res = Store.entries()
      .filter((e) => e.id !== S.recalled)
      .map((e) => ({ e, de: Color.dE00(lab, Color.rgbToLab(Color.parseHex(e.hex))) }))
      .sort((a, b) => (Math.round(a.de * 10) - Math.round(b.de * 10)) || b.e.rating - a.e.rating);
    if (!res.length) {
      box.innerHTML = '<div class="empty small">レシピ帳にカラーがありません</div>';
      return;
    }
    const shown = S.similarAll ? res : res.slice(0, 3);
    box.innerHTML = shown.map(({ e, de }) => {
      const part = e.part === 'カスタム' && e.customPart ? e.customPart : e.part;
      return `<div class="sim-row">
        <button class="sim-main" data-open="${e.id}" title="詳細を開く">
          <span class="sim-sw" style="background:${e.hex}"></span>
          <span class="sim-body">
            <span class="sim-name">${esc(e.name)}</span>
            <span class="sim-meta"><span class="stars">${stars(e.rating)}</span><span class="tag">${esc(part)}</span>${e.cond?.head ? `<span class="tag">${esc(e.cond.head)}</span>` : ''}</span>
          </span>
        </button>
        ${deBadge(de)}
        <button class="btn btn-ghost btn-s" data-recall="${e.id}">呼び出す</button>
      </div>`;
    }).join('') + (res.length > 3
      ? `<button class="link sim-more" data-more>${S.similarAll ? '上位3件だけ表示' : `もっと見る（ほか${res.length - 3}件）`}</button>`
      : '');
  }
  $('#similar').addEventListener('click', (e) => {
    const r = e.target.closest('[data-recall]');
    if (r) return recall(r.dataset.recall);
    const o = e.target.closest('[data-open]');
    if (o) return openEditor(Store.get(o.dataset.open));
    if (e.target.closest('[data-more]')) { S.similarAll = !S.similarAll; renderSimilar(); }
  });

  // ================= 絵具箱 =================
  const PF = { line: PaintDB.lines[0].id, ownedOnly: false, q: '' }; // 絵具箱の絞り込み（ラインは1つずつ表示する）

  // 品番（「8」でも「008」でも可。前方一致）または色名の一部で探す。空白は無視する。品番のない絵具（ベーシックス）は色名だけで探す
  function matchPaint(p, q) {
    if (!q) return true;
    if (/^\d+$/.test(q)) return !!p.no && (Number(p.no) === Number(q) || p.no.startsWith(q));
    return p.name.replace(/\s/g, '').includes(q);
  }
  function shownPaints() {
    const q = PF.q.replace(/[\s　]/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    return PaintDB.paints.filter((p) => p.line === PF.line && matchPaint(p, q) && (!PF.ownedOnly || Store.isOwned(p.id)));
  }
  function renderPaints() {
    const ownedIn = (id) => PaintDB.paints.filter((p) => p.line === id && Store.isOwned(p.id)).length;
    $('#owned-count').textContent = `所持 ${Store.ownedIds().length} 色`;
    $('#paint-lines').innerHTML = PaintDB.lines.map((l) => `<button type="button" data-line="${l.id}" class="${l.id === PF.line ? 'on' : ''}" aria-pressed="${l.id === PF.line}">${esc(l.name)}<small>${ownedIn(l.id) ? `${ownedIn(l.id)} / ` : ''}${PaintDB.paints.filter((p) => p.line === l.id).length}</small></button>`).join('');
    const line = PaintDB.lineById[PF.line];
    const lp = PaintDB.paints.filter((p) => p.line === line.id);
    const special = lp.filter((p) => !p.mixable).length;
    $('#paint-q').placeholder = lp.some((p) => p.no) ? '品番・色名で検索（例：008、ナフソール）' : '色名で検索（例：ナフソール）';
    $('#paint-source').textContent = `出典：${line.chart}の${lp.some((p) => p.no) ? '品番・' : ''}色名・透明度。${line.name}は${lp.length}色で、うちメタリック・蛍光・イリディッセントの${special}色は計算対象外です。色見本はチャートから取った仮の色で、実際の色とは異なります。`;
    const W = PaintDB.byId[PaintDB.whiteOf[PF.line]?.id || PaintDB.WHITE_ID]; // 同じラインのチタニウムホワイトと混ぜる
    const list = shownPaints();
    $('#paint-rows').innerHTML = list.length ? list.map((p) => {
      const owned = Store.isOwned(p.id);
      const ladder = !p.mixable ? [] : p === W ? [[1, 0]] : [[1, 0], [1, 1], [1, 4], [1, 10]];
      return `<tr class="${owned ? '' : 'unowned'}">
        <td><input type="checkbox" data-own="${p.id}" ${owned ? 'checked' : ''} aria-label="${esc(p.name)}を所持"></td>
        <td><div class="pcell">${sw(p.hex)}<span>${p.no ? `<span class="pno mono">${p.no}</span>` : ''}${esc(p.name)}</span></div>
          <div class="ptags"><span class="tag op-${p.opacity}">${PaintDB.OPACITY[p.opacity]}</span>${p.discontinued ? '<span class="tag tag-stop" title="カラーチャートで販売中止になっている色です。持っているチューブの記録に使えます">販売中止</span>' : ''}${p.mixable ? '' : '<span class="tag tag-muted" title="メタリック・蛍光・イリディッセントは混色の計算で表せないため、調色候補には使いません">計算対象外</span>'}</div></td>
        <td>${p.mixable ? `<div class="ladder">${ladder.map(([a, w]) => {
          const hex = w ? Color.toHex(PaintDB.mixRgb([p, W], [a, w])) : p.hex;
          return `<span style="background:${hex}" title="${w ? `1:${w}` : '絵具のみ'} ${hex}"><small>${w ? `1:${w}` : '原色'}</small></span>`;
        }).join('')}</div>` : '<span class="hint">—</span>'}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="empty small">該当する絵具はありません</td></tr>';
  }
  $('#paint-rows').addEventListener('change', (e) => {
    const id = e.target.dataset.own;
    if (id) { Store.setOwned(id, e.target.checked); renderPaints(); }
  });
  $('#paint-lines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-line]');
    if (b) { PF.line = b.dataset.line; renderPaints(); }
  });
  $('#paint-owned-only').addEventListener('change', (e) => { PF.ownedOnly = e.target.checked; renderPaints(); });
  $('#paint-q').addEventListener('input', (e) => { PF.q = e.target.value; renderPaints(); });
  $('#btn-unown-shown').addEventListener('click', () => {
    const ids = shownPaints().map((p) => p.id);
    if (ids.length > 10 && !confirm(`表示中の${ids.length}色の所持を解除します。よろしいですか？`)) return;
    Store.setOwnedMany(ids, false);
    renderPaints();
  });

  // ================= 設定 =================
  async function renderSettings() {
    let persisted = '不明';
    try { persisted = (await navigator.storage?.persisted?.()) ? '許可済み' : '未許可'; } catch (e) { /* noop */ }
    $('#storage-info').innerHTML = `<span>カラーエントリ</span><b>${Store.entries().length} 件</b>
      <span>使用容量</span><b>${(Store.sizeBytes() / 1024).toFixed(1)} KB</b>
      <span>永続保存</span><b>${persisted}</b>`;
  }
  $('#btn-persist').addEventListener('click', async () => {
    try {
      const ok = await navigator.storage.persist();
      toast(ok ? '永続保存が許可されました' : '永続保存は許可されませんでした');
    } catch (e) { toast('このブラウザは永続保存の要求に対応していません'); }
    renderSettings();
  });
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'doll-pigment-atelier', exportedAt: new Date().toISOString(), ...Store.db }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `doll-pigment-atelier-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.entries)) throw new Error('format');
      if (!confirm(`${data.entries.length} 件のカラーをインポートします。現在のデータは置き換わります。`)) return;
      Store.replaceAll({ version: 1, entries: data.entries, owned: data.owned || [], lastMedium: data.lastMedium });
      toast('インポートしました');
      renderSettings();
    } catch (err) { toast('バックアップファイルを読み込めませんでした'); }
    e.target.value = '';
  });
  $('#btn-reset-sample').addEventListener('click', () => {
    if (!confirm('サンプルデータに戻します。現在のデータは消えます。')) return;
    Store.resetSample(); toast('サンプルデータに戻しました'); renderSettings();
  });
  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('すべてのカラーエントリを削除します。元に戻せません。')) return;
    Store.wipe(); toast('削除しました'); renderSettings();
  });

  // ================= このアプリについて =================
  const aboutDlg = $('#about-dialog');
  const openAbout = () => { if (!aboutDlg.open) aboutDlg.showModal(); };
  $('#btn-about').addEventListener('click', openAbout);
  $$('[data-open-about]').forEach((b) => b.addEventListener('click', openAbout));
  aboutDlg.addEventListener('click', (e) => { if (e.target === aboutDlg) aboutDlg.close(); }); // 背景クリックで閉じる

  // ---------------- 起動 ----------------
  renderImages(); renderExtracted(); renderCandidates(); renderMix();
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
