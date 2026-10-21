/**
 * The drawing tools on a report sheet: pencil, rectangle, circle, arrow, eraser.
 * Run: node tests/report-drawing-tools.mjs   (needs a static server on 8765)
 *
 * These are the one part of Report Builder nothing covered. They are also the
 * part that writes unbounded data onto the Customer File and the part that can
 * leave a sheet armed and unclickable, so a regression here does not announce
 * itself -- it reads as a dead application, or as marks that quietly did not
 * survive the save.
 *
 * Report Builder's ink is Distress's, deliberately: pick a tool, then draw.
 * What is checked here is what the investigator would notice: a mark appears
 * where it was drawn, it is the shape that was chosen, a twitch leaves nothing
 * behind, the marks belong to the slide they were made on, the eraser takes
 * one and leaves the rest, undo puts it back, the marks are still there after
 * a reload, and changing slides puts the pen down.
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-drawing';
const results = [];
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async ({ png, id }) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(['customerFiles', 'media'], 'readwrite');
    transaction.objectStore('customerFiles').clear();
    transaction.objectStore('media').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Ada';
  record.lastName = 'Reyes';
  record.propertyAddress = '7 Drafting Way';
  await window.ToolboxDB.putMedia('plan-ink', png);
  record.planSetup.canvases[0].plan = { id: 'plan-ink', width: 400, height: 300 };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE });

async function openReport() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 25000 });
}
await openReport();

async function openSlide(id) {
  await page.evaluate((want) => {
    document.querySelector(`.rb-thumb[data-page-id="${want}"]`)?.click();
  }, id);
  await page.waitForFunction(
    (want) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === want,
    { timeout: 15000 }, id);
}
await openSlide('cover');

const slideIds = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .map((t) => t.getAttribute('data-page-id') || ''));

function sheetRect() {
  return page.evaluate(() => {
    const r = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** Arm a tool from the toolbar, the way the investigator does. */
async function arm(tool) {
  await page.click(`[data-rb-tool="${tool}"]`);
  await page.waitForFunction(
    (want) => document.querySelector(`[data-rb-tool="${want}"]`)?.classList.contains('is-on'),
    { timeout: 10000 }, tool);
}

/** Drag across the sheet in fractions of its width and height. */
async function drag(from, to) {
  const r = await sheetRect();
  await page.mouse.move(r.x + r.w * from[0], r.y + r.h * from[1]);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * to[0], r.y + r.h * to[1], { steps: 18 });
  await page.mouse.up();
  await new Promise((done) => setTimeout(done, 450));
}

const tools = await page.evaluate(() => [...document.querySelectorAll('[data-rb-tool]')]
  .map((b) => b.getAttribute('data-rb-tool')));
check('the toolbar offers all five drawing tools',
  ['pencil', 'rect', 'circle', 'arrow', 'eraser'].every((t) => tools.indexOf(t) !== -1),
  tools.join(','));

await arm('pencil');
const armed = await page.evaluate(() => ({
  inking: document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').classList.contains('rb-sheet--inking'),
  layer: getComputedStyle(
    document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-ov-layer')).pointerEvents,
}));
check('arming a tool puts the drawing layer over the sheet',
  armed.inking && armed.layer === 'auto', JSON.stringify(armed));

await drag([0.2, 0.3], [0.45, 0.55]);
const afterPencil = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const paths = sheet.querySelectorAll('[data-rb-ov-ink] g[data-rb-ov]');
  return { count: paths.length };
});
check('the pencil leaves one freehand mark where it was drawn',
  afterPencil.count === 1, JSON.stringify(afterPencil));

for (const [tool, from, to] of [
  ['rect', [0.55, 0.2], [0.8, 0.4]],
  ['circle', [0.55, 0.5], [0.78, 0.68]],
  ['arrow', [0.2, 0.7], [0.45, 0.85]],
]) {
  await arm(tool);
  await drag(from, to);
}

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 });

