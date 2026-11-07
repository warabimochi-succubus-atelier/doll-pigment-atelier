// オフライン用の Service Worker（ネットワーク優先・オフライン時はキャッシュ）
// キャッシュ名は js/version.js の版から作る。版を上げると新しい Service Worker が入り、
// 画面に「新しい版があります」と表示する。利用者が更新を押したら切り替え、古いキャッシュを消す
importScripts('js/version.js');
const CACHE = `dpa-${APP_VERSION}`;
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/apple-touch-icon.png',
  './images/author-logo.webp',
  './js/version.js', './js/vendor/mixbox.js', './js/color.js', './js/paints-data.js', './js/km.js', './js/store.js', './js/zip.js', './js/reverse-worker.js', './js/picker.js', './js/sample.js', './js/app.js',
];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
));
// 画面の「更新する」から呼ばれる：待機中の新しい版に切り替える
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // ブラウザのキャッシュを通すと古いファイルが返ることがあるので、毎回サーバーに確かめる（変わっていなければ 304 で軽い）
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});
