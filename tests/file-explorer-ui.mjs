/**
 * File Explorer UI against a synthetic server. No production Customer Files.
 * Run: node tests/file-explorer-ui.mjs
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

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = 'plan-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const INDEX_TEXT = JSON.stringify({
  id: ID,
  displayName: 'Ada Mitchell',
  propertyAddress: '10 Oak Street',
  fieldWorkDate: '2026-03-01',
  createdAt: '2026-01-15T12:00:00.000Z',
  checkout: { email: 'tim@example.com', deviceId: 'device-a' },
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer && window.ToolboxDB);

  const flow = await page.evaluate(async (fixture) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    const fetchLog = [];
    const writes = [];
    const downloads = [];
    const writeNames = [
      'saveCustomerFile', 'putMedia', 'deleteMedia', 'moveCustomerFileToTrash',
      'restoreCustomerFile', 'permanentlyDeleteCustomerFiles', 'removeLocalWorkingCopy',
      'importCustomerFileRecovery', 'commitCustomerFileRecoveryUpdate', 'purgeExpiredCustomerFiles',
    ];
    writeNames.forEach((name) => {
      const original = window.ToolboxDB[name];
      if (typeof original !== 'function') return;
      window.ToolboxDB[name] = function () {
        writes.push(name);
        return original.apply(this, arguments);
      };
    });
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      const url = originalCreate(blob);
      downloads.push({ url, size: blob.size, type: blob.type, name: '' });
      return url;
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const last = downloads[downloads.length - 1];
      if (last) {
        last.name = this.download;
        last.clicked = true;
      }
      return originalClick.call(this);
    };

    const files = [{
      key: `cf/${fixture.id}/index.json`,
      id: fixture.id,
      size: fixture.indexText.length,
      uploaded: '2026-03-04T15:06:07.000Z',
      contentType: 'application/json',
      displayName: 'Ada Mitchell',
      propertyAddress: '10 Oak Street',
      fieldWorkDate: '2026-03-01',
      createdAt: '2026-01-15T12:00:00.000Z',
    }, {
      key: `cf/${fixture.other}/index.json`,
      id: fixture.other,
      displayName: 'Fred Keulen',
      propertyAddress: '5 Pine Road',
      createdAt: '2024-11-02T00:00:00.000Z',
    }];
    const objects = [
      { key: `cf/${fixture.id}/index.json`, size: fixture.indexText.length, contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
      { key: `cf/${fixture.id}/customer.json`, size: 40, contentType: 'application/json', purpose: 'customer', label: 'Customer information' },
      { key: `cf/${fixture.id}/plans.json`, size: 42, contentType: 'application/json', purpose: 'plans', label: 'Plans and canvases' },
      { key: `cf/${fixture.id}/distress.json`, size: 80, contentType: 'application/json', purpose: 'distress', label: 'Distress Survey' },
      { key: `cf/${fixture.id}/floor.json`, size: 60, contentType: 'application/json', purpose: 'floor', label: 'Floor Survey' },
      { key: `cf/${fixture.id}/diagnostics.json`, size: 30, contentType: 'application/json', purpose: 'diagnostics', label: 'Diagnostics' },
      { key: `cf/${fixture.id}/report.json`, size: 20, contentType: 'application/json', purpose: 'report', label: 'Report Builder' },
      { key: `cf/${fixture.id}/field-notes.txt`, size: 6, contentType: 'text/plain', purpose: 'other', label: 'field-notes.txt' },
      { key: `media/${fixture.planId}`, size: fixture.png.length, contentType: 'image/png', purpose: 'plan', label: 'Floor plan — Ground' },
      { key: 'media/ph_present', size: fixture.png.length, contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
      { key: 'media/ph_quick', size: fixture.png.length, contentType: 'image/jpeg', purpose: 'quick-capture', label: 'Quick Capture photo — porch.jpg' },
      { key: 'media/fsrec_canvas-ground', size: fixture.pdf.length, contentType: 'application/pdf', purpose: 'floor-pdf', label: 'Floor Survey recovery PDF — Ground' },
      { key: 'media/dxfig_ground', size: fixture.png.length, contentType: 'image/png', purpose: 'diagnostics-figure', label: 'Diagnostics figure — Ground' },
      { key: 'media/ph_missing', missing: true, purpose: 'distress-photo', label: 'Distress Survey photograph' },
      { key: 'media/fsrec_missing', missing: true, purpose: 'floor-pdf', label: 'Floor Survey recovery PDF — Empty' },
    ];
    const bytes = {
      [`cf/${fixture.id}/index.json`]: { type: 'application/json', body: fixture.indexText },
      [`cf/${fixture.id}/plans.json`]: { type: 'application/json', body: '{"canvases":[]}' },
      [`cf/${fixture.id}/customer.json`]: { type: 'application/json', body: '{"firstName":"Ada"}' },
      [`cf/${fixture.id}/field-notes.txt`]: { type: 'text/plain', body: 'a note' },
      [`media/${fixture.planId}`]: { type: 'image/png', body: fixture.png },
      'media/ph_present': { type: 'image/jpeg', body: fixture.png },
      'media/ph_quick': { type: 'image/jpeg', body: fixture.png },
      'media/fsrec_canvas-ground': { type: 'application/pdf', body: fixture.pdf },
      'media/dxfig_ground': { type: 'image/png', body: fixture.png },
    };

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const method = (opts && opts.method) || 'GET';
      const path = href.slice(base.length).replace(/^\//, '');
      fetchLog.push({ method, path });
      if (path === 'explore/files' && method === 'GET') return jsonResponse({ files });
      if (path === `explore/files/${fixture.id}` && method === 'GET') {
        return jsonResponse({
          id: fixture.id,
          displayName: 'Ada Mitchell',
          propertyAddress: '10 Oak Street',
          fieldWorkDate: '2026-03-01',
          prefix: `cf/${fixture.id}/`,
          objects,
          referenceNotes: ['Referenced media id in distress.json is not a single storage key and was not fetched.'],
        });
      }
      if (path === `explore/files/${fixture.other}` && method === 'GET') {
        return jsonResponse({
          id: fixture.other,
          displayName: 'Fred Keulen',
          propertyAddress: '5 Pine Road',
          createdAt: '2024-11-02T00:00:00.000Z',
          prefix: `cf/${fixture.other}/`,
          objects: [{
            key: `cf/${fixture.other}/index.json`,
            contentType: 'application/json',
            purpose: 'technical',
            label: 'Cabinet index',
          }],
          referenceNotes: [],
        });
      }
      const objectMatch = new RegExp(`^explore/files/${fixture.id}/object\\?key=(.+)$`).exec(path);
      if (objectMatch && method === 'GET') {
        const key = decodeURIComponent(objectMatch[1]);
        const stored = bytes[key];
        if (!stored) return new Response('Not stored', { status: 404, headers: { 'content-type': 'text/plain' } });
        const raw = typeof stored.body === 'string' ? new TextEncoder().encode(stored.body) : new Uint8Array(stored.body);
        return new Response(raw, {
          status: 200,
          headers: {
            'content-type': stored.type,
            'content-disposition': `attachment; filename="${key.split('/').pop()}"`,
          },
        });
      }
      if (path === `explore/files/${fixture.id}/archive` && method === 'GET') {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="cf-${fixture.id}.zip"`,
          },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    function jsonResponse(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const beforeFiles = await window.ToolboxDB.getAllCustomerFiles();
    document.getElementById('app-explorer').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rootText = document.getElementById('explorer-list').innerText;
    const rootLead = document.getElementById('explorer-lead').textContent;
    const columnHead = document.querySelector('.explorer-columns');
    const adaCard = document.querySelector(`[data-key="cf/${fixture.id}/index.json"]`);
    const rootRawKey = adaCard.querySelector('.explorer-row__technical code').textContent;
    const search = document.getElementById('explorer-search');
    search.value = 'Keulen';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const searched = document.getElementById('explorer-list').innerText;
    const searchedCount = document.querySelectorAll('.explorer-row__key').length;
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rootKey = document.querySelector('.explorer-row__key');
    rootKey.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const detailText = document.getElementById('explorer-list').innerText;
    const detailTitle = document.getElementById('explorer-title').textContent;
    const detailLead = document.getElementById('explorer-lead').textContent;
    const detailRawKey = document.querySelector('.explorer-row__technical code').textContent;
    const missingRow = document.querySelector('[data-key="media/ph_missing"]');
    const missingPdf = document.querySelector('[data-key="media/fsrec_missing"]');
    const recoveryRow = document.querySelector('[data-key="media/fsrec_canvas-ground"]');
    const quickRow = document.querySelector('[data-key="media/ph_quick"]');
    const distressRow = document.querySelector('[data-key="media/ph_present"]');
    const notesRow = document.querySelector(`[data-key="cf/${fixture.id}/field-notes.txt"]`);
    const groups = [...document.querySelectorAll('.explorer-group')].map((group) => group.dataset.group);
    const objectCount = document.querySelectorAll('.explorer-row[data-key]').length;
    const note = document.querySelector('.explorer-note');
    const unreferenced = document.querySelector('[data-key="media/ph_unreferenced"]');

    async function clickAction(key, label) {
      const row = document.querySelector(`[data-key="${key}"]`);
      const button = [...row.querySelectorAll('button')].find((item) => item.textContent === label);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    await clickAction('media/fsrec_canvas-ground', 'Download');
    await clickAction(`media/${fixture.planId}`, 'Open');
    const image = document.querySelector('.explorer-preview__image');
    if (image && !image.complete) {
      await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
    }
    const imageOpened = !!(image && image.complete && image.naturalWidth === 1);
    await clickAction(`cf/${fixture.id}/index.json`, 'Open');
    const jsonText = document.querySelector('.explorer-preview__text')
      ? document.querySelector('.explorer-preview__text').textContent
      : '';
    await clickAction('media/fsrec_canvas-ground', 'Open');
    const pdf = document.querySelector('.explorer-preview__pdf');
    await clickAction(`media/${fixture.planId}`, 'Download');
    document.getElementById('explorer-zip').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterFiles = await window.ToolboxDB.getAllCustomerFiles();

    return {
      hash: window.location.hash,
      hasExplorerButton: !!document.getElementById('app-explorer'),
      rootText,
      rootLead,
      rootRawKey,
      columnHead: !!columnHead,
      searched,
      searchedCount,
      detailText,
      detailTitle,
      detailLead,
      detailRawKey,
      groups,
      objectCount,
      recoveryText: recoveryRow ? recoveryRow.innerText : '',
      recoveryActions: recoveryRow ? [...recoveryRow.querySelectorAll('button')].map((button) => button.textContent) : [],
      quickText: quickRow ? quickRow.innerText : '',
      distressText: distressRow ? distressRow.innerText : '',
      notesText: notesRow ? notesRow.innerText : '',
      missingText: missingRow ? missingRow.innerText : '',
      missingDownloads: missingRow ? missingRow.querySelectorAll('button').length : -1,
      missingPdfText: missingPdf ? missingPdf.innerText : '',
      missingPdfDownloads: missingPdf ? missingPdf.querySelectorAll('button').length : -1,
      note: note ? note.textContent : '',
      unreferenced: !!unreferenced,
      imageOpened,
      jsonText,
      pdfSrc: pdf ? pdf.getAttribute('src') : '',
      pdfTitle: pdf ? pdf.getAttribute('title') : '',
      downloads,
      fetchLog,
      writes,
      beforeCount: beforeFiles.length,
      afterCount: afterFiles.length,
    };
  }, {
    id: ID,
    other: OTHER,
    planId: PLAN_ID,
    indexText: INDEX_TEXT,
    png: [...PNG],
    pdf: [...PDF],
  });

  check('app bar has a File Explorer entry', flow.hasExplorerButton);
  check('root leads with customer, address, and one useful date; raw key stays in Technical details',
    !flow.rootText.includes(`cf/${ID}/index.json`) && flow.rootRawKey === `cf/${ID}/index.json` &&
    flow.rootText.includes('Ada Mitchell') &&
    flow.rootText.includes('Fred Keulen') &&
    flow.rootText.includes('10 Oak Street') &&
    flow.rootText.includes('Mar 1, 2026') &&
    !flow.rootText.includes('Jan 15') &&
    !flow.rootText.includes('Mar 4') &&
    !flow.columnHead &&
    !/\bType\b/.test(flow.rootText) &&
    !/\bUploaded\b/.test(flow.rootText));
  check('root copy is plain language',
    flow.rootLead === 'Customer Files stored on the server. Open a file to view its stored surveys, photos, plans, and other data.');
  check('search finds one Customer File by name',
    flow.searchedCount === 1 && flow.searched.includes('Fred Keulen') && !flow.searched.includes('Ada Mitchell'));
  check('detail groups every stored piece and keeps raw keys available',
    flow.detailTitle === 'Ada Mitchell' &&
    flow.detailLead.includes('10 Oak Street') &&
    flow.detailLead.includes('Mar 1, 2026') &&
    flow.detailRawKey.startsWith(`cf/${ID}/`) &&
    flow.groups.join(',') === 'customer,plans,distress,quick-capture,floor,diagnostics,report,other,technical' &&
    flow.objectCount === 15 &&
    flow.detailText.includes('Plans and canvases') &&
    flow.detailText.includes('Floor plan — Ground') &&
    !flow.detailText.includes(`media/${PLAN_ID}`));
  check('Distress and Quick Capture stay distinct',
    flow.distressText.includes('Distress Survey photograph') &&
    !flow.distressText.includes('Quick Capture') &&
    flow.quickText.includes('Quick Capture photo — porch.jpg') &&
    !flow.detailText.includes('Distress or Quick Capture'));
  check('Floor Survey recovery PDF can be opened and downloaded',
    flow.recoveryText.includes('Floor Survey recovery PDF — Ground') &&
    flow.recoveryActions.includes('Open') &&
    flow.recoveryActions.includes('Download'));
  check('unknown stored file is shown with its name',
    flow.notesText.includes('field-notes.txt'));
  check('missing media is visibly not stored and cannot be downloaded',
    /Not stored/.test(flow.missingText) && flow.missingDownloads === 0 && !/image\/|application\//.test(flow.missingText) &&
    /Not stored/.test(flow.missingPdfText) && flow.missingPdfDownloads === 0 &&
    flow.missingPdfText.includes('Floor Survey recovery PDF — Empty'));
  check('unsafe reference note is visible', /not a single storage key/.test(flow.note));
  check('unreferenced media is absent', flow.unreferenced === false);
  check('image preview uses the stored image', flow.imageOpened);
  check('JSON preview is the stored text', flow.jsonText === INDEX_TEXT);
  check('PDF preview uses the stored recovery PDF',
    flow.pdfSrc.startsWith('blob:') && flow.pdfTitle === 'Floor Survey recovery PDF — Ground');
  check('individual download saves the object bytes',
    flow.downloads.some((item) => item.clicked && item.type === 'image/png' && item.size === PNG.length && item.name.includes(PLAN_ID)) &&
    flow.downloads.some((item) => item.clicked && item.type === 'application/pdf' && item.size === PDF.length && item.name.includes('fsrec_canvas-ground')));
  check('ZIP download uses the archive response',
    flow.downloads.some((item) => item.clicked && item.type === 'application/zip' && item.name === `cf-${ID}.zip`));
  check('browsing does not check out or write the cabinet',
    flow.fetchLog.length > 0 &&
    flow.fetchLog.every((entry) => entry.method === 'GET' && entry.path.startsWith('explore/')) &&
    !flow.fetchLog.some((entry) => entry.path.includes('checkout')),
    JSON.stringify(flow.fetchLog));
  check('browsing does not create a local working copy',
    flow.writes.length === 0 && flow.beforeCount === flow.afterCount,
    JSON.stringify({ writes: flow.writes, before: flow.beforeCount, after: flow.afterCount }));

  const shotDir = '/opt/cursor/artifacts/screenshots';
  mkdirSync(shotDir, { recursive: true });

  async function layoutSnapshot(width, height, name) {
    await page.setViewport({ width, height });
    await page.evaluate(() => { window.location.hash = '#/explore'; });
    await page.waitForFunction(() => document.querySelector('.explorer-row__key'));
    const rootShot = join(shotDir, `file-explorer-${name}-list.png`);
    await page.screenshot({ path: rootShot, fullPage: true });
    await page.click('.explorer-row__key');
    await page.waitForFunction(() => document.querySelector('[data-key="media/ph_missing"]'));
    const detailShot = join(shotDir, `file-explorer-${name}-detail.png`);
    await page.screenshot({ path: detailShot, fullPage: true });
    const metrics = await page.evaluate(() => {
      function box(el) {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      }
      function overlaps(a, b) {
        return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      }
      const title = box(document.querySelector('.app-bar__title'));
      const buttons = [...document.querySelectorAll('.app-bar__actions button')].map((el) => ({
        name: el.textContent.trim(),
        ...box(el),
      }));
      const bar = box(document.querySelector('.app-bar'));
      let crowded = title.right > buttons[0].left + 1;
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        if (button.left < -1 || button.right > window.innerWidth + 1 || button.top < bar.top - 1 || button.bottom > bar.bottom + 1) {
          crowded = true;
        }
        for (let j = i + 1; j < buttons.length; j++) {
          if (overlaps(button, buttons[j])) crowded = true;
        }
      }
      const rows = [...document.querySelectorAll('.explorer-row')];
      const rowOverflow = rows.some((row) => row.getBoundingClientRect().right > window.innerWidth + 1);
      const doc = document.documentElement;
      return {
        crowded,
        rowOverflow,
        pageOverflow: doc.scrollWidth > doc.clientWidth + 1,
        buttons,
        titleWidth: Math.round(title.width),
        rowCount: rows.length,
      };
    });
    return { metrics, rootShot, detailShot };
  }

  const desktop = await layoutSnapshot(1280, 800, 'desktop');
  const tablet = await layoutSnapshot(768, 1024, 'ipad');
  const phone = await layoutSnapshot(390, 844, 'phone');
  check('desktop layout does not crowd the app bar or rows',
    !desktop.metrics.crowded && !desktop.metrics.rowOverflow && !desktop.metrics.pageOverflow && desktop.metrics.rowCount >= 4,
    JSON.stringify(desktop.metrics));
  check('iPad layout does not crowd the app bar or rows',
    !tablet.metrics.crowded && !tablet.metrics.rowOverflow && !tablet.metrics.pageOverflow,
    JSON.stringify(tablet.metrics));
  check('phone layout does not crowd the app bar or rows',
    !phone.metrics.crowded && !phone.metrics.rowOverflow && !phone.metrics.pageOverflow,
    JSON.stringify(phone.metrics));

  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate((planId) => {
    const row = document.querySelector(`[data-key="media/${planId}"]`);
    [...row.querySelectorAll('button')].find((button) => button.textContent === 'Open').click();
  }, PLAN_ID);
  await page.waitForSelector('.explorer-preview__image');
  await page.screenshot({ path: join(shotDir, 'file-explorer-desktop-preview.png'), fullPage: true });
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
