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
const CACHE_NAME = 'toolbox-shell-v204';
const OFFLINE_DOCUMENT = '/index.html';
const DISTRESS_DOCUMENT = '/distress-survey/survey.html';

const STATIC_SHELL = [
  '/css/styles.css',
  '/css/report-builder.css',
  '/js/sw-register.js',
  '/js/db.js',
  '/js/config.js',
  '/js/geo.js',
  '/js/plan-image.js',
  '/js/building-types.js',
  '/js/room-ocr.js',
  '/js/room-verify.js',
  '/js/plan-setup.js',
  '/js/vendor/jszip.min.js',
  '/js/customer-file-import.js',
  '/js/recovered-photos.js',
  '/js/distress-survey/mount.js',
  '/distress-survey/survey.html',
  '/js/floor-survey/floor-survey.js',
  '/js/floor-survey/floor-survey.css',
  '/js/diagnostics.js',
  '/js/sync.js',
  '/js/file-explorer.js',
  '/js/ai-export.js',
  '/js/report-source.js',
  '/js/report-evidence.js',
  '/js/report-session.js',
  '/js/report-text.js',
  '/js/report-toolbar.js',
  '/js/report-overlay.js',
  '/js/report-discussion.js',
  '/js/report-floor-layout.js',
  '/js/report-rail.js',
  '/js/report-cover-layout.js',
  '/js/pen-log.js',
  '/js/report-builder.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/Distress%20Survey.png',
  '/icons/Floor%20Survey.png',
  '/icons/Diagnostics.png',
  '/icons/report-builder.png',
  '/brand/sandia-geo.png',
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

const NAVIGATE_TIMEOUT_MS = 3000;
const ASSET_TIMEOUT_MS = 8000;
const UNCACHED_TIMEOUT_MS = 30000;

/** fetch with a deadline, so a dead link fails instead of waiting. */
function fetchWithin(request, ms) {
  if (typeof AbortController !== 'function') return fetch(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are network-first. Distress runs in an iframe with Customer
  // File query parameters, so its offline fallback must be its own cached
  // document — never the Toolbox index shell.
  //
  // Network-FIRST, not network-eventually. A link that accepts connections
  // and never answers — a tablet tethered to a phone that has lost signal —
  // does not make this fetch reject; it makes it wait for the operating
  // system to give up, which on iOS is a minute or more. The cached document
  // was sitting there the whole time. Opening or reloading Toolbox in the
  // field is exactly when that must not happen, so the network gets three
  // seconds and then the cache answers.
  if (req.mode === 'navigate') {
    const fallbackDocument =
      url.pathname === DISTRESS_DOCUMENT ? DISTRESS_DOCUMENT : OFFLINE_DOCUMENT;
    event.respondWith(
      fetchWithin(req, NAVIGATE_TIMEOUT_MS).catch(() => caches.match(fallbackDocument))
    );
    return;
  }

  // Static shell assets: cache first, refresh the cache in the background.
  // The background refresh is given a deadline too. Without one, every asset
  // on the page left a request hanging against a dead network, and Safari's
  // handful of connections to a host filled with requests that would never be
  // answered -- so anything that genuinely needed the network queued behind
  // them. That is the difference between an app that is offline and an app
  // that is stuck.
  event.respondWith(
    caches.match(req).then((cached) => {
      // A cached copy is already the answer, so its background refresh gets a
      // short deadline -- it exists only to keep the cache warm and must
      // never hold a connection open on a dead link. An asset with no cached
      // copy IS the answer, so it gets a long one and its failure is reported
      // as a failure rather than swallowed into an empty response.
      const network = fetchWithin(req, cached ? ASSET_TIMEOUT_MS : UNCACHED_TIMEOUT_MS)
        .then((res) => {
          if (res && res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch((err) => {
          if (cached) return cached;
          throw err;
        });
      return cached || network;
    })
  );
});
