/**
 * H/L/Δ pill and Legend on a report floor slide: with a mouse, a drag always moves
 * the box right away (a slow press included), a plain click opens the size − / +
 * box, and moving still works when the slide is zoomed. Touch keeps press-and-hold.
 * (Tim, Nov 12, 2026: "sometimes you can't move it around, sometimes you can,
 * sometimes that little plus or minus shows up".)
 *
 * Run: node tests/report-pill-gesture.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-pill-gesture';
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await window.ToolboxDB.putMedia('plan-pill', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Pill'; rec.lastName = 'Gesture';
  rec.propertyAddress = '3 Pill Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-pill', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [];
  for (let i = 1; i <= 8; i += 1) {
    points.push({ id: 'p' + i, floorId: cv.id, index: i, x: 80 + i * 70, y: 180 + (i % 3) * 40, value: 5 + i * 0.25 });
  }
  rec.floorSurvey = {
    id: 'fs-pill', inspectionDate: '2026-10-26',
    byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await wait(4500);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-floor-import]') || !!document.querySelector('[data-rb-floor-box^="topo"]'),
  { timeout: 25000 });
const needsImport = await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-import]');
  if (!btn) return false;
  btn.click();
  return true;
});
if (needsImport) {
  await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 30000 });
}
await wait(2500);

const sheetSel = '.rb-sheet:not(.rb-sheet--thumb)';
const kindBox = (kind) => page.evaluate((k, sel) => {
  const el = document.querySelector(`${sel} [data-rb-floor-kind="${k}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const sr = document.querySelector(`${sel} [data-rb-floor-stage]`).getBoundingClientRect();
  return { id: el.getAttribute('data-rb-floor-box'), x: r.left, y: r.top, w: r.width, h: r.height,
    leftPct: ((r.left - sr.left) / sr.width) * 100, topPct: ((r.top - sr.top) / sr.height) * 100 };
}, kind, sheetSel);
const hudOpen = () => page.evaluate(() => !!document.querySelector('[data-accessory-size-hud]'));
const hudButton = (label) => page.evaluate((l) => {
  const b = document.querySelector(`[data-accessory-size-hud] button[aria-label^="${l}"]`);
  if (!b) return false;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, label);

for (const kind of ['pill', 'legend']) {
  const name = kind === 'pill' ? 'H/L/Δ pill' : 'Legend';
  let b = await kindBox(kind);
  check(`${name} is on the slide`, !!b, JSON.stringify(b));
  if (!b) continue;
  const grab = { x: b.x + b.w / 2, y: b.y + Math.min(12, b.h / 2) };

  // 1. A quick drag moves it.
  await page.mouse.move(grab.x, grab.y); await page.mouse.down();
  await page.mouse.move(grab.x - 90, grab.y - 60, { steps: 10 }); await page.mouse.up();
  await wait(500);
  let a = await kindBox(kind);
  check(`${name}: a quick mouse drag moves it`, a && Math.hypot(a.leftPct - b.leftPct, a.topPct - b.topPct) > 3,
    JSON.stringify({ before: [b.leftPct, b.topPct].map((n) => +n.toFixed(1)), after: a && [a.leftPct, a.topPct].map((n) => +n.toFixed(1)) }));
  check(`${name}: a drag does not open the size box`, !(await hudOpen()));

  // 2. A slow press (longer than the old 350 ms hold) then a drag still moves it.
  b = await kindBox(kind);
  const g2 = { x: b.x + b.w / 2, y: b.y + Math.min(12, b.h / 2) };
  await page.mouse.move(g2.x, g2.y); await page.mouse.down();
  await wait(700);
  await page.mouse.move(g2.x + 80, g2.y + 50, { steps: 10 }); await page.mouse.up();
  await wait(500);
  a = await kindBox(kind);
  check(`${name}: a slow press then drag still moves it (no size box in the way)`,
    a && Math.hypot(a.leftPct - b.leftPct, a.topPct - b.topPct) > 3 && !(await hudOpen()),
    JSON.stringify({ moved: a && Math.hypot(a.leftPct - b.leftPct, a.topPct - b.topPct).toFixed(1), hud: await hudOpen() }));

  // 3. A plain click opens the size box; its − and + change the size; a second click closes it.
  b = await kindBox(kind);
  const g3 = { x: b.x + b.w / 2, y: b.y + Math.min(12, b.h / 2) };
  await page.mouse.click(g3.x, g3.y);
  await wait(500);
  check(`${name}: a plain click opens the size − / + box`, await hudOpen());
  const plus = await hudButton('Increase');
  const sizeBefore = (await kindBox(kind)).w;
  if (plus) { await page.mouse.click(plus.x, plus.y); await wait(900); }
  const sizeAfter = (await kindBox(kind)).w;
  check(`${name}: + makes it bigger`, !!plus && sizeAfter > sizeBefore + 0.5, `${sizeBefore.toFixed(1)} -> ${sizeAfter.toFixed(1)}`);
  b = await kindBox(kind);
  await page.mouse.click(b.x + b.w / 2, b.y + Math.min(12, b.h / 2));
  await wait(500);
  check(`${name}: clicking it again closes the size box`, !(await hudOpen()));
  await page.mouse.click(60, 880); await wait(300);
}

// 4. Zoomed in, the box still moves.
await page.evaluate(() => document.querySelector('#rb-zoom-in')?.click());
await wait(300);
await page.evaluate(() => document.querySelector('#rb-zoom-in')?.click());
await wait(800);
const zoomed = await page.evaluate(() => !!document.querySelector('.rb-stage--zoomed'));
check('Slide is zoomed for the zoom test', zoomed);
let pz = await kindBox('pill');
if (pz && pz.x > 0 && pz.x + pz.w < 1440 && pz.y > 100 && pz.y + pz.h < 900) {
  const gz = { x: pz.x + pz.w / 2, y: pz.y + Math.min(12, pz.h / 2) };
  await page.mouse.move(gz.x, gz.y); await page.mouse.down();
  await page.mouse.move(gz.x + 60, gz.y + 40, { steps: 8 }); await page.mouse.up();
  await wait(500);
  const pz2 = await kindBox('pill');
  check('Zoomed in: the pill still moves with a mouse drag', pz2 && Math.hypot(pz2.x - pz.x, pz2.y - pz.y) > 20, JSON.stringify({ before: [pz.x, pz.y], after: pz2 && [pz2.x, pz2.y] }));
} else {
  check('Zoomed in: the pill is on screen to drag', false, JSON.stringify(pz));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
