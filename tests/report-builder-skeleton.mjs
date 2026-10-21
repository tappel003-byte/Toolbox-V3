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
  // Main Level leads whatever order the canvases were drawn in -- the
  // Basement is canvas 0 here and still comes second. Tim, Oct 20: "Main
  // level always gets brought in first."
  assert('floor figures stay consecutive and unmerged, Main Level first',
    source.floor.figures.map((figure) => figure.id).join(',') ===
      'floor-current::canvas-m,floor-current::canvas-b,epoch-jan::canvas-b',
    source.floor.figures.map((figure) => figure.id).join(','));
  const byName = (name) => source.floor.figures.find((figure) => figure.name === name);
  assert('stored topo media is referenced on the outline',
    byName('Basement').figureMediaId === 'fsrec_canvas-b' &&
    byName('Basement').readingCount === 1,
    JSON.stringify(byName('Basement')));
  assert('areas without closed polygons stay one level figure',
    byName('Main Level').areaCount === 0,
    JSON.stringify(byName('Main Level')));

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
  const shuffled = src.normalizeBookOrder([
    sequence.pages.find((p) => p.type === 'distress'),
    sequence.pages.find((p) => p.type === 'cover'),
    sequence.pages.find((p) => p.type === 'floor'),
    sequence.pages.find((p) => p.type === 'section'),
  ].filter(Boolean));
  const shuffledTitles = src.contents(shuffled).map((item) => item.title);
  assert('normalizeBookOrder puts Discussion before figures',
    shuffled[0].type === 'cover' &&
    shuffled[1].meta && shuffled[1].meta.sectionId === 'discussion' &&
    shuffledTitles[0] === 'Floor Level Survey Results - Discussion' &&
    shuffled.find((p) => p.type === 'floor').meta.figureNumber === 1,
    shuffledTitles.join(' | '));
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
  const ready = document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true';
  const label = document.querySelector('#rb-file-label')?.textContent || '';
  // Cover fields are rich text, so they are contenteditable divs rather than
  // inputs: they carry textContent, never a value.
  const name = document.querySelector('[data-rb-cover-field="name"]');
  return ready && /Riley Chen/.test(label) && name && name.textContent === 'Riley Chen';
}, { timeout: 20000 });

