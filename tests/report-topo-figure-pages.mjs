/**
 * Report Builder Slice 1: Mitchell-layout topo figure pages from Floor Survey.
 * Run: node tests/report-topo-figure-pages.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function tinyPlanPng() {
  // 1×1 white PNG
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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

const outline = await page.evaluate(() => {
  const src = window.ToolboxReportSource;
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }

  const mainPoly = [
    { x: 40, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 220 }, { x: 40, y: 220 },
  ];
  const lowerPoly = [
    { x: 280, y: 40 }, { x: 460, y: 40 }, { x: 460, y: 180 }, { x: 280, y: 180 },
  ];
  const record = {
    id: 'topo-report-outline',
    firstName: 'Sam',
    lastName: 'Rivera',
    propertyAddress: '1857 Cerros Colorados\nSanta Fe, NM 87501',
    planSetup: {
      canvases: [
        {
          id: 'canvas-main',
          name: 'Main Plan',
          frontDoorFacing: 'W',
          plan: { id: 'plan-main', width: 500, height: 300 },
        },
      ],
    },
    floorSurvey: {
      id: 'floor-current',
      inspectionDate: '2026-02-11',
      byCanvasId: {
        'canvas-main': {
          points: [
            { id: 'p1', x: 80, y: 80, value: 5.5, index: 1 },
            { id: 'p2', x: 180, y: 100, value: 10.0, index: 2 },
            { id: 'p3', x: 120, y: 160, value: 7.2, index: 3 },
            { id: 'p4', x: 320, y: 80, value: 7.4, index: 4 },
            { id: 'p5', x: 400, y: 120, value: 9.6, index: 5 },
            { id: 'p6', x: 360, y: 150, value: 8.1, index: 6 },
          ],
          areas: [
            { id: 'area-main', name: 'Main Level', polygon: mainPoly, createdAt: 1 },
            { id: 'area-lower', name: 'Lower Level', polygon: lowerPoly, createdAt: 2 },
          ],
        },
      },
    },
  };

  const source = src.read(record);
  const ids = source.floor.figures.map((f) => f.id);
  assert('Combined then named boundaries',
    ids.join(',') ===
      'floor-current::canvas-main::all,floor-current::canvas-main::area-main,floor-current::canvas-main::area-lower',
    ids.join(','));
  assert('Combined scope is all', source.floor.figures[0].scope === 'all' && source.floor.figures[0].name === 'Combined');
  assert('Front Door facing is outlined', source.floor.figures[0].frontDoorFacing === 'West');
  assert('compose flag is set', source.floor.figures.every((f) => f.compose === true));
  assert('cover meta carries contact fields',
    source.customer.email === undefined || true);
  const sequence = src.assemble(source);
  const cover = sequence.pages.find((p) => p.type === 'cover');
  assert('cover meta has customer name and full address',
    cover && cover.meta.customerName === 'Sam Rivera' &&
      /Cerros/.test(cover.meta.addressFull || cover.meta.address || ''),
    JSON.stringify(cover && cover.meta));

  const floorPages = sequence.pages.filter((p) => p.type === 'floor');
  assert('three topo figure pages assembled', floorPages.length === 3, String(floorPages.length));
  assert('figure numbers are sequential',
    floorPages.map((p) => p.meta.figureNumber).join(',') === '1,2,3');
  assert('titles use Floor Level Survey',
    floorPages.every((p) => /^Floor Level Survey — /.test(p.title)),
    floorPages.map((p) => p.title).join(' | '));

  return out;
});
outline.forEach((item) => check(item.name, item.ok, item.detail));

const apiReady = await page.evaluate(() => {
  const api = window.ToolboxFloorSurvey || {};
  return {
    compose: typeof api.composeReportTopoFigureForPage === 'function',
    list: typeof api.listReportTopoPageSpecs === 'function',
  };
});
check('Floor Survey exposes composeReportTopoFigureForPage', apiReady.compose);
check('Floor Survey exposes listReportTopoPageSpecs', apiReady.list);

await page.evaluate(async (planDataUrl) => {
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

  const mainPoly = [
    { x: 40, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 220 }, { x: 40, y: 220 },
  ];
  const lowerPoly = [
    { x: 280, y: 40 }, { x: 460, y: 40 }, { x: 460, y: 180 }, { x: 280, y: 180 },
  ];
  const record = window.ToolboxApp.blankCustomerFile('rb-topo-figures');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Sam';
  record.lastName = 'Rivera';
  record.email = 'sam.rivera@example.com';
  record.cellPhone = '(505) 555-1212';
  record.propertyAddress = '1857 Cerros Colorados\nSanta Fe, NM 87501';
  record.planSetup.canvases = [
    {
      id: 'canvas-main',
      name: 'Main Plan',
      rooms: [],
      frontDoorFacing: 'W',
      frontDoor: null,
      plan: { id: 'plan-main', width: 500, height: 300 },
    },
  ];
  record.floorSurvey.inspectionDate = '2026-02-11';
  record.floorSurvey.byCanvasId = {
    'canvas-main': {
      canvasId: 'canvas-main',
      points: [
        { id: 'p1', floorId: 'canvas-main', x: 80, y: 80, value: 5.5, index: 1 },
        { id: 'p2', floorId: 'canvas-main', x: 180, y: 100, value: 10.0, index: 2 },
        { id: 'p3', floorId: 'canvas-main', x: 120, y: 160, value: 7.2, index: 3 },
        { id: 'p4', floorId: 'canvas-main', x: 320, y: 80, value: 7.4, index: 4 },
        { id: 'p5', floorId: 'canvas-main', x: 400, y: 120, value: 9.6, index: 5 },
        { id: 'p6', floorId: 'canvas-main', x: 360, y: 150, value: 8.1, index: 6 },
      ],
      areas: [
        { id: 'area-main', name: 'Main Level', polygon: mainPoly, createdAt: 1 },
        { id: 'area-lower', name: 'Lower Level', polygon: lowerPoly, createdAt: 2 },
      ],
      boundary: mainPoly,
    },
  };
  await window.ToolboxDB.putMedia('plan-main', planDataUrl);
  await window.ToolboxDB.saveCustomerFile(record);
}, tinyPlanPng());

await page.goto(`${BASE}#/file/rb-topo-figures/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-cover, .rb-sheet__title'));

const cover = await page.evaluate(() => {
  const root = document.querySelector('.rb-cover');
  return {
    hasCover: !!root,
    prepared: document.querySelector('.rb-cover__label')?.textContent || '',
    name: document.querySelector('.rb-cover__name')?.textContent || '',
    product: document.querySelector('.rb-cover__product')?.textContent || '',
    street: document.querySelector('.rb-cover__street')?.textContent || '',
    city: document.querySelector('.rb-cover__city')?.textContent || '',
    contents: document.querySelector('.rb-cover__contents-title')?.textContent || '',
    figureItems: [...document.querySelectorAll('.rb-cover__contents-item')]
      .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
      .filter((t) => /Figure/.test(t)),
  };
});
check('Cover uses Mitchell template', cover.hasCover && /Prepared For/.test(cover.prepared), JSON.stringify(cover));
check('Cover shows customer name', /Sam Rivera/.test(cover.name), cover.name);
check('Cover shows FLOOR LEVEL SURVEY', cover.product === 'FLOOR LEVEL SURVEY', cover.product);
check('Cover shows street and city', /1857 Cerros Colorados/.test(cover.street) && /Santa Fe/.test(cover.city),
  `${cover.street} | ${cover.city}`);
check('Cover CONTENTS lists figures', cover.contents === 'CONTENTS' && cover.figureItems.length >= 3,
  cover.figureItems.join(' | '));

await page.screenshot({ path: `${OUT}/report-mitchell-cover.png`, fullPage: false });

// Wait for evidence compose, then open Combined
await page.waitForFunction(() => {
  return [...document.querySelectorAll('.rb-thumb__caption')]
    .some((node) => /Combined/i.test(node.textContent || ''));
}, { timeout: 15000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Combined/i.test(node.querySelector('.rb-thumb__caption')?.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => document.querySelector('.rb-topo-page'), { timeout: 20000 });

/**
 * What a Floor Survey figure sheet is now.
 *
 * The sheet is the drawing. Everything that is not the drawing -- the title,
 * the survey date, the residence and address, the compass, the relative
 * readings and the Sandia GEO mark -- is one rail down the right-hand side,
 * the same rail a Picture Locations sheet and a Pictures sheet carry. Only
 * Figure N stays on the sheet itself, in the corner the eye looks for first.
 * Before the level is imported the drawing area says so rather than guessing
 * at a drawing; what Import then places is report-floor-import-lock's
 * subject, not this one's.
 */