const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const cover = (record.reportBuilder?.pages || []).find((p) => p.type === 'cover');
  const overlays = (cover?.meta?.overlays || []);
  const other = (record.reportBuilder?.pages || [])
    .filter((p) => p.type !== 'cover')
    .reduce((n, p) => n + (p.meta?.overlays || []).length, 0);
  return {
    kinds: overlays.map((o) => o.kind),
    hasPoints: overlays.some((o) => o.kind === 'path' && (o.points || []).length >= 2),
    boxed: overlays.filter((o) => o.kind !== 'path')
      .every((o) => ['x0', 'y0', 'x1', 'y1'].every((k) => typeof o[k] === 'number')),
    onOtherSlides: other,
  };
}, FILE);
check('all four shapes are on the Customer File, each as its own kind',
  stored.kinds.filter((k) => k === 'path').length === 1 &&
  stored.kinds.indexOf('rect') !== -1 &&
  stored.kinds.indexOf('circle') !== -1 &&
  stored.kinds.indexOf('arrow') !== -1 &&
  stored.hasPoints && stored.boxed,
  JSON.stringify(stored));
check('the marks belong to the slide they were drawn on',
  stored.onOtherSlides === 0, String(stored.onOtherSlides));

// A twitch is not a mark. Without this, every stray click on an armed sheet
// leaves a dot or a zero-width box the investigator then has to find and erase.
await arm('rect');
await drag([0.35, 0.44], [0.353, 0.443]);
const afterTwitch = await page.evaluate(() =>
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-ov-ink] g[data-rb-ov]').length);
check('a twitch of the pointer leaves nothing behind', afterTwitch === 4, String(afterTwitch));

// Changing slides puts the pen down. A sheet left armed cannot be clicked,
// which reads as a dead application rather than as a tool still held.
await arm('pencil');
await openSlide(slideIds.find((id) => id !== 'cover'));
const onOther = await page.evaluate(() => ({
  inking: document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').classList.contains('rb-sheet--inking'),
  armedBtn: !!document.querySelector('[data-rb-tool].is-on'),
}));
check('changing slides puts the pen down',
  !onOther.inking && !onOther.armedBtn, JSON.stringify(onOther));

await openSlide('cover');
const backOnCover = await page.evaluate(() =>
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-ov-ink] g[data-rb-ov]').length);
check('the marks are still on the cover when it comes back', backOnCover === 4, String(backOnCover));

// The eraser takes the one that was clicked and leaves the rest.
await arm('eraser');
const erasing = await page.evaluate(() => getComputedStyle(
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-ov-layer__ink')).pointerEvents);
check('the eraser lets the marks themselves be clicked', erasing === 'auto', erasing);

const target = await page.evaluate(() => {
  const g = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-ov-ink] g[data-rb-ov]');
  const r = g.getBBox ? g.getBoundingClientRect() : null;
  return { id: g.getAttribute('data-rb-ov'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(target.x, target.y);
await new Promise((done) => setTimeout(done, 600));
const afterErase = await page.evaluate((gone) => ({
  count: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-ov-ink] g[data-rb-ov]').length,
  stillThere: !!document.querySelector(`[data-rb-ov="${gone}"]`),
}), target.id);
check('the eraser takes the mark it was clicked on and leaves the others',
  afterErase.count === 3 && !afterErase.stillThere, JSON.stringify(afterErase));

// Undo puts it back: erasing is the one drawing action that destroys work.
await page.keyboard.down('Control');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Control');
await new Promise((done) => setTimeout(done, 700));
const afterUndo = await page.evaluate(() =>
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-ov-ink] g[data-rb-ov]').length);
check('undo puts an erased mark back', afterUndo === 4, String(afterUndo));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 });
await openReport();
await openSlide('cover');
const afterReload = await page.evaluate(() =>
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-ov-ink] g[data-rb-ov]').length);
check('the marks survive closing and reopening the report',
  afterReload === 4, String(afterReload));

await page.screenshot({ path: `${OUT}/report-drawing-tools.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