const opened = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet');
  const rect = sheet.getBoundingClientRect();
  const ratio = rect.width / rect.height;
  const toc = [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
  return {
    type: sheet.getAttribute('data-page-type'),
    title: document.querySelector('[data-rb-cover-field="name"]')?.textContent || '',
    address: document.querySelector('[data-rb-cover-field="street"]')?.textContent || '',
    product: document.querySelector('.rb-cover__product')?.textContent || '',
    contents: document.querySelector('.rb-cover__contents-title')?.textContent || '',
    ratio: Math.round(ratio * 100) / 100,
    // The way back to an application belongs to the slide that came from
    // it, so a cover offers none. Counted as visible, because the Pen Log
    // panel's button is in the shell markup whether or not it is shown.
    links: [...document.querySelectorAll('[data-rb-source]')]
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => node.getAttribute('data-rb-source')),
    captions: toc,
    tools: [...document.querySelectorAll('[data-rb-tool]')].map((node) => node.getAttribute('data-rb-tool')),
    lead: document.querySelector('[data-rb-fmt-hint]')?.textContent || '',
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
check('a cover offers no way back to an application', opened.links.length === 0, opened.links.join(','));
check('rail lists Discussion, floor, then picture locations',
  opened.captions.indexOf('Discussion') !== -1 &&
  opened.captions.indexOf('Floor · Basement') !== -1 &&
  opened.captions.indexOf('Picture Locations · Basement') !== -1 &&
  opened.captions.indexOf('Floor · Basement') < opened.captions.indexOf('Picture Locations · Basement'),
  opened.captions.join(' | '));
check('the toolbar carries the real drawing tools',
  ['pencil', 'rect', 'circle', 'arrow', 'eraser'].every((t) => opened.tools.indexOf(t) !== -1),
  opened.tools.join(','));
check('workspace keeps Export for AI and the formatting hint',
  opened.exportAi && /Select text on the sheet/i.test(opened.lead),
  opened.lead);
const coverBoxes = await page.evaluate(() => ({
  boxes: [...document.querySelectorAll('[data-rb-cover-box]')].map((n) => n.getAttribute('data-rb-cover-box')),
  maps: !!document.querySelector('.rb-cover__maps-link'),
  lock: document.querySelector('[data-rb-cover-lock]')?.getAttribute('data-rb-cover-lock') || '',
  contents: [...document.querySelectorAll('[data-rb-cover-field^="contents:"]')].map((n) => n.textContent.trim()),
  streetEditable: document.querySelector('[data-rb-cover-field="street"]')?.getAttribute('contenteditable') === 'true',
  street: document.querySelector('[data-rb-cover-field="street"]')?.textContent || '',
  city: document.querySelector('[data-rb-cover-field="cityLine"]')?.textContent || '',
  // A contents line holds the title only; Figure N is derived from slide
  // order and printed in its own column beside it.
  figures: [...document.querySelectorAll('.rb-cover__contents-num')].map((n) => n.textContent.trim()),
}));
check('title page has movable Mitchell boxes',
  coverBoxes.boxes.join(',') === 'prepared,identity,date,contents,overview' &&
  coverBoxes.lock === 'lock' &&
  coverBoxes.maps,
  JSON.stringify(coverBoxes));
check('CONTENTS on title lists Discussion then figures',
  /Discussion/i.test(coverBoxes.contents[0] || '') &&
  coverBoxes.figures.indexOf('Figure 1') !== -1 &&
  coverBoxes.contents.length > 1,
  `${coverBoxes.contents.join(' | ')} :: ${coverBoxes.figures.join(',')}`);
check('title text fields are editable',
  coverBoxes.streetEditable && !!coverBoxes.street,
  JSON.stringify(coverBoxes));

// A title page carries no handles of ours until a box is pointed at. Tim,
// Oct 17: "all those corner blocks -- that's one of the things I really
// dislike about this page." Five boxes used to show a dashed edge and two
// copper brackets each, all the time.
const coverChrome = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const boxes = [...sheet.querySelectorAll('.rb-cover-box')];
  const shown = (box) => ({
    outline: getComputedStyle(box).outlineStyle,
    move: box.querySelector('.rb-cover-box__move')
      ? getComputedStyle(box.querySelector('.rb-cover-box__move')).display : 'missing',
    resize: box.querySelector('.rb-cover-box__resize')
      ? getComputedStyle(box.querySelector('.rb-cover-box__resize')).display : 'missing',
  });
  const r = boxes[1].getBoundingClientRect();
  return {
    count: boxes.length,
    rest: boxes.map(shown),
    point: { x: r.left + 12, y: r.top + 12 },
  };
});
check('no box on the title page shows chrome at rest',
  coverChrome.count === 5 &&
  coverChrome.rest.every((s) => s.outline === 'none' && s.move === 'none' && s.resize === 'none'),
  JSON.stringify(coverChrome.rest));
// Pointing shows the box's edge, so the investigator can see it is a box.
// Its corners are a different thing: they are the controls, and they come out
// when the box is highlighted and at no other time. Tim: "I don't like them
// visible all the time. I wanted them to where you highlighted it."
await page.mouse.move(coverChrome.point.x, coverChrome.point.y);
await new Promise((r) => setTimeout(r, 300));
const coverHovered = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const box = [...sheet.querySelectorAll('.rb-cover-box')][1];
  return {
    outline: getComputedStyle(box).outlineStyle,
    move: getComputedStyle(box.querySelector('.rb-cover-box__move')).display,
    resize: getComputedStyle(box.querySelector('.rb-cover-box__resize')).display,
  };
});
check('pointing shows the edge and no corner at all',
  coverHovered.outline === 'dashed' &&
  coverHovered.move === 'none' && coverHovered.resize === 'none',
  JSON.stringify(coverHovered));
await page.mouse.click(coverChrome.point.x, coverChrome.point.y);
await new Promise((r) => setTimeout(r, 400));
const coverPointed = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const boxes = [...sheet.querySelectorAll('.rb-cover-box')];
  const box = boxes[1];
  const other = boxes[0];
  const look = (b) => ({
    outline: getComputedStyle(b).outlineStyle,
    move: getComputedStyle(b.querySelector('.rb-cover-box__move')).display,
    resize: getComputedStyle(b.querySelector('.rb-cover-box__resize')).display,
  });
  return { pointed: look(box), other: look(other) };
});
check('the box being worked on shows its edge and both corners, alone',
  coverPointed.pointed.outline === 'dashed' &&
  coverPointed.pointed.move === 'block' &&
  coverPointed.pointed.resize === 'block' &&
  coverPointed.other.outline === 'none' &&
  coverPointed.other.move === 'none',
  JSON.stringify(coverPointed));
await page.mouse.move(4, 4);

