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

// Add to Report still captures (with the title in the band)
await page.click('[data-diagnostics-add-report]'); await wait(2500);
check('Add to Report still works', /Added to Report/.test(await page.$eval('[data-diagnostics-status]', (e) => e.textContent)), await page.$eval('[data-diagnostics-status]', (e) => e.textContent));
check('No JavaScript errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
