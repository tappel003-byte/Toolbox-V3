/**
 * The 3D view on a white canvas with a settings list down the left (Tim, Nov 20, 2026; modelled on 3DField).
 *
 * Run: node tests/diagnostics-3d-controls.mjs   (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 1500, height: 950 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 700; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 700); x.strokeStyle = '#111'; x.lineWidth = 8; x.strokeRect(100, 100, 800, 500);
  x.font = 'bold 40px sans-serif'; x.fillStyle = '#222'; x.fillText('Living', 250, 250);
  await ToolboxDB.putMedia('plan-3dc', c.toDataURL('image/jpeg', 0.92));
  const rec = ToolboxApp.blankCustomerFile('dx3c'); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Three'; rec.lastName = 'D'; rec.propertyAddress = '1 Test Way';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Level'; cv.plan = { id: 'plan-3dc', width: 1000, height: 700 };
  const poly = [{ x: 110, y: 110 }, { x: 890, y: 110 }, { x: 890, y: 590 }, { x: 110, y: 590 }];
  const points = []; let n = 0;
  for (let r = 0; r < 7; r++) for (let q = 0; q < 10; q++) { n++; const px = 140 + q * 80; const py = 140 + r * 70;
    const d = Math.hypot(px - 450, py - 380); const v = 10 - 1.65 * Math.exp(-(d * d) / (2 * 150 * 150)) + 0.002 * (px - 140) - 0.3 * Math.sin(py / 90);
    points.push({ id: 'p' + n, floorId: cv.id, index: n, x: px, y: py, value: Math.round(v * 10) / 10, createdAt: n, ...(n === 1 ? { isBasePoint: true, label: 'BP1' } : {}) }); }
  rec.floorSurvey = { id: 'fs-dx3c', inspectionDate: '2026-11-20', byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await ToolboxDB.saveCustomerFile(rec);
});
await page.goto(`${BASE}#/file/dx3c/diagnostics/3d`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[data-diagnostics-readout]', { timeout: 30000 });
await wait(3500);

// The picture of the canvas as numbers: a small hash of its pixels, and its corner colour.
const look = () => page.evaluate(() => {
  const src = document.querySelector('.dx3-stage canvas');
  const c = document.createElement('canvas'); c.width = 96; c.height = 64;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0, 96, 64);
  const d = x.getImageData(0, 0, 96, 64).data;
  let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
  return { hash: h, corner: [d[0], d[1], d[2]], dark: (() => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) n += 1; return n; })() };
});
const open = async (k) => { await page.evaluate((key) => { const h = document.querySelector(`[data-dx3-page="${key}"] .dx3-page__head`); if (h && h.getAttribute('aria-expanded') !== 'true') h.click(); }, k); await wait(300); };
const sw = (k, i = 0) => page.evaluate((key, idx) => { document.querySelectorAll(`[data-dx3-page="${key}"] button[role=switch]`)[idx].click(); }, k, i);

const base = await look();
check('The canvas is white', base.corner.every((v) => v >= 250), JSON.stringify(base.corner));
const pages = await page.evaluate(() => [...document.querySelectorAll('[data-dx3-page]')].map((e) => e.getAttribute('data-dx3-page')));
check('The settings list has Format, View, Lighting, Contours, Color scale, Base, Axes, Texture and Map title', pages.join(',') === 'format,view,lighting,contours,color,base,axes,texture,title', pages.join(','));
check('Height exaggeration and Show survey points are always on screen', await page.evaluate(() => /Height exaggeration/.test(document.querySelector('[data-diagnostics-height]').textContent) && /Show survey points/.test(document.querySelector('[data-diagnostics-height]').textContent)));

// Contours
await open('contours');
await sw('contours', 0); await wait(900);
const noContours = await look();
check('Switching contour lines off changes the picture', noContours.hash !== base.hash && noContours.dark < base.dark, JSON.stringify({ before: base.dark, after: noContours.dark }));
await sw('contours', 0); await wait(900);
await page.select('select[aria-label="Contour interval"]', '0.5'); await wait(900);
const wide = await look();
check('A wider contour interval draws fewer lines', wide.dark < base.dark, JSON.stringify({ before: base.dark, after: wide.dark }));
await page.select('select[aria-label="Contour interval"]', '0.2'); await wait(600);

// Base and axes
await open('base');
await sw('base', 0); await wait(900);
const noBase = await look();
check('The base slab can be switched off', noBase.hash !== base.hash);
await sw('base', 0); await wait(700);
await open('axes');
await sw('axes', 0); await wait(900);
const noAxes = await look();
check('The box and ticks can be switched off', noAxes.hash !== base.hash);
await sw('axes', 0); await wait(700);

// Colour scale
await open('color');
await page.select('select[aria-label="Palette"]', 'ocean'); await wait(900);
check('Choosing a palette recolours the surface and the legend', (await page.evaluate(() => document.querySelector('[data-diagnostics-legend]').getAttribute('data-palette'))) === 'ocean' && (await look()).hash !== base.hash);
await sw('color', 0); await wait(400);
check('The colour scale can be hidden', !(await page.$('[data-diagnostics-legend]')));
await sw('color', 0); await wait(400);

// View presets and lighting
await open('view');
await page.evaluate(() => { [...document.querySelectorAll('[data-dx3-page="view"] .dx3-btn')].find((b) => b.textContent === 'Top').click(); }); await wait(900);
const top = await look();
check('The Top view looks straight down', top.hash !== base.hash);
await page.evaluate(() => { [...document.querySelectorAll('[data-dx3-page="view"] .dx3-btn')].find((b) => b.textContent === 'Angled').click(); }); await wait(700);

// Texture
await open('texture');
const beforeTex = await look();
await sw('texture', 0); await wait(2000);
const tex = await look();
check('The floor plan can be draped on the surface', tex.hash !== beforeTex.hash);
await sw('texture', 0); await wait(600);

// Title
await open('title');
await page.type('input[aria-label="Map title"]', 'Rain Lily test');
await wait(300);
check('A map title shows on the view', (await page.$eval('.dx3-title', (e) => e.textContent)) === 'Rain Lily test');

// Z scale still works
const ex = await page.evaluate(() => document.querySelector('[data-diagnostics-readout]').getAttribute('data-exaggeration'));
await page.focus('[data-diagnostics-height] [role="slider"]');
for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
await wait(500);
const ex2 = await page.evaluate(() => document.querySelector('[data-diagnostics-readout]').getAttribute('data-exaggeration'));
check('The Z scale slider still changes the height exaggeration', Number(ex2) > Number(ex), `${ex} -> ${ex2}`);

// ---- slider range: single digits, with fine steps under 1 ----
const setZ = async (presses, key) => { await page.focus('[data-diagnostics-height] [role="slider"]'); for (let i = 0; i < presses; i += 1) { await page.keyboard.press(key); await wait(6); } await wait(300); };
const exNow = () => page.evaluate(() => Number(document.querySelector('[data-diagnostics-readout]').getAttribute('data-exaggeration')));
await setZ(260, 'ArrowRight');
check('The Z slider tops out in single digits (10x), not the twenties', (await exNow()) <= 10.001 && (await exNow()) > 8, String(await exNow()));
await setZ(520, 'ArrowLeft');
const low = await exNow();
check('and goes down to a tenth', low >= 0.1 && low < 0.15, String(low));
const lowLabel = await page.evaluate(() => /Height exaggeration · ([0-9.]+)×/.exec(document.body.innerText)[1]);
check('Under 1 it is shown to two decimals', /^0\.\d\d$/.test(lowLabel), lowLabel);
await setZ(40, 'ArrowRight');
const mid = await exNow();
check('Ten key presses from the bottom moves it in small steps (still under 1)', mid > low && mid < 1, String(mid));
await setZ(60, 'ArrowRight'); await setZ(30, 'ArrowLeft');
await setZ(0, 'ArrowLeft');
// back near 3 for the pictures that follow
await page.evaluate(() => {});

// ---- pinch and two-finger pan, with real touch events ----
const cdp = await page.createCDPSession();
const box = await page.evaluate(() => { const r = document.querySelector('[data-dx3-canvas]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const camNow = () => page.evaluate(() => { const m = document.querySelector('[data-dx3-canvas]'); return { d: Number(m.dataset.camDist), t: m.dataset.camTarget.split(',').map(Number), p: m.dataset.camPos.split(',').map(Number) }; });
async function touch(type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
}
const before = await camNow();
// two fingers spread apart (a pinch out) = zoom in
await touch('touchStart', [{ x: box.x - 40, y: box.y }, { x: box.x + 40, y: box.y }]);
for (let i = 1; i <= 12; i += 1) { await touch('touchMove', [{ x: box.x - 40 - i * 10, y: box.y }, { x: box.x + 40 + i * 10, y: box.y }]); await wait(25); }
await touch('touchEnd', []);
await wait(600);
const zoomed = await camNow();
check('Spreading two fingers zooms in', zoomed.d < before.d * 0.85, JSON.stringify({ before: before.d, after: zoomed.d }));
// two fingers pinching in = zoom out
await touch('touchStart', [{ x: box.x - 160, y: box.y }, { x: box.x + 160, y: box.y }]);
for (let i = 1; i <= 12; i += 1) { await touch('touchMove', [{ x: box.x - 160 + i * 10, y: box.y }, { x: box.x + 160 - i * 10, y: box.y }]); await wait(25); }
await touch('touchEnd', []);
await wait(600);
const out = await camNow();
check('Bringing them together zooms out', out.d > zoomed.d * 1.15, JSON.stringify({ zoomed: zoomed.d, after: out.d }));
// two fingers sliding together without changing their spacing = pan
const preMove = await camNow();
await touch('touchStart', [{ x: box.x - 50, y: box.y }, { x: box.x + 50, y: box.y }]);
for (let i = 1; i <= 12; i += 1) { await touch('touchMove', [{ x: box.x - 50 + i * 12, y: box.y + i * 4 }, { x: box.x + 50 + i * 12, y: box.y + i * 4 }]); await wait(25); }
await touch('touchEnd', []);
await wait(600);
const panned = await camNow();
const shift = Math.hypot(panned.t[0] - preMove.t[0], panned.t[1] - preMove.t[1], panned.t[2] - preMove.t[2]);
check('Sliding two fingers together pans the view', shift > 0.03, JSON.stringify({ shift: shift.toFixed(3) }));
check('and that slide does not also zoom', Math.abs(panned.d - preMove.d) / preMove.d < 0.12, JSON.stringify({ before: preMove.d, after: panned.d }));
// one finger rotates
const rotBefore = await camNow();
await touch('touchStart', [{ x: box.x - 100, y: box.y }]);
for (let i = 1; i <= 12; i += 1) { await touch('touchMove', [{ x: box.x - 100 + i * 12, y: box.y - i * 3 }]); await wait(25); }
await touch('touchEnd', []);
await wait(600);
const rotAfter = await camNow();
check('One finger still orbits', Math.hypot(rotAfter.p[0] - rotBefore.p[0], rotAfter.p[1] - rotBefore.p[1], rotAfter.p[2] - rotBefore.p[2]) > 0.05 && Math.abs(rotAfter.d - rotBefore.d) / rotBefore.d < 0.05, JSON.stringify({ before: rotBefore.p, after: rotAfter.p }));
// the buttons
const d0 = (await camNow()).d;
await page.click('button[aria-label="Zoom in"]'); await wait(400);
const d1 = (await camNow()).d;
check('The + button zooms in', d1 < d0, `${d0} -> ${d1}`);
await page.click('button[aria-label="Zoom out"]'); await wait(300); await page.click('button[aria-label="Zoom out"]'); await wait(400);
check('The − button zooms out', (await camNow()).d > d1);
await page.click('button[aria-label="Fit"]'); await wait(500);
const fit = await camNow();
check('Fit brings the whole view back', fit.d > 0.5 && fit.d < 3, JSON.stringify(fit));
// wheel zoom (a laptop's pinch arrives as ctrl + wheel)
await page.mouse.move(box.x, box.y);
const w0 = (await camNow()).d;
await page.keyboard.down('Control'); await page.mouse.wheel({ deltaY: -400 }); await page.keyboard.up('Control'); await wait(600);
check('A trackpad pinch (ctrl + wheel) zooms in', (await camNow()).d < w0);

// Move mode: a plain left-button drag slides the view; without it the same drag only orbits
{
  const b = await camNow();
  const r = await page.$eval('[data-dx3-canvas] canvas', (e) => { const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  const drag = async () => { await page.mouse.move(r.x, r.y); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + i * 14, r.y + i * 6); await page.mouse.up(); await wait(500); };
  await drag();
  const orbited = await camNow();
  check('Without Move, a left drag orbits and does not slide the view', Math.hypot(orbited.t[0] - b.t[0], orbited.t[1] - b.t[1], orbited.t[2] - b.t[2]) < 0.01, JSON.stringify({ b: b.t, a: orbited.t }));
  await page.click('[aria-label="Move the view"]'); await wait(200);
  await drag();
  const slid = await camNow();
  check('With Move on, a left drag slides the view', Math.hypot(slid.t[0] - orbited.t[0], slid.t[1] - orbited.t[1], slid.t[2] - orbited.t[2]) > 0.05, JSON.stringify({ a: orbited.t, s: slid.t }));
  await page.click('[aria-label="Move the view"]'); await wait(200);
  await open('contours');
  check('Contours page has a Line weight control', /Line weight/.test(await page.$eval('[data-dx3-page="contours"]', (e) => e.textContent)));
}

// Add to Report still captures (with the title in the band)
await page.click('[data-diagnostics-add-report]'); await wait(2500);
check('Add to Report still works', /Added to Report/.test(await page.$eval('[data-diagnostics-status]', (e) => e.textContent)), await page.$eval('[data-diagnostics-status]', (e) => e.textContent));
check('No JavaScript errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
