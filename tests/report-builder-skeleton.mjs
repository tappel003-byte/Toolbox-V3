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
  assert('empty file is cover, discussion, then floor figure',
    emptyTypes.join(',') === 'cover,section,floor',
    emptyTypes.join(','));
  const emptyTitles = src.contents(empty.pages).map((item) => item.title);
  assert('CONTENTS starts with Discussion then Floor Survey',
    emptyTitles[0] === 'Floor Level Survey Results - Discussion' &&
    emptyTitles.indexOf('Floor Survey') !== -1 &&
    emptyTitles.indexOf('Table of Contents') === -1 &&
    emptyTitles.indexOf('Property') === -1,
    emptyTitles.join(' | '));
  assert('TOC skips cover',
    emptyTitles.indexOf('Ada Lovelace') === -1);
  assert('figures after Discussion are numbered',
    empty.pages.filter((p) => p.type === 'floor')[0].meta.figureNumber === 1);

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
  assert('stored topo media is referenced on the outline',
    source.floor.figures[0].figureMediaId === 'fsrec_canvas-b' &&
    source.floor.figures[0].readingCount === 1);
  assert('areas without closed polygons stay one level figure',
    source.floor.figures[1].areaCount === 0 && source.floor.figures[1].name === 'Main Level',
    JSON.stringify(source.floor.figures[1]));

  const sequence = src.assemble(source);
  const distressIds = sequence.pages.filter((item) => item.type === 'distress').map((item) => item.id);
  const floorIds = sequence.pages.filter((item) => item.type === 'floor').map((item) => item.id);
  const types = sequence.pages.map((item) => item.type);
  const discussionAt = types.indexOf('section');
  const floorAt = types.indexOf('floor');
  const distressAt = types.indexOf('distress');
  assert('discussion is immediately after cover',
    types[0] === 'cover' && discussionAt === 1);
  assert('floor sheets are consecutive after discussion',
    floorIds.length === 3 && floorAt === 2 &&
    types.slice(floorAt, floorAt + 3).every((type) => type === 'floor'));
  assert('picture locations follow the floor block',
    distressIds.length === 3 && distressAt === floorAt + 3 &&
    types.slice(distressAt, distressAt + 3).every((type) => type === 'distress'));
  assert('diagnostics is not auto-assembled', types.indexOf('diagnostics') === -1);
  const toc = src.contents(sequence.pages).map((item) => item.title);
  assert('CONTENTS names discussion, floor, and picture locations',
    toc[0] === 'Floor Level Survey Results - Discussion' &&
    toc.indexOf('Picture Locations — Basement') !== -1 &&
    toc.indexOf('Picture Locations — Main Level') !== -1 &&
    toc.indexOf('Floor Level Survey — Basement — Current Floor Survey') !== -1 &&
    toc.indexOf('Floor Level Survey — Main Level — Current Floor Survey') !== -1 &&
    toc.indexOf('Floor Level Survey — Basement — January survey') !== -1,
    toc.join(' | '));
  assert('Figure 1 is the first floor sheet',
    sequence.pages[floorAt].meta.figureNumber === 1,
    String(sequence.pages[floorAt].meta.figureNumber));
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
  const name = document.querySelector('.rb-cover__name');
  return name && name.textContent === 'Riley Chen';
});

const opened = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet');
  const rect = sheet.getBoundingClientRect();
  const ratio = rect.width / rect.height;
  const toc = [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
  return {
    type: sheet.getAttribute('data-page-type'),
    title: document.querySelector('.rb-cover__name')?.textContent || '',
    address: document.querySelector('.rb-cover__street')?.textContent || '',
    product: document.querySelector('.rb-cover__product')?.textContent || '',
    contents: document.querySelector('.rb-cover__contents-title')?.textContent || '',
    ratio: Math.round(ratio * 100) / 100,
    links: [...document.querySelectorAll('[data-rb-source]')].map((node) => node.getAttribute('data-rb-source')),
    captions: toc,
    fakeTools: [...document.querySelectorAll('[data-rb-tool]')].map((node) => node.textContent),
    lead: document.querySelector('.rb-toolbar__lead')?.textContent || '',
    exportAi: !!document.querySelector('#rb-export-ai'),
    saveStatus: document.querySelector('#rb-save-status')?.textContent || '',
  };
});

