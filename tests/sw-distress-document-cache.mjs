/**
 * Distress HTML must be cached as a fresh, non-redirected Response under its
 * canonical key — the same WebKit-safe treatment index.html already had.
 *
 * Run: node tests/sw-distress-document-cache.mjs
 *
 * Proves the install path that fails when survey.html is left to cache.addAll
 * after a redirect, and passes when the clean-document helper writes it.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISTRESS_PATH = '/distress-survey/survey.html';
const CACHE_NAME_RE = /const CACHE_NAME = '([^']+)'/;
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const cacheName = (swSource.match(CACHE_NAME_RE) || [])[1] || '';
const staticShellBlock = (swSource.match(/const STATIC_SHELL = \[([\s\S]*?)\];/) || [])[1] || '';

check(
  'shell cache name was bumped for the Distress document-cache fix',
  cacheName === 'toolbox-shell-v336' ||
    (cacheName.startsWith('toolbox-shell-v') && cacheName > 'toolbox-shell-v335'),
  cacheName,
);
check(
  'Distress HTML is not in STATIC_SHELL (addAll cannot overwrite the clean copy)',
  !staticShellBlock.includes('/distress-survey/survey.html') &&
    /CLEAN_DOCUMENTS[\s\S]*DISTRESS_DOCUMENT/.test(swSource),
  'STATIC_SHELL / CLEAN_DOCUMENTS shape',
);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Static server that REDIRECTS the canonical Distress document once, so a
 * naive cache.add / put of the followed fetch would store a redirected
 * Response — the WebKit failure mode. The clean-document path must still
 * write a non-redirected body under the canonical key.
 */
function startRedirectingServer(port) {
  const root = ROOT;
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === DISTRESS_PATH && url.search !== '?clean=1') {
      res.writeHead(302, { Location: DISTRESS_PATH + '?clean=1' });
      res.end();
      return;
    }
    let filePath = path.join(root, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') {
      filePath = path.join(root, 'index.html');
    }
    if (url.pathname === DISTRESS_PATH) {
      filePath = path.join(root, 'distress-survey', 'survey.html');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const type = filePath.endsWith('.js') || filePath.endsWith('.mjs')
        ? 'application/javascript; charset=utf-8'
        : filePath.endsWith('.html') ? 'text/html; charset=utf-8'
          : filePath.endsWith('.css') ? 'text/css; charset=utf-8'
            : filePath.endsWith('.webmanifest') ? 'application/manifest+json'
              : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  }).listen(port, '127.0.0.1');
}

