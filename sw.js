// Network-first, cache-fallback: always serves the latest deployed version while online (so a
// pushed fix shows up immediately, no stale-cache lag), and falls back to the last cached copy
// when offline. Bump CACHE_NAME on any deploy that should force-evict old cached responses.
const CACHE_NAME = 'magic-survival-calc-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    // { cache: 'no-store' } is required here, not optional — without it, a plain fetch() can be
    // silently satisfied by the browser's own HTTP cache (honoring GitHub Pages' Cache-Control
    // headers) instead of actually reaching the server, which defeats "network-first" entirely.
    // Confirmed live: a deployed change didn't show up in an installed PWA until this was added.
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
