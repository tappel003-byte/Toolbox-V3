/**
 * A Pictures caption nobody has typed in follows the Distress pin's text when the pin is corrected in Distress;
 * a caption typed in Report Builder is never overwritten (Tim, Nov 25, 2026).
 * Run: node tests/report-caption-follows-distress.mjs   (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 1440, height: 960 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (png) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('toolbox', 2); r.onerror = () => rej(r.error); r.onsuccess = () => res(r.result); });
  await new Promise((res, rej) => { const t = db.transaction(['customerFiles', 'media'], 'readwrite'); t.objectStore('customerFiles').clear(); t.objectStore('media').clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  const record = window.ToolboxApp.blankCustomerFile('rb-follow');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Ada'; record.lastName = 'Mitchell'; record.propertyAddress = '15 Picture Lane';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-follow', png);
  record.planSetup.canvases[0].plan = { id: 'plan-follow', width: 400, height: 300 };
  const pins = [];
  for (let i = 1; i <= 3; i += 1) {
    await window.ToolboxDB.putMedia(`ph-f-${i}`, png);
    pins.push({ id: `pin-${i}`, num: i, x: 0.2 * i, y: 0.4, canvasId, location: `Room ${i}`, description: `Original text ${i}`, photos: [{ id: `ph-f-${i}` }] });
  }
  record.distress = { mode: 'internal', startNum: 1, nextNum: 4, activeCanvasId: canvasId, pins };
  await window.ToolboxDB.saveCustomerFile(record);
}, TINY_PNG);

const openReport = async () => {
  await page.goto('about:blank');
  await page.goto(`${BASE}#/file/rb-follow`, { waitUntil: 'networkidle0' });
  await page.goto(`${BASE}#/file/rb-follow/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 15000 });
  await wait(2500);
};
const captionsInDb = () => page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-follow');
  const p = (rec.reportBuilder?.pages || []).find((x) => x.type === 'pictures');
  return { caps: p?.reportText?.captions || {}, seeds: p?.reportText?.captionSeeds || {} };
});

await openReport();
let db = await captionsInDb();
check('The report starts with the pins\' text and remembers where it came from', db.caps['ph-f-2'] === 'Original text 2' && db.seeds['ph-f-2'] === 'Original text 2', JSON.stringify(db));

// type into caption 3 in Report Builder
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="pictures-"]').click());
await wait(2500);
await page.evaluate(() => { const f = document.querySelector('[data-rb-caption="ph-f-3"]'); f.focus(); f.value = 'Typed in the report'; f.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 10000 });

// correct pins 2 and 3 in Distress
await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-follow');
  rec.distress.pins[1].description = 'Corrected in Distress 2';
  rec.distress.pins[2].description = 'Corrected in Distress 3';
  await window.ToolboxDB.saveCustomerFile(rec);
});
await openReport();
db = await captionsInDb();
check('A caption nobody typed in follows the corrected pin text', db.caps['ph-f-2'] === 'Corrected in Distress 2', db.caps['ph-f-2']);
check('A caption typed in Report Builder is left alone', db.caps['ph-f-3'] === 'Typed in the report', db.caps['ph-f-3']);
check('An untouched pin is unchanged', db.caps['ph-f-1'] === 'Original text 1');

// a report saved before seeds were kept: its captions follow the pins from then on; differing wording is kept aside
await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-follow');
  const p = rec.reportBuilder.pages.find((x) => x.type === 'pictures');
  delete p.reportText.captionSeeds;
  p.reportText.captions['ph-f-2'] = 'Some older wording';
  await window.ToolboxDB.saveCustomerFile(rec);
});
await openReport();
await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-follow');
  rec.distress.pins[0].description = 'Pin one changed again';
  rec.distress.pins[1].description = 'Pin two changed again';
  await window.ToolboxDB.saveCustomerFile(rec);
});
await openReport();
db = await captionsInDb();
check('Without remembered seeds, a caption in step with its pin follows it from then on', db.caps['ph-f-1'] === 'Pin one changed again', db.caps['ph-f-1']);
check('and older wording that differs is replaced by the pin text', db.caps['ph-f-2'] === 'Pin two changed again', db.caps['ph-f-2']);
const bk = await page.evaluate(async () => { const r = await window.ToolboxDB.getCustomerFile('rb-follow'); return r.reportBuilder.pages.find((x) => x.type === 'pictures').reportText.captionBackup || {}; });
check('nothing is lost: the replaced wording is kept in captionBackup', bk['ph-f-2'] === 'Some older wording', JSON.stringify(bk));
check('No JavaScript errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
