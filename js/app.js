// 画面ロジック
(async () => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stars = (n) => '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span>';
  const paintName = (id) => PaintDB.byId[id]?.fullLabel || id; // 品番＋色名（ライン）
  const sw = (hex, cls = '') => `<span class="sw ${cls}" style="background:${hex}"></span>`;
  // 明るい色の上に文字を載せるときは、白ではなく濃い色の文字にする（白との混色見本や、目標・混色の見本）
  const onLight = (hex) => (Color.rgbToLab(Color.parseHex(hex))[0] > 66 ? 'on-light' : '');
  // 調色候補の計算には、所持していて切らしていない絵具を使う
  const mixableOwnedCount = () => PaintDB.paints.filter((p) => p.mixable && Store.isUsable(p.id)).length;
  const owned = () => PaintDB.paints.map((p) => p.id).filter(Store.isUsable);

  const isTouch = matchMedia('(pointer: coarse)').matches; // スマホ・タブレット（タッチ操作の端末）

  // 案内（トースト）。ダイアログを開いていても見えるよう、最前面（top layer）に出す。
  // あとから開いたダイアログが手前に来るので、ダイアログを開いたら raiseToast で出し直す
  const toastEl = $('#toast');
  const popoverOk = typeof toastEl.showPopover === 'function';
  const toastOpen = () => (popoverOk ? toastEl.matches(':popover-open') : !toastEl.hidden);
  function showToastEl() {
    if (!popoverOk) { toastEl.hidden = false; return; }
    if (toastOpen()) toastEl.hidePopover();
    toastEl.showPopover();
  }
  function hideToastEl() {
    if (!popoverOk) toastEl.hidden = true;
    else if (toastOpen()) toastEl.hidePopover();
  }
  if (!popoverOk) toastEl.hidden = true;
  function toast(msg) {
    toastEl.textContent = msg;
    showToastEl();
    clearTimeout(toast.t);
    toast.t = setTimeout(hideToastEl, Math.max(2600, msg.length * 90)); // 長い案内は読み終えられるよう長めに出す
  }
  const raiseToast = () => { if (toastOpen()) showToastEl(); };
  // ダイアログを開く（表示中の案内は、ダイアログより手前に出し直す）
  function openModal(d) {
    d.showModal();
    raiseToast();
  }
  const SAVE_FAILED = '保存できませんでした。端末の空き容量が不足している可能性があります（画像を減らしてください）';
  // 書き込みの結果を待ち、保存できなかったら知らせる（所持の設定など、結果を待たずに画面を進める操作用）
  const warnIfFailed = (p) => p.then((ok) => { if (!ok) toast(SAVE_FAILED); return ok; });

  // ユーザーDB（IndexedDB）を読み込んでから画面を作る
  const boot = await Store.init();

  // ---------------- 状態 ----------------
  const S = {
    images: [],        // { id, name, canvas, gains, thumb, savedId }  gains はグレーカード補正のゲイン（未補正なら null）
                       // savedId はレシピ帳に保存したときの画像の id（同じ画像を何度も保存しないため）
    active: null,
    extracted: [],     // { id, imgId, rect, rgb }
    fixed: null,       // 画像を使わない代表色 { rgb, from: 'recall' | 'input', label, src? }（レシピ帳からの呼び出し・数値指定）
                       // src は呼び出し元の色の取得記録 { method, extracted, refImages }（保存するときに引き継ぐ）
    similarAll: false, // レシピ帳の近い色をすべて表示するか
    candidates: [],
    candKey: null,     // 表示中の調色候補を計算した「代表色＋所持絵具」（変わったら自動で計算し直す）
    backToCands: false, // 候補の絵具名から絵具箱を開いた（調色に戻ったら候補の位置を表示する）
    mix: [],           // [{ paintId, pct }]
    recalled: null,    // 呼び出し元エントリ id
  };

  // ---------------- タブ ----------------
  function route() {
    let tab = (location.hash || '#mix').slice(1);
    if (!$('#view-' + tab)) tab = 'mix'; // 存在しないタブは調色を表示
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    if (tab !== 'paints') PF.focus = null; // 候補から開いた絵具の絞り込みは、絵具箱を離れたら解除する
    let back = false;
    if (tab === 'mix') {
      // 候補の絵具名から絵具箱を開いて戻ったとき：所持・切らしているを変えていれば知らせ、候補の位置を表示する
      back = S.backToCands;
      S.backToCands = false;
      if (back && S.candKey && candKeyNow() !== S.candKey) toast('絵具箱の変更に合わせて、調色候補を計算し直します');
      renderCandidates(); renderMix(); scheduleReverse(); // 絵具箱で所持を変えたときに反映する
    }
    if (tab === 'library') renderLibrary();
    if (tab === 'paints') renderPaints();
    if (tab === 'settings') renderSettings();
    if (back) $('#candidates').closest('.card').scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
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
    onGray(lin, rect, st) {
      // 白飛び・暗すぎる範囲では正しい補正値が出ないので、補正しない
      if (st.clipped > GRAY_CLIP_MAX) {
        return toast('囲んだ範囲が白飛びしているため補正できません。白飛びしていない部分を囲むか、明るさを抑えて撮り直してください');
      }
      if (Math.max(...lin) < GRAY_DARK_MIN) {
        return toast('囲んだ範囲が暗すぎるため補正できません。グレーカードの部分を囲んでいるか確認してください');
      }
      const img = curImg();
      img.gains = lin.map((v) => 0.18 / Math.max(0.001, v));
      setGrayMode(false);
      resampleExtracted(img);
      renderImages();
      renderExtracted();
      // 明るさのむらが大きい：グレーカード以外の部分も囲んでいる可能性がある（補正はする）
      toast(st.spread > GRAY_SPREAD_MAX
        ? '補正しましたが、囲んだ範囲の明るさにむらがあります。グレーカードの部分だけを囲めているか確認してください'
        : 'グレーカードでホワイトバランスと明るさを補正しました');
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
  // グレーカード補正の確認（仕様書 2.1）
  const GRAY_CLIP_MAX = 0.02;  // 白飛びした画素がこの割合を超えたら補正しない
  const GRAY_DARK_MIN = 0.01;  // 線形の平均がこれより暗ければ補正しない（sRGB でおよそ 25）
  const GRAY_SPREAD_MAX = 0.2; // 明るさのばらつき（標準偏差÷平均）がこれを超えたら知らせる
  // 画像の補正を変えたら、その画像から取った抽出色を取り直す（picker が表示している画像に限る）
  function resampleExtracted(img) {
    for (const ex of S.extracted.filter((x) => x.imgId === img.id)) {
      ex.rgb = Color.linearToRgb(picker.sample(ex.rect, img.gains));
    }
  }

  // 画像を本画像（長辺 1600px）とサムネイル（長辺 320px）にして保存し、id を返す（保存できなければ null）
  async function storeImage(canvas, name) {
    const [full, thumb] = await Promise.all([canvasToBlob(canvas, 1600, 0.9), canvasToBlob(canvas, 320, 0.8)]);
    return Store.putImage({ full, thumb, name, w: canvas.width, h: canvas.height });
  }

  function addImage(canvas, name) {
    const img = { id: Store.uid(), name, canvas, gains: null, thumb: canvasThumb(canvas, 160) };
    S.images.push(img);
    S.active = img.id;
    renderImages();
  }

  function renderImages() {
    // × はサムネイルのボタンの外に置き、押しやすい大きさにする（画像の切り替えと押し間違えないように）
    $('#img-strip').innerHTML = S.images.map((i) => `
      <div class="thumb-wrap">
        <button class="thumb ${i.id === S.active ? 'on' : ''}" data-id="${i.id}" title="${esc(i.name)}">
          <img src="${i.thumb}" alt="">
          ${i.gains ? '<span class="thumb-tag own">補正済</span>' : ''}
        </button>
        <button class="thumb-x" data-del="${i.id}" title="この画像を外す" aria-label="「${esc(i.name)}」を外す">×</button>
      </div>`).join('');
    const img = curImg();
    $('#img-tools').hidden = !img;
    $('#btn-gray-reset').hidden = !img?.gains;
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
      // この画像から取った抽出色も消えるので、抽出色があるときは確かめる
      const n = S.extracted.filter((x) => x.imgId === id).length;
      const name = S.images.find((i) => i.id === id)?.name || '';
      if (n && !confirm(`「${name}」を外します。この画像から取った抽出色（${n}色）も消えます。`)) return;
      S.images = S.images.filter((i) => i.id !== id);
      S.extracted = S.extracted.filter((x) => x.imgId !== id);
      if (S.active === id) S.active = S.images[0]?.id || null;
      renderImages(); renderExtracted();
      return;
    }
    const b = e.target.closest('.thumb');
    if (b) { S.active = b.dataset.id; setGrayMode(false); renderImages(); }
  });

  // 画像ファイルを読み込む。読み込めなければ知らせて null を返す（HEIC を表示できないブラウザ、壊れたファイルなど）
  async function loadImageFile(f, maxSide) {
    try {
      return await fileToCanvas(f, maxSide);
    } catch (err) {
      console.warn(err);
      toast(`「${f.name}」を読み込めませんでした。JPEG・PNG などの画像を選んでください`);
      return null;
    }
  }
  $('#img-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      const c = await loadImageFile(f);
      if (c) addImage(c, f.name);
    }
  });
  // 画像が1枚もないときだけ、案内文の中に「サンプル画像で試してみる」を出す
  $('#img-stage').addEventListener('click', (e) => {
    if (!e.target.closest('[data-sample]')) return;
    addImage(makeSampleCanvas('natural'), 'サンプル（自然光）');
    addImage(makeSampleCanvas('warm'), 'サンプル（室内光）');
    toast(`サンプル画像を2枚追加しました。チークを${isTouch ? 'タップ' : 'ドラッグ'}してみてください`);
  });

  // ---- 操作モード（範囲選択 / 移動 / グレーカード補正）----
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
  $('#btn-gray-reset').addEventListener('click', () => {
    const img = curImg();
    if (!img?.gains) return;
    img.gains = null;
    setGrayMode(false);
    resampleExtracted(img);
    renderImages();
    renderExtracted();
    toast('グレーカード補正を解除しました');
  });
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
      openModal(camDlg);
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
    e.target.value = '';
    const c = f && await loadImageFile(f);
    if (c) addImage(c, shotName());
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

  // 外れた色：その色を除いた残りの平均から ΔE2000 がこれ以上離れている抽出色（3色以上のとき）。
  // ただし、残りの抽出色のばらつき（残りの平均から最も離れた色の ΔE）の2倍以上離れているときに限る。
  // 照明の違う画像から取って色が広がっているときに、両端の色にまで印が付かないようにするため
  const OUTLIER_DE = 10;
  const OUTLIER_SPREAD_RATIO = 2;
  function outliers() {
    const xs = S.extracted;
    const out = new Map(); // id → ΔE
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
        return `<div class="chip ${de ? 'outlier' : ''}" data-id="${x.id}" ${de ? 'title="照明の違いや、取る場所のずれがないか確認してください。外れた色なら × で除きます（意図して条件の違う画像を入れている場合は、そのままで構いません）"' : ''}>
          ${sw(Color.toHex(x.rgb))}
          <span><b>${x.label}</b> ${Color.toHex(x.rgb)}<small>${esc(img?.name || '')}</small>${de ? `<em class="flag">ほかと色が離れています（ΔE ${de.toFixed(1)}）</em>` : ''}</span>
          <button class="chip-x" data-del="${x.id}" title="取り消す" aria-label="${x.label} を取り消す">×</button></div>`;
      }).join('')
      : `<div class="empty small">${isTouch ? '手順1の画像をタップする（範囲は長押ししてから囲む）' : '手順1の画像をクリックかドラッグする'}と、ここに抽出色が並びます</div>`;
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
      // 外れた色は抽出色のチップに印を付けるので、ここには書かない
      note = `<div class="note">${S.extracted.length}色 / ${imgs.length}枚から算出${uncorrected ? `（補正していない画像を含むため、色は目安）` : ''}</div>`;
      const gap = pairGap();
      if (gap) note += `<div class="note warn">2つの抽出色の差が大きめです（ΔE ${gap.toFixed(1)}）。照明の違いや、取る場所がずれていないか確認してください</div>`;
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
  let pendingKey = null; // 計算中の「代表色＋所持絵具」

  // 計算は Web Worker で行い、画面を固めない（所持している絵具が多いと時間がかかるため）
  // Worker は起動時に1つだけ作って使い続ける（作り直すと、スクリプトの読み込みと絵具の準備をやり直すうえ、
  // 新しい版が公開された直後に、画面と Worker で版が食い違うことがあるため）。
  // 計算中に新しい計算を頼まれたら、終わるのを待ってから最新の1件だけを計算する（古い結果は捨てる）。
  // Worker を使えないとき（index.html を直接開いた場合など）は画面側で計算する
  const Reverser = (() => {
    let worker = null, failed = false, seq = 0, busy = false;
    let waiting = null; // 結果を待っている最新の計算 { id, args, resolve, sent }
    const runHere = ({ rgb, ids, top }) => {
      const t0 = performance.now();
      const cands = PaintDB.reverse(rgb, ids, top);
      return { cands, ms: performance.now() - t0 };
    };
    function fallback() {
      failed = true;
      busy = false;
      worker?.terminate();
      worker = null;
      const w = waiting;
      waiting = null;
      if (w) w.resolve(runHere(w.args));
    }
    function send() {
      busy = true;
      waiting.sent = true;
      worker.postMessage({ id: waiting.id, ...waiting.args });
    }
    function ensure() {
      if (worker || failed) return worker;
      try {
        worker = new Worker('js/reverse-worker.js');
        worker.onmessage = (e) => {
          busy = false;
          if (waiting?.id === e.data.id) {
            const w = waiting;
            waiting = null;
            w.resolve({ cands: e.data.cands, ms: e.data.ms });
          } else if (waiting && !waiting.sent) {
            send(); // 計算中に頼まれた最新の計算を始める
          }
        };
        worker.onerror = (e) => { e.preventDefault?.(); fallback(); };
      } catch (e) { failed = true; worker = null; }
      return worker;
    }
    // 結果を待っている計算をやめて、結果は null にする（Worker で計算中のものは、終わってから捨てる）
    function cancel() {
      if (!waiting) return;
      waiting.resolve(null);
      waiting = null;
    }
    function run(rgb, ids, top = 3) {
      cancel();
      const args = { rgb, ids, top };
      if (!ensure()) return Promise.resolve(runHere(args));
      return new Promise((resolve) => {
        waiting = { id: ++seq, args, resolve, sent: false };
        if (!busy) send();
      });
    }
    ensure(); // 最初の計算を待たせないよう、起動時に読み込んでおく
    return { run, cancel, get inWorker() { return !!worker; } };
  })();
  // いま表示している候補が、どの「代表色＋所持絵具」で計算したものか
  function candKeyNow() {
    const rgb = representative();
    if (!rgb) return null;
    return `${Color.toHex(rgb)}|${owned().filter((id) => PaintDB.byId[id].mixable).join(',')}`;
  }
  // 計算の予定と計算中のものをやめる（呼び出し・絵具置換で候補を直接決めたとき）
  function stopReverse() {
    clearTimeout(reverseTimer);
    Reverser.cancel();
    pendingKey = null;
  }
  function scheduleReverse() {
    clearTimeout(reverseTimer);
    const key = candKeyNow();
    if (key === pendingKey) return; // 同じ内容をすでに計算中
    if (key === S.candKey) {
      // 変わっていない（いったん変えて元に戻した場合を含む）：計算し直さず、表示中の候補を使う
      if (pendingKey) { Reverser.cancel(); pendingKey = null; renderCandidates(); }
      return;
    }
    Reverser.cancel();
    pendingKey = null;
    if (!key || !mixableOwnedCount()) {
      S.candidates = [];
      S.candKey = key;
      renderCandidates();
      return;
    }
    $('#candidates').innerHTML = '<div class="empty small">計算中…</div>';
    reverseTimer = setTimeout(async () => {
      const rgb = representative();
      if (!rgb) return;
      pendingKey = key;
      const res = await Reverser.run(rgb, owned(), 3);
      if (pendingKey !== key) return; // 計算中に代表色か所持が変わった（新しい計算が始まっている）
      pendingKey = null;
      if (!res) return;
      S.candidates = res.cands;
      S.candTime = res.ms;
      S.candKey = key;
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
        ? '<div class="empty small">代表色が決まると、自動で調色候補を計算します</div>'
        : Store.runOutIds().length
        ? '<div class="empty">使える絵具がありません（所持している絵具は、すべて「切らしている」になっています）。<br>買い直した絵具は、絵具箱で「切らしている」を外してください。<div class="sample-try"><a class="btn btn-ghost btn-s" href="#paints">絵具箱を開く</a></div></div>'
        : '<div class="empty">調色候補は、持っている絵具だけで計算します。<br>先に絵具箱で、持っている絵具を選んでください。<div class="sample-try"><a class="btn btn-ghost btn-s" href="#paints">絵具箱を開く</a></div></div>';
      return;
    }
    const target = rgb ? Color.toHex(rgb) : '#cccccc';
    $('#candidates').innerHTML = S.candidates.map((c, i) => `
      <div class="cand">
        <div class="cand-sw">
          <div class="${onLight(target)}" style="background:${target}"><span>目標</span></div>
          <div class="${onLight(c.hex)}" style="background:${c.hex}"><span>混色</span></div>
        </div>
        <div class="cand-body">
          <div class="row between"><b>候補 ${i + 1}</b>${deBadge(c.de)}</div>
          <ul class="recipe">
            ${c.items.map((x) => `<li>${sw(PaintDB.byId[x.paintId].hex)}<button type="button" class="pname plink" data-focus="${x.paintId}" title="絵具箱でこの絵具を表示します">${esc(paintName(x.paintId))}</button>
              <span class="bar"><i style="width:${x.pct}%"></i></span><b class="mono">${x.pct}%</b></li>`).join('')}
          </ul>
          <div class="row gap-s wrap">
            <button class="btn btn-ghost btn-s" data-use="${i}">この候補で調整する ↓</button>
          </div>
        </div>
      </div>`).join('') + (S.candTime == null
      ? '<div class="hint small">呼び出したカラーに保存されていた候補です</div>'
      : `<div class="hint small">所持している ${mixableOwnedCount()} 色から計算しました${Store.runOutIds().length ? `（切らしている ${Store.runOutIds().length} 色を除く）` : ''}</div>`)
      + '<div class="hint small">絵具名を押すと、絵具箱でその絵具を表示します。手元にない絵具は「切らした」を押して戻ると、その絵具を除いて計算し直します</div>';
  }

  $('#candidates').addEventListener('click', (e) => {
    const use = e.target.closest('[data-use]');
    if (use) {
      S.mix = S.candidates[+use.dataset.use].items.map((x) => ({ ...x }));
      renderMix();
      $('#mix-rows').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // 絵具名：絵具箱でその絵具だけを表示する（切らしているにして戻ると、所持が変わるので候補を計算し直す）
    const focus = e.target.closest('[data-focus]');
    if (focus) {
      const p = PaintDB.byId[focus.dataset.focus];
      if (!p) return;
      PF.focus = p.id;
      PF.line = p.line;
      S.backToCands = true;
      location.hash = '#paints';
    }
  });

  // ---- 手動調整 ----
  // 所持している絵具（切らしているものを除く）を先に並べ、残りはラインごとにまとめる
  const paintOptions = (sel) => {
    const opt = (p, text) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(text)}</option>`;
    const own = PaintDB.paints.filter((p) => Store.isUsable(p.id));
    return (own.length ? `<optgroup label="所持している絵具">${own.map((p) => opt(p, p.fullLabel)).join('')}</optgroup>` : '')
      + PaintDB.lines.map((l) => {
        const rest = PaintDB.paints.filter((p) => p.line === l.id && !Store.isUsable(p.id));
        return rest.length ? `<optgroup label="${esc(l.name)}${own.length ? (Store.runOutIds().length ? '（未所持・切らしている）' : '（未所持）') : ''}">${rest.map((p) => opt(p, p.label)).join('')}</optgroup>` : '';
      }).join('');
  };

  function renderMix() {
    const rows = $('#mix-rows');
    rows.innerHTML = S.mix.length
      ? S.mix.map((m, i) => `
        <div class="mix-row" data-i="${i}">
          ${sw(PaintDB.byId[m.paintId]?.hex || '#ccc')}
          <select data-k="paintId">${paintOptions(m.paintId)}</select>
          <button class="icon-btn" data-rm="${i}" title="削除">×</button>
          <input type="range" data-k="pct" value="${m.pct}" min="0" max="100" step="1" aria-label="割合">
          <input type="number" data-k="pct" value="${m.pct}" min="0" max="100" step="1" class="mono" aria-label="割合（%）">
          <span class="unit">%</span>
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
          <div class="${target ? onLight(Color.toHex(target)) : 'on-light'}" style="background:${target ? Color.toHex(target) : 'transparent'}"><span>${target ? '目標' : '目標なし'}</span></div>
          <div class="${onLight(ev.hex)}" style="background:${ev.hex}"><span>予測</span></div>
        </div>
        <div class="kv"><span>予測色</span><b class="mono">${ev.hex}</b>
          <span>絵具の合計</span><b><span class="mono">${total}%</span>${total === 100 ? '' : '<span class="note">（保存するときに、比率を変えずに100%にそろえます）</span>'}</b></div>
        ${ev.de != null ? deBadge(ev.de) : ''}`
      : '<div class="empty small">混色の予測がここに出ます</div>';
  }
  $('#mix-rows').addEventListener('input', (e) => {
    const row = e.target.closest('.mix-row');
    if (!row) return;
    const m = S.mix[+row.dataset.i];
    const k = e.target.dataset.k;
    m[k] = k === 'pct' ? Math.min(100, Math.max(0, Math.round(+e.target.value || 0))) : e.target.value;
    if (k === 'paintId') return renderMix();
    // スライダーと数値の欄は同じ割合を表すので、操作していないほうを合わせる
    row.querySelectorAll('[data-k="pct"]').forEach((el) => { if (el !== e.target) el.value = m.pct; });
    renderMixPreview();
  });
  // 範囲外や小数を入れたときは、入力を終えた時点で数値の欄を記録する値に直す
  $('#mix-rows').addEventListener('change', (e) => {
    const row = e.target.closest('.mix-row');
    if (row && e.target.type === 'number') e.target.value = S.mix[+row.dataset.i].pct;
  });
  $('#mix-rows').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { S.mix.splice(+rm.dataset.rm, 1); renderMix(); }
  });
  $('#btn-add-row').addEventListener('click', () => {
    if (S.mix.length >= 6) return toast('絵具は6色までにしましょう');
    const first = PaintDB.WHITE_IDS.find(Store.isUsable) || owned()[0] || PaintDB.WHITE_ID;
    S.mix.push({ paintId: first, pct: S.mix.length ? 5 : 100 });
    renderMix();
  });
  $('#btn-clear-mix').addEventListener('click', () => { S.mix = []; renderMix(); });

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

  $('#btn-save').addEventListener('click', async () => {
    // 合計が100%でないとき（グラムで入れたときなど）や0%の絵具があるときは、保存の前にそろえて画面にも反映する
    const total = S.mix.reduce((s, m) => s + (+m.pct || 0), 0);
    let normalized = '';
    if (S.mix.length && (total !== 100 || S.mix.some((m) => !(m.pct > 0)))) {
      S.mix = normalizeMix(S.mix);
      renderMix();
      if (total !== 100 && S.mix.length) normalized = `絵具の合計が${total}%だったので、比率を変えずに100%にそろえました`;
    }
    const rgb = representative() || PaintDB.evaluate(S.mix)?.rgb;
    if (!rgb) return toast('代表色か実際の調色を決めてから保存してください');
    const base = S.recalled ? Store.get(S.recalled) : null;
    // 呼び出した色をそのまま代表色にしているときは、呼び出し元の色の取得記録を引き継ぐ
    // （呼び出し案内を閉じて上書き先がなくなっても引き継ぐ。画面に残っている画像と抽出色は、この色とは関係がないので保存しない）
    const src = S.fixed?.from === 'recall' ? S.fixed.src : null;
    // 参考画像を先に保存しておく（保存をやめた画像は、次の起動時に消える）
    const pending = src ? [] : S.images.filter((img) => !(img.savedId && Store.hasImage(img.savedId)));
    if (pending.length) {
      const btn = $('#btn-save'), label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '画像を保存中…';
      try {
        for (const img of pending) {
          img.savedId = await storeImage(img.canvas, img.name);
          if (!img.savedId) return toast(SAVE_FAILED);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
    const draft = {
      ...(base ? structuredClone(base) : {
        name: '', rating: 3, comment: '',
        cond: { head: '', skin: 'セミホワイト', brand: Store.DEFAULT_BRAND, medium: Store.lastMedium() }, recordImages: [],
      }),
      hex: Color.toHex(rgb),
      method: src ? src.method : S.fixed ? 'manual' : 'average',
      // 数値・カラーピッカーで指定した色は抽出色を使っていないので、抽出色は記録しない
      extracted: src ? [...src.extracted] : S.fixed ? [] : S.extracted.map((x) => Color.toHex(x.rgb)),
      refImages: src ? structuredClone(src.refImages) : S.images.map((i) => ({ imageId: i.savedId, name: i.name, corrected: !!i.gains, gains: i.gains })),
      estimated: S.candidates.map((c) => ({ items: c.items, de: +c.de.toFixed(2) })),
      actual: S.mix.map((x) => ({ ...x })),
    };
    openEditor(draft, { fromMix: true, baseId: base?.id });
    if (normalized) toast(normalized); // 保存の画面を開いてから知らせる（画面の手前に出る）
  });

  // ================= エントリ編集ダイアログ =================
  const dlg = $('#entry-dialog');

  // サムネイル（押すと本画像を開く）。rm を渡すと削除ボタンを付ける
  const thumbButton = (ref, rm) => Store.hasImage(ref.imageId)
    ? `<span class="thumb-box"><button type="button" class="thumb-view" data-view="${ref.imageId}" data-name="${esc(ref.name)}" title="${esc(ref.name || '画像を開く')}"><img src="${Store.thumbUrl(ref.imageId)}" alt="${esc(ref.name)}"></button>${rm != null ? `<button type="button" class="thumb-x" data-rm-rec="${rm}" title="この記録画像を外す" aria-label="この記録画像を外す">×</button>` : ''}</span>`
    : '';
  const recThumbs = (list) => (list || []).map((r, i) => thumbButton(r, i)).join('') || '<div class="empty small">仕上がりの写真を追加できます</div>';

  // 本画像を大きく表示する
  const viewer = $('#image-dialog');
  function openViewer(id, name) {
    $('#image-view').src = Store.fullUrl(id);
    $('#image-view').alt = name || '';
    $('#image-name').textContent = name || '';
    openModal(viewer);
  }
  $('#image-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });

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
          <input name="name" class="title-input" placeholder="名称（例：コーラルピンクチーク）" value="${esc(e.name)}" required>
          <div class="mono small">${e.hex} · RGB ${rgb.join(', ')} · Lab ${Color.fmtLab(Color.rgbToLab(rgb))}</div>
        </div>
        <button type="button" class="icon-btn" data-act="close" title="閉じる" ${e.name ? 'autofocus' : ''}>×</button>
      </div>
      <div class="dlg-body">
        <div class="form-grid">
          <label class="span2">評価
            <div class="stars-input" data-v="${e.rating}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" class="${n <= e.rating ? 'on' : ''}">★</button>`).join('')}</div>
          </label>
          <label class="span2">コメント<textarea name="comment" rows="2" placeholder="例：少し暖色寄り。頬の中心だけ3回重ねる">${esc(e.comment)}</textarea></label>
        </div>

        <h3>制作条件 <span class="badge" title="使用絵具はリキテックスに固定です。ライン（レギュラー・ソフト・ベーシックス）は調色記録の絵具に表示されます">使用絵具：${esc(Store.DEFAULT_BRAND)}</span></h3>
        <div class="form-grid">
          <label>ヘッド<input name="head" value="${esc(e.cond?.head)}" placeholder="DDH-01" list="heads"></label>
          <label>肌色<select name="skin">${Store.SKINS.map((s) => `<option ${s === e.cond?.skin ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
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
        <div class="thumbs">${e.refImages?.length ? e.refImages.map((i) => thumbButton(i)).join('') : '<div class="empty small">なし</div>'}</div>
        <h3>記録画像 <label class="btn btn-ghost btn-s">追加<input type="file" accept="image/*" multiple hidden data-rec></label></h3>
        <div class="thumbs" id="rec-thumbs">${recThumbs(e.recordImages)}</div>
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

    form.onclick = async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.rmRec != null) {
        work.recordImages.splice(+b.dataset.rmRec, 1);
        $('#rec-thumbs').innerHTML = recThumbs(work.recordImages);
        markDirty();
        return;
      }
      if (b.dataset.view) return openViewer(b.dataset.view, b.dataset.name);
      const st = b.closest('.stars-input');
      if (st) { work.rating = +b.dataset.v; $$('button', st).forEach((x) => x.classList.toggle('on', +x.dataset.v <= work.rating)); markDirty(); return; }
      const act = b.dataset.act;
      if (act === 'close') { ev.preventDefault(); dlg.close(); }
      if (act === 'delete') {
        if (!confirm(`「${e.name}」を削除します。よろしいですか？`)) return;
        const ok = await Store.remove(e.id);
        dlg.close(); renderLibrary(); toast(ok ? '削除しました' : '削除できませんでした');
        if (ok) dropStaleRecall();
      }
      if (act === 'recall') {
        // 書き換えてあれば、先に保存してから呼び出す
        if (dirty) {
          const data = collect();
          if (!data.name) return toast('名称を入力してください');
          if (!(await saveEntry(data))) return;
          toast('変更を保存しました');
        }
        dlg.close();
        recall(e.id);
      }
    };
    form.querySelector('[data-rec]').onchange = async (ev) => {
      work.recordImages = work.recordImages || [];
      const files = [...ev.target.files];
      ev.target.value = '';
      for (const f of files) {
        const c = await loadImageFile(f, 1600);
        if (!c) continue;
        const id = await storeImage(c, f.name);
        if (!id) { toast(SAVE_FAILED); break; }
        work.recordImages.push({ imageId: id, name: f.name });
      }
      $('#rec-thumbs').innerHTML = recThumbs(work.recordImages);
      markDirty();
    };

    function collect() {
      const fd = new FormData(form);
      return {
        ...work,
        name: fd.get('name').trim(),
        comment: fd.get('comment'),
        cond: { head: fd.get('head').trim(), skin: fd.get('skin'), brand: Store.DEFAULT_BRAND, medium: fd.get('medium') },
      };
    }

    async function saveEntry(data) {
      const ok = await Store.upsert(data);
      if (!ok) { toast(SAVE_FAILED); return false; }
      await Store.setLastMedium(data.cond.medium);
      renderLibrary();
      return true;
    }

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const act = ev.submitter?.dataset.act;
      const data = collect();
      if (!data.name) return toast('名称を入力してください');
      if (act === 'overwrite') { data.id = opt.baseId; data.createdAt = Store.get(opt.baseId)?.createdAt || Date.now(); }
      else if (act === 'new') { data.id = Store.uid(); data.createdAt = Date.now(); }
      // 保存できてから閉じる（保存できなければ、書いた内容を残したままにする）
      const btns = $$('.dlg-foot button', form);
      btns.forEach((x) => (x.disabled = true));
      const ok = await saveEntry(data);
      btns.forEach((x) => (x.disabled = false));
      if (!ok) return;
      dlg.close();
      toast(act === 'overwrite' ? `レシピ帳の「${data.name}」を上書き保存しました`
        : act === 'new' ? `「${data.name}」をレシピ帳に${opt.baseId ? '追加' : '保存'}しました`
          : `「${data.name}」の変更を保存しました`);
      if (opt.fromMix) S.recalled = data.id;
    };

    // 名称が入っているとき（レシピ帳の詳細、呼び出したカラーの上書き）は、入力欄ではなく「閉じる」に
    // フォーカスする（上の autofocus）。iOS では入力欄にフォーカスするとキーボードが開き、毎回閉じる操作が要るため。
    // 名称が空のとき（新しく保存するとき）は、すぐ入力できるよう最初の欄（名称）にフォーカスする
    openModal(dlg);
  }

  // ================= レシピ帳 =================
  ['#lib-q', '#lib-rating', '#lib-sort'].forEach((s) => $(s).addEventListener('input', renderLibrary));

  function entryCard(e, extra = '') {
    return `<button class="entry" data-id="${e.id}">
      <div class="entry-sw" style="background:${e.hex}">
        ${e.recordImages?.[0] && Store.hasImage(e.recordImages[0].imageId) ? `<img src="${Store.thumbUrl(e.recordImages[0].imageId)}" alt="">` : ''}
      </div>
      <div class="entry-body">
        <div class="entry-name">${esc(e.name)}</div>
        <div class="stars">${stars(e.rating)}</div>
        <div class="entry-comment">${esc(e.comment)}</div>
        <div class="tags">${e.cond?.head ? `<span class="tag">${esc(e.cond.head)}</span>` : ''}<span class="tag mono">${e.hex}</span></div>
        ${extra}
      </div></button>`;
  }

  // 検索の対象：名称・コメントと、制作条件（ヘッド・肌色・使用絵具・使用メディウム）
  const searchText = (e) => [
    e.name, e.comment,
    e.cond?.head, e.cond?.skin, e.cond?.brand, PaintDB.mediumById[e.cond?.medium]?.name,
  ].join(' ').toLowerCase();

  function renderLibrary() {
    const q = $('#lib-q').value.trim().toLowerCase();
    const minR = +$('#lib-rating').value, sort = $('#lib-sort').value;
    let list = Store.entries().filter((e) =>
      e.rating >= minR &&
      (!q || searchText(e).includes(q)));
    list = list.sort(sort === 'rating' ? (a, b) => b.rating - a.rating || b.createdAt - a.createdAt
      : sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ja') : (a, b) => b.createdAt - a.createdAt);
    $('#lib-grid').innerHTML = list.length ? list.map((e) => entryCard(e)).join('')
      : Store.entries().length ? '<div class="card empty">該当するカラーはありません</div>'
        : `<div class="card empty">まだカラーがありません。調色の画面で色を決めて「レシピ帳に保存」すると、ここに並びます。
          <div class="sample-try"><button class="btn btn-ghost btn-s" data-add-sample>サンプルのカラーを追加して試す</button></div></div>`;
    renderSimilar(); // レシピ帳が変わったら、調色画面の「近い色」も更新する
  }
  $('#lib-grid').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-add-sample]')) return addSamples();
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
    stopReverse(); // 計算中の候補で、呼び出した候補を上書きしない
    S.candKey = candKeyNow();
    const b = $('#recall-banner');
    b.innerHTML = `${sw(e.hex)} <span>「<b>${esc(e.name)}</b>」の調色を呼び出しました。下の絵具と割合を微調整して、上書き保存するか、別のカラーとしてレシピ帳に追加できます。</span><button class="icon-btn" id="btn-unrecall" title="呼び出しをやめる">×</button>`;
    b.hidden = false;
    $('#btn-unrecall').onclick = clearRecall;
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

  // 呼び出しの案内を閉じる（呼び出した色・候補・調色はそのまま残る）
  function clearRecall() {
    S.recalled = null;
    $('#recall-banner').hidden = true;
    renderSimilar();
  }
  // 呼び出し元のカラーが削除された（削除・インポート・すべて削除）ら、呼び出しの案内を閉じる
  function dropStaleRecall() {
    if (S.recalled && !Store.get(S.recalled)) clearRecall();
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
      return `<div class="sim-row">
        <button class="sim-main" data-open="${e.id}" title="詳細を開く">
          <span class="sim-sw" style="background:${e.hex}"></span>
          <span class="sim-body">
            <span class="sim-name">${esc(e.name)}</span>
            <span class="sim-meta"><span class="stars">${stars(e.rating)}</span>${e.cond?.head ? `<span class="tag">${esc(e.cond.head)}</span>` : ''}</span>
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
  // 絵具箱の絞り込み（ラインは1つずつ表示する）。focus は調色候補の絵具名から開いた絵具の id（その絵具だけを表示する）
  const PF = { line: PaintDB.lines[0].id, ownedOnly: false, q: '', focus: null };

  // 品番（「8」でも「008」でも可。前方一致）または色名の一部で探す。空白は無視する。品番のない絵具（ベーシックス）は色名だけで探す
  function matchPaint(p, q) {
    if (!q) return true;
    if (/^\d+$/.test(q)) return !!p.no && (Number(p.no) === Number(q) || p.no.startsWith(q));
    return p.name.replace(/\s/g, '').includes(q);
  }
  function shownPaints() {
    if (PF.focus) return [PaintDB.byId[PF.focus]];
    const q = PF.q.replace(/[\s　]/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    return PaintDB.paints.filter((p) => p.line === PF.line && matchPaint(p, q) && (!PF.ownedOnly || Store.isOwned(p.id)));
  }
  function renderPaints() {
    const ownedIn = (id) => PaintDB.paints.filter((p) => p.line === id && Store.isOwned(p.id)).length;
    const outN = Store.runOutIds().length;
    $('#owned-count').textContent = `所持 ${Store.ownedIds().length} 色${outN ? `（切らしている ${outN} 色）` : ''}`;
    $('#paint-lines').innerHTML = PaintDB.lines.map((l) => `<button type="button" data-line="${l.id}" class="${l.id === PF.line ? 'on' : ''}" aria-pressed="${l.id === PF.line}">${esc(l.name)}<small>${ownedIn(l.id) ? `${ownedIn(l.id)} / ` : ''}${PaintDB.paints.filter((p) => p.line === l.id).length}</small></button>`).join('');
    const line = PaintDB.lineById[PF.line];
    const lp = PaintDB.paints.filter((p) => p.line === line.id);
    const special = lp.filter((p) => !p.mixable).length;
    $('#paint-q').placeholder = lp.some((p) => p.no) ? '品番・色名で検索' : '色名で検索';
    // 所持していない絵具を薄くするのは、このラインに所持している絵具があるときだけ（1色もなければ全部が薄くなって見づらいため）
    $('table.paints').classList.toggle('fade-unowned', lp.some((p) => Store.isOwned(p.id)));
    $('#paint-source').textContent = `出典：${line.chart}の${lp.some((p) => p.no) ? '品番・' : ''}色名・透明度。${line.name}は${lp.length}色で、うちメタリック・蛍光・イリディッセントの${special}色は計算対象外です。色見本はチャートから取った色で、実際の絵具の色とは異なります。混色はこの色から Mixbox で計算します。`;
    const W = PaintDB.byId[PaintDB.whiteOf[PF.line]?.id || PaintDB.WHITE_ID]; // 同じラインのチタニウムホワイトと混ぜる
    const list = shownPaints();
    // 候補から開いたときは、その絵具だけを表示し、ラインの切り替え・検索は隠して戻るボタンを出す
    const fp = PF.focus && PaintDB.byId[PF.focus];
    $('.paint-filters').hidden = !!fp;
    $('#paint-focus').hidden = !fp;
    if (fp) $('#paint-focus').innerHTML = `${sw(fp.hex)}<span>調色候補から開いた絵具：<b>${esc(fp.fullLabel)}</b><br><small>手元にないときは「切らした」を押して戻ると、この絵具を除いて計算し直します</small></span>
      <div class="row gap-s wrap"><a class="btn btn-primary btn-s" href="#mix">調色に戻る</a><button type="button" class="btn btn-ghost btn-s" id="btn-unfocus">すべての絵具を表示</button></div>`;
    $('#btn-unown-shown').disabled = !list.some((p) => Store.isOwned(p.id)); // 解除する絵具がないときは押せない
    $('#paint-rows').innerHTML = list.length ? list.map((p) => {
      const owned = Store.isOwned(p.id);
      const out = owned && Store.isRunOut(p.id);
      const steps = !p.mixable ? [] : p === W ? [[1, 0]] : [[1, 0], [1, 1], [1, 4], [1, 10]];
      const ladder = steps.map(([a, w]) => {
        const hex = w ? Color.toHex(PaintDB.mixRgb([p, W], [a, w])) : p.hex;
        return `<span class="${onLight(hex)}" style="background:${hex}" title="${w ? `1:${w}` : '絵具のみ'} ${hex}"><small>${w ? `1:${w}` : '原色'}</small></span>`;
      }).join('');
      // 白との混色見本は、PC では3列目に、スマホでは絵具名の下（ladder-in）に出す。
      // スマホで3列目に置くと、絵具名の欄が狭くなって名前が改行されるため
      // 所持している絵具には「切らしている」の切り替えを出す（押すと、買い直すまで調色候補の計算に使わない）
      const outBtn = owned ? `<button type="button" class="tag tag-out${out ? ' on' : ''}" data-out="${p.id}" aria-pressed="${out}" title="${out ? '買い直したら押して外します' : '使い切った絵具は、押すと買い直すまで調色候補の計算に使いません'}">${out ? '切らしている' : '切らした'}</button>` : '';
      return `<tr class="${owned ? '' : 'unowned'}${out ? ' run-out' : ''}">
        <td><input type="checkbox" data-own="${p.id}" ${owned ? 'checked' : ''} aria-label="${esc(p.name)}を所持"></td>
        <td><div class="pcell">${sw(p.hex)}<span>${p.no ? `<span class="pno mono">${p.no}</span>` : ''}${esc(p.name)}</span></div>
          <div class="ptags"><span class="tag op-${p.opacity}">${PaintDB.OPACITY[p.opacity]}</span>${p.discontinued ? '<span class="tag tag-stop" title="カラーチャートで販売中止になっている色です。持っているチューブの記録に使えます">販売中止</span>' : ''}${p.mixable ? '' : '<span class="tag tag-muted" title="メタリック・蛍光・イリディッセントは混色の計算で表せないため、調色候補には使いません">計算対象外</span>'}${outBtn}</div>
          ${p.mixable ? `<div class="ladder ladder-in" aria-hidden="true">${ladder}</div>` : ''}</td>
        <td class="ladder-col">${p.mixable ? `<div class="ladder">${ladder}</div>` : '<span class="hint">—</span>'}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="empty small">該当する絵具はありません</td></tr>';
  }
  $('#paint-rows').addEventListener('change', (e) => {
    const id = e.target.dataset.own;
    if (id) { warnIfFailed(Store.setOwned(id, e.target.checked)); renderPaints(); }
  });
  $('#paint-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-out]');
    if (b) { warnIfFailed(Store.setRunOut(b.dataset.out, !Store.isRunOut(b.dataset.out))); renderPaints(); }
  });
  $('#paint-focus').addEventListener('click', (e) => {
    if (e.target.closest('#btn-unfocus')) { PF.focus = null; renderPaints(); }
  });
  $('#paint-lines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-line]');
    if (b) { PF.line = b.dataset.line; renderPaints(); }
  });
  $('#paint-owned-only').addEventListener('change', (e) => { PF.ownedOnly = e.target.checked; renderPaints(); });
  $('#paint-q').addEventListener('input', (e) => { PF.q = e.target.value; renderPaints(); });
  $('#btn-unown-shown').addEventListener('click', () => {
    const ids = shownPaints().map((p) => p.id).filter(Store.isOwned);
    if (!ids.length) return;
    if (ids.length > 10 && !confirm(`表示中の${ids.length}色の所持を解除します。よろしいですか？`)) return;
    warnIfFailed(Store.setOwnedMany(ids, false));
    renderPaints();
  });

  // ================= 設定 =================
  const fmtBytes = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  async function renderSettings() {
    let persisted = '不明';
    try { persisted = (await navigator.storage?.persisted?.()) ? '許可済み' : '未許可'; } catch (e) { /* noop */ }
    $('#storage-info').innerHTML = `<span>カラーエントリ</span><b>${Store.entries().length} 件</b>
      <span>保存先</span><b>${Store.available ? 'この端末のブラウザ（IndexedDB）' : '一時的（画面を閉じると消えます）'}</b>
      <span>画像</span><b>${Store.imageCount()} 枚</b>
      <span>使用容量</span><b>${fmtBytes(Store.sizeBytes())}</b>
      <span>永続保存</span><b>${persisted}</b>`;
  }
  $('#btn-persist').addEventListener('click', async () => {
    try {
      const ok = await navigator.storage.persist();
      toast(ok ? '永続保存が許可されました' : '永続保存は許可されませんでした');
    } catch (e) { toast('このブラウザは永続保存の要求に対応していません'); }
    renderSettings();
  });
  // ---- バックアップ（仕様書 5）----
  // ZIP 1つに、data.json（ユーザーDB と画像の一覧）と images/ の画像（本画像とサムネイル）を入れる
  const BACKUP_FORMAT = 2;
  const extOf = (type) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');
  $('#btn-export').addEventListener('click', async () => {
    const btn = $('#btn-export');
    btn.disabled = true;
    try {
      const imgs = Store.imageRecords();
      const files = [];
      const list = imgs.map((im) => {
        const file = `images/${im.id}.${extOf(im.full.type)}`;
        const thumbFile = im.thumb === im.full ? file : `images/${im.id}-thumb.${extOf(im.thumb.type)}`;
        files.push({ name: file, data: im.full });
        if (thumbFile !== file) files.push({ name: thumbFile, data: im.thumb });
        return { id: im.id, name: im.name, type: im.type, w: im.w, h: im.h, file, thumbFile };
      });
      const { entries, owned, runOut, lastMedium } = Store.db;
      const data = { app: 'doll-pigment-atelier', format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), entries, owned, runOut, lastMedium, images: list };
      files.unshift({ name: 'data.json', data: JSON.stringify(data, null, 2) });
      const zip = await Zip.create(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip);
      a.download = `doll-pigment-atelier-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000); // ダウンロードが始まるまで残す
      toast(`カラー ${entries.length} 件と画像 ${imgs.length} 枚を書き出しました（${fmtBytes(zip.size)}）`);
    } catch (err) {
      console.warn(err);
      toast('書き出せませんでした');
    } finally { btn.disabled = false; }
  });
  // ZIP（この版のバックアップ）と JSON（以前の版のバックアップ。画像はサムネイルだけ）を読み込める
  // 読み込むファイルの大きさの上限（大きすぎるファイルでタブが落ちないようにする。ZIP の展開の上限は zip.js）
  const MAX_BACKUP_BYTES = 1024 * 1024 * 1024; // ZIP：1GB
  const MAX_JSON_BYTES = 100 * 1024 * 1024;    // 以前の版の JSON：100MB
  async function readBackup(f) {
    const isZip = /\.zip$/i.test(f.name) || f.type.includes('zip');
    if (f.size > (isZip ? MAX_BACKUP_BYTES : MAX_JSON_BYTES)) throw new Zip.ZipLimitError('file too large');
    if (!isZip) return { data: JSON.parse(await f.text()), images: [] };
    const files = await Zip.read(f);
    const data = JSON.parse(await files.get('data.json').text());
    const typed = (blob, type) => (blob && blob.type !== type ? new Blob([blob], { type }) : blob);
    const images = (data.images || []).map((im) => {
      const full = typed(files.get(im.file), im.type || 'image/jpeg');
      const thumb = im.thumbFile === im.file ? full : typed(files.get(im.thumbFile), im.type || 'image/jpeg');
      return full && thumb ? { id: im.id, name: im.name || '', type: full.type, w: im.w || 0, h: im.h || 0, full, thumb } : null;
    }).filter(Boolean);
    return { data, images };
  }
  $('#import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = ''; // 同じファイルを選び直せるようにする
    if (!f) return;
    let data, images;
    try {
      ({ data, images } = await readBackup(f));
      if (!Array.isArray(data.entries)) throw new Error('format');
      if (data.format > BACKUP_FORMAT) return toast('新しい版のアプリで書き出したバックアップです。アプリを更新してから読み込んでください');
    } catch (err) {
      console.warn(err);
      return toast(err instanceof Zip.ZipLimitError
        ? 'ファイルが大きすぎるため読み込めません（このアプリで書き出したバックアップか確認してください）'
        : 'バックアップファイルを読み込めませんでした');
    }
    if (!confirm(`カラー ${data.entries.length} 件${images.length ? `と画像 ${images.length} 枚` : ''}をインポートします。現在のデータは置き換わります。`)) return;
    const ok = await Store.replaceAll({ version: 1, entries: data.entries, owned: data.owned || [], runOut: data.runOut || [], lastMedium: data.lastMedium }, images);
    toast(ok ? 'インポートしました' : SAVE_FAILED);
    afterDataChange();
  });
  // データを入れ替えたら、レシピ帳と調色画面の表示（近い色・調色候補）を更新する
  function afterDataChange() {
    dropStaleRecall();
    renderLibrary(); renderCandidates(); renderMix(); scheduleReverse(); renderSettings();
  }
  // サンプルのカラーを追加する（今のカラーは消さない。不要になったら1件ずつ削除できる）
  async function addSamples() {
    const ok = await Store.addSamples();
    toast(ok ? 'サンプルのカラーを6件追加しました（名称の後ろに「サンプル」と付いています）' : SAVE_FAILED);
    afterDataChange();
  }
  $('#btn-add-sample').addEventListener('click', addSamples);
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('レシピ帳のすべてのカラー（画像を含む）を削除します。絵具箱の所持の設定は残ります。元に戻せません。')) return;
    const ok = await Store.wipe();
    toast(ok ? '削除しました' : '削除できませんでした');
    afterDataChange();
  });

  // ================= このアプリについて =================
  const aboutDlg = $('#about-dialog');
  const openAbout = () => { if (!aboutDlg.open) openModal(aboutDlg); };
  $('#btn-about').addEventListener('click', openAbout);
  aboutDlg.addEventListener('click', (e) => { if (e.target === aboutDlg) aboutDlg.close(); }); // 背景クリックで閉じる

  // ---------------- 起動 ----------------
  renderImages(); renderExtracted(); renderCandidates(); renderMix();
  route();
  if (!boot.ok) toast('このブラウザでは端末に保存できないため、画面を閉じるとデータが消えます（プライベートブラウズでは保存できません）');
  else if (boot.migrated) toast('以前の版のデータを、新しい保存先（IndexedDB）に移しました');
  // ---------------- 版と更新 ----------------
  $$('[data-app-version]').forEach((el) => (el.textContent = `v${APP_VERSION}`));
  // 新しい版の Service Worker が待機したら案内を出し、「更新する」で切り替えて読み込み直す
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const bar = $('#update-bar');
    let waiting = null, reloading = false;
    const offer = (w) => { waiting = w; bar.hidden = false; };
    $('#update-now').addEventListener('click', () => {
      if (!waiting) return location.reload();
      $('#update-now').disabled = true;
      waiting.postMessage('skipWaiting');
    });
    $('#update-later').addEventListener('click', () => (bar.hidden = true));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waiting) return; // 初めて入ったときは読み込み直さない
      reloading = true;
      location.reload();
    });
    // 版は sw.js が読み込む js/version.js にあるので、更新の確認ではブラウザのキャッシュを使わない（既定では読み込むファイルにキャッシュが使われ、版を上げても気づけないことがある）
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      // 開きっぱなしのとき（ホーム画面から起動した場合など）も、画面に戻ったときに新しい版を確かめる
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
})();
