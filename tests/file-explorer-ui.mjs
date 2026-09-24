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
const PLAN_ID = 'plan-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const INDEX_TEXT = JSON.stringify({
  id: ID,
  displayName: 'Mitchell',
  propertyAddress: '10 Oak Street',
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
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
      displayName: 'Mitchell',
      propertyAddress: '10 Oak Street',
    }];
    const objects = [
      { key: `cf/${fixture.id}/index.json`, size: fixture.indexText.length, uploaded: '2026-03-04T15:06:07.000Z', contentType: 'application/json' },
      { key: `cf/${fixture.id}/plans.json`, size: 42, uploaded: '2026-03-04T15:06:07.000Z', contentType: 'application/json' },
      { key: `cf/${fixture.id}/distress.json`, size: 80, uploaded: '2026-03-04T15:06:07.000Z', contentType: 'application/json' },
      { key: `media/${fixture.planId}`, size: fixture.png.length, uploaded: '2026-03-04T15:06:07.000Z', contentType: 'image/png' },
      { key: 'media/ph_quick', size: fixture.pdf.length, uploaded: '2026-03-04T15:06:07.000Z', contentType: 'application/pdf' },
      { key: 'media/ph_missing', missing: true },
    ];
    const bytes = {
      [`cf/${fixture.id}/index.json`]: { type: 'application/json', body: fixture.indexText },
      [`cf/${fixture.id}/plans.json`]: { type: 'application/json', body: '{"canvases":[]}' },
      [`media/${fixture.planId}`]: { type: 'image/png', body: fixture.png },
      'media/ph_quick': { type: 'application/pdf', body: fixture.pdf },
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
          prefix: `cf/${fixture.id}/`,
          objects,
          referenceNotes: ['Referenced media id in distress.json is not a single storage key and was not fetched.'],
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
    const rootKey = document.querySelector('.explorer-row__key');
    rootKey.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const detailText = document.getElementById('explorer-list').innerText;
    const missingRow = document.querySelector('[data-key="media/ph_missing"]');
    const note = document.querySelector('.explorer-note');
    const unreferenced = document.querySelector('[data-key="media/ph_unreferenced"]');

    async function clickAction(key, label) {
      const row = document.querySelector(`[data-key="${key}"]`);
      const button = [...row.querySelectorAll('button')].find((item) => item.textContent === label);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

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
    await clickAction('media/ph_quick', 'Open');
    const pdf = document.querySelector('.explorer-preview__pdf');
    await clickAction(`media/${fixture.planId}`, 'Download');
    document.getElementById('explorer-zip').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterFiles = await window.ToolboxDB.getAllCustomerFiles();

    return {
      hash: window.location.hash,
      hasExplorerButton: !!document.getElementById('app-explorer'),
      rootText,
      detailText,
      missingText: missingRow ? missingRow.innerText : '',
      missingDownloads: missingRow ? missingRow.querySelectorAll('button').length : -1,
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
    planId: PLAN_ID,
    indexText: INDEX_TEXT,
    png: [...PNG],
    pdf: [...PDF],
  });

  check('app bar has a File Explorer entry', flow.hasExplorerButton);
  check('root shows the index key and labels from that JSON',
    flow.rootText.includes(`cf/${ID}/index.json`) &&
    flow.rootText.includes('Mitchell') &&
    flow.rootText.includes('10 Oak Street'));
  check('detail shows stored keys and does not invent a folder tree',
    flow.detailText.includes(`cf/${ID}/plans.json`) &&
    flow.detailText.includes(`media/${PLAN_ID}`) &&
    flow.detailText.includes('media/ph_quick') &&
    !/Distress Photos|Quick Capture|Floor Survey/.test(flow.detailText));
  check('missing media is visibly not stored and cannot be downloaded',
    /Not stored/.test(flow.missingText) && flow.missingDownloads === 0 && !/image\/|application\//.test(flow.missingText));
  check('unsafe reference note is visible', /not a single storage key/.test(flow.note));
  check('unreferenced media is absent', flow.unreferenced === false);
  check('image preview uses the stored image', flow.imageOpened);
  check('JSON preview is the stored text', flow.jsonText === INDEX_TEXT);
  check('PDF preview uses the stored PDF', flow.pdfSrc.startsWith('blob:') && flow.pdfTitle === 'media/ph_quick');
  check('individual download saves the object bytes',
    flow.downloads.some((item) => item.clicked && item.type === 'image/png' && item.size === PNG.length && item.name.includes(PLAN_ID)));
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
