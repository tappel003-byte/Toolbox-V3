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
  const title = document.querySelector('.rb-sheet__title');
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    title && title.textContent === 'Riley Chen';
});
const rail = await page.evaluate(() => {
  return [...document.querySelectorAll('.rb-thumb__caption')].map((node) => node.textContent);
});
check('a level without pins does not get a Pen Log',
  rail.indexOf('Pen Log · Main Level') !== -1 &&
  rail.indexOf('Pen Log · Upper Floor') !== -1 &&
  rail.indexOf('Pen Log · Roof') === -1 &&
  rail.indexOf('Pen Log · Main Level') < rail.indexOf('Pen Log · Upper Floor'),
  rail.join(' | '));
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]').click());
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-penlog__title');
  const fit = document.querySelector('.rb-penlog__fit');
  return title && title.textContent === 'Pen Log — Main Level' && fit && fit.getBoundingClientRect().width > 40;
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
check('opening the report does not write the Customer File',
  openedClean.updatedAt === '2026-09-26T12:00:00.000Z' &&
  openedClean.distressUpdatedAt === '2026-09-26T11:00:00.000Z' &&
  openedClean.title === 'Keep me' &&
  openedClean.penLog === null &&
  openedClean.save === '' &&
  openedClean.source === 'Hairline seam|Door sticks|Ceiling stain|Stair crack',
  JSON.stringify(openedClean));

