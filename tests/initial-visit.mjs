/**
 * Initial Visit — create offline, persist photo/note/outcomes, Visits list,
 * Make Customer File (move same id), existing files unaffected, jobWalk opens.
 *
 * Run: node tests/initial-visit.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = '/opt/cursor/artifacts';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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

async function waitForServer(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

function startServer(port) {
  return spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}

async function stopServer(server) {
  if (!server || server.exitCode != null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    server.once('exit', resolve);
    setTimeout(resolve, 2000);
  });
}

async function tinyJpegPath() {
  // Minimal valid 1×1 JPEG.
  const bytes = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xDB, 0x00, 0x43, 0x00,
    0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C,
    0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23,
    0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
    0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9,
  ]);
  // Prefer a known-good PNG (browsers decode reliably); fall back to JPEG bytes.
  const png = path.join(OUT, 'iv-test-photo.png');
  try {
    const { readFile } = await import('fs/promises');
    await readFile(png);
    return png;
  } catch (_) {}
  const file = path.join(OUT, 'iv-test-photo.jpg');
  await writeFile(file, bytes);
  return file;
}

await mkdir(OUT, { recursive: true });

const port = await freePort();
const base = `http://127.0.0.1:${port}/index.html`;
const rootUrl = `http://127.0.0.1:${port}/`;
let server = startServer(port);
await waitForServer(port);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

async function clearDb() {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('toolbox', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['customerFiles', 'media'], 'readwrite');
      transaction.objectStore('customerFiles').clear();
      transaction.objectStore('media').clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    try {
      const photoDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('pgg_photos_v1', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
          const d = request.result;
          if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
        };
      });
      await new Promise((resolve, reject) => {
        const tx = photoDb.transaction(['photos'], 'readwrite');
        tx.objectStore('photos').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      photoDb.close();
    } catch (_) {}
  });
}

// ---------- Offline shell: "/" must be mirrored (Job Walk / Initial Visit cold start) ----------
{
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('no SW');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    // Force activate latest.
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    await new Promise((r) => setTimeout(r, 800));
  });
  // Revisit so install caches run against this origin.
  await page.goto(base, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));

  const shellKeys = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.indexOf('toolbox-shell-') === 0) || names[0];
    if (!shell) return { shell: null, keys: [] };
    const cache = await caches.open(shell);
    const reqs = await cache.keys();
    return {
      shell,
      keys: reqs.map((r) => new URL(r.url).pathname),
    };
  });
  check('SW shell includes / and /index.html',
    !!(shellKeys.keys.includes('/') && shellKeys.keys.includes('/index.html')),
    JSON.stringify(shellKeys));
  check('SW shell includes job-walk.js',
    shellKeys.keys.includes('/js/job-walk.js'),
    JSON.stringify(shellKeys.keys.filter((k) => /job-walk|app\.js|tls\.css/.test(k))));
}

await clearDb();

// ---------- Seed ordinary CF (no visit mark) + legacy jobWalk ----------
await page.evaluate(async () => {
  const ordinary = window.ToolboxApp.blankCustomerFile('cf-ordinary-1');
  window.ToolboxPlanSetup.ensurePlanSetup(ordinary);
  ordinary.firstName = 'Ordinary';
  ordinary.lastName = 'Job';
  ordinary.propertyAddress = '100 Main St';
  ordinary.distress = {
    updatedAt: new Date().toISOString(),
    pins: [],
    quickCapture: [],
    jobWalk: {
      updatedAt: new Date().toISOString(),
      notes: [{ id: 'n-legacy', ts: new Date().toISOString(), speaker: 'investigator', text: 'legacy walk note' }],
      videos: [],
    },
  };
  await window.ToolboxDB.saveCustomerFile(ordinary);
});

// ---------- Home UI: + Initial Visit button ----------
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${base}#/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cabinet-visit');
await page.screenshot({ path: `${OUT}/initial-visit-home-phone.png`, fullPage: true });

const homePhone = await page.evaluate(() => {
  const visit = document.querySelector('#cabinet-visit');
  const neu = document.querySelector('#cabinet-new');
  const visitBox = visit && visit.getBoundingClientRect();
  const newBox = neu && neu.getBoundingClientRect();
  return {
    visitLabel: visit && visit.textContent.trim(),
    newLabel: neu && neu.textContent.trim(),
    sideBySide: !!(visitBox && newBox && Math.abs(visitBox.top - newBox.top) < 40),
    overlap: !!(visitBox && newBox &&
      visitBox.left < newBox.right && visitBox.right > newBox.left &&
      visitBox.top < newBox.bottom && visitBox.bottom > newBox.top &&
      visit !== neu),
  };
});
check('Home shows + Initial Visit beside New Customer File',
  homePhone.visitLabel === '+ Initial Visit' && homePhone.newLabel === '+ New Customer File',
  JSON.stringify(homePhone));
check('Home Initial Visit button does not overlap New Customer File',
  !homePhone.overlap, JSON.stringify(homePhone));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${base}#/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cabinet-visit');
await page.screenshot({ path: `${OUT}/initial-visit-home-desktop.png`, fullPage: true });

// ---------- Create visit offline (network off after shell warm) ----------
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${base}#/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cabinet-visit');

await page.setOfflineMode(true);

const visitBtn = await page.$('#cabinet-visit');
const visitBox = await visitBtn.boundingBox();
await page.mouse.click(visitBox.x + visitBox.width / 2, visitBox.y + visitBox.height / 2);
await page.waitForSelector('#iv-form');

await page.click('#iv-first');
await page.keyboard.type('Ava', { delay: 20 });
await page.click('#iv-last');
await page.keyboard.type('Visit', { delay: 20 });
await page.click('#iv-phone');
await page.keyboard.type('555-0142', { delay: 15 });
await page.click('#iv-address');
await page.keyboard.type('12 Yard Lane\nAlbuquerque, NM 87101', { delay: 10 });

const startBtn = await page.$('#iv-start');
const startBox = await startBtn.boundingBox();
await page.mouse.click(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);

await page.waitForSelector('.jw-shell', { timeout: 20000 });
await page.waitForSelector('#jw-visit-meta:not([hidden])', { timeout: 10000 });

const visitId = await page.evaluate(() => {
  const m = location.hash.match(/#\/file\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
});
check('Offline create opens Initial Visit card', !!visitId && !!(await page.$('.jw-shell')));
check('Visit meta (date/outcomes/Make CF) visible on visit card',
  !!(await page.$('#jw-make-cf')) && !!(await page.$('[data-jw-outcome="callBack"]')));

await page.screenshot({ path: `${OUT}/initial-visit-card-phone.png`, fullPage: true });

// Photo via real file input
const jpeg = await tinyJpegPath();
const fileInput = await page.$('#jw-file');
await fileInput.uploadFile(jpeg);
await page.waitForFunction(() => document.querySelectorAll('#jw-grid .jw-card img').length >= 1, {
  timeout: 20000,
});

// Note via real keyboard
await page.click('#jw-note-text');
await page.keyboard.type('Crack at front left corner — call back.', { delay: 8 });
const noteSave = await page.$('#jw-note-save');
const noteBox = await noteSave.boundingBox();
await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
await page.waitForFunction(
  () => /Crack at front left corner/.test(document.querySelector('#jw-notes')?.textContent || ''),
  { timeout: 10000 }
);

// Outcomes + follow-up
await page.click('#jw-out-floor');
await page.click('#jw-out-callback');
await page.evaluate(() => {
  const el = document.querySelector('#jw-follow-up');
  el.value = '2026-11-20';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));

const beforeReload = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const walk = rec && rec.distress && rec.distress.jobWalk;
  return {
    status: rec && rec.status,
    photos: (rec.distress.quickCapture || []).length,
    notes: (walk.notes || []).map((n) => n.text),
    outcomes: walk.outcomes,
    followUpDate: walk.followUpDate,
    count: (await window.ToolboxDB.getAllCustomerFiles()).length,
  };
}, visitId);
check('Offline photo+note+outcomes saved before reload',
  beforeReload.status === 'visit' &&
  beforeReload.photos >= 1 &&
  beforeReload.notes.some((t) => /Crack at front left/.test(t)) &&
  beforeReload.outcomes.recommendFloor === true &&
  beforeReload.outcomes.callBack === true &&
  beforeReload.followUpDate === '2026-11-20',
  JSON.stringify(beforeReload));

// Cold-ish reload offline via "/" start_url style
await page.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction(() => window.ToolboxDB && window.ToolboxApp, { timeout: 20000 });
await page.goto(`${rootUrl}index.html#/file/${encodeURIComponent(visitId)}/job-walk`, {
  waitUntil: 'domcontentloaded',
  timeout: 20000,
});
await page.waitForSelector('.jw-shell', { timeout: 20000 });
await page.waitForFunction(
  () => /Crack at front left/.test(document.querySelector('#jw-notes')?.textContent || ''),
  { timeout: 15000 }
);

const afterReload = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const walk = rec.distress.jobWalk;
  return {
    status: rec.status,
    photos: (rec.distress.quickCapture || []).length,
    noteOk: (walk.notes || []).some((n) => /Crack at front left/.test(n.text || '')),
    floor: !!(walk.outcomes && walk.outcomes.recommendFloor),
    callBack: !!(walk.outcomes && walk.outcomes.callBack),
    followUpDate: walk.followUpDate,
    photoShown: document.querySelectorAll('#jw-grid .jw-card img').length,
    floorChecked: !!document.querySelector('#jw-out-floor')?.checked,
  };
}, visitId);
check('Offline reload keeps photo+note+outcomes+follow-up',
  afterReload.status === 'visit' &&
  afterReload.photos >= 1 &&
  afterReload.noteOk &&
  afterReload.floor &&
  afterReload.callBack &&
  afterReload.followUpDate === '2026-11-20' &&
  afterReload.photoShown >= 1 &&
  afterReload.floorChecked,
  JSON.stringify(afterReload));

await page.setOfflineMode(false);

// ---------- Visits list vs Customer Files ----------
await page.goto(`${base}#/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cabinet-visits-title');
const lists = await page.evaluate(() => {
  const visitsTitle = document.querySelector('#cabinet-visits-title');
  const visitsList = document.querySelector('#cabinet-visits-list');
  const deviceList = document.querySelector('#cabinet-list');
  const visitRows = [...(visitsList?.querySelectorAll('[data-customer-file-id]') || [])]
    .map((el) => el.getAttribute('data-customer-file-id'));
  const jobRows = [...(deviceList?.querySelectorAll('[data-customer-file-id]') || [])]
    .map((el) => el.getAttribute('data-customer-file-id'));
  return {
    visitsHeading: visitsTitle && !visitsTitle.hidden && visitsTitle.textContent.trim(),
    visitRows,
    jobRows,
    visitLabels: [...(visitsList?.querySelectorAll('.cabinet-row__plan-state') || [])]
      .map((el) => el.textContent.trim()),
  };
});
check('Visits heading shown under On this device',
  lists.visitsHeading === 'Visits', JSON.stringify(lists));
check('Visit appears under Visits, not under Customer Files jobs',
  lists.visitRows.includes(visitId) && !lists.jobRows.includes(visitId) &&
  lists.jobRows.includes('cf-ordinary-1'),
  JSON.stringify(lists));
check('Ordinary file without visit mark stays a job row',
  lists.jobRows.includes('cf-ordinary-1') && !lists.visitRows.includes('cf-ordinary-1'),
  JSON.stringify(lists));

await page.screenshot({ path: `${OUT}/initial-visit-visits-list-phone.png`, fullPage: true });

// File Cabinet Visits group — mock browseCabinet so paintList shows headings.
await page.evaluate(() => {
  if (!window.ToolboxSync) window.ToolboxSync = {};
  window.ToolboxSync.syncApiBase = function () { return 'https://sync.test'; };
  window.ToolboxSync.browseCabinet = async function () {
    return {
      entries: [
        {
          id: 'cab-job-1',
          displayName: 'Cabinet Job',
          propertyAddress: '1 Job St',
          status: '',
          availability: 'available',
          presence: 'cloud-only',
        },
        {
          id: 'cab-visit-1',
          displayName: 'Cabinet Visit',
          propertyAddress: '2 Visit Rd',
          status: 'visit',
          availability: 'available',
          presence: 'cloud-only',
        },
      ],
    };
  };
});
await page.goto(`${base}#/cabinet`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
const cabinetGroups = await page.evaluate(() => {
  const titles = [...document.querySelectorAll('.cabinet-section-title')]
    .map((el) => el.textContent.trim());
  return {
    titles,
    hasVisits: titles.includes('Visits'),
    hasJobs: titles.includes('Customer Files'),
    text: document.querySelector('#app')?.innerText || '',
  };
});
check('File Cabinet shows Visits group separately',
  cabinetGroups.hasVisits && cabinetGroups.hasJobs,
  JSON.stringify(cabinetGroups.titles));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.screenshot({ path: `${OUT}/initial-visit-cabinet-visits-desktop.png`, fullPage: true });

// File Explorer Visits — mock exploreListFiles and remount
await page.evaluate(() => {
  window.ToolboxSync.exploreListFiles = async function () {
    return {
      files: [
        { id: 'ex-job', displayName: 'Explorer Job', propertyAddress: '9 Job', createdAt: '2026-01-01' },
        { id: 'ex-visit', displayName: 'Explorer Visit', propertyAddress: '8 Visit', status: 'visit', createdAt: '2026-11-11' },
      ],
    };
  };
});
await page.goto(`${base}#/explore`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
const explorerUi = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.explorer-tree__label, .explorer-phone-group__label')]
    .map((el) => el.textContent.trim());
  return {
    labels,
    hasVisits: labels.some((t) => t === 'Visits'),
    body: (document.body.innerText || '').slice(0, 500),
  };
});
check('File Explorer shows Visits folder/group',
  explorerUi.hasVisits, JSON.stringify(explorerUi));
await page.screenshot({ path: `${OUT}/initial-visit-explorer-visits-desktop.png`, fullPage: true });

// ---------- Make Customer File = MOVE same id ----------
await page.goto(`${base}#/file/${encodeURIComponent(visitId)}/job-walk`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#jw-make-cf');
const countBefore = await page.evaluate(async () =>
  (await window.ToolboxDB.getAllCustomerFiles()).length);

const makeBtn = await page.$('#jw-make-cf');
const makeBox = await makeBtn.boundingBox();
await page.mouse.click(makeBox.x + makeBox.width / 2, makeBox.y + makeBox.height / 2);

await page.waitForFunction((id) => {
  return location.hash.indexOf('#/file/' + encodeURIComponent(id)) === 0 &&
    location.hash.indexOf('/job-walk') === -1;
}, { timeout: 15000 }, visitId);

const afterMake = await page.evaluate(async (id) => {
  const all = await window.ToolboxDB.getAllCustomerFiles();
  const rec = all.find((r) => r.id === id);
  const walk = rec && rec.distress && rec.distress.jobWalk;
  return {
    count: all.length,
    status: rec && rec.status,
    hasStatusKey: !!(rec && Object.prototype.hasOwnProperty.call(rec, 'status')),
    noteOk: !!(walk && (walk.notes || []).some((n) => /Crack at front left/.test(n.text || ''))),
    photos: (rec.distress.quickCapture || []).length,
    hash: location.hash,
    recommendFloor: !!(walk && walk.outcomes && walk.outcomes.recommendFloor),
  };
}, visitId);

check('Make Customer File keeps record count (move, not copy)',
  afterMake.count === countBefore, JSON.stringify({ countBefore, afterMake }));
check('Make Customer File clears visit mark on same id',
  afterMake.status !== 'visit' && !afterMake.hasStatusKey, JSON.stringify(afterMake));
check('Make Customer File preserves notes and photos',
  afterMake.noteOk && afterMake.photos >= 1, JSON.stringify(afterMake));
check('Make Customer File lands on Floor Survey when recommended',
  afterMake.hash === `#/file/${encodeURIComponent(visitId)}/floor` ||
  afterMake.hash === `#/file/${visitId}/floor`,
  afterMake.hash);

// After move, home lists it under jobs not Visits.
// Floor Survey may open without a plan (stub); force a clean home remount.
await page.goto(`${base}#/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cabinet-list', { timeout: 15000 });
await page.waitForFunction(() => {
  const jobs = document.querySelectorAll('#cabinet-list [data-customer-file-id]').length;
  const visits = document.querySelectorAll('#cabinet-visits-list [data-customer-file-id]').length;
  return jobs + visits > 0;
}, { timeout: 15000 });
const afterLists = await page.evaluate((id) => {
  const visitsList = document.querySelector('#cabinet-visits-list');
  const deviceList = document.querySelector('#cabinet-list');
  const visitRows = [...(visitsList?.querySelectorAll('[data-customer-file-id]') || [])]
    .map((el) => el.getAttribute('data-customer-file-id'));
  const jobRows = [...(deviceList?.querySelectorAll('[data-customer-file-id]') || [])]
    .map((el) => el.getAttribute('data-customer-file-id'));
  const visitsTitle = document.querySelector('#cabinet-visits-title');
  return {
    visitRows,
    jobRows,
    visitsHidden: !visitsTitle || visitsTitle.hidden || visitRows.length === 0,
    statusStillVisit: null,
  };
}, visitId);
afterLists.statusStillVisit = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return rec && rec.status === 'visit';
}, visitId);
check('Moved file appears under Customer Files jobs, not Visits',
  afterLists.jobRows.includes(visitId) && !afterLists.visitRows.includes(visitId) &&
  afterLists.statusStillVisit === false,
  JSON.stringify(afterLists));

// ---------- Existing jobWalk on ordinary file still opens ----------
await page.goto(`${base}#/file/cf-ordinary-1/job-walk`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.jw-shell', { timeout: 15000 });
const legacy = await page.evaluate(() => {
  return {
    title: document.querySelector('#jw-title')?.textContent.trim(),
    note: document.querySelector('#jw-notes')?.textContent || '',
    makeHiddenMeta: !!document.querySelector('#jw-visit-meta')?.hidden,
  };
});
check('Existing jobWalk data still opens as Initial Visit screen',
  /legacy walk note/.test(legacy.note), JSON.stringify(legacy));
check('Ordinary file does not show visit Make Customer File panel',
  legacy.makeHiddenMeta, JSON.stringify(legacy));

// Distress recommend route probe
await page.evaluate(async () => {
  const rec = window.ToolboxApp.blankInitialVisit('iv-distress-route');
  rec.firstName = 'Distress';
  rec.lastName = 'Route';
  rec.distress.jobWalk.outcomes.recommendDistress = true;
  await window.ToolboxDB.saveCustomerFile(rec);
});
await page.goto(`${base}#/file/iv-distress-route/job-walk`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#jw-make-cf');
await page.click('#jw-make-cf');
await page.waitForFunction(() => /\/distress/.test(location.hash), { timeout: 10000 });
const distressHash = await page.evaluate(() => location.hash);
check('Make Customer File with distress recommendation opens Distress',
  /#\/file\/iv-distress-route\/distress/.test(distressHash), distressHash);

// Default home route
await page.evaluate(async () => {
  const rec = window.ToolboxApp.blankInitialVisit('iv-home-route');
  rec.firstName = 'Home';
  rec.lastName = 'Route';
  await window.ToolboxDB.saveCustomerFile(rec);
});
await page.goto(`${base}#/file/iv-home-route/job-walk`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#jw-make-cf');
await page.click('#jw-make-cf');
await page.waitForFunction(() => location.hash === '#/file/iv-home-route', { timeout: 10000 });
const homeHash = await page.evaluate(() => location.hash);
check('Make Customer File without survey recommendation opens CF home',
  homeHash === '#/file/iv-home-route', homeHash);

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${base}#/`, { waitUntil: 'networkidle0' });
await page.screenshot({ path: `${OUT}/initial-visit-home-after-move-desktop.png`, fullPage: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
await stopServer(server);
process.exit(failed.length ? 1 : 0);
