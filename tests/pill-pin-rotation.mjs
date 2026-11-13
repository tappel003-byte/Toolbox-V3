/**
 * The Floor Survey H / L / Δ pill stays where it is put when the screen turns.
 *
 * Tim, Nov 13, 2026: "High low delta pill does not lock in place when you move between portrait and
 * landscape on a phone or a tablet... If I move it to lower left corner basically it needs to pin. Its
 * relation to the plan." The position was saved as screen pixels and re-clamped on every rotation, so it
 * drifted. It is now saved as a share of the room the chip has to move in over the plan area.
 *
 * Run: node tests/pill-pin-rotation.mjs  (static server on 8765). Real mouse throughout.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'fs-pill-pin';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', async (d) => { await d.accept(); });
const PORTRAIT = { width: 390, height: 844, isMobile: true, hasTouch: false, deviceScaleFactor: 1 };
const LANDSCAPE = { width: 844, height: 390, isMobile: true, hasTouch: false, deviceScaleFactor: 1 };
await page.setViewport(PORTRAIT);
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await ToolboxDB.putMedia('plan-pp', c.toDataURL('image/jpeg', 0.9));
  const rec = ToolboxApp.blankCustomerFile(id); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Pill'; rec.lastName = 'Pin'; rec.propertyAddress = '9 Pin Lane';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Floor'; cv.plan = { id: 'plan-pp', width: 800, height: 600 };
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'p' + n, floorId: cv.id, index: n, x: 100 + n * 90, y: 200 + (n % 2) * 60, value: 5 + n * 0.3 }));
  rec.floorSurvey = { id: 'fs-' + id, inspectionDate: '2026-11-13', byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Floor', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

const chipSel = '[aria-label^="Elevation stats"]';
async function open() {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(chipSel, { timeout: 30000 });
  await wait(1000);
}
const geom = () => page.evaluate((sel) => {
  const chip = document.querySelector(sel);
  const area = document.querySelector('[data-plan-area]');
  if (!chip || !area) return null;
  const c = chip.getBoundingClientRect(); const a = area.getBoundingClientRect();
  return {
    left: +(c.left - a.left).toFixed(1), right: +(a.right - c.right).toFixed(1), top: +(c.top - a.top).toFixed(1), bottom: +(a.bottom - c.bottom).toFixed(1),
    cx: +((c.left + c.width / 2) - (a.left + a.width / 2)).toFixed(1), w: Math.round(c.width), h: Math.round(c.height), aw: Math.round(a.width), ah: Math.round(a.height),
    inside: c.left >= a.left - 1 && c.right <= a.right + 1 && c.top >= a.top - 1 && c.bottom <= a.bottom + 1,
  };
}, chipSel);
async function dragChipTo(where) {
  const g = await page.evaluate((sel) => {
    const chip = document.querySelector(sel); const area = document.querySelector('[data-plan-area]');
    const c = chip.getBoundingClientRect(); const a = area.getBoundingClientRect();
    return { cx: c.left + c.width / 2, cy: c.top + c.height / 2, aL: a.left, aR: a.right, aT: a.top, aB: a.bottom, w: c.width, h: c.height };
  }, chipSel);
  const target = {
    'lower-left': [g.aL + g.w / 2, g.aB - g.h / 2],
    'upper-right': [g.aR - g.w / 2, g.aT + g.h / 2],
    'bottom-middle': [(g.aL + g.aR) / 2, g.aB - g.h / 2],
  }[where];
  await page.mouse.move(g.cx, g.cy); await page.mouse.down();
  await page.mouse.move((g.cx + target[0]) / 2, (g.cy + target[1]) / 2, { steps: 6 });
  await page.mouse.move(target[0] - (where.includes('left') ? 30 : where.includes('right') ? -30 : 0), target[1] + (where.includes('lower') || where.includes('bottom') ? 30 : -30), { steps: 6 }); // overshoot: must clamp inside
  await page.mouse.up();
  await wait(700);
}
const near = (n, target = 0, tol = 3) => Math.abs(n - target) <= tol;

await open();
const startGeom = await geom();
check('The pill is on the capture screen inside the plan area', !!startGeom && startGeom.inside, JSON.stringify(startGeom));

// ---- lower-left corner, then turn the screen
await dragChipTo('lower-left');
let g = await geom();
check('Dragged to the lower-left corner it sits in that corner of the plan area, inside it', near(g.left) && near(g.bottom) && g.inside, JSON.stringify(g));
await page.setViewport(LANDSCAPE); await wait(1000);
g = await geom();
check('Turned to landscape it is still in the lower-left corner', near(g.left) && near(g.bottom) && g.inside, JSON.stringify(g));
await page.setViewport(PORTRAIT); await wait(1000);
g = await geom();
check('Turned back to portrait it is still in the lower-left corner', near(g.left) && near(g.bottom) && g.inside, JSON.stringify(g));
for (let i = 0; i < 3; i += 1) {
  await page.setViewport(LANDSCAPE); await wait(500);
  await page.setViewport(PORTRAIT); await wait(500);
}
g = await geom();
check('Six more turns later it has not drifted', near(g.left) && near(g.bottom) && g.inside, JSON.stringify(g));

// ---- saved as a share of the room, not as screen pixels
const saved = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('stats-chip-pos:'));
  return key ? { key, value: JSON.parse(localStorage.getItem(key)) } : null;
});
check('The saved position is a share of the plan area, not pixels',
  !!saved && typeof saved.value.fx === 'number' && typeof saved.value.fy === 'number' && !('x' in saved.value) && near(saved.value.fx, 0, 0.03) && near(saved.value.fy, 1, 0.03), JSON.stringify(saved));

// ---- survives a reload
await open();
g = await geom();
check('After reopening the screen it is still in the lower-left corner', near(g.left) && near(g.bottom) && g.inside, JSON.stringify(g));

// ---- upper-right and bottom-middle stay put through a turn too
await dragChipTo('upper-right');
g = await geom();
check('Dragged to the upper-right corner it sits there', near(g.right) && near(g.top) && g.inside, JSON.stringify(g));
await page.setViewport(LANDSCAPE); await wait(1000);
g = await geom();
check('and stays in the upper-right corner when turned', near(g.right) && near(g.top) && g.inside, JSON.stringify(g));
await page.setViewport(PORTRAIT); await wait(800);
await dragChipTo('bottom-middle');
g = await geom();
check('Bottom-middle: centred along the bottom edge', near(g.cx, 0, 4) && near(g.bottom) && g.inside, JSON.stringify(g));
await page.setViewport(LANDSCAPE); await wait(1000);
g = await geom();
check('and still bottom-middle when turned', near(g.cx, 0, 4) && near(g.bottom) && g.inside, JSON.stringify(g));
await page.setViewport(PORTRAIT); await wait(800);

// ---- tap still opens the size box, drag still moves
const gTap = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, chipSel);
await page.mouse.click(gTap.x, gTap.y); await wait(500);
check('A tap on the pill still opens the size − / + box', await page.evaluate(() => !!document.querySelector('[data-accessory-size-hud]')));
g = await geom();
check('and the tap does not move it', near(g.cx, 0, 4) && near(g.bottom), JSON.stringify(g));

// ---- an old pixel position is converted, not lost
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('stats-chip-pos:'));
  localStorage.setItem(key, JSON.stringify({ x: 20, y: 700 }));
});
await open();
g = await geom();
check('An old pixel position still opens with the pill on screen, inside the plan area', !!g && g.inside, JSON.stringify(g));
const converted = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('stats-chip-pos:'));
  return JSON.parse(localStorage.getItem(key));
});
check('and it is saved in the new form from then on', typeof converted.fx === 'number' && typeof converted.fy === 'number', JSON.stringify(converted));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