// And the empty site-overview frame with its buttons: ours, not the
// report's. Tim, Oct 17: "if I don't drop in a picture I want all the other
// buttons to go away."
const ovRest = await page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-cover-box--overview');
  const r = box.getBoundingClientRect();
  return {
    empty: getComputedStyle(box.querySelector('.rb-cover__overview-empty')).visibility,
    actions: getComputedStyle(box.querySelector('.rb-cover__overview-actions')).visibility,
    point: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
    h: Math.round(r.height),
  };
});
check('an empty site overview shows no frame and no buttons at rest',
  ovRest.empty === 'hidden' && ovRest.actions === 'hidden', JSON.stringify(ovRest));
await page.mouse.move(ovRest.point.x, ovRest.point.y);
await new Promise((r) => setTimeout(r, 250));
const ovPointed = await page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-cover-box--overview');
  return {
    empty: getComputedStyle(box.querySelector('.rb-cover__overview-empty')).visibility,
    actions: getComputedStyle(box.querySelector('.rb-cover__overview-actions')).visibility,
    buttons: [...box.querySelectorAll('[data-rb-cover-overview]')]
      .map((b) => b.getAttribute('data-rb-cover-overview')),
    h: Math.round(box.getBoundingClientRect().height),
  };
});
check('pointing at it offers Paste and Add, and nothing has moved',
  ovPointed.empty === 'visible' && ovPointed.actions === 'visible' &&
  ovPointed.buttons.indexOf('paste') !== -1 && ovPointed.buttons.indexOf('pick') !== -1 &&
  ovPointed.h === ovRest.h,
  JSON.stringify({ ovRest, ovPointed }));
await page.mouse.move(4, 4);
await page.evaluate(() => {
  const street = document.querySelector('[data-rb-cover-field="street"]');
  const line = document.querySelector('[data-rb-cover-field="contents:0"]');
  if (street) {
    street.textContent = '15 Example Court Edited';
    street.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (line) {
    line.textContent = 'Floor Level Survey Results - Discussion EDIT';
    line.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.waitForFunction(() => {
  const text = document.querySelector('#rb-save-status')?.textContent || '';
  return /^Saved/.test(text);
}, { timeout: 10000 });
const editedCover = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-skeleton');
  const cover = record && record.reportBuilder && record.reportBuilder.pages
    ? record.reportBuilder.pages.find((p) => p.type === 'cover')
    : null;
  const text = cover && cover.reportText;
  return {
    street: text && text.street,
    contents0: text && text.contents && text.contents[0] && text.contents[0].text,
  };
});
// Cover wording is stored as the same rich-text model the rest of the report
// uses, not as a bare string.
const plain = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return (value.paragraphs || [])
    .map((para) => (para.runs || []).map((run) => run.text || '').join(''))
    .join('\n');
};
check('edited title text persists on Customer File',
  plain(editedCover.street) === '15 Example Court Edited' &&
  /Discussion EDIT/.test(plain(editedCover.contents0)),
  JSON.stringify(editedCover));
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
  // A floor sheet names itself, dates itself and says who it is for through
  // the rail -- one block of sheet information, the same on every figure --
  // and carries Figure N in its own corner. Until it is imported the drawing
  // area says so rather than guessing at one.
  const floorSheet = await page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet');
    const text = (sel) => sheet.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      title: text('.rb-rail__title'),
      figureNum: text('.rb-topo-page__figure-num'),
      railFigure: text('.rb-rail__figure'),
      date: text('.rb-rail__date'),
      client: text('.rb-rail__client'),
      empty: text('.rb-floor-empty'),
      importOffered: !!document.querySelector('[data-rb-floor-import]'),
      source: document.querySelector('[data-rb-source]')?.getAttribute('data-rb-source') || '',
    };
  });
  check('floor sheet names itself in the rail and numbers itself on the sheet',
    /Floor Level Survey/.test(floorSheet.title) && /Basement/.test(floorSheet.title) &&
    /^Figure \d+$/.test(floorSheet.figureNum) && /^FIGURE \d+$/.test(floorSheet.railFigure),
    JSON.stringify(floorSheet));
  check('floor sheet keeps the survey date',
    /March 2, 2026|2026-03-02|03\/02\/26|03\/02\/2026/.test(floorSheet.date), floorSheet.date);
  check('an unimported floor sheet offers Import and the way back to Floor Survey',
    /Import when ready/i.test(floorSheet.empty) && floorSheet.importOffered &&
    floorSheet.source === 'floor',
    JSON.stringify(floorSheet));
}

