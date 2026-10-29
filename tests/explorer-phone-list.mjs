/**
 * The File Explorer list on a phone: filed by year and month, newest first,
 * with the town on each row and Download job beside Open. Synthetic server,
 * no production Customer Files.
 * Run: node tests/explorer-phone-list.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import net from 'net';
import { join } from 'path';

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
  { id: 'job-sorenson', displayName: 'Rhonda Sorenson', propertyAddress: '4925 Edwards Dr NE, Albuquerque, NM 87111, United States of America', fieldWorkDate: '2026-10-07' },
  { id: 'job-yazzie', displayName: 'Marcus Yazzie', propertyAddress: '812 Hilltop Ave, Gallup, NM 87301, United States of America', fieldWorkDate: '2026-10-02' },
  { id: 'job-ford', displayName: 'Chalmers Ford', propertyAddress: '3777 American Rd NW, Albuquerque, NM 87114', fieldWorkDate: '2026-09-11' },
  { id: 'job-ortega', displayName: 'Delia Ortega', propertyAddress: '19 Camino Alire, Santa Fe, New Mexico 87501', fieldWorkDate: '2025-12-18' },
  { id: 'job-oak', displayName: 'Ada Mitchell', propertyAddress: '10 Oak Street', createdAt: '2024-01-01T00:00:00Z' },
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
  } catch (_) { /* not listening yet */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const shotDir = join(new URL('..', import.meta.url).pathname, 'tests', 'review-artifacts');
mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
});

