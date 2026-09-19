// Toolbox — minimal app-shell service worker.
//
// Milestone 0 goal: after one connected load, the installed Toolbox shell
// must reopen offline on phone, iPad, and desktop.
//
// Important: cache.add()/cache.addAll() may follow a redirect and store a
// redirected Response. WebKit refuses to use such a Response for an offline
// navigation ("Response served by service worker has redirections").
// Therefore the offline document is fetched explicitly, converted to a fresh
// non-redirected Response, and cached under one canonical key.

// Bump CACHE_NAME whenever any file in STATIC_SHELL changes content,
// including a content-only edit like adding a key to config.js. The
// browser only re-runs install() (and re-fetches STATIC_SHELL) when this
// sw.js file's own bytes change; a precached static asset edited without
// bumping this stays served from the stale cache indefinitely on already
// installed devices, invisibly, no matter how many times it's redeployed.
const CACHE_NAME = 'toolbox-shell-v14';
const OFFLINE_DOCUMENT = '/index.html';

const STATIC_SHELL = [
  '/css/styles.css',
  '/js/sw-register.js',
  '/js/db.js',
  '/js/config.js',
  '/js/geo.js',
  '/js/plan-setup.js',
  '/js/distress-seam.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

async function cacheOfflineDocument(cache) {
  const response = await fetch(OFFLINE_DOCUMENT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to cache Toolbox shell: ${response.status}`);
  }

  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.delete('location');

  const cleanResponse = new Response(body, {
    status: 200,
    statusText: 'OK',
    headers,
  });

  await cache.put(OFFLINE_DOCUMENT, cleanResponse);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([
      cacheOfflineDocument(cache),
      cache.addAll(STATIC_SHELL),
    ]);
    await self.skipWaiting();
  })());
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

  // Navigations are network-first. A connected launch gets the current app;
  // an offline launch gets the clean cached document from installation.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_DOCUMENT))
    );
    return;
  }

  // Static shell assets: cache first, refresh the cache in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
