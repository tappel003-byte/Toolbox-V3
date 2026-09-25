/**
 * Report Builder authoring: draft persistence, evidence references,
 * authored text, 11×17 print, and the read-only checkout gate.
 * Run: node tests/report-builder-authoring.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
 */
import { createRequire } from 'module';
import { mkdir, readFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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
  const drafts = window.ToolboxReportDraft;
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }
  const record = {
    id: 'merge-case',
    firstName: 'Riley',
    lastName: 'Chen',
    propertyAddress: '15 Example Court',
    createdAt: '2026-01-04T15:00:00.000Z',
    planSetup: { canvases: [{ id: 'canvas-b', name: 'Basement' }] },
    distress: { pins: [{ id: 'pin-b', canvasId: 'canvas-b', photos: ['ph_1'] }] },
    floorSurvey: { inspectionDate: '2026-03-02', byCanvasId: {} },
  };
  const sequence = src.assemble(src.read(record));
  const draft = drafts.blankFromSequence(sequence);
  draft.schema = drafts.SCHEMA;
  const discussion = draft.pages.find((item) => item.id === 'section-discussion');
  discussion.body = 'Keep this.';
  const cover = draft.pages.findIndex((item) => item.id === 'cover');
  const toc = draft.pages.findIndex((item) => item.id === 'toc');
  const moved = draft.pages.splice(draft.pages.findIndex((item) => item.id === 'section-discussion'), 1)[0];
  draft.pages.splice(toc + 1, 0, moved);
  draft.pages = draft.pages.filter((item) => item.id !== 'distress-canvas-b');
  draft.seenSourceIds = sequence.pages.map((item) => item.id);
  record.planSetup.canvases.push({ id: 'canvas-m', name: 'Main Level' });
  record.distress.pins.push({ id: 'pin-m', canvasId: 'canvas-m', photos: [] });
  const merged = drafts.merge(draft, src.assemble(src.read(record)));
  assert('authored discussion stays where the owner moved it',
    merged.pages[cover + 2] && merged.pages[cover + 2].id === 'section-discussion' &&
    merged.pages[cover + 2].body === 'Keep this.');
  assert('a removed distress sheet stays removed',
    !merged.pages.some((item) => item.id === 'distress-canvas-b'));
  assert('a new distress level is inserted',
    merged.pages.some((item) => item.id === 'distress-canvas-m'));
  const packed = drafts.payload({
    pages: [{
      id: 'floor-1',
      type: 'floor',
      title: 'Basement',
      body: 'Hi',
      origin: 'source',
      sourceId: 'floor-1',
      meta: { figureMediaId: 'fsrec_canvas-b', sneak: 'data:image/png;base64,abc' },
      evidence: { dataUrl: 'data:image/png;base64,abc' },
    }],
    selectedPageId: 'floor-1',
    seenSourceIds: ['floor-1'],
  });
  const packedJson = JSON.stringify(packed);
  assert('draft payload keeps the media id and drops image bytes',
    packedJson.indexOf('fsrec_canvas-b') !== -1 &&
    packedJson.indexOf('data:image') === -1 &&
    packedJson.indexOf('Hi') !== -1,
    packedJson);
  assert('empty discussion is not a generated conclusion',
    sequence.pages.find((item) => item.id === 'section-discussion').body !== 'Keep this.' &&
    !(sequence.pages.find((item) => item.id === 'section-conclusions').note || '').match(/recommend|therefore/i));
  return out;
});

logic.forEach((item) => check(item.name, item.ok, item.detail));

