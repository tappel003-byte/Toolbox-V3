/**
 * A save never acknowledges text it did not write.
 *
 * Run: node tests/autosave-latest-edit.mjs   (static server on 8765)
 *
 * Both Report Builder and Customer Information snapshot the document, start
 * asynchronous work, and then cleared `dirty` when that work finished --
 * unconditionally. Anything typed during the wait was not in the snapshot,
 * so clearing the flag threw it away: the armed timer saw a clean document
 * and returned, and the page said "Saved" over text that had never been
 * written. Report Builder's wait is a full IndexedDB read of the borrowed
 * components on EVERY autosave, so the window is an ordinary round trip,
 * not an exotic one.
 *
 * The last keystroke of a sentence landing in that window, and then the
 * person stopping, is how a report loses its last line.
 *
 * Both timing orders are tested, because they fail differently:
 *   A. the save finishes before the next debounce fires
 *   B. the next debounce fires while the first save is still pending
 * and navigation, because leaving is when it would be noticed too late.
 */
import { createRequire } from 'module';

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

// A controllable save: each call parks until it is released by index.
const ARM = () => page.evaluate(() => {
  const db = window.ToolboxDB;
  if (!window.__realSave) window.__realSave = db.saveCustomerFile.bind(db);
  window.__held = [];
  window.__writes = [];
  window.__statusAtRelease = [];
  db.saveCustomerFile = function (rec) {
    window.__writes.push(JSON.stringify(rec));
    return new Promise((resolve, reject) => {
      window.__held.push(() => window.__realSave(rec).then(resolve, reject));
    });
  };
});
const RELEASE = (n) => page.evaluate(async (count) => {
  const take = count == null ? window.__held.length : count;
  for (let i = 0; i < take; i += 1) {
    const fn = window.__held.shift();
    if (fn) await fn();
  }
}, n);
const DISARM = () => page.evaluate(() => {
  if (window.__realSave) window.ToolboxDB.saveCustomerFile = window.__realSave;
});

async function seedReport(id, name) {
  await page.evaluate(async (fid, fname) => {
    const rec = window.ToolboxApp.blankCustomerFile(fid);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = fname; rec.lastName = 'Autosave';
    rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
    await window.ToolboxDB.saveCustomerFile(rec);
  }, id, name);
}

