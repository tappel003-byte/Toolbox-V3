/**
 * Report Builder evidence plumbing.
 * Synthetic Customer Files only. Run: node tests/report-source.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
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
const OUT = '/opt/cursor/artifacts/screenshots';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PLAN = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#f4f1ea" stroke="#111"/><rect x="36" y="36" width="150" height="100" fill="none" stroke="#222"/><rect x="200" y="36" width="160" height="180" fill="none" stroke="#222"/></svg>'
);
const PHOTO = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#d9c7a6" stroke="#111"/></svg>'
);
const PDF = 'data:application/pdf;base64,JVBERi0xLjEKJfbk/N8KMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9Db3VudCAxIC9LaWRzIFsgMyAwIFIgXSA+PgplbmRvYmoKMyAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgNzIgNzAwIFRkIChUb3BvKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDc0IDAwMDAwIG4gCjAwMDAwMDAxMzEgMDAwMDAgbiAKMDAwMDAwMDIzMCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDUgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjMyNAolJUVPRg==';
const TOPO = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#fff" stroke="#111"/><path d="M80 300 C160 80 280 80 360 220" fill="none" stroke="#111" stroke-width="3"/><text x="40" y="40" font-size="28" fill="#111">Finished topo</text></svg>'
);

const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

function canvases() {
  return [
    {
      id: 'canvas-basement',
      name: 'Basement',
      plan: { id: 'plan-basement', width: 400, height: 260 },
      rooms: [],
    },
    {
      id: 'canvas-main',
      name: 'Main Level',
      plan: { id: 'plan-main', width: 400, height: 260 },
      rooms: [],
    },
  ];
}

function baseRecord(id) {
  return {
    id: id,
    firstName: 'Ada',
    lastName: 'Marin',
    propertyAddress: '100 Evidence Lane',
    companyName: 'Northline',
    createdAt: '2026-04-01T12:00:00.000Z',
    updatedAt: '2026-04-02T18:30:00.000Z',
    planSetup: { canvases: canvases() },
  };
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(BASE, { waitUntil: 'networkidle0' });

const report = await page.evaluate(async (fixtures) => {
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name: name, ok: !!cond, detail: detail || '' });
  }
  const png = fixtures.png;
  const photo = fixtures.photo;
  const pdf = fixtures.pdf;
  const topo = fixtures.topo;
  const plan = fixtures.plan;
  const media = {
    'plan-basement': plan,
    'plan-main': plan,
    'fsrec_canvas-basement': pdf,
    'fsrec_canvas-main': topo,
    'fsrec_epoch-main': pdf,
    'area-kitchen': topo,
    'area-hall': plan,
  };
  const photos = { 'ph-a': photo, 'ph-b': photo, 'ph-c': photo };
  const deps = {
    getMedia: function (id) { return Promise.resolve(media[id] || null); },
    getDistressMedia: function (id) { return Promise.resolve(photos[id] || null); },
  };
  const before = JSON.stringify(fixtures.oneDistress);

  const one = await window.ToolboxReportSource.assemble(fixtures.oneDistress, deps);
  assert('one distress level is one slide', one.distress.slides.length === 1 && one.pages.length === 1, JSON.stringify(one.pages.map(function (p) { return p.kind; })));
  const slide = one.distress.slides[0];
  assert('one distress slide keeps the plan and both pins',
    slide.kind === 'distress-level' &&
    slide.levelName === 'Basement' &&
    slide.plan.mediaId === 'plan-basement' &&
    slide.plan.dataUrl === plan &&
    slide.pins.length === 2);
  assert('photograph numbers stay on their pins',
    slide.pins[0].number === 1 &&
    slide.pins[0].photoNumbers.join(',') === '1,2' &&
    slide.pins[0].photos[0].id === 'ph-a' &&
    slide.pins[0].photos[0].displayNumber === 1 &&
    slide.pins[0].photos[0].dataUrl === photo &&
    slide.pins[0].photos[1].id === 'ph-missing' &&
    slide.pins[0].photos[1].displayNumber === 2 &&
    slide.pins[0].photos[1].missing === true &&
    slide.pins[1].number === 3 &&
    slide.pins[1].photos[0].displayNumber === 3 &&
    slide.pins[1].photos[0].id === 'ph-b');
  assert('description and comment stay with the pin',
    slide.pins[0].text.indexOf('Sill crack') !== -1 && slide.pins[0].text.indexOf('north jamb') !== -1);
  assert('stored pin numbers are recomputed', slide.pins[0].number === 1 && fixtures.oneDistress.distress.pins[0].num === 99);
  assert('customer identity comes from the Customer File',
    one.identity.name === 'Ada Marin' &&
    one.identity.address === '100 Evidence Lane' &&
    one.identity.companyName === 'Northline' &&
    one.identity.fileDate === '2026-04-02' &&
    slide.identity.fileDate === '2026-04-02');
  assert('assemble does not rewrite the Customer File object', JSON.stringify(fixtures.oneDistress) === before);

  const multi = await window.ToolboxReportSource.assemble(fixtures.multiDistress, deps);
  assert('multi-level distress is one slide per level',
    multi.distress.slides.length === 2 &&
    multi.distress.slides[0].levelName === 'Basement' &&
    multi.distress.slides[1].levelName === 'Main Level');
  const mainPin = multi.distress.slides[1].pins[0];
  assert('numbering continues across levels and the photo stays linked',
    multi.distress.slides[0].pins[0].photoNumbers.join(',') === '1,2' &&
    multi.distress.slides[0].pins[1].number === 3 &&
    mainPin.number === 4 &&
    mainPin.photos.length === 1 &&
    mainPin.photos[0].id === 'ph-c' &&
    mainPin.photos[0].displayNumber === 4 &&
    mainPin.canvasId == null &&
    multi.distress.slides[1].canvasId === 'canvas-main');
  assert('a level change does not restart at 1', mainPin.number !== 1 && mainPin.photos[0].displayNumber !== 1);

  const oneFloor = await window.ToolboxReportSource.assemble(fixtures.oneFloor, deps);
  const floorPage = oneFloor.floor.slides[0];
  const floorJson = JSON.stringify(floorPage);
  assert('one floor topo is one stored rendering',
    oneFloor.floor.slides.length === 1 &&
    floorPage.kind === 'floor-topo' &&
    floorPage.figure.kind === 'stored-rendering' &&
    floorPage.figure.mediaId === 'fsrec_canvas-basement' &&
    floorPage.figure.mime === 'pdf' &&
    floorPage.figure.dataUrl === pdf &&
    floorPage.readingsRebuilt === false &&
    floorPage.surveyDate === '2026-03-15');
  assert('floor slide does not rebuild the readings',
    floorJson.indexOf('8.125') === -1 && floorJson.indexOf('"points"') === -1);

  const levels = await window.ToolboxReportSource.assemble(fixtures.multiFloor, deps);
  assert('multiple floor levels are consecutive slides',
    levels.floor.slides.length === 2 &&
    levels.pages.map(function (p) { return p.canvasId; }).join(',') === 'canvas-basement,canvas-main' &&
    levels.floor.slides[0].figure.mediaId === 'fsrec_canvas-basement' &&
    levels.floor.slides[1].figure.mediaId === 'fsrec_canvas-main' &&
    levels.floor.slides[0].figure.mime === 'pdf' &&
    levels.floor.slides[1].figure.mime === 'image');

  const epochs = await window.ToolboxReportSource.assemble(fixtures.multiEpoch, deps);
  const epochJson = JSON.stringify(epochs.floor.slides);
  assert('epochs stay consecutive and are not flattened',
    epochs.floor.slides.length === 2 &&
    epochs.floor.slides[0].epochId === 'current-floor' &&
    epochs.floor.slides[0].surveyDate === '2026-03-15' &&
    epochs.floor.slides[0].figure.mediaId === 'fsrec_canvas-basement' &&
    epochs.floor.slides[1].epochId === 'epoch-spring' &&
    epochs.floor.slides[1].surveyDate === '2025-11-02' &&
    epochs.floor.slides[1].figure.mediaId === 'fsrec_epoch-main' &&
    epochJson.indexOf('8.125') === -1 &&
    epochJson.indexOf('4.5') === -1);

  const areas = await window.ToolboxReportSource.assemble(fixtures.multiArea, deps);
  assert('separate area renderings are consecutive slides',
    areas.floor.slides.length === 2 &&
    areas.floor.slides[0].areaName === 'Kitchen' &&
    areas.floor.slides[0].figure.mediaId === 'area-kitchen' &&
    areas.floor.slides[1].areaName === 'Hall' &&
    areas.floor.slides[1].figure.mediaId === 'area-hall' &&
    areas.floor.slides[0].readingsRebuilt === false &&
    areas.floor.slides[1].readingsRebuilt === false);

  const shared = await window.ToolboxReportSource.assemble(fixtures.sharedAreas, deps);
  assert('one stored canvas rendering stays one slide',
    shared.floor.slides.length === 1 &&
    shared.floor.slides[0].figure.mediaId === 'fsrec_canvas-basement' &&
    shared.floor.slides[0].areaNames.join(',') === 'Kitchen,Hall' &&
    shared.floor.slides[0].readingsRebuilt === false &&
    JSON.stringify(shared.floor.slides[0]).indexOf('8.125') === -1);

  const missing = await window.ToolboxReportSource.assemble(fixtures.missingFigure, deps);
  assert('missing rendering is not replaced with a reading plot',
    missing.floor.slides.length === 1 &&
    missing.floor.slides[0].figure.kind === 'unavailable' &&
    missing.floor.slides[0].note === window.ToolboxReportSource.FLOOR_MISSING_NOTE &&
    missing.floor.slides[0].readingsRebuilt === false &&
    missing.floor.slides[0].readingCount === 1 &&
    JSON.stringify(missing.floor.slides[0]).indexOf('8.125') === -1);

  const empty = await window.ToolboxReportSource.assemble(fixtures.emptyFile, deps);
  assert('empty file does not invent evidence pages',
    empty.pages.length === 0 && empty.distress.status === 'absent' && empty.floor.status === 'absent' &&
    empty.identity.name === 'Ada Marin');

  return out;
}, {
  png: PNG,
  photo: PHOTO,
  pdf: PDF,
  topo: TOPO,
  plan: PLAN,
  oneDistress: Object.assign(baseRecord('cf-one-distress'), {
    distress: {
      startNum: 1,
      mode: 'internal',
      pins: [
        {
          id: 'pin-a',
          num: 99,
          canvasId: 'canvas-basement',
          x: 120,
          y: 80,
          description: 'Sill crack',
          comment: 'north jamb',
          location: 'North bedroom',
          photos: ['ph-a', 'ph-missing'],
        },
        {
          id: 'pin-b',
          num: 1,
          canvasId: 'canvas-basement',
          x: 240,
          y: 140,
          description: 'Stair gap',
          photos: ['ph-b'],
        },
      ],
    },
  }),
  multiDistress: Object.assign(baseRecord('cf-multi-distress'), {
    distress: {
      startNum: 1,
      pins: [
        { id: 'pin-a', num: 1, canvasId: 'canvas-basement', x: 40, y: 40, description: 'Sill crack', photos: ['ph-a', 'ph-b'] },
        { id: 'pin-b', num: 1, canvasId: 'canvas-basement', x: 80, y: 80, description: 'No photo', photos: [] },
        { id: 'pin-c', num: 1, canvasId: 'canvas-main', x: 90, y: 90, description: 'Ceiling stain', photos: ['ph-c'] },
      ],
    },
  }),
  oneFloor: Object.assign(baseRecord('cf-one-floor'), {
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-basement': {
          canvasId: 'canvas-basement',
          recoveryPdfMediaId: 'fsrec_canvas-basement',
          points: [{ id: 'p1', x: 10, y: 12, value: 8.125 }],
          areas: [{ id: 'a1', name: 'Kitchen', polygon: [{ x: 1, y: 1 }] }],
        },
      },
    },
  }),
  multiFloor: Object.assign(baseRecord('cf-multi-floor'), {
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-main': {
          canvasId: 'canvas-main',
          figureMediaId: 'fsrec_canvas-main',
          points: [{ id: 'p2', x: 3, y: 4, value: 4.5 }],
        },
        'canvas-basement': {
          canvasId: 'canvas-basement',
          recoveryPdfMediaId: 'fsrec_canvas-basement',
          points: [{ id: 'p1', x: 1, y: 2, value: 8.125 }],
        },
      },
    },
  }),
  multiEpoch: Object.assign(baseRecord('cf-epochs'), {
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-basement': {
          canvasId: 'canvas-basement',
          recoveryPdfMediaId: 'fsrec_canvas-basement',
          points: [{ id: 'p1', x: 1, y: 2, value: 8.125 }],
        },
      },
      epochs: [
        {
          id: 'epoch-spring',
          label: 'November survey',
          surveyDate: '2025-11-02',
          byCanvasId: {
            'canvas-main': {
              canvasId: 'canvas-main',
              recoveryPdfMediaId: 'fsrec_epoch-main',
              points: [{ id: 'p9', x: 9, y: 9, value: 4.5 }],
            },
          },
        },
      ],
    },
  }),
  multiArea: Object.assign(baseRecord('cf-areas'), {
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-basement': {
          canvasId: 'canvas-basement',
          points: [{ id: 'p1', x: 1, y: 1, value: 8.125 }],
          areas: [
            { id: 'kitchen', name: 'Kitchen', polygon: [{ x: 1, y: 1 }], figureMediaId: 'area-kitchen' },
            { id: 'hall', name: 'Hall', polygon: [{ x: 2, y: 2 }], figureMediaId: 'area-hall' },
          ],
        },
      },
    },
  }),
  sharedAreas: Object.assign(baseRecord('cf-shared'), {
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-basement': {
          canvasId: 'canvas-basement',
          recoveryPdfMediaId: 'fsrec_canvas-basement',
          points: [{ id: 'p1', x: 1, y: 1, value: 8.125 }],
          areas: [
            { id: 'kitchen', name: 'Kitchen', polygon: [{ x: 1, y: 1 }] },
            { id: 'hall', name: 'Hall', polygon: [{ x: 2, y: 2 }] },
          ],
        },
      },
    },
  }),
  missingFigure: Object.assign(baseRecord('cf-missing-figure'), {
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-basement': {
          canvasId: 'canvas-basement',
          points: [{ id: 'p1', x: 5, y: 6, value: 8.125 }],
        },
      },
    },
  }),
  emptyFile: baseRecord('cf-empty'),
});

report.forEach(function (item) { check(item.name, item.ok, item.detail); });

await page.evaluate(async (seed) => {
  const db = window.ToolboxDB;
  await db.putMedia('plan-basement', seed.plan);
  await db.putMedia('plan-main', seed.plan);
  await db.putMedia('fsrec_canvas-basement', seed.pdf);
  await db.putMedia('fsrec_canvas-main', seed.topo);
  const record = seed.record;
  record.distress.pins[0].photos = [seed.photo, 'ph-missing'];
  await db.saveCustomerFile(record);
  window.__rbSaves = 0;
  const orig = db.saveCustomerFile;
  db.saveCustomerFile = function () {
    window.__rbSaves += 1;
    return orig.apply(db, arguments);
  };
}, {
  plan: PLAN,
  pdf: PDF,
  topo: TOPO,
  photo: PHOTO,
  record: Object.assign(baseRecord('cf-evidence-ui'), {
    distress: {
      startNum: 1,
      pins: [
        {
          id: 'pin-a',
          num: 99,
          canvasId: 'canvas-basement',
          x: 120,
          y: 90,
          description: 'Sill crack',
          comment: 'north jamb',
          location: 'North bedroom',
          photos: [],
        },
        {
          id: 'pin-b',
          num: 1,
          canvasId: 'canvas-basement',
          x: 250,
          y: 150,
          description: 'Stair gap',
          photos: [],
        },
        {
          id: 'pin-c',
          num: 1,
          canvasId: 'canvas-main',
          x: 180,
          y: 80,
          description: 'Ceiling stain',
          photos: [PHOTO],
        },
      ],
    },
    floorSurvey: {
      id: 'current-floor',
      inspectionDate: '2026-03-15',
      byCanvasId: {
        'canvas-basement': {
          canvasId: 'canvas-basement',
          recoveryPdfMediaId: 'fsrec_canvas-basement',
          points: [{ id: 'p1', x: 10, y: 12, value: 8.125 }],
          areas: [
            { id: 'kitchen', name: 'Kitchen', polygon: [{ x: 1, y: 1 }] },
            { id: 'hall', name: 'Hall', polygon: [{ x: 2, y: 2 }] },
          ],
        },
        'canvas-main': {
          canvasId: 'canvas-main',
          figureMediaId: 'fsrec_canvas-main',
          points: [{ id: 'p2', x: 4, y: 5, value: 4.5 }],
        },
      },
    },
  }),
});

function rects() {
  function rect(selector) {
    const node = document.querySelector(selector);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  }
  function overlaps(a, b) {
    if (!a || !b || a.width < 1 || b.width < 1 || a.height < 1 || b.height < 1) return false;
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }
  function inside(inner, outer) {
    if (!inner || !outer) return false;
    return inner.left >= outer.left - 1 && inner.right <= outer.right + 1 &&
      inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
  }
  const sheet = rect('.rb-sheet');
  const bar = rect('.app-bar');
  const exportBtn = rect('#rb-export-ai');
  const name = rect('.file-identity__name');
  const jump = rect('.rb-jump');
  const title = rect('.rb-evidence__title');
  return {
    sheet: sheet,
    title: title ? title.width : 0,
    kind: document.querySelector('.rb-sheet') ? document.querySelector('.rb-sheet').getAttribute('data-page-kind') : '',
    heading: document.querySelector('.rb-evidence__title') ? document.querySelector('.rb-evidence__title').textContent : '',
    identity: document.querySelector('.rb-evidence__identity') ? document.querySelector('.rb-evidence__identity').textContent : '',
    mode: document.querySelector('#rb-mode') ? document.querySelector('#rb-mode').textContent : '',
    thumbs: Array.from(document.querySelectorAll('.rb-thumb__caption')).map(function (node) { return node.textContent; }),
    overlapsBar: overlaps(sheet, bar),
    overlapsExport: overlaps(sheet, exportBtn),
    overlapsName: overlaps(exportBtn, name),
    jumpInside: inside(jump, sheet),
    titleInside: inside(title, sheet),
    inputs: document.querySelectorAll('.rb-sheet input, .rb-sheet textarea').length,
  };
}

async function openReport() {
  const hash = await page.evaluate(function () { return window.location.hash; });
  if (hash.indexOf('/report') === -1) {
    await page.evaluate(function () { window.location.hash = '#/file/cf-evidence-ui/report'; });
  } else {
    await page.evaluate(function () {
      const first = document.querySelector('.rb-thumb');
      if (first) first.click();
    });
  }
  await page.waitForFunction(function () {
    const title = document.querySelector('.rb-evidence__title');
    const label = document.querySelector('#rb-file-label');
    return title && title.textContent.indexOf('Distress Survey — Basement') === 0 &&
      label && label.textContent.indexOf('Ada Marin') !== -1;
  });
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
}

async function shot(width, height, name) {
  await page.setViewport({ width: width, height: height });
  await openReport();
  const box = await page.evaluate(rects);
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: false });
  check(name + ' shows distress evidence inside the sheet',
    box.kind === 'distress-level' &&
    box.heading.indexOf('Basement') !== -1 &&
    box.identity.indexOf('Ada Marin') !== -1 &&
    box.identity.indexOf('100 Evidence Lane') !== -1 &&
    box.mode === 'Evidence' &&
    box.inputs === 0 &&
    box.sheet && box.sheet.height > 120 &&
    !box.overlapsBar && !box.overlapsExport && !box.overlapsName &&
    box.jumpInside && box.titleInside,
    JSON.stringify(box));
  return box;
}

await shot(1280, 800, 'report-evidence-desktop');
const desktopThumbs = await page.evaluate(function () {
  return Array.from(document.querySelectorAll('.rb-thumb__caption')).map(function (node) { return node.textContent; });
});
check('desktop opens four consecutive evidence sheets',
  desktopThumbs.length === 4 &&
  desktopThumbs[0].indexOf('Distress Survey — Basement') === 0 &&
  desktopThumbs[1].indexOf('Distress Survey — Main Level') === 0 &&
  desktopThumbs[2].indexOf('Floor Survey — Basement') === 0 &&
  desktopThumbs[3].indexOf('Floor Survey — Main Level') === 0,
  JSON.stringify(desktopThumbs));

await page.click('#rb-page-later');
const moved = await page.evaluate(function () {
  return {
    active: document.querySelector('.rb-thumb.is-active .rb-thumb__caption').textContent,
    first: document.querySelector('.rb-thumb__caption').textContent,
    count: document.querySelectorAll('.rb-thumb').length,
  };
});
check('page order can change without dropping the evidence',
  moved.count === 4 &&
  moved.first.indexOf('Distress Survey — Main Level') === 0 &&
  moved.active.indexOf('Distress Survey — Basement') === 0,
  JSON.stringify(moved));

await page.click('#rb-page-earlier');
const restored = await page.evaluate(function () {
  return document.querySelector('.rb-thumb__caption').textContent;
});
check('evidence order can be restored', restored.indexOf('Distress Survey — Basement') === 0, restored);

const thumbs = await page.$$('.rb-thumb');
await thumbs[3].click();
await page.waitForFunction(function () {
  const title = document.querySelector('.rb-evidence__title');
  return title && title.textContent.indexOf('Floor Survey') !== -1 && title.textContent.indexOf('Main Level') !== -1;
});
const floorBox = await page.evaluate(function () {
  const figure = document.querySelector('.rb-figure');
  const title = document.querySelector('.rb-evidence__title');
  const date = document.querySelector('.rb-evidence__date');
  const text = document.querySelector('.rb-sheet').innerText;
  return {
    kind: figure ? figure.getAttribute('data-figure-kind') : '',
    mediaId: figure ? figure.getAttribute('data-media-id') : '',
    title: title ? title.textContent : '',
    date: date ? date.textContent : '',
    rebuilt: text.indexOf('8.125') !== -1 || text.indexOf('4.5') !== -1,
    image: !!document.querySelector('.rb-figure__img'),
  };
});
check('floor sheet uses the stored rendering and the survey date',
  floorBox.kind === 'stored-rendering' &&
  floorBox.mediaId === 'fsrec_canvas-main' &&
  floorBox.date === 'Survey date 2026-03-15' &&
  floorBox.image === true &&
  floorBox.rebuilt === false,
  JSON.stringify(floorBox));
await page.screenshot({ path: OUT + '/report-evidence-floor-desktop.png', fullPage: false });

await page.evaluate(function () {
  const thumbs = Array.from(document.querySelectorAll('.rb-thumb'));
  thumbs[2].click();
});
await page.waitForFunction(function () {
  const figure = document.querySelector('.rb-figure');
  return figure && figure.getAttribute('data-media-id') === 'fsrec_canvas-basement';
});
const pdfBox = await page.evaluate(function () {
  const figure = document.querySelector('.rb-figure');
  const areas = document.querySelector('.rb-figure__areas');
  return {
    kind: figure.getAttribute('data-figure-kind'),
    mime: document.querySelector('.rb-figure__pdf') ? document.querySelector('.rb-figure__pdf').type : '',
    areas: areas ? areas.textContent : '',
    reading: document.querySelector('.rb-sheet').innerText.indexOf('8.125') !== -1,
  };
});
check('shared areas stay on the stored PDF slide',
  pdfBox.kind === 'stored-rendering' &&
  pdfBox.mime === 'application/pdf' &&
  pdfBox.areas.indexOf('Kitchen') !== -1 &&
  pdfBox.areas.indexOf('Hall') !== -1 &&
  pdfBox.reading === false,
  JSON.stringify(pdfBox));

await shot(834, 1112, 'report-evidence-ipad');
await shot(390, 844, 'report-evidence-phone');

const saves = await page.evaluate(function () { return window.__rbSaves; });
check('opening Report Builder does not save the Customer File', saves === 0, String(saves));

await page.setViewport({ width: 1280, height: 800 });
await openReport();
const distressJump = await page.evaluate(function () {
  const button = document.querySelector('.rb-jump');
  return {
    source: button.getAttribute('data-rb-source'),
    canvas: button.getAttribute('data-rb-canvas'),
  };
});
await page.click('.rb-jump');
await page.waitForFunction(function () { return window.location.hash.indexOf('/distress') !== -1; });
const distressHash = await page.evaluate(function () { return window.location.hash; });
check('distress jump returns to Distress Survey',
  distressJump.source === 'distress' &&
  distressJump.canvas === 'canvas-basement' &&
  distressHash.indexOf('#/file/cf-evidence-ui/distress') === 0,
  distressHash + ' ' + JSON.stringify(distressJump));

await openReport();
await page.evaluate(function () {
  const thumbs = Array.from(document.querySelectorAll('.rb-thumb'));
  thumbs[2].click();
});
await page.waitForSelector('.rb-figure');
const floorJump = await page.evaluate(function () {
  const button = document.querySelector('.rb-jump');
  return {
    source: button.getAttribute('data-rb-source'),
    canvas: button.getAttribute('data-rb-canvas'),
  };
});
await page.click('.rb-jump');
await page.waitForFunction(function () { return window.location.hash.indexOf('/floor') !== -1; });
const floorHash = await page.evaluate(function () { return window.location.hash; });
check('floor jump keeps the source link',
  floorJump.source === 'floor' &&
  floorJump.canvas === 'canvas-basement' &&
  floorHash.indexOf('#/file/cf-evidence-ui/floor') === 0,
  floorHash + ' ' + JSON.stringify(floorJump));

await browser.close();

const failed = results.filter(function (item) { return !item.ok; });
console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
