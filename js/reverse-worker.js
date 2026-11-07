// 逆引き調色を画面とは別のスレッドで計算する（所持している絵具が多いと時間がかかるため。画面を固めない）
// 受け取る：{ id, rgb, ids, top }  返す：{ id, cands, ms }
importScripts('color.js', 'paints-data.js', 'km.js');

self.onmessage = (e) => {
  const { id, rgb, ids, top } = e.data;
  const t0 = performance.now();
  const cands = PaintDB.reverse(rgb, ids, top);
  self.postMessage({ id, cands, ms: performance.now() - t0 });
};