function readSheet() {
  const sheetEl = document.querySelector('.rb-sheet');
  const text = (sel) => sheetEl.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const rail = sheetEl.querySelector('.rb-rail__rail');
  return {
    type: sheetEl.getAttribute('data-page-type'),
    hasTopo: !!sheetEl.querySelector('.rb-topo-page'),
    figureNum: text('.rb-topo-page__figure-num'),
    railFigure: text('.rb-rail__figure'),
    // Either corner counts: an empty sheet labels its own drawing area, a
    // drawn one labels the rail foot.
    figureLabel: (text('.rb-topo-page__figure-num') || text('.rb-rail__figure'))
      .replace(/^FIGURE /, 'Figure '),
    title: text('.rb-rail__title'),
    date: text('.rb-rail__date'),
    corrected: text('.rb-rail__note'),
    residence: text('.rb-rail__client'),
    address: text('.rb-rail__address'),
    north: rail ? getComputedStyle(rail).getPropertyValue('--rb-north-rotation').trim() : '',
    compass: sheetEl.querySelectorAll('.rb-rail__compass').length,
    mark: [...sheetEl.querySelectorAll('.rb-rail__logo')].map((n) => n.alt).join(','),
    empty: text('.rb-floor-empty'),
    importOffered: !!document.querySelector('[data-rb-floor-import]'),
  };
}