// Open Distress Survey belongs to a sheet that came from Distress Survey, so
// the slide has to be open before the button is.
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')].find((node) =>
    /Picture Locations · Basement/.test(node.querySelector('.rb-thumb__caption')?.textContent || ''));
  if (thumb) thumb.click();
});
await page.waitForFunction(() => {
  const btn = document.querySelector('[data-rb-source="distress"]');
  return btn && btn.getBoundingClientRect().width > 0;
}, { timeout: 15000 });
await page.click('[data-rb-source="distress"]');
await page.waitForFunction(() => location.hash.indexOf('/distress') !== -1, { timeout: 15000 });
check('Open Distress Survey still leaves Report Builder', page.url().indexOf('/distress') !== -1, page.url());

await page.goto(`${BASE}#/file/rb-skeleton/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const label = document.querySelector('#rb-file-label')?.textContent || '';
  return document.querySelector('.rb-shell') && /Riley Chen/.test(label);
}, { timeout: 15000 });
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="cover"]').click());
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

// Lock layout lives in the side rail, not on the paper. Tim, Oct 17: "yes,
// side rail please." And it has to still be reachable once the layout IS
// locked -- on the sheet it went away with the rest of the editor chrome,
// so a locked title page could not be unlocked again.
const lockWhere = await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-cover-lock]');
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const r = btn.getBoundingClientRect();
  return {
    onSheet: sheet.contains(btn),
    inRail: !!btn.closest('.rb-panel'),
    label: btn.textContent.trim(),
    visible: getComputedStyle(btn).display !== 'none' && r.width > 0 && r.height > 0,
  };
});
check('Lock layout sits in the side rail and is still there when locked',
  !lockWhere.onSheet && lockWhere.inRail && lockWhere.visible &&
  lockWhere.label === 'Unlock layout',
  JSON.stringify(lockWhere));
await page.click('[data-rb-cover-lock="unlock"]');
await page.waitForFunction(() => document.querySelector('[data-rb-cover-lock="lock"]'), { timeout: 10000 });
const unlocked = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-skeleton');
  return !!(record?.reportBuilder?.coverLayout || {}).locked;
});
check('and Unlock layout puts it back', unlocked === false, String(unlocked));

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
  // The rail of page stamps down the left, not the sheet's own information rail.
  const rail = document.querySelector('aside[aria-label="Report pages"]').getBoundingClientRect();
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
    // A reopened book comes back on its cover, which came from no
    // application and so offers no way into one.
    visibleLinks: [...document.querySelectorAll('[data-rb-source]')]
      .filter((node) => node.getBoundingClientRect().width > 0).length,
  };
});
check('iPad sheet stays visible and the cover offers no source link',
  !ipad.overflow && ipad.sheetVisible && ipad.visibleLinks === 0, JSON.stringify(ipad));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const label = document.querySelector('#rb-file-label')?.textContent || '';
  return document.querySelector('.rb-shell') && /Riley Chen/.test(label);
}, { timeout: 15000 });
// On a phone the rail of stamps scrolls sideways, so the thumb for a later
// sheet sits outside the viewport and a synthetic tap lands on whatever is
// in its place.
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-b"]').click());
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'distress-canvas-b');
await page.screenshot({ path: `${OUT}/report-builder-skeleton-phone.png`, fullPage: true });
// The schedule is measured after the sheet first appears, so wait for a row
// rather than for the page element.
await page.waitForFunction(() => document.querySelectorAll('.rb-sheet .rb-penlog__pinnum').length > 0,
  { timeout: 15000 });
const phone = await page.evaluate(() => {
  const sheetEl = document.querySelector('.rb-sheet');
  const sheet = sheetEl.getBoundingClientRect();
  const link = document.querySelector('[data-rb-source="distress"]').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  const pen = sheetEl.querySelector('.rb-penlog');
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 140 && sheet.height > 80,
    level: pen ? pen.getAttribute('data-level') : '',
    // The sheet names itself through its rail, as every figure sheet does.
    heading: sheetEl.querySelector('.rb-rail__title')?.textContent || '',
    schedulePins: sheetEl.querySelectorAll('.rb-penlog__pinnum').length,
    linkReady: link.width > 40 && link.height > 20,
    overlap: hit(sheet, link),
  };
});
check('phone pen log shows the level and Picture/Damage Locations',
  phone.level === 'Basement' && /Picture\/Damage Locations/.test(phone.heading) && phone.schedulePins >= 1,
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
