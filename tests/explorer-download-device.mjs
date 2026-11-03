/**
 * File Explorer list "Download job" brings a Cabinet file onto this device
 * through Check Out materialization — not a ZIP to Safari/Files.
 *
 * Run: node tests/explorer-download-device.mjs
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
  for (const candidate of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (!candidate) continue;
    try { require('fs').accessSync(candidate); return candidate; } catch (_) {}
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
  {
    id: 'job-free',
    displayName: 'Free Job',
    propertyAddress: '1 Main St, Albuquerque',
    fieldWorkDate: '2026-09-01',
  },
  {
    id: 'job-held',
    displayName: 'Held Elsewhere',
    propertyAddress: '2 Main St, Albuquerque',
    fieldWorkDate: '2026-09-02',
    checkout: {
      email: 'lee@example.com',
      deviceId: 'device-other',
      checkedOutAt: '2026-09-02T12:00:00.000Z',
    },
  },
].map((row) => Object.assign({ key: `cf/${row.id}/index.json` }, row));

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
for (let i = 0; i < 100; i += 1) {
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/index.html`);
    if (probe.ok) break;
  } catch (_) { /* waiting */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
});

async function openExplorer(page, files) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer);
  await page.evaluate((list) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    window.__checkout = [];
    window.__notices = [];
    window.__picked = [];
    window.showSaveFilePicker = async function (options) {
      window.__picked.push(options && options.suggestedName);
      throw new Error('ZIP save must not run for Download job');
    };
    window.ToolboxSync.getDeviceId = function () { return 'device-this'; };
    window.ToolboxApp.setCustomerFilesNotice = function (message) {
      window.__notices.push(String(message || ''));
    };
    const json = (body) => new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
    window.fetch = async function (url) {
      const href = String(url);
      if (!href.startsWith(base)) return new Response('Not found', { status: 404 });
      const path = href.slice(base.length).replace(/^\//, '');
      if (path === 'explore/files') return json({ files: list });
      return new Response('Not found', { status: 404 });
    };
    window.location.hash = '#/explore';
  }, files);
  await page.waitForFunction(() => document.querySelectorAll('.explorer-row[data-id]').length === 2);
}

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.setViewport({ width: 390, height: 844 });

  // --- available: Check Out materialization, return to Customer Files ------
  await openExplorer(page, FILES);
  const free = await page.evaluate(async () => {
    window.__checkout = [];
    window.__notices = [];
    window.__picked = [];
    window.ToolboxSync.checkOutCustomerFile = async function (id) {
      window.__checkout.push(id);
      await new Promise((r) => setTimeout(r, 30));
      return {
        ok: true,
        id: id,
        missingMedia: [{ component: 'report', label: 'report picture', mediaId: 'rp_missing' }],
      };
    };
    const row = document.querySelector('.explorer-row[data-id="job-free"]');
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Download job');
    button.click();
    for (let i = 0; i < 100; i += 1) {
      if (window.location.hash === '#/' || window.location.hash === '') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return {
      checkout: window.__checkout.slice(),
      notices: window.__notices.slice(),
      picked: window.__picked.slice(),
      hash: window.location.hash,
      takeOver: !!row.querySelector('.explorer-take-over'),
    };
  });
  check('available job calls checkOutCustomerFile once',
    free.checkout.length === 1 && free.checkout[0] === 'job-free',
    JSON.stringify(free.checkout));
  check('available job does not open a ZIP picker', free.picked.length === 0);
  check('available job navigates to Customer Files',
    free.hash === '#/' || free.hash === '', free.hash);
  check('available job notice says the file is on this device',
    free.notices.some((n) => /Free Job is on this device/.test(n)),
    JSON.stringify(free.notices));
  check('available job notice names missing optional media',
    free.notices.some((n) => /report picture/i.test(n)),
    JSON.stringify(free.notices));
  check('available job has no Take Over button', free.takeOver === false);

  // --- held elsewhere: explain, do not Check Out, Take Over stays ----------
  await openExplorer(page, FILES);
  const held = await page.evaluate(async () => {
    window.__checkout = [];
    window.ToolboxSync.checkOutCustomerFile = async function (id) {
      window.__checkout.push(id);
      return { ok: true, id: id, missingMedia: [] };
    };
    const row = document.querySelector('.explorer-row[data-id="job-held"]');
    const buttons = [...row.querySelectorAll('button')].map((b) => b.textContent);
    const download = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Download job');
    download.click();
    await new Promise((r) => setTimeout(r, 40));
    return {
      buttons,
      checkout: window.__checkout.slice(),
      notice: document.getElementById('explorer-notice').textContent,
      hash: window.location.hash,
    };
  });
  check('held-elsewhere row offers Download job and Take Over',
    held.buttons.indexOf('Download job') !== -1 && held.buttons.indexOf('Take Over') !== -1,
    JSON.stringify(held.buttons));
  check('held-elsewhere Download job does not call checkOut',
    held.checkout.length === 0, JSON.stringify(held.checkout));
  check('held-elsewhere Download job explains the lease conflict',
    /checked out by lee@example.com/i.test(held.notice) && /Take Over/i.test(held.notice),
    held.notice);
  check('held-elsewhere Download job stays on Explorer',
    held.hash.indexOf('#/explore') === 0, held.hash);

  // --- failure: truthful notice, button restored for retry -----------------
  await openExplorer(page, FILES);
  const failed = await page.evaluate(async () => {
    window.__checkout = [];
    window.__picked = [];
    window.ToolboxSync.checkOutCustomerFile = async function (id) {
      window.__checkout.push(id);
      await new Promise((r) => setTimeout(r, 20));
      const err = new Error('Required plan media missing after Check Out.');
      err.code = 'incomplete';
      throw err;
    };
    const row = document.querySelector('.explorer-row[data-id="job-free"]');
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Download job');
    button.click();
    for (let i = 0; i < 100; i += 1) {
      if (!button.disabled && button.textContent === 'Download job') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return {
      checkout: window.__checkout.slice(),
      label: button.textContent,
      disabled: button.disabled,
      notice: document.getElementById('explorer-notice').textContent,
      hash: window.location.hash,
      picked: window.__picked.length,
    };
  });
  check('failed Download job called checkOut once',
    failed.checkout.length === 1 && failed.checkout[0] === 'job-free',
    JSON.stringify(failed.checkout));
  check('failed Download job restores the button for retry',
    failed.label === 'Download job' && failed.disabled === false,
    JSON.stringify({ label: failed.label, disabled: failed.disabled }));
  check('failed Download job reports the failure truthfully',
    /Required plan media missing/i.test(failed.notice), failed.notice);
  check('failed Download job does not navigate away',
    failed.hash.indexOf('#/explore') === 0, failed.hash);
  check('failed Download job did not save a ZIP', failed.picked === 0);

  // Desktop width still shows Download job on rows.
  await page.setViewport({ width: 1280, height: 800, isMobile: false, hasTouch: false });
  await openExplorer(page, FILES);
  const desktop = await page.evaluate(() => ({
    download: document.querySelectorAll('.explorer-download-job').length,
    takeOver: document.querySelectorAll('.explorer-take-over').length,
  }));
  check('desktop list still has Download job on each row', desktop.download === 2, JSON.stringify(desktop));
  check('desktop list shows Take Over only on the held job', desktop.takeOver === 1, JSON.stringify(desktop));
} finally {
  await browser.close();
  server.kill();
}

const bad = results.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
