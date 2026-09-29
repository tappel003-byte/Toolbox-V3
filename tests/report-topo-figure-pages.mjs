/**
 * Report Builder Slice 1: fixed-slot topo figure pages from Floor Survey.
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

  const sequence = src.assemble(source);
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
await page.waitForFunction(() => document.querySelector('.rb-sheet__title'));

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

const combined = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet');
  const pageRoot = document.querySelector('.rb-topo-page');
  const legends = [...document.querySelectorAll('.rb-topo-legend')];
  const stats = [...document.querySelectorAll('.rb-topo-stats')];
  const door = document.querySelector('.rb-topo-page__front-door strong');
  const img = document.querySelector('.rb-topo-page__image');
  const chrome = document.querySelector('.rb-topo-page__chrome');
  const drawing = document.querySelector('.rb-topo-page__drawing');
  return {
    type: sheet && sheet.getAttribute('data-page-type'),
    hasTopo: !!pageRoot,
    title: document.querySelector('.rb-topo-page__figure-title')?.textContent || '',
    date: document.querySelector('.rb-topo-page__survey-date')?.textContent || '',
    address: document.querySelector('.rb-topo-page__address')?.textContent || '',
    door: door ? door.textContent : '',
    legendCount: legends.length,
    statsCount: stats.length,
    statsText: stats.map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
    hasImage: !!(img && img.src && img.src.indexOf('data:image/') === 0),
    chromeRightOfDrawing: !!(chrome && drawing &&
      chrome.getBoundingClientRect().left >= drawing.getBoundingClientRect().right - 2),
    corrected: document.querySelector('.rb-topo-page__corrected')?.textContent || '',
  };
});

check('Combined page uses topo template', combined.type === 'floor' && combined.hasTopo, JSON.stringify(combined));
check('Combined title includes Figure 1', /Figure 1/.test(combined.title) && /Combined/.test(combined.title), combined.title);
check('Survey date slot is filled', /02\/11\/26/.test(combined.date), combined.date);
check('Address slot is filled', /1857 Cerros Colorados/.test(combined.address), combined.address);
check('Front Door slot is West', combined.door === 'West', combined.door);
check('Combined shows two legends', combined.legendCount === 2, String(combined.legendCount));
check('Combined shows two H/L/Δ pills', combined.statsCount === 2, combined.statsText.join(' | '));
check('Composed drawing image is present', combined.hasImage);
check('Chrome is fixed to the right of the drawing', combined.chromeRightOfDrawing);
check('Corrected footer is present', /Corrected for Floor Differences/.test(combined.corrected));

// Open Main Level page and confirm same chrome geometry
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Floor · Main Level/i.test(node.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-topo-page__figure-title');
  return title && /Main Level/.test(title.textContent || '');
}, { timeout: 15000 });

const mainLevel = await page.evaluate(() => {
  const chrome = document.querySelector('.rb-topo-page__chrome');
  const drawing = document.querySelector('.rb-topo-page__drawing');
  const door = document.querySelector('.rb-topo-page__front-door');
  const legend = document.querySelector('.rb-topo-legend');
  const stats = document.querySelector('.rb-topo-stats');
  const c = chrome.getBoundingClientRect();
  const d = drawing.getBoundingClientRect();
  const doorBox = door.getBoundingClientRect();
  return {
    title: document.querySelector('.rb-topo-page__figure-title')?.textContent || '',
    legendCount: document.querySelectorAll('.rb-topo-legend').length,
    statsText: stats ? stats.textContent.replace(/\s+/g, ' ').trim() : '',
    chromeLeft: Math.round(c.left),
    drawingRight: Math.round(d.right),
    doorTop: Math.round(doorBox.top),
    doorRight: Math.round(doorBox.right),
    legendTop: legend ? Math.round(legend.getBoundingClientRect().top) : null,
    hi: /H 10\.00/.test(stats?.textContent || ''),
    lo: /L 5\.50/.test(stats?.textContent || ''),
    delta: /Δ4\.50/.test(stats?.textContent || ''),
  };
});

check('Main Level page title', /Figure 2/.test(mainLevel.title) && /Main Level/.test(mainLevel.title), mainLevel.title);
check('Main Level has one legend and matching H/L/Δ',
  mainLevel.legendCount === 1 && mainLevel.hi && mainLevel.lo && mainLevel.delta,
  mainLevel.statsText);
check('Main Level chrome stays right of drawing',
  mainLevel.chromeLeft >= mainLevel.drawingRight - 2,
  `${mainLevel.chromeLeft} vs ${mainLevel.drawingRight}`);

await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Floor · Lower Level/i.test(node.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-topo-page__figure-title');
  return title && /Lower Level/.test(title.textContent || '');
}, { timeout: 15000 });

const lower = await page.evaluate(() => {
  const chrome = document.querySelector('.rb-topo-page__chrome');
  const drawing = document.querySelector('.rb-topo-page__drawing');
  const door = document.querySelector('.rb-topo-page__front-door');
  return {
    title: document.querySelector('.rb-topo-page__figure-title')?.textContent || '',
    chromeLeft: Math.round(chrome.getBoundingClientRect().left),
    drawingRight: Math.round(drawing.getBoundingClientRect().right),
    doorTop: Math.round(door.getBoundingClientRect().top),
    doorRight: Math.round(door.getBoundingClientRect().right),
    statsText: document.querySelector('.rb-topo-stats')?.textContent.replace(/\s+/g, ' ').trim() || '',
  };
});

check('Lower Level page title', /Figure 3/.test(lower.title) && /Lower Level/.test(lower.title), lower.title);
check('Legend/H-L chrome position matches Main Level page',
  lower.chromeLeft === mainLevel.chromeLeft,
  `${lower.chromeLeft} vs ${mainLevel.chromeLeft}`);
check('Front Door slot position matches across pages',
  lower.doorTop === mainLevel.doorTop && lower.doorRight === mainLevel.doorRight,
  JSON.stringify({ lower, main: { top: mainLevel.doorTop, right: mainLevel.doorRight } }));

await page.screenshot({ path: `${OUT}/report-topo-figure-lower.png`, fullPage: false });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Combined/i.test(node.querySelector('.rb-thumb__caption')?.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => /Combined/.test(document.querySelector('.rb-topo-page__figure-title')?.textContent || ''));
await page.screenshot({ path: `${OUT}/report-topo-figure-combined.png`, fullPage: false });

await writeFile(`${OUT}/report-topo-figure-pages.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
