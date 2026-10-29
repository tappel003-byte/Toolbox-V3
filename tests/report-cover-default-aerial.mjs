/**
 * A cover default carries where the boxes sit, never another job's aerial.
 *
 * Run: node tests/report-cover-default-aerial.mjs   (static server on 8765)
 *
 * Tim, Oct 29, 2026, on a job brought in from the old capture apps: the cover
 * showed a screenshot of something that was not this property. "Use this as
 * my default" on the cover saved the whole cover layout, the aerial's media id
 * included, and every report opened for the first time started from it -- so
 * one job's aerial landed on the next job's cover, was carried onto its floor
 * sheets, and was saved and synced as that job's own.
 */
import { createRequire } from 'module';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const aerialPath = join(tmpdir(), 'rb-cover-default-aerial.png');
const aerialPng = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const x = c.getContext('2d');
  x.fillStyle = '#2a7'; x.fillRect(0, 0, 64, 48);
  return c.toDataURL('image/png');
});
await writeFile(aerialPath, Buffer.from(aerialPng.split(',')[1], 'base64'));

await page.evaluate(async () => {
  try { localStorage.clear(); } catch (_) { /* ignore */ }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const jobs = [
    ['job-a', 'Alpha', '1 First St, Santa Fe, NM'],
    ['job-b', 'Bravo', '2 Second St, Edgewood, NM'],
    ['job-c', 'Charlie', '3 Third St, Moriarty, NM'],
    ['job-d', 'Delta', '4 Fourth St, Tijeras, NM'],
  ];
  for (const [id, last, addr] of jobs) {
    const r = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(r);
    r.firstName = 'Pat';
    r.lastName = last;
    r.propertyAddress = addr;
    await window.ToolboxDB.saveCustomerFile(r);
  }
});

async function openCover(id) {
  await page.goto(`${BASE}#/file/${id}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector(
    '.rb-sheet:not(.rb-sheet--thumb) .rb-cover__overview-empty, .rb-sheet:not(.rb-sheet--thumb) .rb-cover__overview-image'),
  { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1500));
}
const coverAerial = () => page.evaluate(() =>
  !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-cover__overview-image'));
const savedCover = (id) => page.evaluate(async (want) => {
  const r = await window.ToolboxDB.getCustomerFile(want);
  const cover = r && r.reportBuilder && r.reportBuilder.coverLayout;
  return cover ? { overviewMediaId: cover.overviewMediaId, boxes: cover.boxes } : null;
}, id);
const storedDefault = () => page.evaluate(() => {
  const raw = localStorage.getItem('toolbox-report-template');
  return raw ? (JSON.parse(raw).coverLayout || null) : null;
});

// ---- 1. Job A: its own aerial, then saved as the default ------------------
await openCover('job-a');
const [chooser] = await Promise.all([
  page.waitForFileChooser({ timeout: 8000 }),
  page.evaluate(() => document.querySelector('[data-rb-cover-overview="pick"]').click()),
]);
await chooser.accept([aerialPath]);
await new Promise((r) => setTimeout(r, 2000));
check('job A shows the aerial placed on it', await coverAerial());
await page.evaluate(() => document.querySelector('[data-rb-template="cover"]').click());
await new Promise((r) => setTimeout(r, 800));
const def = await storedDefault();
const savedA = await savedCover('job-a');
check('the cover default carries no aerial', def && def.overviewMediaId === '', JSON.stringify(def && def.overviewMediaId));
check('but it does carry where the boxes sit',
  def && savedA && JSON.stringify(def.boxes) === JSON.stringify(savedA.boxes),
  JSON.stringify({ def: def && Object.keys(def.boxes || {}), a: savedA && Object.keys(savedA.boxes || {}) }));

// ---- 2. Job B opens fresh from that default ------------------------------
await openCover('job-b');
check('a new report opened from the default shows no other job\'s aerial', !(await coverAerial()));
const savedB = await savedCover('job-b');
check('and does not save one as its own', savedB && savedB.overviewMediaId === '', JSON.stringify(savedB && savedB.overviewMediaId));
check('while it does take the default\'s box positions',
  savedB && JSON.stringify(savedB.boxes) === JSON.stringify(savedA.boxes));

// ---- 3. A default saved before the fix, still holding job A's aerial ------
await page.evaluate((id) => {
  const raw = JSON.parse(localStorage.getItem('toolbox-report-template') || '{}');
  raw.coverLayout = Object.assign({}, raw.coverLayout, { overviewMediaId: id });
  localStorage.setItem('toolbox-report-template', JSON.stringify(raw));
}, savedA.overviewMediaId);
await openCover('job-c');
check('an old default that still names job A\'s aerial does not put it on job C', !(await coverAerial()));
const savedC = await savedCover('job-c');
check('and job C does not save it', savedC && savedC.overviewMediaId === '', JSON.stringify(savedC && savedC.overviewMediaId));

// ---- 4. A report already saved holding job A's aerial ---------------------
await page.evaluate(async (id) => {
  const r = await window.ToolboxDB.getCustomerFile('job-d');
  r.reportBuilder = { coverLayout: { locked: false, boxes: {}, overviewMediaId: id } };
  await window.ToolboxDB.saveCustomerFile(r);
}, savedA.overviewMediaId);
await openCover('job-d');
check('a report that already took job A\'s aerial opens without it', !(await coverAerial()));
await new Promise((r) => setTimeout(r, 1500));
const savedD = await savedCover('job-d');
check('and the wrong aerial is cleared from what it saves', savedD && savedD.overviewMediaId === '', JSON.stringify(savedD && savedD.overviewMediaId));

// ---- 5. Job A keeps its own ------------------------------------------------
await openCover('job-a');
check('job A still shows its own aerial on reopen', await coverAerial());
const savedA2 = await savedCover('job-a');
check('and still saves it', savedA2 && savedA2.overviewMediaId === 'report-cover-overview-job-a',
  JSON.stringify(savedA2 && savedA2.overviewMediaId));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
