// 画面ロジック
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stars = (n) => '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span>';
  const paintName = (id) => PaintDB.byId[id]?.name || id;
  const sw = (hex, cls = '') => `<span class="sw ${cls}" style="background:${hex}"></span>`;
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
    fixed: null,       // 画像を使わない代表色 { rgb, from: 'recall' | 'input', label }（レシピ帳からの呼び出し・数値指定）
    similarAll: false, // レシピ帳の近い色をすべて表示するか
    candidates: [],
    mix: [],           // [{ paintId, pct }]
    recalled: null,    // 呼び出し元エントリ id
  };

  // ---------------- タブ ----------------
  function route() {
    let tab = (location.hash || '#mix').slice(1);
    if (!$('#view-' + tab)) tab = 'mix'; // 存在しないタブは調色を表示
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
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
      $('#img-stage').innerHTML = `<div class="empty">画像を追加してください（正面・斜め・自然光・室内光など複数枚可）
        <div class="sample-try"><button class="link" data-sample>サンプル画像で試してみる</button></div></div>`;
      picker.img = null;
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
    toast('サンプル画像を2枚追加しました。チークをドラッグしてみてください');
  });

  function setGrayMode(on) {
    picker.grayMode = on;
    $('#btn-gray').classList.toggle('on', on);
    $('#img-hint').textContent = on ? 'グレーカードの部分をドラッグしてください' : 'ドラッグで範囲を選択 → 色を取得';
    $('#img-stage').classList.toggle('gray-mode', on);
  }
  $('#btn-gray').addEventListener('click', () => setGrayMode(!picker.grayMode));

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
  }

  // ---- 逆引き調色 ----
  function runReverse() {
    const rgb = representative();
    if (!rgb) return toast('先に代表色を決めてください');
    $('#candidates').innerHTML = '<div class="empty">計算中…</div>';
    setTimeout(() => {
      const t0 = performance.now();
      S.candidates = PaintDB.reverse(rgb, owned(), 3);
      S.candTime = performance.now() - t0;
      renderCandidates();
    }, 20);
  }
  $('#btn-reverse').addEventListener('click', runReverse);

  function deBadge(de) {
    const cls = de < 2 ? 'good' : de < 5 ? 'ok' : 'bad';
    const word = de < 2 ? 'ほぼ同じ' : de < 5 ? '近い' : '差あり';
    return `<span class="de ${cls}">ΔE ${de.toFixed(1)} · ${word}</span>`;
  }

  function renderCandidates() {
    const rgb = representative();
    if (!S.candidates.length) {
      $('#candidates').innerHTML = '<div class="empty">代表色を決めて「逆引き調色」を実行してください</div>';
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
        : `<div class="hint small">計算 ${S.candTime.toFixed(0)} ms ・ 所持絵具 ${owned().length} 色から探索</div>`);
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
      renderCandidates();
      toast(`${paintName(pid)} を「未所持」にしました（絵具箱で戻せます）`);
    }
  });

  // ---- 手動調整 ----
  const paintOptions = (sel) => PaintDB.paints.map((p) =>
    `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${Store.isOwned(p.id) ? '' : '（未所持）'}</option>`).join('');

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
    S.mix.push({ paintId: S.mix.length ? 'titanium-white' : 'titanium-white', pct: S.mix.length ? 5 : 100 });
    renderMix();
  });
  $('#btn-clear-mix').addEventListener('click', () => { S.mix = []; renderMix(); });

  $('#btn-save').addEventListener('click', () => {
    const rgb = representative() || PaintDB.evaluate(S.mix)?.rgb;
    if (!rgb) return toast('代表色か実際の調色を決めてから保存してください');
    const base = S.recalled ? Store.get(S.recalled) : null;
    const draft = {
      ...(base ? structuredClone(base) : {
        name: '', part: '頬', customPart: '', rating: 3, comment: '',
        cond: { head: '', skin: 'セミホワイト', topcoat: 'つや消し', brand: 'リキテックス', medium: Store.lastMedium() }, recordImages: [],
      }),
      hex: Color.toHex(rgb),
      method: S.fixed ? (S.fixed.from === 'input' ? 'manual' : (base?.method || 'average')) : 'average',
      extracted: S.extracted.map((x) => Color.toHex(x.rgb)),
      refImages: S.images.map((i) => ({ src: i.thumb, name: i.name, corrected: !!i.gains })),
      estimated: S.candidates.map((c) => ({ items: c.items, de: +c.de.toFixed(2) })),
      actual: S.mix.map((x) => ({ ...x })),
    };
    if (!S.images.length && base) draft.refImages = base.refImages;
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
          <label>使用絵具<input name="brand" value="${esc(e.cond?.brand || 'リキテックス')}"></label>
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
        ${!isNew && !opt.fromMix ? `<button type="button" class="btn btn-danger" data-act="delete">削除</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-ghost" data-act="dup">複製</button>
          <button type="button" class="btn btn-ghost" data-act="recall">呼び出して調色 →</button>
          <button type="submit" class="btn btn-primary" data-act="save">保存</button>`
        : `<span class="grow"></span>
          ${opt.baseId ? '<button type="submit" class="btn btn-ghost" data-act="overwrite">呼び出し元に上書き</button>' : ''}
          <button type="submit" class="btn btn-primary" data-act="new">新しいカラーとして保存</button>`}
      </div>`;

    const form = $('#entry-form');
    const work = structuredClone(e);

    form.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const st = b.closest('.stars-input');
      if (st) { work.rating = +b.dataset.v; $$('button', st).forEach((x) => x.classList.toggle('on', +x.dataset.v <= work.rating)); return; }
      const act = b.dataset.act;
      if (act === 'close') { ev.preventDefault(); dlg.close(); }
      if (act === 'delete') {
        if (!confirm(`「${e.name}」を削除します。よろしいですか？`)) return;
        Store.remove(e.id); dlg.close(); renderLibrary(); toast('削除しました');
      }
      if (act === 'dup') {
        const copy = { ...collect(), id: Store.uid(), createdAt: Date.now(), name: e.name + '（コピー）' };
        Store.upsert(copy); dlg.close(); renderLibrary(); toast('複製しました');
      }
      if (act === 'recall') { dlg.close(); recall(e.id); }
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
    };

    function collect() {
      const fd = new FormData(form);
      return {
        ...work,
        name: fd.get('name').trim(),
        part: fd.get('part'),
        customPart: fd.get('customPart') || '',
        comment: fd.get('comment'),
        cond: { head: fd.get('head').trim(), skin: fd.get('skin'), topcoat: fd.get('topcoat'), brand: fd.get('brand').trim(), medium: fd.get('medium') },
      };
    }

    form.onsubmit = (ev) => {
      ev.preventDefault();
      const act = ev.submitter?.dataset.act;
      const data = collect();
      if (!data.name) return toast('名称を入力してください');
      if (act === 'overwrite') { data.id = opt.baseId; data.createdAt = Store.get(opt.baseId)?.createdAt || Date.now(); }
      else if (act === 'new') { data.id = Store.uid(); data.createdAt = Date.now(); }
      const ok = Store.upsert(data);
      Store.setLastMedium(data.cond.medium);
      dlg.close();
      if (!ok) return toast('保存容量が不足しています（画像を減らしてください）');
      toast(`「${data.name}」を保存しました`);
      if (opt.fromMix) S.recalled = data.id;
      renderLibrary();
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

  function renderLibrary() {
    const q = $('#lib-q').value.trim().toLowerCase();
    const part = $('#lib-part').value, minR = +$('#lib-rating').value, sort = $('#lib-sort').value;
    let list = Store.entries().filter((e) =>
      (!part || e.part === part) && e.rating >= minR &&
      (!q || [e.name, e.comment, e.cond?.head, e.customPart].join(' ').toLowerCase().includes(q)));
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
      fixed: { rgb: Color.parseHex(e.hex), from: 'recall', label: `「${e.name}」から呼び出した色` },
      candidates: (e.estimated || []).map((c) => ({ ...c, ...PaintDB.evaluate(c.items, Color.parseHex(e.hex)) })),
      mix: (e.actual || []).map((x) => ({ ...x })),
      candTime: null,
      recalled: e.id,
    });
    const b = $('#recall-banner');
    b.innerHTML = `${sw(e.hex)} <span>「<b>${esc(e.name)}</b>」を呼び出しました。微調整して、上書き保存か新しいカラーとして保存できます。</span><button class="icon-btn" id="btn-unrecall">×</button>`;
    b.hidden = false;
    $('#btn-unrecall').onclick = () => { S.recalled = null; b.hidden = true; };
    renderImages(); renderExtracted(); renderCandidates(); renderMix();
    if (location.hash !== '#mix') location.hash = '#mix';
    else b.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ================= 数値で指定（手順1） =================
  // HEX（#D98C8C）または RGB（217, 140, 140）を受け付ける
  function parseColorText(text) {
    const hex = Color.parseHex(text);
    if (hex) return hex;
    const m = String(text).match(/\d+/g);
    return m && m.length === 3 && m.every((v) => +v <= 255) ? m.map(Number) : null;
  }
  function useNumber() {
    const rgb = parseColorText($('#num-input').value);
    if (!rgb) return toast('HEX（#D98C8C）または RGB（217, 140, 140）で入力してください');
    S.fixed = { rgb, from: 'input', label: '数値で指定した色' };
    renderExtracted();
    toast('数値で指定した色を代表色にしました');
  }
  $('#btn-num').addEventListener('click', useNumber);
  $('#num-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') useNumber(); });

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
  function renderPaints() {
    const W = PaintDB.byId['titanium-white'];
    $('#paint-rows').innerHTML = PaintDB.paints.map((p) => {
      const ladder = p === W ? [[1, 0]] : [[1, 0], [1, 1], [1, 4], [1, 10]];
      const ks = p.K.map((k, i) => (k / p.S[i]).toFixed(2)).join(', ');
      return `<tr class="${Store.isOwned(p.id) ? '' : 'unowned'}">
        <td><input type="checkbox" data-own="${p.id}" ${Store.isOwned(p.id) ? 'checked' : ''}></td>
        <td><div class="pcell">${sw(p.hex)}<span>${esc(p.name)}</span></div></td>
        <td><div class="ladder">${ladder.map(([a, w]) => {
          const hex = w ? Color.toHex(PaintDB.mixRgb([p, W], [a, w])) : p.hex;
          return `<span style="background:${hex}" title="${w ? `1:${w}` : '絵具のみ'} ${hex}"><small>${w ? `1:${w}` : '原色'}</small></span>`;
        }).join('')}</div></td>
        <td class="num mono small">${ks}</td></tr>`;
    }).join('');
  }
  $('#paint-rows').addEventListener('change', (e) => {
    const id = e.target.dataset.own;
    if (id) { Store.setOwned(id, e.target.checked); renderPaints(); }
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
      Store.replaceAll({ version: 1, entries: data.entries, unowned: data.unowned || [], lastMedium: data.lastMedium });
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