const wideLayout = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  const planEl = document.querySelector('.rb-penlog__plan');
  const plan = planEl.getBoundingClientRect();
  const fit = document.querySelector('.rb-penlog__fit').getBoundingClientRect();
  const schedule = document.querySelector('.rb-penlog__schedule').getBoundingClientRect();
  const title = document.querySelector('.rb-penlog__title').getBoundingClientRect();
  const brand = document.querySelector('.rb-penlog__brand').getBoundingClientRect();
  const pin = document.querySelector('.rb-penlog__pin[data-pin-id="pin-w1"]').getBoundingClientRect();
  const contentLeft = plan.left + planEl.clientLeft;
  const contentTop = plan.top + planEl.clientTop;
  const frame = window.ToolboxPenLog.containedFrame(planEl.clientWidth, planEl.clientHeight, 1600, 900);
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
  const rail = document.querySelector('.rb-rail').getBoundingClientRect();
  const panel = document.querySelector('.rb-panel').getBoundingClientRect();
  return {
    plan: inches(plan),
    schedule: inches(schedule),
    title: inches(title),
    brand: inches(brand),
    fitTopGap: fit.top - contentTop,
    fitBottomGap: (contentTop + planEl.clientHeight) - fit.bottom,
    fitLeftGap: fit.left - contentLeft,
    pinDx: (pin.left + pin.width / 2) - (contentLeft + expected.x),
    pinDy: (pin.top + pin.height / 2) - (contentTop + expected.y),
    sheetImages: document.querySelectorAll('.rb-sheet img').length,
    panelImages: document.querySelectorAll('#rb-photo-list img').length,
    cards: document.querySelectorAll('.rb-sheet .rb-evidence-observation').length,
    headers: [...document.querySelectorAll('.rb-penlog__cell--head')].map((node) => node.textContent).join(','),
    photos: [...document.querySelectorAll('.rb-penlog__photo')].map((node) => node.textContent).join(','),
    pins: [...document.querySelectorAll('.rb-penlog__pinnum')].map((node) => node.textContent).join(','),
    overlapPlan: hit(plan, schedule),
    overlapChrome: hit(rail, sheet) || hit(panel, sheet),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('wide plan is letterboxed and the pin stays on the image',
  wideLayout.fitTopGap > 8 && wideLayout.fitBottomGap > 8 && wideLayout.fitLeftGap < 3 &&
  Math.abs(wideLayout.pinDx) < 2 && Math.abs(wideLayout.pinDy) < 2,
  JSON.stringify({ fitTopGap: wideLayout.fitTopGap, fitLeftGap: wideLayout.fitLeftGap, pinDx: wideLayout.pinDx, pinDy: wideLayout.pinDy }));
check('schedule starts near 10 inches and ends near 10.4 inches',
  near(wideLayout.schedule.x, 10, 0.15) && near(wideLayout.schedule.b, 10.4, 0.15) &&
  near(wideLayout.plan.r, 9.5, 0.15) && wideLayout.title.y < 0.6 && wideLayout.brand.y > 10.2,
  JSON.stringify({ plan: wideLayout.plan, schedule: wideLayout.schedule, title: wideLayout.title, brand: wideLayout.brand }));
check('pen log is a plan and schedule, with photographs beside the page',
  !wideLayout.overlapPlan && wideLayout.headers === 'Photo,#,Location,Notes' &&
  wideLayout.photos === '1\u20132,3' && wideLayout.pins === '1,3' &&
  wideLayout.sheetImages === 1 && wideLayout.panelImages === 3 && wideLayout.cards === 0,
  JSON.stringify(wideLayout));
check('desktop sheet stays clear of the rail and panel',
  !wideLayout.overlapChrome && !wideLayout.overflow);

const sheetShot = await page.$('.rb-sheet');
await sheetShot.screenshot({ path: `${OUT}/pen-log-after-desktop-wide.png` });
await page.screenshot({ path: `${OUT}/pen-log-after-desktop-workspace.png` });

await page.click('.rb-penlog__photo');
const selected = await page.evaluate(() => ({
  note: document.querySelector('#rb-report-note').value,
  current: document.querySelector('.rb-photo.is-current figcaption').textContent,
}));
check('a photo number opens that pin’s photographs',
  selected.note === 'Hairline seam' && selected.current.indexOf('Photo 1') === 0,
  JSON.stringify(selected));

await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-penlog__title');
  const fit = document.querySelector('.rb-penlog__fit');
  return title && title.textContent === 'Pen Log — Upper Floor' && fit && fit.getBoundingClientRect().height > 40;
});
const tallLayout = await page.evaluate(() => {
  const planEl = document.querySelector('.rb-penlog__plan');
  const plan = planEl.getBoundingClientRect();
  const fit = document.querySelector('.rb-penlog__fit').getBoundingClientRect();
  const pin = document.querySelector('.rb-penlog__pin[data-pin-id="pin-u2"]').getBoundingClientRect();
  const contentLeft = plan.left + planEl.clientLeft;
  const contentTop = plan.top + planEl.clientTop;
  const frame = window.ToolboxPenLog.containedFrame(planEl.clientWidth, planEl.clientHeight, 800, 1600);
  const expected = window.ToolboxPenLog.pinPoint(100 / 800, 1400 / 1600, frame);
  return {
    fitLeftGap: fit.left - contentLeft,
    fitTopGap: fit.top - contentTop,
    pinDx: (pin.left + pin.width / 2) - (contentLeft + expected.x),
    pinDy: (pin.top + pin.height / 2) - (contentTop + expected.y),
    photos: [...document.querySelectorAll('.rb-penlog__photo')].map((node) => node.textContent).join(','),
    pins: [...document.querySelectorAll('.rb-penlog__pinnum')].map((node) => node.textContent).join(','),
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

await page.click('.rb-penlog__photo[data-pin-id="pin-u2"]');
await page.click('#rb-report-note');
await page.keyboard.down('Control');
await page.keyboard.press('KeyA');
await page.keyboard.up('Control');
await page.keyboard.type('1/4 inch crack');
await page.waitForFunction(() => document.querySelector('#rb-save-state').textContent === 'Note saved');
const saved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  const source = record.distress.pins.find((pin) => pin.id === 'pin-u2');
  const pageNote = document.querySelector('.rb-penlog__note[data-pin-id="pin-u2"]').value;
  const panelNote = document.querySelector('#rb-report-note').value;
  return {
    pageNote,
    panelNote,
    description: source.description,
    location: source.location,
    photos: source.photos.length,
    distressUpdatedAt: record.distress.updatedAt,
    stored: record.reportBuilder.penLog.notes['pin-u2'],
    title: record.reportBuilder.title,
    status: document.querySelector('#rb-save-state').textContent,
  };
});
check('the report note is saved and the Distress source stays unchanged',
  saved.pageNote === '1/4 inch crack' && saved.panelNote === '1/4 inch crack' &&
  saved.stored === '1/4 inch crack' && saved.description === 'Stair crack' &&
  saved.location === 'Stair' && saved.photos === 3 &&
  saved.distressUpdatedAt === '2026-09-26T11:00:00.000Z' &&
  saved.title === 'Keep me' && saved.status === 'Note saved',
  JSON.stringify(saved));
await page.screenshot({ path: `${OUT}/pen-log-after-note-saved.png` });

await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    title && title.textContent === 'Riley Chen';
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => {
  const field = document.querySelector('.rb-penlog__note[data-pin-id="pin-u2"]');
  return field && field.value === '1/4 inch crack';
});
const reloaded = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return {
    pageNote: document.querySelector('.rb-penlog__note[data-pin-id="pin-u2"]').value,
    description: record.distress.pins.find((pin) => pin.id === 'pin-u2').description,
    status: document.querySelector('#rb-save-state').textContent,
  };
});
check('reload restores the report note and still leaves Distress unchanged',
  reloaded.pageNote === '1/4 inch crack' && reloaded.description === 'Stair crack' && reloaded.status === '',
  JSON.stringify(reloaded));
