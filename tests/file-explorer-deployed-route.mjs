/**
 * Field regression: the deployed Sync Worker answers GET /explore/files
 * with 404 "Not found". Customer Files are on GET /files. #/explore must
 * show those files, not the 404 body.
 *
 * Run: node tests/file-explorer-deployed-route.mjs
 * Synthetic responses only. Does not call production.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
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

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      require('fs').accessSync(candidate);
      return candidate;
    } catch (_) {}
  }
  return '/usr/bin/google-chrome';
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

const FILES = [
  { id: 'cf-1', displayName: 'Mitchell', propertyAddress: '10 Oak Street', fieldWorkDate: '2026-03-01', createdAt: '2026-01-15T12:00:00.000Z' },
  { id: 'cf-2', displayName: 'Keulen', propertyAddress: '5 Pine Road', createdAt: '2024-11-02T00:00:00.000Z' },
  { id: 'cf-3', displayName: 'Nguyen', propertyAddress: '8 Elm Street', createdAt: '2025-06-01T00:00:00.000Z' },
  { id: 'cf-4', displayName: 'Garcia', propertyAddress: '2 Cedar Lane', createdAt: '2025-07-01T00:00:00.000Z' },
  { id: 'cf-5', displayName: 'Patel', propertyAddress: '9 Ash Court', createdAt: '2025-08-01T00:00:00.000Z' },
];
const PLANS = JSON.stringify({
  canvases: [{ id: 'canvas-1', name: 'Ground', plan: { id: 'plan-1', width: 10, height: 10 } }],
});
const DISTRESS = JSON.stringify({
  pins: [{ photos: ['ph_missing', 'ph_shared'] }],
  quickCapture: [{ id: 'ph_quick', sourceName: 'porch.jpg' }],
  unassignedPhotos: ['ph_loose', 'ph_shared', { id: 'ph_unassigned_missing', subject: 'Loose crack' }, 'room-note'],
  generalPhotos: [{ id: 'ph_general', subject: 'Exterior overview' }, { id: 'ph_general_missing' }],
});
const CUSTOMER = JSON.stringify({
  firstName: 'Mitchell',
  generalPhotos: [{ id: 'ph_file_general', subject: 'File overview' }, { id: 'ph_file_missing' }],
});
const FLOOR = JSON.stringify({
  byCanvasId: { 'canvas-1': { recoveryPdfMediaId: 'fsrec_canvas-1' } },
});
const DIAGNOSTICS = JSON.stringify({
  figures: [{ mediaId: 'dxfig_1', canvasName: 'Ground' }],
});

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 400));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer);

  const flow = await page.evaluate(async (fixture) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    const fetchLog = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const method = (opts && opts.method) || 'GET';
      const path = href.slice(base.length).replace(/^\//, '');
      fetchLog.push({ method, path });

      if (method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }
      if (path === 'explore/files' || /^explore\/files\/[^/]+$/.test(path)) {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      if (path === 'files') {
        return new Response(JSON.stringify({ files: fixture.files, purged: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const indexMatch = /^files\/([^/]+)\/index$/.exec(path);
      if (indexMatch) {
        const id = decodeURIComponent(indexMatch[1]);
        const index = fixture.files.find((row) => row.id === id);
        if (!index) return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(index), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const componentMatch = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
      if (componentMatch) {
        const name = decodeURIComponent(componentMatch[2]);
        if (name === 'customer') {
          return new Response(fixture.customer, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (name === 'plans') {
          return new Response(fixture.plans, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (name === 'distress') {
          return new Response(fixture.distress, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (name === 'floor') {
          return new Response(fixture.floor, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (name === 'diagnostics') {
          return new Response(fixture.diagnostics, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      const existsMatch = /^media\/([^/]+)\/exists$/.exec(path);
      if (existsMatch) {
        const present = [
          'plan-1', 'ph_quick', 'ph_loose', 'ph_general', 'ph_file_general', 'ph_shared',
          'fsrec_canvas-1', 'dxfig_1',
        ].includes(decodeURIComponent(existsMatch[1]));
        return new Response(JSON.stringify({ exists: present }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path === 'media/plan-1') {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };

    async function waitFor(fn) {
      for (let i = 0; i < 40; i++) {
        if (fn()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('timed out');
    }

    window.location.hash = '#/explore';
    await waitFor(() => document.querySelectorAll('.explorer-row__key').length >= fixture.files.length);
    const notice = document.getElementById('explorer-notice');
    const rootText = document.getElementById('explorer-list').innerText;
    const mitchell = [...document.querySelectorAll('.explorer-row__key')].find((button) => button.textContent === 'Mitchell');
    mitchell.click();
    await waitFor(() => document.querySelector('[data-key="media/ph_missing"]'));
    const detailNotice = document.getElementById('explorer-notice');
    const detailText = document.getElementById('explorer-list').innerText;
    const plansRow = document.querySelector('[data-key="cf/cf-1/plans.json"]');
    const open = [...plansRow.querySelectorAll('button')].find((button) => button.textContent === 'Open');
    open.click();
    await waitFor(() => {
      const pre = document.querySelector('.explorer-preview__text');
      return pre && pre.textContent.indexOf('plan-1') !== -1;
    });

    return {
      rootText,
      detailText,
      noticeHidden: !!(notice && notice.hidden),
      noticeText: notice ? notice.textContent : '',
      detailNoticeHidden: !!(detailNotice && detailNotice.hidden),
      detailNoticeText: detailNotice ? detailNotice.textContent : '',
      preview: document.querySelector('.explorer-preview__text').textContent,
      fetchLog,
    };
  }, { files: FILES, plans: PLANS, distress: DISTRESS, floor: FLOOR, diagnostics: DIAGNOSTICS, customer: CUSTOMER });

  check('five stored Customer Files are listed from GET /files',
    FILES.every((file) => flow.rootText.includes(file.displayName) && flow.rootText.includes(file.propertyAddress)) &&
    flow.rootText.includes('Mar 1, 2026') &&
    !flow.rootText.includes('cf/cf-1/index.json') &&
    !/\bType\b/.test(flow.rootText) &&
    !/\bUploaded\b/.test(flow.rootText),
    flow.rootText);
  check('the 404 body is not shown as the Explorer screen',
    flow.noticeHidden && flow.noticeText !== 'Not found' && !/^Not found$/.test(flow.rootText),
    flow.noticeText);
  check('opening a file does not stop on explore 404',
    flow.detailText.includes('Plans and canvases') &&
    flow.detailText.includes('Distress Survey') &&
    flow.detailText.includes('Floor plan — Ground') &&
    flow.detailText.includes('Distress Survey photograph') &&
    flow.detailText.includes('Quick Capture photo — porch.jpg') &&
    flow.detailText.includes('Unassigned photo') &&
    flow.detailText.includes('Unassigned photo — Loose crack') &&
    flow.detailText.includes('General photo — Exterior overview') &&
    flow.detailText.includes('General photo — File overview') &&
    flow.detailText.includes('Also listed in Unassigned photos.') &&
    !flow.detailText.includes('media/room-note') &&
    flow.detailText.includes('Floor Survey recovery PDF — Ground') &&
    flow.detailText.includes('Diagnostics figure — Ground') &&
    !flow.detailText.includes('Distress or Quick Capture') &&
    /Not stored/.test(flow.detailText) &&
    flow.detailNoticeHidden,
    flow.detailNoticeText + ' ' + flow.detailText);
  check('JSON from the cabinet component route opens as text', flow.preview.includes('plan-1'));
  check('fallback reads do not check out or write',
    flow.fetchLog.every((entry) => entry.method === 'GET') &&
    !flow.fetchLog.some((entry) => entry.path.includes('checkout')) &&
    flow.fetchLog.some((entry) => entry.path === 'explore/files') &&
    flow.fetchLog.some((entry) => entry.path === 'files'),
    JSON.stringify(flow.fetchLog));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