check('cover uses the Customer File name', opened.type === 'cover' && opened.title === 'Riley Chen', JSON.stringify(opened));
check('cover shows the stored address', opened.address === '15 Example Court', opened.address);
check('cover shows FLOOR LEVEL SURVEY and CONTENTS',
  opened.product === 'FLOOR LEVEL SURVEY' && opened.contents === 'CONTENTS',
  `${opened.product} | ${opened.contents}`);
check('sheet is 11×17 landscape', opened.ratio > 1.5 && opened.ratio < 1.58, String(opened.ratio));
check('source jump links remain', opened.links.join(',') === 'floor,distress,diagnostics', opened.links.join(','));
check('rail lists Discussion, floor, then picture locations',
  opened.captions.indexOf('Discussion') !== -1 &&
  opened.captions.indexOf('Floor · Basement') !== -1 &&
  opened.captions.indexOf('Picture Locations · Basement') !== -1 &&
  opened.captions.indexOf('Floor · Basement') < opened.captions.indexOf('Picture Locations · Basement'),
  opened.captions.join(' | '));
check('fake composition toolbar is gone', opened.fakeTools.length === 0, opened.fakeTools.join(','));
check('workspace keeps Export for AI and rebuild lead',
  opened.exportAi && /screenshots/i.test(opened.lead),
  opened.lead);
const coverBoxes = await page.evaluate(() => ({
  boxes: [...document.querySelectorAll('[data-rb-cover-box]')].map((n) => n.getAttribute('data-rb-cover-box')),
  maps: !!document.querySelector('.rb-cover__maps-link'),
  lock: document.querySelector('[data-rb-cover-lock]')?.getAttribute('data-rb-cover-lock') || '',
  contents: [...document.querySelectorAll('.rb-cover__contents-item')].map((n) => n.textContent.trim()),
}));
check('title page has movable Mitchell boxes',
  coverBoxes.boxes.join(',') === 'prepared,identity,date,contents,overview' &&
  coverBoxes.lock === 'lock' &&
  coverBoxes.maps,
  JSON.stringify(coverBoxes));
check('CONTENTS on title lists Discussion then figures',
  /Discussion/i.test(coverBoxes.contents[0] || '') &&
  coverBoxes.contents.some((t) => /Figure 1/.test(t)),
  coverBoxes.contents.join(' | '));
await page.waitForFunction(() => {
  const text = document.querySelector('#rb-save-status')?.textContent || '';
  return /^Saved/.test(text);
}, { timeout: 10000 });
const saveStatus = await page.evaluate(() => document.querySelector('#rb-save-status')?.textContent || '');
check('report autosaves onto the Customer File', /^Saved/.test(saveStatus), saveStatus);
const persisted = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-skeleton');
  const doc = record && record.reportBuilder;
  return {
    hasDoc: !!(doc && Array.isArray(doc.pages) && doc.pages.length),
    pageCount: doc && doc.pages ? doc.pages.length : 0,
    hasEvidenceBlob: !!(doc && doc.pages && doc.pages.some((p) => p && p.evidence)),
    activePageId: doc && doc.activePageId || '',
  };
});
check('saved reportBuilder has pages and no evidence blobs',
  persisted.hasDoc && persisted.pageCount >= 5 && !persisted.hasEvidenceBlob,
  JSON.stringify(persisted));

await page.screenshot({ path: `${OUT}/report-builder-skeleton-desktop-cover.png` });

