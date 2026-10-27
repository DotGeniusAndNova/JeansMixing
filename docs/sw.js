/* JeansMixing service worker — offline-first app shell.
 *
 * BUMP WITH EVERY RELEASE: the CACHE name and the ?v= on the versioned
 * assets below must match the current release (see index.html).
 */
var CACHE = 'jeansmixing-v1-7-0';
var ASSETS = [
  './',
  './index.html',
  './css/style.css?v=web-v1.7.0',
  './js/model.js?v=web-v1.7.0',
  './js/scan-parse.js?v=web-v1.7.0',
  './js/app.js?v=web-v1.7.0',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // The page itself: network first so updates apply immediately when online,
  // cached copy when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }
  // Versioned assets (?v= changes every release): cache first.
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      });
    })
  );
});