async function openReport(id) {
  await page.goto(`${BASE}#/file/${id}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 6000));
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
      .find((x) => /discussion/i.test(x.getAttribute('aria-label') || ''));
    if (t) t.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
}

const typeInto = (text) => page.evaluate((t) => {
  const field = document.querySelector('.rb-stage .rb-discussion__body [data-rb-rich]')
    || document.querySelector('.rb-stage [data-rb-rich]');
  if (!field) return false;
  field.focus();
  field.textContent = t;
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return true;
}, text);

const statusNow = () => page.evaluate(() => ({
  save: (document.querySelector('#rb-save-status') || {}).textContent || '',
  file: (document.querySelector('#rb-file-status') || {}).textContent || '',
}));

const storedText = (id) => page.evaluate(async (fid) => {
  const rec = await window.ToolboxDB.getCustomerFile(fid);
  return JSON.stringify((rec && rec.reportBuilder) || {});
}, id);

// ---------------------------------------------------------------- order A
// The held save finishes BEFORE the next debounce fires.
await seedReport('rb-autosave-a', 'OrderA');
await openReport('rb-autosave-a');
await ARM();
await typeInto('First edit.');
await new Promise((r) => setTimeout(r, 1500));        // its autosave fires and parks
await typeInto('Second edit while saving.');
await new Promise((r) => setTimeout(r, 150));         // still inside the debounce
await RELEASE(1);
const midA = await statusNow();
await new Promise((r) => setTimeout(r, 400));
await RELEASE();                                      // the follow-up save, if any
await new Promise((r) => setTimeout(r, 2500));
await RELEASE();
await new Promise((r) => setTimeout(r, 1200));
const afterA = await storedText('rb-autosave-a');
const writesA = await page.evaluate(() => window.__writes.length);
await DISARM();

check('A: the newer edit is on disk, not the snapshot that was in flight',
  afterA.indexOf('Second edit while saving.') >= 0, afterA.slice(0, 0) +
  `second:${afterA.indexOf('Second edit while saving.') >= 0} first-only:${afterA.indexOf('First edit.') >= 0 && afterA.indexOf('Second') < 0}`);
check('A: a second write actually happened', writesA >= 2, String(writesA));
check('A: the status does not say Saved while newer text is unwritten',
  !/^Saved\b/.test(midA.save.trim()) && midA.file !== 'Saved',
  JSON.stringify(midA));

// ---------------------------------------------------------------- order B
// The next debounce fires WHILE the first save is still pending.
await seedReport('rb-autosave-b', 'OrderB');
await openReport('rb-autosave-b');
await ARM();
await typeInto('First edit.');
await new Promise((r) => setTimeout(r, 1500));        // save 1 parks
await typeInto('Second edit while saving.');
await new Promise((r) => setTimeout(r, 1600));        // save 2 fires while 1 is held
const parked = await page.evaluate(() => window.__held.length);
await RELEASE();                                      // release 1, then 2
await new Promise((r) => setTimeout(r, 2000));
await RELEASE();
await new Promise((r) => setTimeout(r, 1200));
const afterB = await storedText('rb-autosave-b');
await DISARM();

check('B: a save started while the first was still pending', parked >= 2,
  `${parked} parked`);
check('B: the newer edit is the one left on disk',
  afterB.indexOf('Second edit while saving.') >= 0,
  `second:${afterB.indexOf('Second edit while saving.') >= 0}`);

// ------------------------------------------------------------- navigation
// Leaving while an edit is still in flight must not strand it.
await seedReport('rb-autosave-n', 'Nav');
await openReport('rb-autosave-n');
await ARM();
await typeInto('Typed then left.');
await new Promise((r) => setTimeout(r, 1500));
await typeInto('Typed then left, and edited again.');
await new Promise((r) => setTimeout(r, 150));
await RELEASE(1);
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => { const b = document.querySelector('#rb-back'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 600));
await RELEASE();
await new Promise((r) => setTimeout(r, 2500));
await RELEASE();
await new Promise((r) => setTimeout(r, 1200));
const afterN = await storedText('rb-autosave-n');
await DISARM();
check('navigation does not strand the edit made during a save',
  afterN.indexOf('Typed then left, and edited again.') >= 0,
  `kept:${afterN.indexOf('Typed then left, and edited again.') >= 0}`);

// ------------------------------------------------- Customer Information
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const rec = window.ToolboxApp.blankCustomerFile('ci-autosave');
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Carl'; rec.lastName = 'Info';
  rec.propertyAddress = '15 Rabbitbrush';
  await window.ToolboxDB.saveCustomerFile(rec);
});
await page.goto(`${BASE}#/file/ci-autosave/edit/customer`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const f = document.querySelector('input[name="firstName"], #cf-first-name, [data-field="firstName"]');
  return !!f;
}, { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

const ciField = await page.evaluate(() => {
  const el = document.querySelector('input[name="firstName"], #cf-first-name, [data-field="firstName"]')
    || [...document.querySelectorAll('input[type="text"]')][0];
  return el ? (el.id || el.name || 'first text input') : null;
});
const ciType = (v) => page.evaluate((val) => {
  const el = document.querySelector('input[name="firstName"], #cf-first-name, [data-field="firstName"]')
    || [...document.querySelectorAll('input[type="text"]')][0];
  if (!el) return false;
  el.focus();
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, v);

if (!ciField) {
  check('Customer Information field was found', false, 'no text input on the edit view');
} else {
  await ARM();
  await ciType('FirstCI');
  await new Promise((r) => setTimeout(r, 1500));
  await ciType('SecondCI');
  await new Promise((r) => setTimeout(r, 150));
  await RELEASE(1);
  await new Promise((r) => setTimeout(r, 400));
  await RELEASE();
  await new Promise((r) => setTimeout(r, 2500));
  await RELEASE();
  await new Promise((r) => setTimeout(r, 1200));
  const ciStored = await page.evaluate(async () => {
    const rec = await window.ToolboxDB.getCustomerFile('ci-autosave');
    return (rec && rec.firstName) || '';
  });
  await DISARM();
  check('Customer Information keeps the newer edit too', ciStored === 'SecondCI',
    `stored firstName = ${JSON.stringify(ciStored)} (field: ${ciField})`);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
