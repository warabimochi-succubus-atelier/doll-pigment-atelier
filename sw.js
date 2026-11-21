// オフライン用の Service Worker
// キャッシュ名は js/version.js の版から作る。版を上げると新しい Service Worker が入り、
// 画面に「新しい版があります」と表示する。利用者が更新を押したら切り替え、古いキャッシュを消す
//
// アプリのファイル（ASSETS）は、インストールのときに版ごとのキャッシュへまとめて入れ、以後はそこから返す（キャッシュ優先）。
// ファイルごとにネットワークへ取りに行くと、回線が遅いときに一部だけ古いファイルになり、
// 新しい版と古い版のファイルが混ざって動くことがあるため。新しいファイルは、版を上げて新しい Service Worker が入ったときに届く。
// ただし開発中（localhost）は、版を上げなくても変更が見えるよう、毎回ネットワークから取る（届かないときだけキャッシュ）
importScripts('js/version.js');
// キャッシュはドメイン（github.io）単位で、同じアカウントの他のアプリと共有する。名前に dpa- を付け、消すのも自分の分だけにする（仕様書 5.1）
const CACHE_PREFIX = 'dpa-';
const CACHE = `${CACHE_PREFIX}${APP_VERSION}`;
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/favicon.ico', './icons/apple-touch-icon.png',
  './images/author-logo.webp',
  './js/version.js', './js/vendor/mixbox.js', './js/color.js', './js/paints-data.js', './js/km.js', './js/store.js', './js/zip.js', './js/reverse-worker.js', './js/picker.js', './js/sample.js', './js/calc.js', './js/app.js',
];
const DEV = self.location.hostname === 'localhost';
const assetUrls = new Set(ASSETS.map((a) => new URL(a, self.location.href).href));

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  // ブラウザの HTTP キャッシュを通さずに取る（GitHub Pages はファイルを一定時間キャッシュさせるため、
  // そのままだと新しい版のキャッシュに古いファイルが入ることがある）
  await c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })));
  // 取ったファイルが、この Service Worker と同じ版か確かめる（公開の途中で取ったときなど）。
  // 違えばインストールをやめる（次に版を確かめたときにやり直す）
  const v = await (await c.match('./js/version.js')).text();
  if (!v.includes(`'${APP_VERSION}'`)) {
    await caches.delete(CACHE);
    throw new Error(`version mismatch: expected ${APP_VERSION}`);
  }
})()));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
));
// 画面の「更新する」から呼ばれる：待機中の新しい版に切り替える
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// 電波が弱くてサーバーの応答が遅いときは、この時間だけ待ってからキャッシュを使う（キャッシュがあるときだけ）
const NET_TIMEOUT_MS = 4000;
// ネットワーク優先（届かない・遅い・エラーのときはキャッシュ）。開発中と、アプリのファイル以外に使う
function networkFirst(e, cached) {
  const req = e.request;
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
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 同じサイトのファイルだけを扱う（外部へのリンクなどはブラウザに任せる）
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 画面（index.html）は、URL に ?… が付いていても同じものを返す
    const isPage = req.mode === 'navigate';
    const cached = await cache.match(req, { ignoreSearch: isPage });
    const isAsset = isPage || assetUrls.has(new URL(req.url).href.split(/[?#]/)[0]);
    // アプリのファイルは、この版のキャッシュから返す（ほかのファイルと版がそろう）
    if (!DEV && isAsset && cached) return cached;
    return networkFirst(e, cached);
  })());
});