await page.evaluate(async (png) => {
  localStorage.removeItem('toolboxForeignCheckouts');
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
  const record = window.ToolboxApp.blankCustomerFile('rb-author');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Riley';
  record.lastName = 'Chen';
  record.propertyAddress = '15 Example Court\nAlbuquerque, NM';
  record.cellPhone = '555-0101';
  record.homePhone = '555-0102';
  record.email = 'riley@example.com';
  record.companyName = 'Example Co';
  record.spouseName = 'Jordan Chen';
  record.createdAt = '2026-01-04T15:00:00.000Z';
  record.updatedAt = '2026-09-24T12:00:00.000Z';
  record.planSetup.canvases = [
    { id: 'canvas-b', name: 'Basement', rooms: [], frontDoorFacing: 'S', frontDoor: null, plan: null },
    { id: 'canvas-m', name: 'Main Level', rooms: [], frontDoorFacing: 'S', frontDoor: null, plan: null },
  ];
  record.distress.pins = [
    { id: 'pin-b', canvasId: 'canvas-b', photos: ['ph_b'], description: 'Basement crack' },
    { id: 'pin-m', canvasId: 'canvas-m', photos: ['ph_m1', 'ph_m2'], description: 'Main crack' },
  ];
  record.floorSurvey.inspectionDate = '2026-03-02';
  record.floorSurvey.byCanvasId = {
    'canvas-b': {
      canvasId: 'canvas-b',
      points: [{ id: 'p1' }],
      areas: [{ id: 'a1' }, { id: 'a2' }],
      recoveryPdfMediaId: 'fsrec_canvas-b',
    },
    'canvas-m': { canvasId: 'canvas-m', points: [{ id: 'p2' }, { id: 'p3' }] },
  };
  record.floorSurvey.epochs = [{
    id: 'epoch-jan',
    label: 'January survey',
    inspectionDate: '2026-01-15',
    byCanvasId: { 'canvas-b': { points: [{ id: 'old' }] } },
  }];
  const pins = JSON.parse(JSON.stringify(record.distress.pins));
  const points = JSON.parse(JSON.stringify(record.floorSurvey.byCanvasId));
  await window.ToolboxDB.saveCustomerFile(record);
  await window.ToolboxDB.putMedia('fsrec_canvas-b', png);
  window.__rbPins = pins;
  window.__rbPoints = points;
}, PNG);

