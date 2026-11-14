/**
 * The Floor Survey H / L / Δ pill stays where it is put when the screen turns.
 *
 * Tim, Nov 13, 2026: "High low delta pill does not lock in place when you move between portrait and
 * landscape on a phone or a tablet... If I move it to lower left corner basically it needs to pin. Its
 * relation to the plan." The position was saved as screen pixels and re-clamped on every rotation, so it
 * drifted. It is saved against the plan area as a distance from the nearest side and top/bottom.
 * Nov 14: "I had moved it next to the Data/Topo pill. It moved." (a share of the width slid it away from
 * that pill; a distance from the corner keeps it beside it). The Data button also stays upper-left.
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
check('The saved position is a distance from the lower-left corner of the plan area, not screen pixels',
  !!saved && saved.value.h === 'l' && saved.value.v === 'b' && near(saved.value.dx, 0) && near(saved.value.dy, 0) && !('x' in saved.value), JSON.stringify(saved));

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
check('and it is saved in the new form from then on', !!converted.h && !!converted.v && typeof converted.dx === 'number' && typeof converted.dy === 'number', JSON.stringify(converted));
// the share-of-width form saved by the previous build is converted too, to where it was drawn
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('stats-chip-pos:'));
  localStorage.setItem(key, JSON.stringify({ fx: 0, fy: 1 }));
});
await open();
g = await geom();
check('A position saved as a share by the last build opens in the same corner', !!g && near(g.left) && near(g.bottom) && g.inside, JSON.stringify(g));


// ---- Tim's case: put beside the Data / Topo pill, then turn the phone
const toggleRect = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].filter((x) => /^(Data|Topo)$/.test((x.textContent || '').trim()));
  if (!b.length) return null;
  const rs = b.map((x) => x.getBoundingClientRect());
  return { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)), t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)) };
});
const chipRect = () => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, chipSel);
async function dragChipBy(dx, dy) {
  const c = await chipRect();
  const x = c.l + c.w / 2; const y = c.t + c.h / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 }); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  await wait(700);
}
await page.setViewport(PORTRAIT); await open();
await dragChipTo('lower-left'); // start from a known corner
let tg = await toggleRect(); let cr = await chipRect();
check('The Data / Topo pill is on the capture screen', !!tg, JSON.stringify(tg));
// move the chip so its left edge sits 10 px to the right of the toggle and it shares the toggle's row
await dragChipBy((tg.r + 10) - cr.l, ((tg.t + tg.b) / 2 - (cr.t + cr.b) / 2));
cr = await chipRect(); tg = await toggleRect();
const gapPortrait = +(cr.l - tg.r).toFixed(1);
const rowPortrait = +(((cr.t + cr.b) / 2) - ((tg.t + tg.b) / 2)).toFixed(1);
check('Put beside the Data / Topo pill (portrait)', Math.abs(gapPortrait - 10) <= 3 && Math.abs(rowPortrait) <= 4, JSON.stringify({ gapPortrait, rowPortrait }));
await page.setViewport(LANDSCAPE); await wait(1000);
cr = await chipRect(); tg = await toggleRect();
const gapLand = +(cr.l - tg.r).toFixed(1);
const rowLand = +(((cr.t + cr.b) / 2) - ((tg.t + tg.b) / 2)).toFixed(1);
check('Turned to landscape it is still beside the Data / Topo pill, same gap', Math.abs(gapLand - gapPortrait) <= 3 && Math.abs(rowLand - rowPortrait) <= 4, JSON.stringify({ gapLand, rowLand }));
await page.setViewport(PORTRAIT); await wait(1000);
cr = await chipRect(); tg = await toggleRect();
check('and back to portrait, still beside it', Math.abs((cr.l - tg.r) - gapPortrait) <= 3, JSON.stringify({ gap: +(cr.l - tg.r).toFixed(1) }));

// ---- The Data button (database icon) stays in the upper left through a turn and never sits on the pill
const dataBtn = () => page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Show data points"]');
  if (!b) return null; const r = b.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom };
});
const area0 = () => page.evaluate(() => { const r = document.querySelector('[data-plan-area]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
await page.setViewport(PORTRAIT); await wait(800);
let d1 = await dataBtn(); let a1 = await area0();
check('The Data button is in the upper left of the screen (portrait)', !!d1 && d1.l < 60 && d1.t < a1.t + 70, JSON.stringify({ d1, a1 }));
await page.setViewport(LANDSCAPE); await wait(1000);
let d2 = await dataBtn(); const c2 = await chipRect();
check('Turned to landscape the Data button is still in the upper left, not at the bottom', !!d2 && d2.l < 60 && d2.t < 140, JSON.stringify(d2));
check('and it is not on top of the H/L/Δ pill', !(d2.l < c2.r && d2.r > c2.l && d2.t < c2.b && d2.b > c2.t));
check('and it is not under the top bar', !!d2 && d2.t >= (await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().bottom ?? 0)) - 2);
await page.mouse.click((d2.l + d2.r) / 2, (d2.t + d2.b) / 2); await wait(500);
const panelL = await page.evaluate(() => { const h = document.querySelector('div.cursor-move'); const p = h ? h.parentElement : null; if (!p) return null; const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vh: window.innerHeight }; });
check('Opened in landscape, the Data panel sits under the button on the left, on screen', !!panelL && panelL.l < 60 && panelL.t >= d2.b - 2 && panelL.b <= panelL.vh, JSON.stringify(panelL));
await page.setViewport(PORTRAIT); await wait(800);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
