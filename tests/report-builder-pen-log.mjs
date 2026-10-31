/**
 * Pen Log: native plan, pins, and schedule; cross-level numbering;
 * letterboxed registration; report-note persistence without editing Distress.
 * Run: node tests/report-builder-pen-log.mjs
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

function near(value, expected, tolerance) {
  return Math.abs(value - expected) <= tolerance;
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

const math = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }
  const wide = api.containedFrame(900, 700, 1600, 900);
  const wideOrigin = api.pinPoint(0, 0, wide);
  const wideFar = api.pinPoint(1, 1, wide);
  assert('wide plan letterboxes inside a taller frame', wide.y > 20 && wide.x < 1 && wideFar.x > 800, JSON.stringify(wide));
  assert('a corner pin sits on the image, not the frame origin', wideOrigin.y > 20 && wideOrigin.x < 1, JSON.stringify(wideOrigin));
  const tall = api.containedFrame(500, 700, 800, 1600);
  const tallOrigin = api.pinPoint(0, 0, tall);
  assert('tall plan pillarboxes inside a wider frame', tall.x > 20 && tallOrigin.x > 20 && tallOrigin.y < 1, JSON.stringify(tall));
  const numbers = api.assignPinNumbers([
    { photos: ['a', 'b'] },
    { photos: [] },
    { photos: ['c'] },
  ], 'internal', 1);
  assert('numbering consumes a gap for a pin with no photo and does not restart',
    numbers.map((item) => item.num).join(',') === '1,3,4' &&
    api.photoRange(numbers[0].num, 2) === '1\u20132' &&
    api.photoRange(numbers[1].num, 0) === '' &&
    api.photoRange(numbers[2].num, 1) === '4',
    JSON.stringify(numbers));
  const external = api.assignPinNumbers([
    { photos: ['a'], extPhotoCount: 4 },
    { photos: ['b'] },
  ], 'external', 5);
  assert('external mode spaces pins by extPhotoCount from startNum',
    external[0].num === 5 && external[1].num === 9 && api.photoRange(5, 1) === '5');
  assert('display uses a report override and leaves the source text readable',
    api.displayNote({ id: 'p', text: 'Stair crack' }, { p: '1/4 inch crack' }) === '1/4 inch crack' &&
    api.sourceNote({ id: 'p', text: 'Stair crack' }) === 'Stair crack' &&
    api.displayNote({ id: 'p', description: 'Door sticks' }, {}) === 'Door sticks');
  return out;
});
math.forEach((item) => check(item.name, item.ok, item.detail));

await page.evaluate(async () => {
  function image(width, height, label, tone) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7f1e6';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#243140';
    ctx.lineWidth = Math.max(6, Math.round(Math.min(width, height) / 80));
    ctx.strokeRect(18, 18, width - 36, height - 36);
    ctx.fillStyle = tone;
    ctx.fillRect(width * 0.18, height * 0.22, width * 0.28, height * 0.32);
    ctx.strokeRect(width * 0.18, height * 0.22, width * 0.28, height * 0.32);
    ctx.fillStyle = '#243140';
    ctx.font = Math.round(Math.min(width, height) * 0.045) + 'px sans-serif';
    ctx.fillText(label, 36, Math.round(height * 0.1));
    return canvas.toDataURL('image/jpeg', 0.86);
  }
  function photo(label, tone) {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.fillText(label, 16, 88);
    return canvas.toDataURL('image/jpeg', 0.8);
  }
  const wide = image(1600, 900, 'Main Level', '#d5e3ef');
  const tall = image(800, 1600, 'Upper Floor', '#eadfce');
  const photos = ['Hall', 'Hall 2', 'Bedroom', 'Bath', 'Stair', 'Stair 2', 'Stair 3'].map((label, index) => {
    const id = 'ph_pen_' + (index + 1);
    return window.ToolboxDB.putMedia(id, photo(label, ['#8aa2b5', '#6e8ea8', '#b08968', '#7d8f74', '#a67862', '#8d6a55', '#6f5344'][index])).then(() => id);
  });
  const ids = await Promise.all(photos);
  await window.ToolboxDB.putMedia('plan-pen-wide', wide);
  await window.ToolboxDB.putMedia('plan-pen-tall', tall);
  const record = window.ToolboxApp.blankCustomerFile('rb-penlog');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Riley';
  record.lastName = 'Chen';
  record.propertyAddress = '15 Example Court';
  record.updatedAt = '2026-09-26T12:00:00.000Z';
  record.distress.updatedAt = '2026-09-26T11:00:00.000Z';
  record.reportBuilder = { title: 'Keep me' };
  record.planSetup.canvases = [
    { id: 'canvas-main', name: 'Main Level', rooms: [], plan: { id: 'plan-pen-wide', width: 1600, height: 900 } },
    { id: 'canvas-upper', name: 'Upper Floor', rooms: [], plan: { id: 'plan-pen-tall', width: 800, height: 1600 } },
    { id: 'canvas-empty', name: 'Roof', rooms: [], plan: null },
  ];
  record.distress.pins = [
    { id: 'pin-w1', canvasId: 'canvas-main', x: 400, y: 450, photos: [ids[0], ids[1]], description: 'Hairline seam', location: 'Hall' },
    { id: 'pin-w2', canvasId: 'canvas-main', x: 1200, y: 180, photos: [ids[2]], description: 'Door sticks', location: 'Bedroom' },
    { id: 'pin-u1', canvasId: 'canvas-upper', x: 400, y: 200, photos: [ids[3]], description: 'Ceiling stain', location: 'Bath' },
    { id: 'pin-u2', canvasId: 'canvas-upper', x: 100, y: 1400, photos: [ids[4], ids[5], ids[6]], description: 'Stair crack', location: 'Stair' },
  ];
  await window.ToolboxDB.saveCustomerFile(record);
});

await page.goto(`${BASE}#/file/rb-penlog/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const name = document.querySelector('.rb-cover__name') || document.querySelector('.rb-sheet__title');
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    name && name.textContent === 'Riley Chen';
});
const rail = await page.evaluate(() => {
  return [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
});
check('a level without pins does not get a Picture Locations sheet',
  rail.indexOf('Picture Locations · Main Level') !== -1 &&
  rail.indexOf('Picture Locations · Upper Floor') !== -1 &&
  rail.indexOf('Picture Locations · Roof') === -1 &&
  rail.indexOf('Picture Locations · Main Level') < rail.indexOf('Picture Locations · Upper Floor'),
  rail.join(' | '));
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]').click());
// Scoped to the live sheet throughout. The rail of stamps is the same markup
// with every data- attribute stripped by sanitizeThumb, so an unscoped
// document query answers for a thumbnail: no data-level, and a fit box of
// zero width.
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet .rb-rail__title');
  const fit = document.querySelector('.rb-sheet .rb-penlog__fit');
  const sheetPage = document.querySelector('.rb-sheet .rb-penlog');
  return title && /Picture\/Damage Locations/.test(title.textContent) &&
    sheetPage && sheetPage.getAttribute('data-level') === 'Main Level' &&
    fit && fit.getBoundingClientRect().width > 40;
});

const openedClean = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return {
    updatedAt: record.updatedAt,
    distressUpdatedAt: record.distress.updatedAt,
    title: record.reportBuilder && record.reportBuilder.title,
    penLog: record.reportBuilder && record.reportBuilder.penLog || null,
    save: document.querySelector('#rb-save-state').textContent,
    source: record.distress.pins.map((pin) => pin.description).join('|'),
  };
});
check('opening the report leaves Distress source unchanged',
  openedClean.distressUpdatedAt === '2026-09-26T11:00:00.000Z' &&
  openedClean.title === 'Keep me' &&
  // Missing penLog.pinScale may seed once to 1; notes must stay empty (no write-back).
  (!openedClean.penLog ||
    (!openedClean.penLog.notes || !Object.keys(openedClean.penLog.notes).length)) &&
  openedClean.source === 'Hairline seam|Door sticks|Ceiling stain|Stair crack',
  JSON.stringify(openedClean));

const wideLayout = await page.evaluate(() => {
  const sheetEl = document.querySelector('.rb-sheet');
  const sheet = sheetEl.getBoundingClientRect();
  const planEl = sheetEl.querySelector('.rb-penlog__plan');
  const plan = planEl.getBoundingClientRect();
  const fit = sheetEl.querySelector('.rb-penlog__fit').getBoundingClientRect();
  const schedule = sheetEl.querySelector('.rb-penlog__schedule').getBoundingClientRect();
  // The sheet's own title block, north arrow, footer and logo are all one
  // rail now -- the same rail a Floor Survey sheet and a Pictures sheet use.
  const railBox = sheetEl.querySelector('.rb-rail__rail').getBoundingClientRect();
  const title = sheetEl.querySelector('.rb-rail__title').getBoundingClientRect();
  const north = sheetEl.querySelector('.rb-rail__compass').getBoundingClientRect();
  const brand = sheetEl.querySelector('.rb-rail__logo').getBoundingClientRect();
  const pin = sheetEl.querySelector('.rb-penlog__pin[data-pin-id="pin-w1"]').getBoundingClientRect();
  // The editor shows the 11x17 sheet ZOOMED to the window, so the plan's
  // own clientWidth/clientLeft are unzoomed pixels while every rect is zoomed.
  // Measure both in the same (on-screen) units.
  const zoom = plan.width / (planEl.offsetWidth || plan.width || 1);
  const contentLeft = plan.left + planEl.clientLeft * zoom;
  const contentTop = plan.top + planEl.clientTop * zoom;
  const contentW = planEl.clientWidth * zoom;
  const contentH = planEl.clientHeight * zoom;
  const frame = window.ToolboxPenLog.containedFrame(contentW, contentH, 1600, 900);
  const expected = window.ToolboxPenLog.pinPoint(400 / 1600, 450 / 900, frame);
  function inches(rect) {
    return {
      x: (rect.left - sheet.left) / sheet.width * 17,
      y: (rect.top - sheet.top) / sheet.height * 11,
      r: (rect.right - sheet.left) / sheet.width * 17,
      b: (rect.bottom - sheet.top) / sheet.height * 11,
    };
  }
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  // The rail of page stamps down the left of the workspace, not the sheet's
  // own information rail.
  const workspaceRail = document.querySelector('aside[aria-label="Report pages"]').getBoundingClientRect();
  const panel = document.querySelector('.rb-panel').getBoundingClientRect();
  return {
    plan: inches(plan),
    schedule: inches(schedule),
    sheetRail: inches(railBox),
    title: inches(title),
    north: inches(north),
    brand: inches(brand),
    figure: sheetEl.querySelector('.rb-rail__figure').textContent,
    titleText: title ? sheetEl.querySelector('.rb-rail__title').textContent : '',
    titleBreaks: sheetEl.querySelectorAll('.rb-rail__title br').length,
    aria: sheetEl.getAttribute('aria-label'),
    level: sheetEl.querySelector('.rb-penlog').getAttribute('data-level'),
    planBorder: getComputedStyle(planEl).borderTopWidth,
    planBg: getComputedStyle(planEl).backgroundColor,
    blankRows: sheetEl.querySelectorAll('.rb-penlog__grid .rb-penlog__cell').length,
    fitTopGap: fit.top - contentTop,
    fitBottomGap: (contentTop + contentH) - fit.bottom,
    fitLeftGap: fit.left - contentLeft,
    pinDx: (pin.left + pin.width / 2) - (contentLeft + expected.x),
    pinDy: (pin.top + pin.height / 2) - (contentTop + expected.y),
    // The plan, and the Sandia GEO mark in the rail's foot.
    sheetImages: sheetEl.querySelectorAll('img').length,
    panelImages: document.querySelectorAll('#rb-photo-list img').length,
    cards: sheetEl.querySelectorAll('.rb-evidence-observation').length,
    headers: [...sheetEl.querySelectorAll('.rb-penlog__cell--head')].map((node) => node.textContent).join(','),
    photos: [...sheetEl.querySelectorAll('.rb-penlog__photo')].map((node) => node.textContent).join(','),
    pins: [...sheetEl.querySelectorAll('.rb-penlog__pinnum')].map((node) => node.textContent).join(','),
    overlapPlan: hit(plan, schedule),
    overlapRail: hit(schedule, railBox),
    overlapChrome: hit(workspaceRail, sheet) || hit(panel, sheet),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('wide plan is letterboxed and the pin stays on the image',
  wideLayout.fitTopGap > 8 && wideLayout.fitBottomGap > 8 && wideLayout.fitLeftGap < 3 &&
  Math.abs(wideLayout.pinDx) < 2 && Math.abs(wideLayout.pinDy) < 2,
  JSON.stringify({ fitTopGap: wideLayout.fitTopGap, fitLeftGap: wideLayout.fitLeftGap, pinDx: wideLayout.pinDx, pinDy: wideLayout.pinDy }));
check('the plan, the schedule and the rail each own a band of the sheet',
  near(wideLayout.plan.r, 8.5, 0.2) &&
  near(wideLayout.schedule.x, 8.8, 0.2) && near(wideLayout.schedule.b, 10.5, 0.2) &&
  wideLayout.sheetRail.x > wideLayout.schedule.r &&
  !wideLayout.overlapPlan && !wideLayout.overlapRail,
  JSON.stringify({ plan: wideLayout.plan, schedule: wideLayout.schedule, sheetRail: wideLayout.sheetRail }));
check('the rail carries the two-line title, the compass above it and the mark at its foot',
  wideLayout.titleText === 'Picture/Damage LocationsMain Level' && wideLayout.titleBreaks === 1 &&
  wideLayout.level === 'Main Level' &&
  wideLayout.planBorder === '0px' && wideLayout.planBg === 'rgb(255, 255, 255)' &&
  wideLayout.north.y < wideLayout.title.y && wideLayout.brand.y > wideLayout.title.b &&
  wideLayout.brand.y > 9.5 && wideLayout.blankRows > 8,
  JSON.stringify({ title: wideLayout.title, north: wideLayout.north, brand: wideLayout.brand,
    titleText: wideLayout.titleText, planBorder: wideLayout.planBorder, planBg: wideLayout.planBg }));
// Two places name the figure -- the rail prints it, the sheet's accessible
// label says it -- and they have to say the same number. They did not: the
// label counted the page's position in the book while the rail printed the
// figure number, so a sheet stamped FIGURE 2 announced itself as Figure 4.
check('the printed figure number and the sheet label agree',
  wideLayout.figure === 'FIGURE 2' && /^Figure 2, Picture\/Damage Locations, Main Level/.test(wideLayout.aria),
  `${wideLayout.figure} | ${wideLayout.aria}`);
check('pen log is a plan and schedule, with photographs beside the page',
  !wideLayout.overlapPlan && wideLayout.headers === 'Photo,#,Notes' &&
  wideLayout.photos === '1\u20132,3' && wideLayout.pins === '1,3' &&
  wideLayout.sheetImages === 2 && wideLayout.panelImages === 3 && wideLayout.cards === 0,
  JSON.stringify(wideLayout));
check('desktop sheet stays clear of the rail and panel',
  !wideLayout.overlapChrome && !wideLayout.overflow);

const sheetShot = await page.$('.rb-sheet');
await sheetShot.screenshot({ path: `${OUT}/pen-log-after-desktop-wide.png` });
await page.screenshot({ path: `${OUT}/pen-log-after-desktop-workspace.png` });

await page.click('.rb-sheet .rb-penlog__photo');
const selected = await page.evaluate(() => ({
  note: document.querySelector('#rb-report-note').value,
  current: document.querySelector('.rb-photo.is-current figcaption').textContent,
}));
check('a photo number opens that pin’s photographs',
  selected.note === 'Hairline seam' && selected.current.indexOf('Photo 1') === 0,
  JSON.stringify(selected));

await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet .rb-rail__title');
  const fit = document.querySelector('.rb-sheet .rb-penlog__fit');
  const sheetPage = document.querySelector('.rb-sheet .rb-penlog');
  return title && /Picture\/Damage Locations/.test(title.textContent) &&
    sheetPage && sheetPage.getAttribute('data-level') === 'Upper Floor' &&
    fit && fit.getBoundingClientRect().height > 40;
});
const tallLayout = await page.evaluate(() => {
  const sheetEl = document.querySelector('.rb-sheet');
  const planEl = sheetEl.querySelector('.rb-penlog__plan');
  const plan = planEl.getBoundingClientRect();
  const fit = sheetEl.querySelector('.rb-penlog__fit').getBoundingClientRect();
  const pin = sheetEl.querySelector('.rb-penlog__pin[data-pin-id="pin-u2"]').getBoundingClientRect();
  // The editor shows the 11x17 sheet ZOOMED to the window, so the plan's
  // own clientWidth/clientLeft are unzoomed pixels while every rect is zoomed.
  // Measure both in the same (on-screen) units.
  const zoom = plan.width / (planEl.offsetWidth || plan.width || 1);
  const contentLeft = plan.left + planEl.clientLeft * zoom;
  const contentTop = plan.top + planEl.clientTop * zoom;
  const contentW = planEl.clientWidth * zoom;
  const contentH = planEl.clientHeight * zoom;
  const frame = window.ToolboxPenLog.containedFrame(contentW, contentH, 800, 1600);
  const expected = window.ToolboxPenLog.pinPoint(100 / 800, 1400 / 1600, frame);
  return {
    fitLeftGap: fit.left - contentLeft,
    fitTopGap: fit.top - contentTop,
    pinDx: (pin.left + pin.width / 2) - (contentLeft + expected.x),
    pinDy: (pin.top + pin.height / 2) - (contentTop + expected.y),
    photos: [...sheetEl.querySelectorAll('.rb-penlog__photo')].map((node) => node.textContent).join(','),
    pins: [...sheetEl.querySelectorAll('.rb-penlog__pinnum')].map((node) => node.textContent).join(','),
    panelImages: document.querySelectorAll('#rb-photo-list img').length,
  };
});
check('tall plan pillarboxes and keeps the upper-floor pin registered',
  tallLayout.fitLeftGap > 8 && tallLayout.fitTopGap < 3 &&
  Math.abs(tallLayout.pinDx) < 2 && Math.abs(tallLayout.pinDy) < 2,
  JSON.stringify(tallLayout));
check('upper floor continues the photograph sequence',
  tallLayout.photos === '4,5\u20137' && tallLayout.pins === '4,5' && tallLayout.panelImages === 4,
  JSON.stringify(tallLayout));
await (await page.$('.rb-sheet')).screenshot({ path: `${OUT}/pen-log-after-desktop-tall.png` });

await page.click('.rb-sheet .rb-penlog__photo[data-pin-id="pin-u2"]');
await page.waitForFunction(() => {
  const note = document.querySelector('#rb-report-note');
  return note && note.getAttribute('data-pin-id') === 'pin-u2';
});
await page.evaluate(() => {
  const note = document.querySelector('#rb-report-note');
  note.focus();
  note.value = '1/4 inch crack';
  note.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return !!(record && record.reportBuilder && record.reportBuilder.penLog &&
    record.reportBuilder.penLog.notes && record.reportBuilder.penLog.notes['pin-u2'] === '1/4 inch crack');
}, { timeout: 10000 });
const saved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  const source = record.distress.pins.find((pin) => pin.id === 'pin-u2');
  const pageNote = document.querySelector('.rb-sheet .rb-penlog__note[data-pin-id="pin-u2"]').value;
  const panelNote = document.querySelector('#rb-report-note').value;
  const status = (document.querySelector('#rb-save-state') && document.querySelector('#rb-save-state').textContent) ||
    (document.querySelector('#rb-save-status') && document.querySelector('#rb-save-status').textContent) || '';
  return {
    pageNote,
    panelNote,
    description: source.description,
    location: source.location,
    photos: source.photos.length,
    distressUpdatedAt: record.distress.updatedAt,
    stored: record.reportBuilder.penLog.notes['pin-u2'],
    title: record.reportBuilder.title,
    status,
  };
});
check('the report note is saved and the Distress source stays unchanged',
  saved.pageNote === '1/4 inch crack' && saved.panelNote === '1/4 inch crack' &&
  saved.stored === '1/4 inch crack' && saved.description === 'Stair crack' &&
  saved.location === 'Stair' && saved.photos === 3 &&
  saved.distressUpdatedAt === '2026-09-26T11:00:00.000Z' &&
  saved.title === 'Keep me',
  JSON.stringify(saved));
await page.screenshot({ path: `${OUT}/pen-log-after-note-saved.png` });

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-penlog/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]');
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => {
  const field = document.querySelector('.rb-sheet .rb-penlog__note[data-pin-id="pin-u2"]');
  return field && field.value === '1/4 inch crack';
});
const reloaded = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return {
    pageNote: document.querySelector('.rb-sheet .rb-penlog__note[data-pin-id="pin-u2"]').value,
    description: record.distress.pins.find((pin) => pin.id === 'pin-u2').description,
    status: document.querySelector('#rb-save-state').textContent,
  };
});
check('reload restores the report note and still leaves Distress unchanged',
  reloaded.pageNote === '1/4 inch crack' && reloaded.description === 'Stair crack' && reloaded.status === '',
  JSON.stringify(reloaded));
await (await page.$('.rb-sheet')).screenshot({ path: `${OUT}/pen-log-after-reload.png` });

await page.setOfflineMode(true);
await page.evaluate(() => { window.location.hash = '#/'; });
await page.waitForFunction(() => !document.querySelector('.rb-shell'));
await page.evaluate(() => { window.location.hash = '#/file/rb-penlog/report'; });
await page.waitForFunction(() => {
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]');
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => {
  const field = document.querySelector('.rb-sheet .rb-penlog__note[data-pin-id="pin-u2"]');
  return field && field.value === '1/4 inch crack';
});
const offlineReopen = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return {
    pageNote: document.querySelector('.rb-sheet .rb-penlog__note[data-pin-id="pin-u2"]').value,
    description: record.distress.pins.find((pin) => pin.id === 'pin-u2').description,
    offline: !navigator.onLine,
  };
});
check('offline reopen reads the saved report note',
  offlineReopen.pageNote === '1/4 inch crack' && offlineReopen.description === 'Stair crack' && offlineReopen.offline,
  JSON.stringify(offlineReopen));
await page.setOfflineMode(false);

await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1 });
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-penlog/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]');
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]').click());
await page.waitForFunction(() => document.querySelector('.rb-sheet .rb-penlog') && document.querySelector('.rb-sheet .rb-penlog').getAttribute('data-level') === 'Main Level');
await page.screenshot({ path: `${OUT}/pen-log-ipad.png` });
const ipad = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  const panel = document.querySelector('.rb-panel').getBoundingClientRect();
  const note = document.querySelector('#rb-report-note').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 180 && sheet.height > 100,
    overlap: hit(sheet, panel),
    noteReady: note.width > 120 && note.height >= 44,
  };
});
check('iPad keeps the sheet, the panel, and a usable report note apart',
  !ipad.overflow && ipad.sheetVisible && !ipad.overlap && ipad.noteReady,
  JSON.stringify(ipad));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-penlog/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]') &&
    document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]');
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => document.querySelector('.rb-sheet .rb-penlog') && document.querySelector('.rb-sheet .rb-penlog').getAttribute('data-level') === 'Upper Floor');
// The schedule is measured and reflowed after the sheet first appears, so
// data-level is on the page before the photograph rows are. Wait for the row
// itself. On a phone the whole sheet is scaled down to fit and the number is
// far too small for a synthetic tap to land on; what is under test here is
// the layout once a pin is selected, not the tap.
await page.waitForFunction(
  () => document.querySelector('.rb-sheet .rb-penlog__photo[data-pin-id="pin-u2"]'),
  { timeout: 15000 });
await page.evaluate(() => document.querySelector('.rb-sheet .rb-penlog__photo[data-pin-id="pin-u2"]').click());
const phone = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  // A Picture Locations sheet's workspace is the Pen Log panel: the report
  // note and that pin's photographs. It carries no Open Distress Survey
  // button -- only a Floor Survey sheet has a way back to its application.
  const photos = document.querySelector('#rb-photo-list');
  const photoBox = photos ? photos.getBoundingClientRect() : { width: 0, height: 0 };
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  const placed = {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 140 && sheet.height > 80,
    photosReady: photoBox.width > 40 && photoBox.height > 20,
  };
  document.querySelector('#rb-report-note').scrollIntoView({ block: 'center' });
  const note = document.querySelector('#rb-report-note').getBoundingClientRect();
  const sheetAfter = document.querySelector('.rb-sheet').getBoundingClientRect();
  placed.noteReady = note.width > 140 && note.height >= 44;
  placed.noteValue = document.querySelector('#rb-report-note').value;
  placed.overlapSheet = hit(sheetAfter, note);
  return placed;
});
check('phone pen log leaves a usable report note and keeps the sheet clear',
  !phone.overflow && phone.sheetVisible && phone.noteReady && phone.noteValue === '1/4 inch crack' &&
  !phone.overlapSheet && phone.photosReady,
  JSON.stringify(phone));
await page.screenshot({ path: `${OUT}/pen-log-phone.png`, fullPage: true });

// The plan and the schedule are pieces the investigator places. Tim:
// "Everything here needs to be movable. I should be able to move the floor
// plan if I want, and I want to be able to move the notes if I want."
// Back to the desk: placing pieces is pointer work, and the phone above
// scales the whole sheet down far too small to drag a corner on.
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-penlog/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-penlog'), { timeout: 20000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.mouse.move(4, 4);
await new Promise((r) => setTimeout(r, 300));

function penBoxes() {
  return page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const sr = sheet.getBoundingClientRect();
    const read = (which) => {
      const el = sheet.querySelector(`[data-rb-penlog-box="${which}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: +(((r.left - sr.left) / sr.width) * 17).toFixed(2),
        y: +(((r.top - sr.top) / sr.height) * 11).toFixed(2),
        w: +((r.width / sr.width) * 17).toFixed(2),
        h: +((r.height / sr.height) * 11).toFixed(2),
      };
    };
    const grips = [...sheet.querySelectorAll('[data-rb-penlog-move], [data-rb-penlog-resize]')];
    return {
      plan: read('plan'),
      schedule: read('schedule'),
      grips: grips.length,
      showing: grips.filter((g) => getComputedStyle(g).display !== 'none').length,
    };
  });
}
async function dragPen(selector, dx, dy) {
  // Pick the piece first, the way the investigator does. The handles used to
  // come out on hover; they come out when the box is highlighted now, and at
  // no other time. Tim: the pulls "only show up when the box is highlighted,
  // period."
  const box = await page.evaluate((sel) => {
    const g = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) ' + sel);
    // Just inside the corner the handle sits on, rather than the middle of
    // the piece: the plan's own drawing fills the centre.
    const r = g.closest('[data-rb-penlog-box]').getBoundingClientRect();
    const corner = /resize/.test(sel);
    return corner
      ? { x: r.right - 6, y: r.bottom - 6 }
      : { x: r.left + 6, y: r.top + 6 };
  }, selector);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const at = await page.evaluate((sel) => {
    const g = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) ' + sel);
    const r = g.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, shown: getComputedStyle(g).display };
  }, selector);
  if (at.shown === 'none') throw new Error('handle did not appear once picked: ' + selector);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1500));
}

const penStart = await penBoxes();
check('both pieces carry handles, and show none until pointed at',
  penStart.grips === 4 && penStart.showing === 0, JSON.stringify(penStart));

await dragPen('[data-rb-penlog-move="plan"]', 60, 40);
const penMoved = await penBoxes();
check('the floor plan goes where it is dragged',
  penMoved.plan.x > penStart.plan.x + 0.3 && penMoved.plan.y > penStart.plan.y + 0.2 &&
  Math.abs(penMoved.schedule.x - penStart.schedule.x) < 0.1,
  JSON.stringify({ penStart: penStart.plan, penMoved: penMoved.plan }));

await dragPen('[data-rb-penlog-resize="schedule"]', 90, -60);
const penSized = await penBoxes();
check('the notes take the size they are given, and the plan stays put',
  penSized.schedule.w > penMoved.schedule.w + 0.5 &&
  penSized.schedule.h < penMoved.schedule.h - 0.3 &&
  Math.abs(penSized.plan.x - penMoved.plan.x) < 0.1,
  JSON.stringify({ before: penMoved.schedule, after: penSized.schedule }));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
const penStored = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return (record.reportBuilder || {}).penLogLayout || null;
});
check('the placement is kept on the Customer File',
  !!penStored && Math.abs(penStored.schedule.w - penSized.schedule.w) < 0.3,
  JSON.stringify(penStored));

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-penlog/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 20000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 1500));
const penReopened = await penBoxes();
check('and it is still where it was put when the report is reopened',
  Math.abs(penReopened.plan.x - penSized.plan.x) < 0.3 &&
  Math.abs(penReopened.schedule.w - penSized.schedule.w) < 0.3,
  JSON.stringify({ penSized, penReopened }));

await browser.close();

const failed = results.filter((item) => !item.ok);
if (failed.length) {
  console.error(`${failed.length} failed`);
  process.exit(1);
}
console.log(`${results.length} passed`);
