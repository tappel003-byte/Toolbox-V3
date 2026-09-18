// Toolbox — minimal app-shell service worker.
//
// This app is served from the origin root, so registering here at the
// default (root) scope is intentional, not the root-scope-registered-from-
// a-subpath mistake documented in Toolbox-V2's history. Even so, this
// deliberately uses network-first for navigations (not cache-first) so a
// stale or redirected response is never what a real page load sees —
// the same shape of bug already found and fixed once in V2.

const CACHE_NAME = 'toolbox-shell-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/sw-register.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a real connection always wins; the
  // cached shell is only a fallback for offline reopening.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Static shell assets: cache first, refresh the cache in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