const port = await freePort();
const host = '127.0.0.1';
const origin = `http://${host}:${port}`;
const server = startRedirectingServer(port);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
  ],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  // Cache Storage is document-origin scoped; open a page before probing it.
  const boot = await page.goto(origin + '/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  if (!boot || !boot.ok()) {
    throw new Error('failed to open test origin: ' + (boot && boot.status()));
  }
  const bootCtx = await page.evaluate(() => ({
    hasCaches: typeof caches !== 'undefined',
    secure: window.isSecureContext,
    href: location.href,
  }));
  check('test origin is a secure context with Cache Storage',
    bootCtx.hasCaches && bootCtx.secure, JSON.stringify(bootCtx));
  if (!bootCtx.hasCaches) {
    throw new Error('Cache Storage unavailable at ' + bootCtx.href);
  }

  // ---- Negative control: raw followed fetch stored under the canonical key
  const before = await page.evaluate(async (originUrl, distressPath, name) => {
    await caches.delete(name + '-probe-raw');
    const cache = await caches.open(name + '-probe-raw');
    const followed = await fetch(originUrl + distressPath, { redirect: 'follow' });
    await cache.put(distressPath, followed.clone());
    const stored = await cache.match(distressPath);
    const text = stored ? await stored.clone().text() : '';
    return {
      ok: !!(stored && stored.ok),
      redirected: !!(stored && stored.redirected),
      followedRedirected: followed.redirected,
      hasTitle: text.indexOf('Distress Survey') >= 0,
      type: stored && stored.type,
    };
  }, origin, DISTRESS_PATH, cacheName);

  check(
    'negative control: followed redirect stored under the canonical key is redirected',
    before.ok && before.redirected === true && before.hasTitle,
    JSON.stringify(before),
  );

  // ---- Clean-document treatment (same shape as sw.js cacheCleanDocument)
  const after = await page.evaluate(async (originUrl, distressPath, name) => {
    await caches.delete(name + '-probe-clean');
    const cache = await caches.open(name + '-probe-clean');
    // Even when the network fetch followed a redirect, rebuild a fresh
    // Response so the cached entry is not marked redirected.
    const response = await fetch(originUrl + distressPath, { cache: 'no-store' });
    if (!response.ok) throw new Error('fetch failed ' + response.status);
    const networkWasRedirected = response.redirected;
    const body = await response.blob();
    const headers = new Headers(response.headers);
    headers.delete('location');
    const clean = new Response(body, { status: 200, statusText: 'OK', headers });
    await cache.put(distressPath, clean);
    const stored = await cache.match(distressPath);
    const text = stored ? await stored.clone().text() : '';
    return {
      ok: !!(stored && stored.ok),
      redirected: !!(stored && stored.redirected),
      networkWasRedirected,
      cleanRedirected: clean.redirected,
      hasTitle: text.indexOf('Distress Survey – Field Reporter') >= 0,
      hasScreenWork: text.indexOf('id="screenWork"') >= 0,
    };
  }, origin, DISTRESS_PATH, cacheName);

  check(
    'clean-document cache write is non-redirected under the canonical key',
    after.ok && after.redirected === false && after.hasTitle && after.hasScreenWork,
    JSON.stringify(after),
  );

  // ---- Real SW install from this origin (survey.html still redirects once)
  await page.goto(origin + '/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  });
  await page.goto(origin + '/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  // Allow install to finish caching.
  await page.waitForFunction(async (expected) => {
    const names = await caches.keys();
    return names.indexOf(expected) >= 0;
  }, { timeout: 30000 }, cacheName);

  const installed = await page.evaluate(async (distressPath, expected) => {
    const cache = await caches.open(expected);
    const stored = await cache.match(distressPath);
    const text = stored ? await stored.clone().text() : '';
    const keys = await cache.keys();
    const distressKeys = keys.map((r) => new URL(r.url).pathname + new URL(r.url).search)
      .filter((p) => p.indexOf('distress-survey/survey.html') >= 0);
    return {
      cacheName: expected,
      present: !!stored,
      redirected: stored ? stored.redirected : null,
      hasTitle: text.indexOf('Distress Survey – Field Reporter') >= 0,
      distressKeys,
    };
  }, DISTRESS_PATH, cacheName);

  check(
    'SW install caches Distress HTML non-redirected at the canonical key',
    installed.present && installed.redirected === false && installed.hasTitle,
    JSON.stringify(installed),
  );
  check(
    'no query-bearing Distress cache entry is required for the canonical fallback',
    installed.distressKeys.every((k) => k === DISTRESS_PATH || k.startsWith(DISTRESS_PATH + '?')),
    JSON.stringify(installed.distressKeys),
  );

  // Offline navigate of a query-bearing Distress URL must use Distress HTML,
  // not the Toolbox index (same fallback rule as production).
  await page.setOfflineMode(true);
  const offlineNav = await page.evaluate(async (distressPath) => {
    const res = await fetch(distressPath + '?cf=offline-probe', { method: 'GET' });
    // fetch() from the page for a document URL may not use mode=navigate.
    // Drive the SW navigate path through an iframe instead.
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.onload = () => {
        try {
          const doc = iframe.contentDocument;
          resolve({
            title: doc && doc.title,
            hasScreenWork: !!(doc && doc.querySelector('#screenWork')),
            isToolboxShell: !!(doc && doc.getElementById('app')),
          });
        } catch (err) {
          resolve({ error: String(err && err.message || err) });
        }
      };
      iframe.onerror = () => resolve({ error: 'iframe error' });
      iframe.src = distressPath + '?cf=offline-probe';
      document.body.appendChild(iframe);
    });
  }, DISTRESS_PATH);

  check(
    'query-bearing offline iframe receives Distress HTML, not the Toolbox shell',
    offlineNav.title === 'Distress Survey – Field Reporter' &&
      offlineNav.hasScreenWork === true &&
      offlineNav.isToolboxShell !== true,
    JSON.stringify(offlineNav),
  );

  // Floor Survey control: in-shell asset still present in the new cache.
  const floorCached = await page.evaluate(async (expected) => {
    const cache = await caches.open(expected);
    return {
      js: !!(await cache.match('/js/floor-survey/floor-survey.js')),
      css: !!(await cache.match('/js/floor-survey/floor-survey.css')),
    };
  }, cacheName);
  check(
    'Floor Survey shell assets remain in the bumped cache (loading control)',
    floorCached.js && floorCached.css,
    JSON.stringify(floorCached),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
