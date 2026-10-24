/**
 * Warm Distress navigate must refresh with a real fetchWithin deadline.
 * Run: node tests/sw-distress-refresh-deadline.mjs
 *
 * Proves the production AbortController timer cancels a hung background
 * clean-document refresh, waitUntil settles, the good cache is kept on
 * abort, and a successful refresh still writes clean HTML.
 */
import { createRequire } from 'module';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISTRESS_PATH = '/distress-survey/survey.html';
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const cacheName = (swSource.match(/const CACHE_NAME = '([^']+)'/) || [])[1] || '';
const assetTimeoutMs = Number((swSource.match(/const ASSET_TIMEOUT_MS = (\d+)/) || [])[1] || 0);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

check(
  'shell declares ASSET_TIMEOUT_MS for bounded background refresh',
  assetTimeoutMs >= 1000 && assetTimeoutMs <= 15000,
  String(assetTimeoutMs),
);
check(
  'background refresh uses fetchWithin / ASSET_TIMEOUT_MS (not raw fetch)',
  /cacheCleanDocument\(cache, DISTRESS_DOCUMENT, ASSET_TIMEOUT_MS\)/.test(swSource) &&
    /function fetchWithin\(request, ms, init\)/.test(swSource) &&
    /cache: 'no-store'/.test(swSource),
  'bounded clean-document refresh shape',
);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.webmanifest')) return 'application/manifest+json';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const host = 'toolbox-offline.test';
  let hangSurvey = false;
  let surveyOverride = null;
  let hungOpened = 0;
  let hungAborted = 0;
  const abortTimes = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    if (pathname === DISTRESS_PATH) {
      if (hangSurvey) {
        hungOpened += 1;
        const openedAt = Date.now();
        req.on('close', () => {
          hungAborted += 1;
          abortTimes.push(Date.now() - openedAt);
        });
        // Accept TCP and never answer — production timer must abort.
        return;
      }
      if (surveyOverride != null) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(surveyOverride);
        return;
      }
    }

    const filePath = path.join(ROOT, pathname.slice(1));
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--host-resolver-rules=MAP ${host} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=http://${host}:${port}`,
    ],
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('https://cdn.jsdelivr.net/')) request.abort();
    else request.continue();
  });

  const base = `http://${host}:${port}/index.html`;
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    const planCanvas = document.createElement('canvas');
    planCanvas.width = 120;
    planCanvas.height = 90;
    planCanvas.getContext('2d').fillRect(0, 0, 120, 90);
    await ToolboxDB.putMedia('refresh-plan', planCanvas.toDataURL('image/png'));
    const record = ToolboxApp.blankCustomerFile('refresh-distress');
    ToolboxPlanSetup.ensurePlanSetup(record);
    record.propertyAddress = 'Refresh Lane';
    const canvas = record.planSetup.canvases[0];
    canvas.plan = { id: 'refresh-plan', width: 120, height: 90 };
    record.distress.activeCanvasId = canvas.id;
    record.distress.pins = [{
      id: 'p1', num: 1, x: 30, y: 30, photos: [], description: 'seed',
      location: '', category: null, extPhotoCount: 0, isExterior: false, canvasId: canvas.id,
    }];
    record.distress.nextNum = 2;
    await ToolboxDB.saveCustomerFile(record);
  });

  await page.goto(`${base}#/file/refresh-distress`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-app="distress"]');
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe')?.contentDocument;
    return !!(doc && doc.querySelector('#screenWork.active'));
  }, { timeout: 30000 });

  const before = await page.evaluate(async (name, distressPath) => {
    const cache = await caches.open(name);
    const matched = await cache.match(distressPath);
    const text = matched ? await matched.text() : '';
    return {
      present: !!matched,
      redirected: matched ? matched.redirected : null,
      length: text.length,
      marker: text.includes('CURSOR-REFRESH-SUCCESS-MARKER'),
      fingerprint: text.slice(0, 80) + ':' + text.length,
    };
  }, cacheName, DISTRESS_PATH);
  check('warm cache holds non-redirected Distress document', before.present && before.redirected === false && before.length > 1000, JSON.stringify(before));

  await page.goto(`${base}#/file/refresh-distress`, { waitUntil: 'domcontentloaded' });
  hangSurvey = true;
  hungOpened = 0;
  hungAborted = 0;
  abortTimes.length = 0;

  const t0 = Date.now();
  await page.click('[data-app="distress"]');
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe')?.contentDocument;
    return !!(doc && doc.querySelector('#screenWork.active'));
  }, { timeout: 10000 });
  const openMs = Date.now() - t0;
  check('cached UI opens immediately while background refresh is hung', openMs < 1500, String(openMs));
  check('hung origin received a background/navigation fetch', hungOpened >= 1, String(hungOpened));

  const waitForAbortMs = assetTimeoutMs + 2000;
  const abortDeadline = Date.now() + waitForAbortMs;
  while (Date.now() < abortDeadline && hungAborted < 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(
    'production deadline aborted the hung refresh (socket close)',
    hungAborted >= 1 && abortTimes.some((ms) => ms >= assetTimeoutMs - 500 && ms <= assetTimeoutMs + 1500),
    JSON.stringify({ hungAborted, abortTimes, assetTimeoutMs }),
  );

  const afterAbort = await page.evaluate(async (name, distressPath) => {
    const cache = await caches.open(name);
    const matched = await cache.match(distressPath);
    const text = matched ? await matched.text() : '';
    return {
      present: !!matched,
      redirected: matched ? matched.redirected : null,
      fingerprint: text.slice(0, 80) + ':' + text.length,
      hasQueryKey: !!(await cache.match(distressPath + '?cf=refresh-distress')),
    };
  }, cacheName, DISTRESS_PATH);
  check(
    'failed/aborted refresh retains the identical good cached document',
    afterAbort.present && afterAbort.redirected === false && afterAbort.fingerprint === before.fingerprint,
    JSON.stringify({ before: before.fingerprint, after: afterAbort }),
  );
  check('canonical key remains; query-bearing key not required', !afterAbort.hasQueryKey, JSON.stringify(afterAbort));

  // Success path: answer again with a clean marker body; next open refreshes.
  hangSurvey = false;
  surveyOverride =
    '<!doctype html><html><head><title>Distress Survey – Field Reporter</title></head>' +
    '<body><div id="screenWork" class="active">CURSOR-REFRESH-SUCCESS-MARKER</div>' +
    '<script>/* hostBoot skipped in marker doc */</script></body></html>';

  await page.goto(`${base}#/file/refresh-distress`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-app="distress"]');
  // Marker doc will not run full hostBoot; only need navigation + refresh.
  await page.waitForFunction(() => {
    const child = document.querySelector('iframe');
    return !!(child && /distress-survey\/survey\.html/.test(child.src || ''));
  }, { timeout: 10000 });

  const refreshDeadline = Date.now() + assetTimeoutMs + 2000;
  let afterSuccess = null;
  while (Date.now() < refreshDeadline) {
    afterSuccess = await page.evaluate(async (name, distressPath) => {
      const cache = await caches.open(name);
      const matched = await cache.match(distressPath);
      const text = matched ? await matched.text() : '';
      return {
        present: !!matched,
        redirected: matched ? matched.redirected : null,
        marker: text.includes('CURSOR-REFRESH-SUCCESS-MARKER'),
        fingerprint: text.slice(0, 80) + ':' + text.length,
      };
    }, cacheName, DISTRESS_PATH);
    if (afterSuccess.marker && afterSuccess.redirected === false) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  check(
    'successful bounded refresh replaces cache with clean document',
    afterSuccess && afterSuccess.marker && afterSuccess.redirected === false && afterSuccess.fingerprint !== before.fingerprint,
    JSON.stringify(afterSuccess),
  );

  await browser.close();
  server.close();

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