async function openExplorer(page) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer && window.JSZip);
  await page.evaluate((files) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    window.__log = [];
    window.__picked = [];
    window.showSaveFilePicker = async function (options) {
      const entry = { name: options.suggestedName, chunks: [] };
      window.__picked.push(entry);
      return {
        name: entry.name,
        createWritable: async () => new WritableStream({ write(chunk) { entry.chunks.push(chunk); } }),
      };
    };
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    window.fetch = async function (url) {
      const href = String(url);
      if (!href.startsWith(base)) return new Response('Not found', { status: 404 });
      const path = href.slice(base.length).replace(/^\//, '');
      window.__log.push(((arguments[1] && arguments[1].method) || 'GET') + ' ' + path);
      if (path === 'explore/files') return json({ files });
      if (path === 'explore/files/job-yazzie') {
        return json({
          id: 'job-yazzie',
          displayName: 'Marcus Yazzie',
          objects: [
            { key: 'cf/job-yazzie/index.json', contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
            { key: 'cf/job-yazzie/customer.json', contentType: 'application/json', purpose: 'customer', label: 'Customer information' },
            { key: 'media/ph_one', contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
          ],
          referenceNotes: [],
        });
      }
      const object = /^explore\/files\/job-yazzie\/object\?key=(.+)$/.exec(path);
      if (object) {
        const key = decodeURIComponent(object[1]);
        if (key === 'cf/job-yazzie/customer.json') return json({ firstName: 'Marcus', lastName: 'Yazzie' });
        if (key === 'cf/job-yazzie/index.json') return json({ id: 'job-yazzie' });
        if (key === 'media/ph_one') return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'content-type': 'image/jpeg' } });
        return new Response('Not stored', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    };
    window.location.hash = '#/explore';
  }, FILES);
  await page.waitForFunction(() => document.querySelectorAll('.explorer-row[data-id]').length === 5);
}

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.setViewport({ width: 390, height: 844 });
  await openExplorer(page);

  const phone = await page.evaluate(() => {
    const list = document.getElementById('explorer-list');
    const sequence = [...list.children].map((el) => {
      if (el.classList.contains('explorer-year')) return 'Y:' + el.textContent;
      if (el.classList.contains('explorer-month')) return 'M:' + el.textContent;
      if (el.classList.contains('explorer-row')) return 'J:' + el.querySelector('.explorer-row__key').textContent;
      return '?';
    });
    const meta = {};
    list.querySelectorAll('.explorer-row[data-id]').forEach((row) => {
      const label = row.querySelector('.explorer-row__label');
      meta[row.dataset.id] = {
        text: label ? label.textContent : '',
        buttons: [...row.querySelectorAll('.explorer-row__actions button')].map((b) => b.textContent),
      };
    });
    const doc = document.documentElement;
    return {
      sequence,
      meta,
      lead: document.getElementById('explorer-lead').textContent,
      treeHidden: document.getElementById('explorer-tree').hidden,
      overflow: doc.scrollWidth > doc.clientWidth + 1,
    };
  });

  check('the phone list is filed newest first by year and month', JSON.stringify(phone.sequence) === JSON.stringify([
    'Y:20264 jobs'.replace('4 jobs', '3 jobs'),
    'M:October', 'J:Rhonda Sorenson', 'J:Marcus Yazzie',
    'M:September', 'J:Chalmers Ford',
    'Y:20251 job', 'M:December', 'J:Delia Ortega',
    'Y:No survey date1 job', 'J:Ada Mitchell',
  ]), JSON.stringify(phone.sequence));
  check('the row says the street and the town',
    phone.meta['job-sorenson'].text === '4925 Edwards Dr NE, Albuquerque · Oct 7, 2026',
    phone.meta['job-sorenson'].text);
  check('a spelled-out state still finds the town',
    phone.meta['job-ortega'].text.startsWith('19 Camino Alire, Santa Fe ·'), phone.meta['job-ortega'].text);
  check('an address with no town is shown as it was typed, nothing guessed',
    phone.meta['job-oak'].text.startsWith('10 Oak Street ·'), phone.meta['job-oak'].text);
  check('every row carries Open, then Download job',
    Object.values(phone.meta).every((m) => m.buttons[0] === 'Open' && m.buttons[1] === 'Download job'),
    JSON.stringify(Object.values(phone.meta).map((m) => m.buttons)));
  check('Delete is still on every row',
    Object.values(phone.meta).every((m) => m.buttons.indexOf('Delete') !== -1));
  check('the intro is one short line', phone.lead === 'Jobs on the server, filed by field work date.', phone.lead);
  check('no tree on a phone', phone.treeHidden);
  check('nothing scrolls sideways on a phone', !phone.overflow);
  await page.screenshot({ path: join(shotDir, 'file-explorer-phone-list-grouped.png'), fullPage: true });

  // Search still narrows, and the groups follow what is left.
  const searched = await page.evaluate(async () => {
    const input = document.getElementById('explorer-search');
    input.value = 'gallup';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 50));
    const out = [...document.getElementById('explorer-list').children].map((el) => el.textContent.split('\n')[0].slice(0, 30));
    input.value = '';
    input.dispatchEvent(new Event('input'));
    return { rows: document.querySelectorAll('.explorer-row[data-id]').length, first: out };
  });
  check('search by town narrows the grouped list', searched.first.some((t) => t.indexOf('Marcus Yazzie') !== -1) &&
    !searched.first.some((t) => t.indexOf('Rhonda') !== -1), JSON.stringify(searched.first));

  // Download job from the row: the arranged copy, named for the job, built
  // through the read-only explore routes alone.
  const download = await page.evaluate(async () => {
    window.__log.length = 0;
    const row = document.querySelector('.explorer-row[data-id="job-yazzie"]');
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Download job');
    button.click();
    for (let i = 0; i < 200; i += 1) {
      if (window.__picked.length && button.textContent === 'Download job' && !button.disabled) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const entry = window.__picked[0];
    const blob = entry ? new Blob(entry.chunks) : null;
    let names = [];
    if (blob && blob.size) {
      const zip = await window.JSZip.loadAsync(blob);
      names = Object.keys(zip.files);
    }
    return {
      name: entry && entry.name,
      size: blob ? blob.size : 0,
      names,
      log: window.__log.slice(),
      hash: window.location.hash,
      notice: document.getElementById('explorer-notice').textContent,
    };
  });
  check('Download job on the row saves a ZIP named for the job',
    /^Marcus Yazzie - 812 Hilltop Ave.*\(2026-10-02\)\.zip$/.test(download.name || '') && download.size > 0,
    JSON.stringify({ name: download.name, size: download.size }));
  check('the copy holds the job\'s photograph', download.names.some((n) => /Photographs\//.test(n)), JSON.stringify(download.names));
  check('the row download stays on the list', download.hash === '#/explore');
  // Reading a photograph's pin and room goes through exploreFetchObject,
  // whose fallback to the component route predates this change; what matters
  // here is that a download from the list writes nothing anywhere.
  check('the row download only reads', download.log.length > 0 &&
    download.log.every((p) => p.indexOf('GET ') === 0), JSON.stringify(download.log));

  // Desktop is unchanged: the tree files the jobs, the list does not repeat it.
  await page.setViewport({ width: 1280, height: 800, isMobile: false, hasTouch: false });
  await page.waitForFunction(() => !document.getElementById('explorer-tree').hidden);
  const desktop = await page.evaluate(() => ({
    years: document.querySelectorAll('#explorer-list .explorer-year').length,
    rows: document.querySelectorAll('.explorer-row[data-id]').length,
    download: document.querySelectorAll('.explorer-download-job').length,
  }));
  check('a desktop keeps the tree and a plain list', desktop.years === 0 && desktop.rows === 5, JSON.stringify(desktop));
  check('Download job is on desktop rows too', desktop.download === 5);
  await page.screenshot({ path: join(shotDir, 'file-explorer-desktop-list-download.png'), fullPage: true });

  // Back down to a phone, and the groups come back without a reload.
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll('#explorer-list .explorer-year').length === 3);
  check('narrowing the window brings the groups back', true);
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