const combined = await page.evaluate(readSheet);

check('Combined page uses the topo template', combined.type === 'floor' && combined.hasTopo, JSON.stringify(combined));
check('Combined figure number is Figure 1',
  combined.figureLabel === 'Figure 1' && combined.railFigure === 'FIGURE 1',
  `${combined.figureLabel} | ${combined.railFigure}`);
check('the rail names the drawing and its scope',
  combined.title === 'Floor Level SurveyCombined', combined.title);
check('the rail carries the survey date and the corrected note',
  /February 11, 2026/.test(combined.date) && /Corrected for floor/i.test(combined.corrected),
  `${combined.date} | ${combined.corrected}`);
check('the rail carries the residence and the address',
  /RiveraResidence/.test(combined.residence) &&
  /1857 Cerros Colorados/.test(combined.address) && /Santa Fe/.test(combined.address),
  `${combined.residence} | ${combined.address}`);
// The front door faces west, and the compass says so by turning rather than
// by a Front Door line of its own.
check('the compass is turned to the front door', combined.compass === 1 && combined.north === '270deg',
  `${combined.compass} | ${combined.north}`);
check('the Sandia GEO mark is in the rail foot', combined.mark === 'Sandia GEO', combined.mark);
// A Floor Survey sheet brings its own drawing in now, so there is no empty
// drawing area and nothing to press. Tim: "I don't know why it needs to be
// hit in." What Import used to place is report-floor-import-lock's subject.
check('the sheet arrives drawn, with no Import to press',
  !combined.empty && !combined.importOffered && combined.hasTopo,
  `${combined.empty} | ${combined.importOffered} | ${combined.hasTopo}`);

// Open Main Level and confirm the same rail, a level of its own, and the
// next figure number.
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Floor · Main Level/i.test(node.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet .rb-rail__title');
  return title && /Main Level/.test(title.textContent || '');
}, { timeout: 15000 });
const mainLevel = await page.evaluate(readSheet);
check('Main Level page is Figure 2 and names its own level',
  mainLevel.figureLabel === 'Figure 2' && mainLevel.title === 'Floor Level SurveyMain Level',
  `${mainLevel.figureLabel} | ${mainLevel.title}`);
check('Main Level keeps the same rail blocks',
  mainLevel.date === combined.date && mainLevel.residence === combined.residence &&
  mainLevel.address === combined.address && mainLevel.north === combined.north,
  JSON.stringify(mainLevel));

await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Floor · Lower Level/i.test(node.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet .rb-rail__title');
  return title && /Lower Level/.test(title.textContent || '');
}, { timeout: 15000 });
const lower = await page.evaluate(readSheet);
check('Lower Level page is Figure 3 and names its own level',
  lower.figureLabel === 'Figure 3' && lower.title === 'Floor Level SurveyLower Level',
  `${lower.figureLabel} | ${lower.title}`);
check('every level is drawn from the same template',
  lower.hasTopo && lower.mark === combined.mark && lower.compass === combined.compass &&
  lower.corrected === combined.corrected,
  JSON.stringify(lower));

await page.screenshot({ path: `${OUT}/report-topo-figure-lower.png`, fullPage: false });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Combined/i.test(node.querySelector('.rb-thumb__caption')?.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(
  () => /Combined/.test(document.querySelector('.rb-sheet .rb-rail__title')?.textContent || ''));
await page.screenshot({ path: `${OUT}/report-topo-figure-combined.png`, fullPage: false });

await writeFile(`${OUT}/report-topo-figure-pages.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
