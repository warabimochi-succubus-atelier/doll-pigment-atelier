// オフライン用の簡易 Service Worker（ネットワーク優先・オフライン時はキャッシュ）
const CACHE = 'dpa-mock-v35';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/apple-touch-icon.png',
  './images/author-logo.webp',
  './js/color.js', './js/paints-data.js', './js/km.js', './js/store.js', './js/zip.js', './js/reverse-worker.js', './js/picker.js', './js/sample.js', './js/app.js',
];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});
