/**
 * Present must measure sheets before it hides them.
 *
 * Run: node tests/report-present-measure.mjs  (static server on 8765)
 *
 * Presentation reuses the print deck. Adding .rb-print--present first hid
 * every sheet with display:none, so CONTENTS fit, caption shrink and pin
 * layout all measured against zero size. The flip chart and the PDF printed
 * from it then disagreed with the editor.
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
const FILE = 'rb-present-measure';
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
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const photo = (w, h, seed) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#c8b89a';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#333';
    x.font = '48px sans-serif';
    x.fillText('P' + seed, 40, 80);
    return c.toDataURL('image/jpeg', 0.85);
  };
  const plan = photo(1200, 900, 0);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Present';
  rec.lastName = 'Measure';
  rec.propertyAddress = '12 Long Street Name That Must Shrink\nSanta Fe, NM 87501';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-pm', plan);
  cv.plan = { id: 'plan-pm', width: 1200, height: 900 };
  cv.frontDoorFacing = 'N';
  const pins = [];
  for (let k = 1; k <= 8; k += 1) {
    const pid = 'ph-pm-' + k;
    await window.ToolboxDB.putMedia(pid, photo(1600, 1200, k));
    pins.push({
      id: 'pin-' + k, num: k, canvasId: cv.id,
      x: 200 + (k % 4) * 200, y: 250 + Math.floor(k / 4) * 200,
      location: 'Room ' + k,
      description: 'A long caption that needs to shrink to fit the plate under the photograph on a Pictures sheet without moving the picture.',
      photos: [{ id: pid }],
    });
  }
  rec.distress = {
    updatedAt: new Date().toISOString(), mode: 'internal', startNum: 1,
    nextNum: pins.length + 1, activeCanvasId: cv.id, pins,
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

await page.waitForSelector('#rb-present', { timeout: 10000 });
await page.click('#rb-present');
await page.waitForFunction(() => !!document.querySelector('.rb-print--present .rb-sheet.is-present-current'), {
  timeout: 60000,
});
// Let settle finish.
await new Promise((r) => setTimeout(r, 1500));

const measured = await page.evaluate(() => {
  const deck = document.querySelector('.rb-print--present');
  const cover = deck && deck.querySelector('.rb-sheet[data-page-type="cover"]');
  const contents = cover && cover.querySelector('[data-rb-cover-box="contents"]');
  const fit = contents ? contents.style.getPropertyValue('--rb-contents-fit') : '';
  const captions = [...(deck ? deck.querySelectorAll('[data-rb-caption]') : [])].map((el) => ({
    fs: el.style.fontSize || '',
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  const fitEl = deck && deck.querySelector('.rb-penlog__fit');
  const pinSize = fitEl ? fitEl.style.getPropertyValue('--rb-pin-size') : '';
  const street = cover && cover.querySelector('[data-rb-fit-line]');
  const types = [...(deck ? deck.querySelectorAll('.rb-sheet') : [])]
    .map((s) => s.getAttribute('data-page-type'));
  return {
    hasPresent: !!deck,
    sheetH: cover ? cover.clientHeight : 0,
    contentsFit: fit,
    captionsShrunk: captions.some((c) => c.fs && parseFloat(c.fs) > 0),
    pinSize: (pinSize || '').trim(),
    streetFs: street ? street.style.fontSize : '',
    types: types,
    currentType: deck.querySelector('.rb-sheet.is-present-current')?.getAttribute('data-page-type') || '',
  };
});

check('Present opens a flip-chart deck', measured.hasPresent && measured.currentType === 'cover',
  JSON.stringify(measured));
check('cover sheet was measured at real page height before present framing',
  measured.sheetH > 400, String(measured.sheetH));
check('CONTENTS fit ran against a real sheet (not display:none zero)',
  measured.contentsFit === '' || Number(measured.contentsFit) > 0,
  measured.contentsFit || '(no shrink needed)');
check('Picture Locations pins have a laid-out pin size',
  !measured.types.includes('distress') || (!!measured.pinSize && !measured.pinSize.startsWith('0')),
  measured.pinSize || '(no distress page)');

await page.screenshot({
  path: `${OUT}/report-present-measure-cover.png`,
  fullPage: false,
});

// Present → Print must weigh photographs the same way Print / PDF does.
await page.evaluate(() => { window.print = () => {}; window.__toolboxPrintWeight = null; });
await page.click('[data-present="print"]');
const until = Date.now() + 45000;
let weighed = null;
for (;;) {
  weighed = await page.evaluate(() => window.__toolboxPrintWeight || null);
  if (weighed) break;
  if (Date.now() > until) break;
  await new Promise((r) => setTimeout(r, 400));
}
check('Present Print shrinks photographs before opening the dialog',
  !!weighed && weighed.redrawn >= 1,
  JSON.stringify(weighed));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
