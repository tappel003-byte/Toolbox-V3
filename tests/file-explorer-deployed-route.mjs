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
  { id: 'cf-1', displayName: 'Mitchell', propertyAddress: '10 Oak Street' },
  { id: 'cf-2', displayName: 'Keulen', propertyAddress: '5 Pine Road' },
  { id: 'cf-3', displayName: 'Nguyen', propertyAddress: '8 Elm Street' },
  { id: 'cf-4', displayName: 'Garcia', propertyAddress: '2 Cedar Lane' },
  { id: 'cf-5', displayName: 'Patel', propertyAddress: '9 Ash Court' },
];
const PLANS = JSON.stringify({
  canvases: [{ plan: { id: 'plan-1', width: 10, height: 10 } }],
});
const DISTRESS = JSON.stringify({
  pins: [{ photos: ['ph_missing'] }],
  quickCapture: [],
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
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
        if (name === 'plans') {
          return new Response(fixture.plans, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (name === 'distress') {
          return new Response(fixture.distress, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      if (path === 'media/plan-1/exists') {
        return new Response(JSON.stringify({ exists: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path === 'media/ph_missing/exists') {
        return new Response(JSON.stringify({ exists: false }), {
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
    document.querySelector('.explorer-row__key').click();
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
  }, { files: FILES, plans: PLANS, distress: DISTRESS });

  const rootKeys = FILES.map((file) => `cf/${file.id}/index.json`);
  check('five stored Customer Files are listed from GET /files',
    rootKeys.every((key) => flow.rootText.includes(key)) &&
    FILES.every((file) => flow.rootText.includes(file.displayName)),
    flow.rootText);
  check('the 404 body is not shown as the Explorer screen',
    flow.noticeHidden && flow.noticeText !== 'Not found' && !/^Not found$/.test(flow.rootText),
    flow.noticeText);
  check('opening a file does not stop on explore 404',
    flow.detailText.includes('cf/cf-1/plans.json') &&
    flow.detailText.includes('cf/cf-1/distress.json') &&
    flow.detailText.includes('media/plan-1') &&
    flow.detailText.includes('media/ph_missing') &&
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
