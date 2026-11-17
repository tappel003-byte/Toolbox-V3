/**
 * A contour already sent from a level is redrawn on Save when the readings no longer match (a drain marked afterwards).
 * number and its value on the plan, and stays out of the contours, the High / Low and the readings range.
 * (Tim, Nov 13, 2026: a vet's kennel floor drains are cast low on purpose and skew the topo.)
 *
 * Real mouse and keyboard on a phone-sized screen. Run: node tests/floor-survey-drain.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  s.on('error', reject);
});
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/index.html`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch (_) {} await wait(100); }

const FILE = 'fs-layer';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  await ToolboxDB.putMedia('plan-layer', c.toDataURL('image/jpeg', 0.9));
  await ToolboxDB.putMedia('pl_ct_old', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
  const rec = ToolboxApp.blankCustomerFile(id); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Layer'; rec.lastName = 'Test'; rec.propertyAddress = '2 Kennel Way';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Level'; cv.plan = { id: 'plan-layer', width: 800, height: 600 };
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const mk = (n, px, py, v, extra) => ({ id: 'p' + n, floorId: cv.id, index: n, x: px, y: py, value: v, createdAt: n, ...(extra || {}) });
  const points = [
    mk(1, 120, 120, 6.0, { isBasePoint: true, label: 'BP1' }), mk(2, 300, 140, 5.4), mk(3, 520, 150, 5.8), mk(4, 700, 160, 6.2),
    mk(5, 160, 460, 5.3), mk(6, 420, 480, 5.7), mk(7, 680, 470, 6.1),
  ];
  rec.floorSurvey = { id: 'fs-' + id, inspectionDate: '2026-11-13', byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  // a contour sent earlier (no signature: drawn before this feature)
  ToolboxPlanSetup.setContourLayer(rec, cv.id, { id: 'pl_ct_old', width: 800, height: 600, areaName: 'Main Level', pointCount: 7 });
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);
const layerNow = () => page.evaluate(async (id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  return ToolboxPlanSetup.contourLayer(r.planSetup.canvases[0]);
}, FILE);
await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[aria-label^="Elevation stats"]', { timeout: 30000 });
await wait(1200);
const pressSave = async () => {
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Save' || (x.getAttribute('aria-label') || '') === 'Save');
    if (b) b.click(); return !!b;
  });
  await wait(4500);
  return ok;
};
async function tapPlan(fx, fy) {
  const box = await page.evaluate(() => {
    const area = document.querySelector('[data-plan-area]');
    const cs = [...area.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { l: cs.left, t: cs.top, w: cs.width, h: cs.height };
  });
  await page.mouse.click(box.l + box.w * fx, box.t + box.h * fy);
  await wait(600);
}
let L = await layerNow();
check('The level starts with an old, unsigned contour', L && L.id === 'pl_ct_old' && !L.surfaceSig);
check('Save is there to press', await pressSave());
L = await layerNow();
check('Save redrew an old unsigned contour', L && L.id !== 'pl_ct_old' && /^7:[0-9a-z]+$/.test(L.surfaceSig || ''), L && (L.id + ' ' + L.surfaceSig));
const sig7 = L && L.surfaceSig; const id7 = L && L.id;
await pressSave();
L = await layerNow();
check('Saving again with nothing changed leaves it alone', L && L.id === id7, L && L.id);
// Now a drain is marked AFTER the contour was sent.
await page.evaluate(async (id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const pt = Object.values(r.floorSurvey.byCanvasId)[0].points.find((p) => p.index === 5);
  pt.special = 'drain';
  await ToolboxDB.saveCustomerFile(r);
}, FILE);
await page.goto('about:blank');
await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[aria-label^="Elevation stats"]', { timeout: 30000 });
await wait(1200);
await pressSave();
L = await layerNow();
check('After a drain is marked, Save redraws the contour', L && L.id !== id7, L && L.id);
check('The new contour was drawn without the drain (6 surface readings)', L && /^6:[0-9a-z]+$/.test(L.surfaceSig || '') && L.surfaceSig !== sig7, L && L.surfaceSig);
check('It still covers the same boundary', L && L.areaName === 'Main Level', L && L.areaName);
const firstId = L && L.id;
await pressSave();
L = await layerNow();
check('and saving again leaves it alone', L && L.id === firstId, L && L.id);
const old = await page.evaluate(async () => (await ToolboxDB.getMedia('pl_ct_old')) || null);
check('The first picture was cleaned up', old === null);

// A level that never sent a contour does not get one from Save.
await page.evaluate(async (id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = ToolboxPlanSetup.clearContourLayer(r, r.planSetup.canvases[0].id);
  await ToolboxDB.saveCustomerFile(r);
}, FILE);
await page.goto('about:blank');
await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[aria-label^="Elevation stats"]', { timeout: 30000 });
await wait(1200);
await pressSave();
check('A level with no contour is not given one by Save', (await layerNow()) === null);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
