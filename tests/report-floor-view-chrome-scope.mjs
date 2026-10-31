/**
 * A view's colour scale stays on its own sheet.
 *
 * Run: node tests/report-floor-view-chrome-scope.mjs   (static server on 8765)
 *
 * The report keeps ONE floor layout record (DECIDED Tim, Oct 22, 2026). A
 * multi-view sheet keeps its colour scale and readings pill in that record
 * under legend-<viewId> / pill-<viewId>; a one-view sheet draws the
 * per-boundary slots, legend-0, pill-0. The one-view path drew every legend
 * in the record, so turning a view's scale on, on ONE slide, stacked a second
 * identical scale on every one-view slide in the book -- and removing the
 * view left it there. Found while repairing the flexible-views acceptance
 * test, whose drag moved the top copy while the one underneath stayed put
 * (CLAUDE-017).
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-view-chrome-scope';
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1700, height: 1050 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Dup'; rec.lastName = 'Legend'; rec.propertyAddress = '1 Main';
  rec.planSetup.canvases[0].name = 'Main Level';
  rec.planSetup.canvases.push(window.ToolboxPlanSetup.blankCanvas('Basement'));
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const by = {};
  for (let i = 0; i < 2; i++) {
    const cv = rec.planSetup.canvases[i];
    await window.ToolboxDB.putMedia('p' + i, c.toDataURL('image/png'));
    cv.plan = { id: 'p' + i, width: 1200, height: 900 };
    const pts = []; let n = 0;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { n++; pts.push({ id: i + '_' + n, floorId: cv.id, index: n, x: 120 + k * 300, y: 150 + r * 280, value: 7 + ((n * 7) % 13) / 10 }); }
    by[cv.id] = { canvasId: cv.id, points: pts, areas: [{ id: 'a' + i, name: cv.name, polygon: poly, createdAt: 1 }], boundary: poly };
  }
  rec.floorSurvey = { id: 'fs-d', inspectionDate: '2026-10-09', byCanvasId: by };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]').length >= 2, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const open = async (re) => {
  await page.evaluate((r) => { const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')].find((x) => new RegExp(r, 'i').test(x.textContent || '')); t && t.click(); }, re);
  await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="topo"]'), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
};
const count = () => page.evaluate(() => [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-kind="legend"], .rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]')]
  .map((e) => e.getAttribute('data-rb-floor-box')));
const book = () => page.evaluate(async (id) => {
  const r = await window.ToolboxDB.getCustomerFile(id);
  return ((r.reportBuilder || {}).floorLayout || {}).overlays?.map((o) => o.id) || [];
}, FILE);
await open('Basement');
const basementBefore = await count();
check('a one-view sheet opens with one colour scale', JSON.stringify(basementBefore) === '["legend-0"]', JSON.stringify(basementBefore));
await open('Main');

await page.evaluate(() => document.querySelector('[data-rb-floor-task="layout"]')?.click());
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => document.querySelector('[data-rb-floor-view="add"]')?.click());
await page.waitForFunction(() => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]').length >= 2, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => document.querySelector('[data-rb-floor-task="topo"]')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  document.querySelector('[data-rb-rail-tab="accessories"]')?.click()
    || document.querySelector('[data-rb-rail-tab="legendhl"]')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Accessories"] [role="tab"]')];
  tabs.find((t) => /Legend/.test((t.textContent || '').trim()))?.click();
});
await new Promise((r) => setTimeout(r, 400));
const btns = await page.evaluate(() => [...document.querySelectorAll('[data-rb-floor-view-chrome]')].map((b) => b.getAttribute('data-rb-floor-view-chrome')));
await page.evaluate(() => document.querySelector('[data-rb-floor-view-chrome="legend-on"]')?.click());
await new Promise((r) => setTimeout(r, 2500));
const mainTwo = await count();
const bookTwo = await book();
check('turning on a view\'s colour scale draws it on that sheet',
  btns.includes('legend-on') && mainTwo.includes('legend-v0'), JSON.stringify({ btns, mainTwo }));
check('and stores its place in the one layout record, under the view',
  bookTwo.includes('legend-v0') && bookTwo.includes('legend-0'), JSON.stringify(bookTwo));
await open('Basement');
const basementAfter = await count();
check('another one-view sheet still has exactly one colour scale',
  JSON.stringify(basementAfter) === '["legend-0"]', JSON.stringify(basementAfter));
// Back to Main, remove the added view.
await open('Main');
await page.evaluate(() => document.querySelector('[data-rb-floor-task="layout"]')?.click());
await new Promise((r) => setTimeout(r, 500));
const rm = await page.evaluate(() => { const b = document.querySelector('[data-rb-floor-view="remove"]'); if (b) b.click(); return !!b; });
await new Promise((r) => setTimeout(r, 2500));
const mainOne = await count();
check('removing the view leaves the sheet with one colour scale, not two',
  rm && JSON.stringify(mainOne) === '["legend-0"]', JSON.stringify({ rm, mainOne }));
await open('Basement');
// And on paper: every one-view sheet in the printed deck has one scale.
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 800));
const printed = await page.evaluate(() => [...document.querySelectorAll('.rb-print .rb-sheet[data-page-type="floor"], .rb-print .rb-sheet')]
  .filter((s) => s.querySelector('[data-rb-floor-stage]'))
  .map((s) => s.querySelectorAll('[data-rb-floor-kind="legend"]').length));
check('the printed deck has one colour scale on each one-view sheet',
  printed.length >= 2 && printed.every((n) => n === 1), JSON.stringify(printed));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
