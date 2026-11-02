/**
 * Shared photo viewer: RB Pictures View/dblclick + CF Photo folders View.
 * Local media only; close restores report position; no caption mutation.
 *
 * Run: node tests/photo-viewer.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC';

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

check(
  'ToolboxPhotoViewer is loaded',
  await page.evaluate(() =>
    !!(window.ToolboxPhotoViewer && typeof window.ToolboxPhotoViewer.open === 'function')),
);

await page.evaluate(async (png, png2) => {
  const record = window.ToolboxApp.blankCustomerFile('photo-viewer-cf');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'View';
  record.lastName = 'Photos';
  record.propertyAddress = '9 View Court';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-pv', png);
  record.planSetup.canvases[0].plan = { id: 'plan-pv', width: 400, height: 300 };
  await window.ToolboxDB.putMedia('ph-pv-1', png);
  await window.ToolboxDB.putMedia('ph-pv-2', png2);
  await window.ToolboxDB.putMedia('ph-pv-3', png);
  record.distress = {
    mode: 'internal',
    startNum: 1,
    nextNum: 4,
    activeCanvasId: canvasId,
    pins: [
      {
        id: 'pin-1', num: 1, x: 0.3, y: 0.4, canvasId,
        location: 'Foyer', description: 'First caption',
        photos: [{ id: 'ph-pv-1' }],
      },
      {
        id: 'pin-2', num: 2, x: 0.5, y: 0.5, canvasId,
        location: 'Hall', description: 'Second caption',
        photos: [{ id: 'ph-pv-2' }],
      },
      {
        id: 'pin-3', num: 3, x: 0.6, y: 0.6, canvasId,
        location: 'Kitchen', description: 'Third caption',
        photos: [{ id: 'ph-pv-3' }],
      },
    ],
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, TINY_PNG, TINY_PNG2);

await page.goto(`${BASE}#/file/photo-viewer-cf/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 20000 });
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 20000 },
);

const assembled = await page.evaluate(() => {
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);
  const picturesBtn = document.querySelector('.rb-thumb[data-page-id^="pictures-"]');
  return {
    captions,
    hasPictures: captions.some((c) => /^Pictures/.test(c || '')),
    picturesId: picturesBtn?.getAttribute('data-page-id') || '',
  };
});
check('assembled Pictures page in rail', assembled.hasPictures, JSON.stringify(assembled));

if (assembled.picturesId) {
  await page.click(`.rb-thumb[data-page-id="${assembled.picturesId}"]`);
  await page.waitForFunction(
    (id) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === id,
    { timeout: 10000 },
    assembled.picturesId,
  );
}
await page.waitForFunction(() => document.querySelectorAll('.rb-pictures-page__view').length >= 1, {
  timeout: 15000,
});

const before = await page.evaluate(() => {
  const stage = document.querySelector('.rb-stage');
  return {
    active: document.querySelector('.rb-thumb.is-active')?.getAttribute('data-page-id') || '',
    scrollTop: stage ? stage.scrollTop : 0,
    scrollLeft: stage ? stage.scrollLeft : 0,
    captions: [...document.querySelectorAll('[data-rb-caption]')].map((el) => el.value),
    viewCount: document.querySelectorAll('[data-rb-photo-view]').length,
  };
});
check('Pictures sheet has View controls', before.viewCount >= 3, JSON.stringify(before));

await page.click('[data-rb-photo-view]');
await page.waitForFunction(() => !!document.querySelector('.tb-photo-viewer'), { timeout: 5000 });
const openState = await page.evaluate(() => {
  const v = document.querySelector('.tb-photo-viewer');
  return {
    open: !!v,
    title: v?.querySelector('[data-pv-title]')?.textContent || '',
    caption: v?.querySelector('[data-pv-caption]')?.textContent || '',
    count: v?.querySelector('[data-pv-count]')?.textContent || '',
    imgShown: !!(v?.querySelector('[data-pv-img]') && !v.querySelector('[data-pv-img]').hidden),
  };
});
check(
  'View opens shared viewer with photo chrome',
  openState.open && openState.imgShown && /1 of 3/.test(openState.count),
  JSON.stringify(openState),
);
await page.screenshot({ path: `${OUT}/photo-viewer-rb-open.png` });

await page.click('[data-pv-next]');
await new Promise((r) => setTimeout(r, 250));
const navigated = await page.evaluate(() => ({
  count: document.querySelector('[data-pv-count]')?.textContent || '',
  title: document.querySelector('[data-pv-title]')?.textContent || '',
}));
check('Next walks report-wide order', /2 of 3/.test(navigated.count), JSON.stringify(navigated));

await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.tb-photo-viewer'), { timeout: 5000 });
const after = await page.evaluate(() => {
  const stage = document.querySelector('.rb-stage');
  return {
    active: document.querySelector('.rb-thumb.is-active')?.getAttribute('data-page-id') || '',
    scrollTop: stage ? stage.scrollTop : 0,
    scrollLeft: stage ? stage.scrollLeft : 0,
    captions: [...document.querySelectorAll('[data-rb-caption]')].map((el) => el.value),
    viewerGone: !document.querySelector('.tb-photo-viewer'),
  };
});
check(
  'Escape closes and restores sheet position; captions unchanged',
  after.viewerGone &&
    after.active === before.active &&
    after.scrollTop === before.scrollTop &&
    after.scrollLeft === before.scrollLeft &&
    JSON.stringify(after.captions) === JSON.stringify(before.captions),
  JSON.stringify({ before, after }),
);

await page.evaluate(() => {
  const img = document.querySelector('.rb-pictures-page__image');
  img?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
});
await page.waitForFunction(() => !!document.querySelector('.tb-photo-viewer'), { timeout: 5000 });
check('Double-click opens viewer', await page.evaluate(() => !!document.querySelector('.tb-photo-viewer')));
await page.click('[data-pv-close]');
await page.waitForFunction(() => !document.querySelector('.tb-photo-viewer'), { timeout: 5000 });

await page.goto(`${BASE}#/file/photo-viewer-cf`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const hash = location.hash || '';
  return hash === '#/file/photo-viewer-cf' || hash.endsWith('/photo-viewer-cf');
}, { timeout: 15000 }).catch(() => {});
// Hub may briefly rewrite; wait for Photo folders once the record is on the hub.
await page.waitForFunction(() => !!document.querySelector('#home-photo-folders'), { timeout: 20000 });
await page.click('#home-photo-folders');
await page.waitForFunction(() => !!document.querySelector('.photo-folders'), { timeout: 8000 });
await page.waitForFunction(() => !!document.querySelector('#photo-folders-view-one'), { timeout: 8000 });
const folderBtns = await page.evaluate(() => ({
  view: !!document.querySelector('#photo-folders-view-one'),
  download: !!document.querySelector('#photo-folders-download-one'),
}));
check('Photo folders keeps Download and adds View', folderBtns.view && folderBtns.download, JSON.stringify(folderBtns));

await page.click('#photo-folders-view-one');
await page.waitForFunction(() => !!document.querySelector('.tb-photo-viewer'), { timeout: 5000 });
await page.waitForFunction(() => {
  const img = document.querySelector('.tb-photo-viewer [data-pv-img]');
  const missing = document.querySelector('.tb-photo-viewer [data-pv-missing]');
  return img && !img.hidden && missing && missing.hidden;
}, { timeout: 5000 });
const cfOpen = await page.evaluate(() => {
  const img = document.querySelector('.tb-photo-viewer [data-pv-img]');
  const missing = document.querySelector('.tb-photo-viewer [data-pv-missing]');
  return {
    open: !!document.querySelector('.tb-photo-viewer'),
    imgShown: !!(img && !img.hidden && img.getAttribute('src')),
    missingHidden: !!(missing && missing.hidden),
  };
});
check('Photo folders View opens same viewer with local image',
  cfOpen.open && cfOpen.imgShown && cfOpen.missingHidden, JSON.stringify(cfOpen));
await page.screenshot({ path: `${OUT}/photo-viewer-cf-open.png` });
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.tb-photo-viewer'), { timeout: 5000 });
check(
  'Photo folders still open after viewer close',
  await page.evaluate(() => !!document.querySelector('.photo-folders')),
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
