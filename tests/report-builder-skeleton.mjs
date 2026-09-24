/**
 * Report Builder skeleton: 11×17 sequence, TOC from included pages,
 * repeated Distress and Floor sheets, and source jump links.
 * Run: node tests/report-builder-skeleton.mjs
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const logic = await page.evaluate(() => {
  const src = window.ToolboxReportSource;
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }

  const empty = src.assemble(src.read({ id: 'empty', firstName: 'Ada', lastName: 'Lovelace' }));
  const emptyTypes = empty.pages.map((item) => item.type);
  assert('empty file keeps the skeleton order',
    emptyTypes.join(',') === 'cover,toc,section,distress,floor,diagnostics,section,section,section',
    emptyTypes.join(','));
  const emptyTitles = src.contents(empty.pages).map((item) => item.title);
  assert('empty TOC lists reserved sections',
    emptyTitles.indexOf('Distress Survey') !== -1 &&
    emptyTitles.indexOf('Floor Survey') !== -1 &&
    emptyTitles.indexOf('Diagnostics') !== -1 &&
    emptyTitles.indexOf('Discussion') !== -1 &&
    emptyTitles.indexOf('Conclusions') !== -1 &&
    emptyTitles.indexOf('Limitations') !== -1,
    emptyTitles.join(' | '));
  assert('TOC skips cover and contents',
    emptyTitles.indexOf('Ada Lovelace') === -1 && emptyTitles.indexOf('Table of Contents') === -1);
  assert('TOC numbers are the sheet numbers',
    src.contents(empty.pages).every((item) => empty.pages[item.number - 1].id === item.pageId));

  const record = {
    id: 'synthetic-report',
    firstName: 'Riley',
    lastName: 'Chen',
    propertyAddress: '15 Example Court\nAlbuquerque, NM',
    cellPhone: '555-0101',
    email: 'riley@example.com',
    planSetup: {
      canvases: [
        { id: 'canvas-b', name: 'Basement' },
        { id: 'canvas-m', name: 'Main Level' },
        { id: 'canvas-2', name: 'Second Floor' },
      ],
    },
    distress: {
      pins: [
        { id: 'pin-m', canvasId: 'canvas-m', photos: ['a', 'b'] },
        { id: 'pin-b', canvasId: 'canvas-b', photos: ['c'] },
        { id: 'pin-2', canvasId: 'canvas-2', photos: [] },
      ],
    },
    floorSurvey: {
      id: 'floor-current',
      inspectionDate: '2026-03-02',
      byCanvasId: {
        'canvas-m': { points: [{ id: 'p1' }, { id: 'p2' }], areas: [{ id: 'area-1' }, { id: 'area-2' }] },
        'canvas-b': { points: [{ id: 'p3' }], recoveryPdfMediaId: 'fsrec_canvas-b' },
      },
      epochs: [
        {
          id: 'epoch-jan',
          label: 'January survey',
          inspectionDate: '2026-01-15',
          byCanvasId: {
            'canvas-b': { points: [{ id: 'old' }] },
          },
        },
      ],
    },
    diagnostics: {
      figures: [
        { id: 'dx-1', title: 'Level comparison' },
      ],
    },
  };

  const source = src.read(record);
  assert('identity comes from the Customer File',
    source.customerName === 'Riley Chen' && source.propertyAddress === '15 Example Court');
  assert('floor survey date is the stored inspection date', source.floorSurveyDate === '2026-03-02');
  assert('distress levels follow canvas order',
    source.distress.levels.map((level) => level.name).join(',') === 'Basement,Main Level,Second Floor');
  assert('distress counts stay with the level',
    source.distress.levels[0].pinCount === 1 && source.distress.levels[0].photoCount === 1 &&
    source.distress.levels[1].photoCount === 2);
  assert('floor figures stay consecutive and unmerged',
    source.floor.figures.map((figure) => figure.id).join(',') ===
      'floor-current::canvas-b,floor-current::canvas-m,epoch-jan::canvas-b',
    source.floor.figures.map((figure) => figure.id).join(','));
  assert('stored topo media is referenced, not rebuilt',
    source.floor.figures[0].figureMediaId === 'fsrec_canvas-b' &&
    source.floor.figures[0].readingCount === 1);
  assert('multiple topo areas stay on one level figure', source.floor.figures[1].areaCount === 2);

  const sequence = src.assemble(source);
  const distressIds = sequence.pages.filter((item) => item.type === 'distress').map((item) => item.id);
  const floorIds = sequence.pages.filter((item) => item.type === 'floor').map((item) => item.id);
  const types = sequence.pages.map((item) => item.type);
  const distressAt = types.indexOf('distress');
  const floorAt = types.indexOf('floor');
  const dxAt = types.indexOf('diagnostics');
  assert('distress sheets are consecutive',
    distressIds.length === 3 && types.slice(distressAt, distressAt + 3).every((type) => type === 'distress'));
  assert('floor sheets are consecutive after distress',
    floorIds.length === 3 && floorAt === distressAt + 3 &&
    types.slice(floorAt, floorAt + 3).every((type) => type === 'floor'));
  assert('diagnostics follows the floor block', dxAt === floorAt + 3);
  const toc = src.contents(sequence.pages).map((item) => item.title);
  assert('TOC names each distress and floor sheet',
    toc.indexOf('Distress Survey — Basement') !== -1 &&
    toc.indexOf('Distress Survey — Main Level') !== -1 &&
    toc.indexOf('Distress Survey — Second Floor') !== -1 &&
    toc.indexOf('Floor Survey — Basement — Current Floor Survey') !== -1 &&
    toc.indexOf('Floor Survey — Main Level — Current Floor Survey') !== -1 &&
    toc.indexOf('Floor Survey — Basement — January survey') !== -1 &&
    toc.indexOf('Diagnostics — Level comparison') !== -1,
    toc.join(' | '));
  const joined = JSON.stringify(sequence);
  assert('sequence does not invent findings language',
    !/recommend|settlement|causation|conclusion is|the building/i.test(joined));

  const enriched = src.read(record);
  window.ToolboxReportEvidence = {
    enrich(outline) {
      const copy = JSON.parse(JSON.stringify(outline));
      copy.distress.levels[0].pins = [{ id: 'pin-b', number: '1' }];
      return copy;
    },
  };
  const withEvidence = src.read(record);
  assert('enrich hook can attach evidence on the same source',
    withEvidence.distress.levels[0].pins && withEvidence.distress.levels[0].pins[0].id === 'pin-b');
  window.ToolboxReportEvidence = {
    enrich() { return { schema: 'other' }; },
  };
  const ignored = src.read(record);
  assert('a different schema is not used', !ignored.distress.levels[0].pins);
  window.ToolboxReportEvidence = null;

  return out;
});

logic.forEach((item) => check(item.name, item.ok, item.detail));

await page.evaluate(async () => {
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
  const record = window.ToolboxApp.blankCustomerFile('rb-skeleton');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Riley';
  record.lastName = 'Chen';
  record.propertyAddress = '15 Example Court';
  record.cellPhone = '555-0101';
  record.updatedAt = '2026-09-24T12:00:00.000Z';
  record.planSetup.canvases = [
    { id: 'canvas-b', name: 'Basement', rooms: [], frontDoorFacing: 'S', frontDoor: null, plan: null },
    { id: 'canvas-m', name: 'Main Level', rooms: [], frontDoorFacing: 'S', frontDoor: null, plan: null },
  ];
  record.distress.pins = [
    { id: 'pin-m', canvasId: 'canvas-m', photos: ['photo-1'] },
    { id: 'pin-b', canvasId: 'canvas-b', photos: ['photo-2', 'photo-3'] },
  ];
  record.floorSurvey.inspectionDate = '2026-03-02';
  record.floorSurvey.byCanvasId = {
    'canvas-b': { canvasId: 'canvas-b', points: [{ id: 'p1' }], recoveryPdfMediaId: 'fsrec_canvas-b' },
    'canvas-m': { canvasId: 'canvas-m', points: [{ id: 'p2' }], areas: [{ id: 'a1' }, { id: 'a2' }] },
  };
  await window.ToolboxDB.saveCustomerFile(record);
});

await page.goto(`${BASE}#/file/rb-skeleton/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return title && title.textContent === 'Riley Chen';
});

const opened = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet');
  const rect = sheet.getBoundingClientRect();
  const ratio = rect.width / rect.height;
  const toc = [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
  return {
    type: sheet.getAttribute('data-page-type'),
    title: document.querySelector('.rb-sheet__title').textContent,
    address: document.querySelector('.rb-sheet__meta') && document.querySelector('.rb-sheet__meta').textContent,
    ratio: Math.round(ratio * 100) / 100,
    links: [...document.querySelectorAll('[data-rb-source]')].map((node) => node.getAttribute('data-rb-source')),
    captions: toc,
    tool: document.querySelector('#rb-tool-status').textContent,
    notSaved: document.querySelector('.rb-rail__head span').textContent,
  };
});

check('cover uses the Customer File name', opened.type === 'cover' && opened.title === 'Riley Chen', JSON.stringify(opened));
check('cover shows the stored address', opened.address === '15 Example Court', opened.address);
check('sheet is 11×17 landscape', opened.ratio > 1.5 && opened.ratio < 1.58, String(opened.ratio));
check('source jump links remain', opened.links.join(',') === 'floor,distress,diagnostics', opened.links.join(','));
check('rail lists distress then floor sheets',
  opened.captions.indexOf('Distress · Basement') !== -1 &&
  opened.captions.indexOf('Distress · Basement') < opened.captions.indexOf('Distress · Main Level') &&
  opened.captions.indexOf('Floor · Basement') > opened.captions.indexOf('Distress · Main Level'),
  opened.captions.join(' | '));
check('composition tools stay reserved', /does not move/i.test(opened.tool), opened.tool);
check('sheets are still session-only', opened.notSaved === 'Not saved', opened.notSaved);

await page.screenshot({ path: `${OUT}/report-builder-skeleton-desktop-cover.png` });

await page.click('.rb-thumb[data-page-id="toc"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-type') === 'toc');
const tocUi = await page.evaluate(() => {
  return [...document.querySelectorAll('.rb-toc__item')].map((node) => ({
    title: node.querySelector('span').textContent,
    number: node.querySelector('.rb-toc__num').textContent,
    id: node.getAttribute('data-rb-goto'),
  }));
});
check('TOC is generated from included sheets',
  tocUi.some((item) => item.title === 'Distress Survey — Basement' && item.id === 'distress-canvas-b') &&
  tocUi.some((item) => item.title === 'Floor Survey — Main Level' && item.id.indexOf('::canvas-m') !== -1),
  tocUi.map((item) => item.number + ' ' + item.title).join(' | '));
const tocNumbers = await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll('.rb-thumb')];
  return [...document.querySelectorAll('.rb-toc__item')].every((node) => {
    const index = thumbs.findIndex((thumb) => thumb.getAttribute('data-page-id') === node.getAttribute('data-rb-goto'));
    return String(index + 1) === node.querySelector('.rb-toc__num').textContent;
  });
});
check('TOC page numbers match sheet order', tocNumbers);

await page.screenshot({ path: `${OUT}/report-builder-skeleton-desktop-toc.png` });

const floorEntry = tocUi.find((item) => item.title === 'Floor Survey — Basement');
await page.evaluate((pageId) => {
  document.querySelector(`[data-rb-goto="${pageId}"]`).click();
}, floorEntry.id);
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-type') === 'floor');
const floorSheet = await page.evaluate(() => ({
  title: document.querySelector('.rb-sheet__title').textContent,
  figure: document.querySelector('.rb-figure').textContent,
  meta: document.querySelector('.rb-sheet__meta').textContent,
  current: document.querySelector('[data-rb-source="floor"]').classList.contains('is-current'),
}));
check('floor sheet points at the stored topo', floorSheet.figure === 'Stored topo figure', JSON.stringify(floorSheet));
check('floor sheet keeps the survey date', /2026-03-02/.test(floorSheet.meta), floorSheet.meta);
check('floor sheet marks the Floor Survey link', floorSheet.current === true);

await page.click('[data-rb-source="distress"]');
await page.waitForFunction(() => location.hash.indexOf('/distress') !== -1);
check('Open Distress Survey still leaves Report Builder', page.url().indexOf('/distress') !== -1, page.url());

await page.goto(`${BASE}#/file/rb-skeleton/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return title && title.textContent === 'Riley Chen';
});
await page.click('.rb-thumb[data-page-id="section-discussion"]');
await page.click('#rb-page-earlier');
await page.click('.rb-thumb[data-page-id="toc"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-type') === 'toc');
const moved = await page.evaluate(() => {
  const titles = [...document.querySelectorAll('.rb-toc__item')].map((node) => node.querySelector('span').textContent);
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
  return {
    discussionBeforeDiagnostics: titles.indexOf('Discussion') < titles.indexOf('Diagnostics'),
    adjacent: captions.indexOf('Diagnostics') === captions.indexOf('Discussion') + 1,
    limitationsLast: titles[titles.length - 1] === 'Limitations',
  };
});
check('reordering updates the table of contents',
  moved.discussionBeforeDiagnostics && moved.adjacent && moved.limitationsLast,
  JSON.stringify(moved));

const unchanged = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-skeleton');
  return record.updatedAt === '2026-09-24T12:00:00.000Z' && !record.reportBuilder;
});
check('opening Report Builder does not write the Customer File', unchanged);

const desktopLayout = await page.evaluate(() => {
  const rail = document.querySelector('.rb-rail').getBoundingClientRect();
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  const panel = document.querySelector('.rb-panel').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  return {
    overlapRail: hit(rail, sheet),
    overlapPanel: hit(panel, sheet),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 200 && sheet.height > 120,
  };
});
check('desktop sheet is visible and does not overlap the rail or panel',
  !desktopLayout.overlapRail && !desktopLayout.overlapPanel && !desktopLayout.overflow && desktopLayout.sheetVisible,
  JSON.stringify(desktopLayout));

await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return title && title.textContent === 'Riley Chen';
});
await page.screenshot({ path: `${OUT}/report-builder-skeleton-ipad.png` });
const ipad = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 180 && sheet.height > 100,
    links: document.querySelectorAll('[data-rb-source]').length,
  };
});
check('iPad sheet stays visible with source links', !ipad.overflow && ipad.sheetVisible && ipad.links === 3, JSON.stringify(ipad));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return title && title.textContent === 'Riley Chen';
});
await page.click('.rb-thumb[data-page-id="distress-canvas-b"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'distress-canvas-b');
await page.screenshot({ path: `${OUT}/report-builder-skeleton-phone.png`, fullPage: true });
const phone = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  const link = document.querySelector('[data-rb-source="distress"]').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 140 && sheet.height > 80,
    title: document.querySelector('.rb-sheet__title').textContent,
    meta: document.querySelector('.rb-sheet__meta').textContent,
    linkReady: link.width > 40 && link.height > 20,
    overlap: hit(sheet, link),
  };
});
check('phone distress sheet shows the level and photograph count',
  phone.title === 'Basement' && /1 observation/.test(phone.meta) && /2 photographs/.test(phone.meta),
  JSON.stringify(phone));
check('phone layout keeps the sheet clear of the Distress link',
  !phone.overflow && phone.sheetVisible && phone.linkReady && !phone.overlap,
  JSON.stringify(phone));

await browser.close();

const failed = results.filter((item) => !item.ok);
if (failed.length) {
  console.error(`${failed.length} failed`);
  process.exit(1);
}
console.log(`${results.length} passed`);