await (await page.$('.rb-sheet')).screenshot({ path: `${OUT}/pen-log-after-reload.png` });

await page.setOfflineMode(true);
await page.evaluate(() => { window.location.hash = '#/file/rb-penlog'; });
await page.waitForSelector('#cf-home');
await page.evaluate(() => { window.location.hash = '#/file/rb-penlog/report'; });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    title && title.textContent === 'Riley Chen';
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => {
  const field = document.querySelector('.rb-penlog__note[data-pin-id="pin-u2"]');
  return field && field.value === '1/4 inch crack';
});
const offlineReopen = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-penlog');
  return {
    pageNote: document.querySelector('.rb-penlog__note[data-pin-id="pin-u2"]').value,
    description: record.distress.pins.find((pin) => pin.id === 'pin-u2').description,
    offline: !navigator.onLine,
  };
});
check('offline reopen reads the saved report note',
  offlineReopen.pageNote === '1/4 inch crack' && offlineReopen.description === 'Stair crack' && offlineReopen.offline,
  JSON.stringify(offlineReopen));
await page.setOfflineMode(false);

await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    title && title.textContent === 'Riley Chen';
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-main"]').click());
await page.waitForFunction(() => document.querySelector('.rb-penlog__title') && document.querySelector('.rb-penlog__title').textContent === 'Pen Log — Main Level');
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
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const title = document.querySelector('.rb-sheet__title');
  return document.querySelector('.rb-shell[data-report-ready="true"]') &&
    title && title.textContent === 'Riley Chen';
});
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="distress-canvas-upper"]').click());
await page.waitForFunction(() => document.querySelector('.rb-penlog__title') && document.querySelector('.rb-penlog__title').textContent === 'Pen Log — Upper Floor');
await page.click('.rb-penlog__photo[data-pin-id="pin-u2"]');
const phone = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet').getBoundingClientRect();
  const link = document.querySelector('[data-rb-source="distress"]').getBoundingClientRect();
  function hit(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  const placed = {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sheetVisible: sheet.width > 140 && sheet.height > 80,
    linkReady: link.width > 40 && link.height > 20,
    overlapLink: hit(sheet, link),
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
  !phone.overlapSheet && phone.linkReady && !phone.overlapLink,
  JSON.stringify(phone));
await page.screenshot({ path: `${OUT}/pen-log-phone.png`, fullPage: true });

await browser.close();

const failed = results.filter((item) => !item.ok);
if (failed.length) {
  console.error(`${failed.length} failed`);
  process.exit(1);
}
console.log(`${results.length} passed`);
