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
// 電波が弱くてサーバーの応答が遅いときは、この時間だけ待ってからキャッシュを使う（キャッシュがあるときだけ）
const NET_TIMEOUT_MS = 4000;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 同じサイトのファイルだけを扱う（外部へのリンクなどはブラウザに任せる）
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(req);
    // ブラウザのキャッシュを通すと古いファイルが返ることがあるので、毎回サーバーに確かめる（変わっていなければ 304 で軽い）
    const net = fetch(req, { cache: 'no-cache' }).then((r) => {
      // 正常な応答だけをキャッシュに入れる（404 や 500 で、正常なファイルを上書きしない）
      if (r.ok) {
        const copy = r.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        return r;
      }
      return cached || r; // エラーの応答なら、キャッシュがあればそちらを返す
    });
    if (!cached) return net;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NET_TIMEOUT_MS));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
