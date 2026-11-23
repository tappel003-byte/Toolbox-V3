/**
 * Pages rail must stay .rb-rail — layout, overflow, and phone/iPad rules.
 *
 * d1b32be renamed the RIGHT Toolbox workspace to .rb-ws and accidentally
 * gave the LEFT pages list the same class. This locks the pages aside back
 * to .rb-rail and checks the stage still fits a Floor slide symmetrically
 * after Picture Locations crop cameras are present on the book.
 *
 * Run: node tests/report-pages-rail.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-pages-rail';
const OUT = '/opt/cursor/artifacts';
const results = [];

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
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#f3f0ea'; x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#444'; x.fillRect(120, 90, 560, 420);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await window.ToolboxDB.putMedia('plan-pages-rail', img);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  const names = ['Main Floor', 'Covered Patio', 'Garage', 'Basement'];
  rec.planSetup.canvases = names.map((name, i) => ({
    id: 'cv-' + i, name, rooms: [], frontDoorFacing: 'S', frontDoor: null,
    plan: { id: 'plan-pages-rail', width: 800, height: 600 },
  }));
  rec.distress.pins = [];
  rec.planSetup.canvases.forEach((cv, i) => {
    rec.distress.pins.push({
      id: 'pin-' + i, canvasId: cv.id, x: 0.4, y: 0.4,
      description: 'crack', photos: [],
    });
  });
  rec.floorSurvey.inspectionDate = '2025-11-21';
  rec.floorSurvey.byCanvasId = {};
  rec.planSetup.canvases.forEach((cv) => {
    rec.floorSurvey.byCanvasId[cv.id] = {
      canvasId: cv.id,
      points: [
        { id: 'a', x: 0.2, y: 0.2, value: 0 },
        { id: 'b', x: 0.7, y: 0.7, value: -1 },
      ],
    };
  });
  // Crop camera on file — proves penLogCameras from fc0f22e do not break mount.
  rec.reportBuilder = {
    schema: 'toolbox-report-builder/v1',
    updatedAt: new Date().toISOString(),
    pages: [],
    activePageId: null,
    penLogCameras: { 'cv-1': { cx: 0.4, cy: 0.4, zoom: 2.2, rel: true } },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 60000 },
);
await new Promise((r) => setTimeout(r, 800));

const rail = await page.evaluate(() => {
  const aside = document.querySelector('.rb-workspace > aside:first-child');
  return {
    className: aside ? aside.className : null,
    label: aside ? aside.getAttribute('aria-label') : null,
  };
});
check('Pages aside uses rb-rail (not rb-ws)', rail.className === 'rb-rail', JSON.stringify(rail));

await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb')].find((el) =>
    (el.querySelector('.rb-thumb__caption')?.textContent || '') === 'Floor · Covered Patio');
  t?.scrollIntoView({ block: 'center' });
  t?.click();
});
await new Promise((r) => setTimeout(r, 1000));

const floor = await page.evaluate(() => {
  const stage = document.querySelector('.rb-stage');
  const paper = document.querySelector('.rb-stage__paper');
  const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
  const sr = stage.getBoundingClientRect();
  const pr = paper.getBoundingClientRect();
  const leftPad = pr.left - sr.left;
  const rightPad = sr.right - pr.right;
  return {
    active: document.querySelector('.rb-thumb.is-active .rb-thumb__caption')?.textContent || '',
    hasImport: /Import Floor Survey/.test(stage?.innerText || ''),
    transform: sheet?.style.transform || '',
    paperW: paper?.style.width || '',
    leftPad,
    rightPad,
    padDelta: Math.abs(leftPad - rightPad),
    scrollLeft: stage?.scrollLeft || 0,
    stageW: stage?.clientWidth || 0,
    paperClientW: paper?.clientWidth || 0,
  };
});
check('Floor · Covered Patio thumb selects', floor.active === 'Floor · Covered Patio', floor.active);
check('Floor slide offers Import (empty drawing, not a blank mount)', floor.hasImport);
check('Stage sheet is fitted (has scale transform)', /^scale\(/.test(floor.transform), floor.transform);
check('Stage scrollLeft stays at 0 on Fit', floor.scrollLeft === 0, String(floor.scrollLeft));
check(
  'Paper is centred in the stage (pads within 24px)',
  floor.padDelta <= 24 && floor.paperClientW > floor.stageW * 0.5,
  JSON.stringify(floor),
);

// Visible thumb hit-testing — only thumbs fully inside the list viewport.
await page.evaluate(() => { document.querySelector('#rb-page-list').scrollTop = 0; });
await new Promise((r) => setTimeout(r, 150));
const hits = await page.evaluate(() => {
  const list = document.querySelector('#rb-page-list');
  const lr = list.getBoundingClientRect();
  return [...document.querySelectorAll('.rb-thumb')].map((t) => {
    const r = t.getBoundingClientRect();
    const fullyIn =
      r.top >= lr.top + 2 &&
      r.bottom <= lr.bottom - 2 &&
      r.height > 40;
    if (!fullyIn) return { skip: true };
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(40, r.height / 3));
    return {
      cap: t.querySelector('.rb-thumb__caption')?.textContent || '',
      inThumb: !!(el && el.closest && el.closest('.rb-thumb')),
      hit: el && String(el.className).slice(0, 40),
    };
  }).filter((x) => !x.skip);
});
check(
  'Thumbs fully inside the list viewport receive hits',
  hits.length > 0 && hits.every((h) => h.inThumb),
  JSON.stringify(hits),
);

await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb')].find((el) =>
    (el.querySelector('.rb-thumb__caption')?.textContent || '') === 'Picture Locations · Covered Patio');
  t?.scrollIntoView({ block: 'center' });
  t?.click();
});
await new Promise((r) => setTimeout(r, 1500));

const pen = await page.evaluate(() => {
  const plan = document.querySelector('.rb-stage .rb-penlog__plan');
  const paper = document.querySelector('.rb-stage__paper');
  const stage = document.querySelector('.rb-stage');
  const sr = stage.getBoundingClientRect();
  const pr = paper.getBoundingClientRect();
  return {
    active: document.querySelector('.rb-thumb.is-active .rb-thumb__caption')?.textContent || '',
    cropped: plan ? plan.classList.contains('is-cropped') : false,
    zoom: plan ? plan.getAttribute('data-rb-camera-zoom') : null,
    padDelta: Math.abs((pr.left - sr.left) - (sr.right - pr.right)),
    transform: document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)')?.style.transform || '',
  };
});
check('Picture Locations thumb selects', /Picture Locations · Covered Patio/.test(pen.active), pen.active);
check('Stored penLogCameras still crop the plan', pen.cropped === true && Number(pen.zoom) > 1.5, JSON.stringify(pen));
check('Stage stays fitted on Picture Locations', /^scale\(/.test(pen.transform) && pen.padDelta <= 24, JSON.stringify(pen));
check('No page errors during Report Builder open', pageErrors.length === 0, pageErrors.join(' | '));

await page.screenshot({ path: `${OUT}/rb-pages-rail.png`, fullPage: false });
await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