await page.goto(`${BASE}#/file/rb-author/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return title && title.textContent === 'Riley Chen';
});

const beforeEdit = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-author');
  const property = [...document.querySelectorAll('.rb-print-page')].find((node) => node.getAttribute('data-page-id') === 'section-property');
  const discussion = [...document.querySelectorAll('.rb-print-page')].find((node) => node.getAttribute('data-page-id') === 'section-discussion');
  const tools = ['image', 'line', 'arrow', 'shape'].map((id) => {
    const button = document.querySelector(`[data-rb-tool="${id}"]`);
    return button && button.disabled && /not available/i.test(button.title);
  });
  return {
    unwritten: !record.reportBuilder && record.updatedAt === '2026-09-24T12:00:00.000Z',
    address: document.querySelector('.rb-sheet__meta').textContent,
    city: [...document.querySelectorAll('.rb-sheet__meta')].some((node) => node.textContent === 'Albuquerque, NM'),
    company: [...document.querySelectorAll('.rb-sheet__meta')].some((node) => node.textContent === 'Example Co'),
    propertyText: property ? property.textContent : '',
    propertyEditor: property ? property.querySelectorAll('input, textarea').length : -1,
    discussionBlank: discussion ? discussion.querySelector('.rb-authored').value === '' : false,
    toolsOff: tools.every(Boolean),
    textOn: !document.querySelector('[data-rb-tool="text"]').disabled,
    floorCount: [...document.querySelectorAll('.rb-thumb__caption')].filter((node) => node.textContent.indexOf('Floor ·') === 0).length,
  };
});
check('opening still does not write', beforeEdit.unwritten);
check('cover uses the stored address, city, and company',
  beforeEdit.address === '15 Example Court' && beforeEdit.city && beforeEdit.company,
  JSON.stringify(beforeEdit));
check('property sheet shows known contact and dates and does not ask again',
  /555-0102/.test(beforeEdit.propertyText) &&
  /Jordan Chen/.test(beforeEdit.propertyText) &&
  /2026-03-02/.test(beforeEdit.propertyText) &&
  /2026-01-04/.test(beforeEdit.propertyText) &&
  beforeEdit.propertyEditor === 0,
  beforeEdit.propertyText);
check('discussion starts empty', beforeEdit.discussionBlank);
check('image, line, arrow, and shape stay unavailable', beforeEdit.toolsOff && beforeEdit.textOn);
check('both floor epochs are separate sheets', beforeEdit.floorCount === 3, String(beforeEdit.floorCount));

await page.click('.rb-thumb[data-page-id="section-discussion"]');
await page.waitForSelector('.rb-stage .rb-authored');
await page.click('[data-rb-tool="text"]');
await page.type('.rb-stage .rb-authored', 'Owner wording stays.');
await page.click('#rb-duplicate-page');
await page.click('.rb-thumb[data-page-id="distress-canvas-m"]');
await page.click('#rb-remove-page');
await page.click('#rb-add-page');
await page.waitForSelector('.rb-stage .rb-authored');
await page.type('.rb-stage .rb-authored', 'Added sheet wording.');
await page.click('.rb-thumb[data-page-id="section-discussion"]');
await page.click('#rb-page-earlier');
await page.click('.rb-thumb[data-page-id="section-limitations"]');

async function waitSaved() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await page.evaluate(() => document.querySelector('#rb-save-state').textContent === 'Saved');
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('save did not finish');
}
await waitSaved();

const saved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-author');
  const report = record.reportBuilder;
  const payload = window.ToolboxSync.extractComponent(record, 'report');
  const revision = window.ToolboxSync.componentRevision(record, 'report');
  const json = JSON.stringify(payload);
  const titles = report.pages.map((item) => item.railLabel || item.title);
  return {
    schema: report.schema,
    revisionMatches: revision === report.updatedAt && payload.updatedAt === report.updatedAt,
    selected: report.selectedPageId,
    noBytes: json.indexOf('data:image') === -1 && json.indexOf('data:application') === -1,
    mediaRef: json.indexOf('fsrec_canvas-b') !== -1,
    body: report.pages.filter((item) => item.id === 'section-discussion' || (item.origin === 'duplicate' && item.sourceId === 'section-discussion')).map((item) => item.body),
    added: report.pages.find((item) => item.origin === 'added'),
    mainGone: !report.pages.some((item) => item.id === 'distress-canvas-m'),
    basementKept: report.pages.some((item) => item.id === 'distress-canvas-b'),
    floorIds: report.pages.filter((item) => item.type === 'floor').map((item) => item.id),
    discussionBefore: report.pages.findIndex((item) => item.id === 'section-discussion') <
      report.pages.findIndex((item) => item.type === 'diagnostics'),
    pinsSame: JSON.stringify(record.distress.pins) === JSON.stringify(window.__rbPins),
    pointsSame: JSON.stringify(record.floorSurvey.byCanvasId) === JSON.stringify(window.__rbPoints),
    status: document.querySelector('#rb-file-status').textContent,
    titles,
  };
});
check('save writes the report component and says Saved only after that',
  saved.schema === 'toolbox.report-draft' && saved.revisionMatches && saved.status === 'Saved',
  JSON.stringify({ schema: saved.schema, status: saved.status, revisionMatches: saved.revisionMatches }));
check('saved draft keeps wording, duplicates, removals, selection, and media ids',
  saved.noBytes && saved.mediaRef && saved.selected === 'section-limitations' &&
  saved.body[0] === 'Owner wording stays.' && saved.body.length === 2 &&
  saved.added && saved.added.body === 'Added sheet wording.' &&
  saved.mainGone && saved.basementKept && saved.floorIds.length === 3 && saved.discussionBefore,
  JSON.stringify(saved));
check('saving the report does not change Distress or Floor capture',
  saved.pinsSame && saved.pointsSame);

await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-sheet') && document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'section-limitations');
const reloaded = await page.evaluate(() => {
  const active = document.querySelector('.rb-sheet').getAttribute('data-page-id');
  const texts = [...document.querySelectorAll('.rb-print-page .rb-authored-print')].map((node) => node.textContent);
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
  const toc = [...document.querySelectorAll('.rb-print-page')]
    .find((node) => node.getAttribute('data-page-id') === 'toc');
  const tocTitles = toc ? [...toc.querySelectorAll('.rb-toc__item span:first-child')].map((node) => node.textContent) : [];
  const figure = [...document.querySelectorAll('.rb-print-page')].find((node) => (node.getAttribute('data-page-id') || '').indexOf('canvas-b') !== -1 && node.getAttribute('data-page-type') === 'floor');
  const image = figure && figure.querySelector('.rb-evidence-figure');
  return {
    active,
    texts,
    captions,
    tocTitles,
    image: image ? image.getAttribute('src').indexOf('data:image/png') === 0 : false,
    saved: document.querySelector('#rb-save-state').textContent,
  };
});
check('reload restores the selected page, wording, and source figure',
  reloaded.active === 'section-limitations' &&
  reloaded.texts.indexOf('Owner wording stays.') !== -1 &&
  reloaded.texts.indexOf('Added sheet wording.') !== -1 &&
  reloaded.image === true &&
  reloaded.saved === 'Saved' &&
  reloaded.captions.indexOf('Distress · Main Level') === -1,
  JSON.stringify(reloaded));
check('table of contents follows the saved page order',
  reloaded.tocTitles.indexOf('Discussion') !== -1 &&
  reloaded.tocTitles.indexOf('Discussion') < reloaded.tocTitles.indexOf('Diagnostics') &&
  reloaded.tocTitles.indexOf('Added page') !== -1,
  reloaded.tocTitles.join(' | '));

await page.screenshot({ path: `${OUT}/report-authoring-desktop.png` });

await page.evaluate(() => {
  window.__rbSave = window.ToolboxDB.saveCustomerFile.bind(window.ToolboxDB);
  window.ToolboxDB.saveCustomerFile = function () {
    return Promise.reject(new Error('disk full'));
  };
});
await page.click('.rb-thumb[data-page-id="section-discussion"]');
await page.click('.rb-stage .rb-authored');
await page.keyboard.down('Control');
await page.keyboard.press('KeyA');
await page.keyboard.up('Control');
await page.type('.rb-stage .rb-authored', 'Owner wording stays. Still here after a failed save.');
let failure = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  failure = await page.evaluate(() => ({
    state: document.querySelector('#rb-save-state').textContent,
    detail: document.querySelector('#rb-save-detail').textContent,
    value: document.querySelector('.rb-stage .rb-authored').value,
    claimed: document.querySelector('#rb-file-status').textContent === 'Saved',
  }));
  if (failure.state === 'Not saved' && /Could not save/.test(failure.detail)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const failedRecord = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-author');
  const pageItem = record.reportBuilder.pages.find((item) => item.id === 'section-discussion');
  return pageItem.body;
});
check('a failed save stays visible and does not claim Saved',
  failure.state === 'Not saved' && /Could not save/.test(failure.detail) && failure.claimed === false &&
  failure.value.indexOf('Still here after a failed save') !== -1 &&
  failedRecord === 'Owner wording stays.',
  JSON.stringify({ failure, failedRecord }));

await page.evaluate(() => {
  window.ToolboxDB.saveCustomerFile = window.__rbSave;
});
await page.click('#rb-save');
await waitSaved();
const recovered = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-author');
  return record.reportBuilder.pages.find((item) => item.id === 'section-discussion').body;
});
check('retrying save persists the wording that stayed on the page',
  recovered.indexOf('Still here after a failed save') !== -1,
  recovered);

await page.setOfflineMode(true);
await page.click('#rb-add-page');
await page.waitForSelector('.rb-stage .rb-authored');
await page.type('.rb-stage .rb-authored', 'Offline page.');
await waitSaved();
await page.evaluate(() => { window.location.hash = '#/file/rb-author'; });
await page.waitForFunction(() => document.querySelector('#cf-home, .cf-home'));
await page.evaluate(() => { window.location.hash = '#/file/rb-author/report'; });
await page.waitForFunction(() => {
  const texts = [...document.querySelectorAll('.rb-print-page .rb-authored-print')].map((node) => node.textContent);
  return texts.indexOf('Offline page.') !== -1;
});
check('offline reopen returns the saved page', true);

await page.setOfflineMode(false);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#rb-file-label') && document.querySelector('#rb-file-label').textContent.indexOf('Riley Chen') !== -1);
const controlled = await page.evaluate(async () => {
  if (!navigator.serviceWorker) return false;
  await navigator.serviceWorker.ready;
  return !!navigator.serviceWorker.controller;
});
if (controlled) {
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const texts = [...document.querySelectorAll('.rb-print-page .rb-authored-print')].map((node) => node.textContent);
    return texts.indexOf('Offline page.') !== -1 &&
      texts.some((text) => text.indexOf('Still here after a failed save') !== -1);
  }, { timeout: 15000 });
  check('offline reload returns the saved draft', true);
  await page.setOfflineMode(false);
} else {
  await page.setOfflineMode(false);
  check('offline reload returns the saved draft', false, 'service worker was not controlling the page');
}

const freshLevel = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-author');
  record.planSetup.canvases.push({ id: 'canvas-2', name: 'Second Floor', rooms: [], plan: null });
  record.distress.pins.push({ id: 'pin-2', canvasId: 'canvas-2', photos: ['ph_2'], description: 'Upper crack' });
  record.distress.updatedAt = '2026-09-25T12:00:00.000Z';
  await window.ToolboxDB.saveCustomerFile(record);
  return true;
});
check('new distress evidence was added beside the draft', freshLevel);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-2"]'));
const mergedUi = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-author');
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
  const texts = [...document.querySelectorAll('.rb-print-page .rb-authored-print')].map((node) => node.textContent);
  return {
    second: captions.indexOf('Distress · Second Floor') !== -1,
    mainStillGone: captions.indexOf('Distress · Main Level') === -1,
    wording: texts.some((text) => text.indexOf('Still here after a failed save') !== -1),
    offline: texts.indexOf('Offline page.') !== -1,
    pins: record.distress.pins.length,
  };
});
check('new distress evidence appears without dropping authored edits or a removed sheet',
  mergedUi.second && mergedUi.mainStillGone && mergedUi.wording && mergedUi.offline && mergedUi.pins === 3,
  JSON.stringify(mergedUi));

await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
await page.click('#rb-print');
await page.emulateMediaType('print');
const printed = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print-page')];
  const chrome = ['.app-bar', '.rb-toolbar', '.rb-rail', '.rb-panel', '.rb-stage'].map((selector) => {
    const node = document.querySelector(selector);
    return node ? getComputedStyle(node).display : 'missing';
  });
  const sample = sheets.find((node) => (node.textContent || '').indexOf('Still here after a failed save') !== -1);
  const text = sample && sample.querySelector('.rb-authored-print');
  const pageBox = sample ? sample.getBoundingClientRect() : null;
  const textBox = text ? text.getBoundingClientRect() : null;
  const figure = sheets.map((node) => node.querySelector('.rb-evidence-figure')).find(Boolean);
  const fit = figure ? getComputedStyle(figure).objectFit : '';
  const breaks = sheets.map((node) => getComputedStyle(node).breakAfter || getComputedStyle(node).pageBreakAfter);
  return {
    called: window.__printed,
    count: sheets.length,
    chrome,
    width: pageBox ? pageBox.width : 0,
    height: pageBox ? pageBox.height : 0,
    textInside: !!(pageBox && textBox && textBox.height > 8 && textBox.top >= pageBox.top - 1 && textBox.bottom <= pageBox.bottom + 1),
    fit,
    breaks: breaks.slice(0, 3).concat(breaks.slice(-1)),
    lastBreak: breaks[breaks.length - 1],
  };
});
check('print hides editing chrome and keeps 11×17 sheets',
  printed.called === 1 &&
  printed.chrome.every((value) => value === 'none') &&
  printed.width > 1600 && printed.width < 1660 &&
  printed.height > 1040 && printed.height < 1080 &&
  printed.textInside &&
  printed.fit === 'contain' &&
  /page|always/.test(printed.breaks[0]) &&
  /auto|avoid/.test(printed.lastBreak),
  JSON.stringify(printed));

const pdf = await page.pdf({
  path: `${OUT}/report-11x17.pdf`,
  printBackground: true,
  preferCSSPageSize: true,
  width: '17in',
  height: '11in',
  margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
});
const pdfText = Buffer.from(pdf).toString('latin1');
const media = pdfText.match(/\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
const pdfPages = (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length;
const boxW = media ? Number(media[3]) - Number(media[1]) : 0;
const boxH = media ? Number(media[4]) - Number(media[2]) : 0;
check('PDF pages are 11×17 landscape',
  pdfPages === printed.count && boxW > 1200 && boxW < 1240 && boxH > 770 && boxH < 820,
  JSON.stringify({ pdfPages, sheets: printed.count, boxW, boxH }));
await page.screenshot({ path: `${OUT}/report-authoring-print.png` });
await page.emulateMediaType('screen');

await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-sheet__title'));
await page.screenshot({ path: `${OUT}/report-authoring-ipad.png` });
const ipad = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet').getBoundingClientRect();
  const link = document.querySelector('[data-rb-source="floor"]').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 180 && sheet.height > 100,
    links: document.querySelectorAll('[data-rb-source]').length,
    overlap: hit(sheet, link),
  };
});
check('iPad sheet stays visible beside the source links',
  !ipad.overflow && ipad.sheetVisible && ipad.links === 3 && !ipad.overlap,
  JSON.stringify(ipad));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-thumb'));
await page.click('.rb-thumb[data-page-id="distress-canvas-b"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'distress-canvas-b');
await page.screenshot({ path: `${OUT}/report-authoring-phone.png`, fullPage: true });
const phone = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet').getBoundingClientRect();
  const link = document.querySelector('[data-rb-source="distress"]').getBoundingClientRect();
  const save = document.querySelector('#rb-save').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 140 && sheet.height > 80,
    title: document.querySelector('.rb-sheet__title').textContent,
    saveReady: save.width > 40 && save.height > 20,
    overlap: hit(sheet, link) || hit(sheet, save),
  };
});
check('phone can open a distress sheet without covering Save or the source link',
  phone.title === 'Basement' && !phone.overflow && phone.sheetVisible && phone.saveReady && !phone.overlap,
  JSON.stringify(phone));

await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.evaluate(async () => {
  const record = window.ToolboxApp.blankCustomerFile('rb-locked');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Locked';
  record.updatedAt = '2026-09-24T12:00:00.000Z';
  record.distress = { pins: [{ id: 'pin-lock', canvasId: 'canvas-1', photos: [] }] };
  await window.ToolboxDB.saveCustomerFile(record);
  localStorage.setItem('toolboxForeignCheckouts', JSON.stringify({
    'rb-locked': {
      deviceId: 'other-device',
      email: 'lee@example.com',
      deviceLabel: 'Field iPad',
      checkedAt: '2026-09-25T00:00:00.000Z',
    },
  }));
});
await page.goto(`${BASE}#/file/rb-locked/report`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cf-readonly__status');
const locked = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-locked');
  return {
    text: document.querySelector('.cf-readonly__status').textContent,
    sheet: !!document.querySelector('.rb-sheet'),
    report: record.reportBuilder || null,
    pin: record.distress.pins[0].id,
    updatedAt: record.updatedAt,
  };
});
check('a foreign checkout opens Report Builder read-only and does not write',
  /Checked out on Field iPad/.test(locked.text) && !locked.sheet && !locked.report &&
  locked.pin === 'pin-lock' && locked.updatedAt === '2026-09-24T12:00:00.000Z',
  JSON.stringify(locked));
await page.screenshot({ path: `${OUT}/report-authoring-readonly.png` });

await browser.close();

const failed = results.filter((item) => !item.ok);
if (failed.length) {
  console.error(`${failed.length} failed`);
  process.exit(1);
}
console.log(`${results.length} passed`);