const floorThumb = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Floor · Basement/.test(node.querySelector('.rb-thumb__caption')?.textContent || ''));
  return btn ? btn.getAttribute('data-page-id') : '';
});
check('rail lists the Basement floor sheet', !!floorThumb, floorThumb);
if (floorThumb) {
  await page.click(`.rb-thumb[data-page-id="${floorThumb}"]`);
  await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-type') === 'floor');
  const floorSheet = await page.evaluate(() => ({
    title: document.querySelector('.rb-sheet__title')?.textContent ||
      document.querySelector('.rb-topo-page__figure-title')?.textContent || '',
    figure: document.querySelector('.rb-figure')?.textContent ||
      (document.querySelector('.rb-topo-page__image') ? 'Composed topo figure' : ''),
    meta: document.querySelector('.rb-sheet__meta')?.textContent ||
      document.querySelector('.rb-topo-page__survey-date')?.textContent || '',
    current: document.querySelector('[data-rb-source="floor"]').classList.contains('is-current'),
  }));
  check('floor sheet shows topo evidence or reserved figure',
    /topo figure|Composed topo|reserved/i.test(floorSheet.figure) || /Floor Level Survey/.test(floorSheet.title),
    JSON.stringify(floorSheet));
  check('floor sheet keeps the survey date', /2026-03-02|03\/02\/26|03\/02\/2026/.test(floorSheet.meta), floorSheet.meta);
  check('floor sheet marks the Floor Survey link', floorSheet.current === true);
}

await page.click('[data-rb-source="distress"]');
await page.waitForFunction(() => location.hash.indexOf('/distress') !== -1, { timeout: 15000 });
check('Open Distress Survey still leaves Report Builder', page.url().indexOf('/distress') !== -1, page.url());

await page.goto(`${BASE}#/file/rb-skeleton/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const label = document.querySelector('#rb-file-label')?.textContent || '';
  return document.querySelector('.rb-shell') && /Riley Chen/.test(label);
}, { timeout: 15000 });
await page.click('.rb-thumb[data-page-id="cover"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet')?.getAttribute('data-page-type') === 'cover');
await page.click('[data-rb-cover-lock="lock"]');
await page.waitForFunction(() => document.querySelector('[data-rb-cover-lock="unlock"]'), { timeout: 10000 });
const locked = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-skeleton');
  return {
    btn: document.querySelector('[data-rb-cover-lock]')?.getAttribute('data-rb-cover-lock') || '',
    locked: !!(record && record.reportBuilder && record.reportBuilder.coverLayout && record.reportBuilder.coverLayout.locked),
  };
});
check('title Lock persists coverLayout', locked.btn === 'unlock' && locked.locked, JSON.stringify(locked));

const reportSaved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-skeleton');
  const doc = record && record.reportBuilder;
  return {
    hasReport: !!(doc && Array.isArray(doc.pages) && doc.pages.length),
    updatedMoved: record.updatedAt !== '2026-09-24T12:00:00.000Z',
    noEvidence: !!(doc && doc.pages && doc.pages.every((p) => !p.evidence)),
  };
});
check('opening Report Builder autosaves reportBuilder without evidence blobs',
  reportSaved.hasReport && reportSaved.updatedMoved && reportSaved.noEvidence,
  JSON.stringify(reportSaved));

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
  const label = document.querySelector('#rb-file-label')?.textContent || '';
  return document.querySelector('.rb-shell') && /Riley Chen/.test(label);
}, { timeout: 15000 });
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
  const label = document.querySelector('#rb-file-label')?.textContent || '';
  return document.querySelector('.rb-shell') && /Riley Chen/.test(label);
}, { timeout: 15000 });
await page.click('.rb-thumb[data-page-id="distress-canvas-b"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'distress-canvas-b');
await page.screenshot({ path: `${OUT}/report-builder-skeleton-phone.png`, fullPage: true });
const phone = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  const link = document.querySelector('[data-rb-source="distress"]').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  const pen = document.querySelector('.rb-penlog');
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 140 && sheet.height > 80,
    level: pen ? pen.getAttribute('data-level') : '',
    heading: document.querySelector('.rb-penlog__heading')?.textContent || '',
    schedulePins: document.querySelectorAll('.rb-penlog__pinnum').length,
    linkReady: link.width > 40 && link.height > 20,
    overlap: hit(sheet, link),
  };
});
check('phone pen log shows the level and Picture/Damage Locations',
  phone.level === 'Basement' && phone.heading === 'Picture/Damage Locations' && phone.schedulePins >= 1,
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
