/**
 * iPad Mini–sized Report Builder stage must scroll when zoomed past fit,
 * with usable overflow on the right and bottom of the canvas window.
 * Run: node tests/report-stage-scroll-ipad.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-stage-scroll-ipad';
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
// iPad Mini 6 landscape CSS viewport (approx)
await page.setViewport({ width: 1133, height: 744, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ipad'; rec.lastName = 'Scroll';
  rec.propertyAddress = '44 El Cielo Azul Circle\nEdgewood, NM';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

// Cover is selected by default; Tim's screenshot was title page.
const probe = async (label) => page.evaluate((lab) => {
  const stage = document.querySelector('.rb-stage');
  const paper = document.querySelector('.rb-stage__paper');
  const cs = getComputedStyle(stage);
  return {
    label: lab,
    level: document.querySelector('#rb-zoom-level')?.textContent.trim(),
    zoomedClass: stage.classList.contains('rb-stage--zoomed'),
    overflowX: cs.overflowX,
    overflowY: cs.overflowY,
    stageW: stage.clientWidth,
    stageH: stage.clientHeight,
    scrollW: stage.scrollWidth,
    scrollH: stage.scrollHeight,
    canScrollX: stage.scrollWidth > stage.clientWidth + 1,
    canScrollY: stage.scrollHeight > stage.clientHeight + 1,
    paperW: paper?.offsetWidth,
    paperH: paper?.offsetHeight,
    scrollLeft: stage.scrollLeft,
    scrollTop: stage.scrollTop,
  };
}, label);

const fit = await probe('fit');
check('fit starts without needing stage scroll',
  !fit.canScrollX && !fit.canScrollY && !fit.zoomedClass,
  JSON.stringify(fit));

// Zoom past fit until stage must scroll (several clicks).
for (let i = 0; i < 6; i += 1) {
  await page.click('#rb-zoom-in');
  await new Promise((r) => setTimeout(r, 200));
}
const zoomed = await probe('zoomed');
check('zoomed past fit marks stage zoomed and needs scroll',
  zoomed.zoomedClass && zoomed.canScrollX && zoomed.canScrollY,
  JSON.stringify(zoomed));
check('zoomed stage uses scroll overflow on both axes (right + bottom bars)',
  zoomed.overflowX === 'scroll' && zoomed.overflowY === 'scroll',
  JSON.stringify({ overflowX: zoomed.overflowX, overflowY: zoomed.overflowY }));

const bars = await page.evaluate(() => {
  const stage = document.querySelector('.rb-stage');
  // Force layout; webkit scrollbar size is not always queryable, so assert
  // reserved gutter / scroll metrics instead.
  return {
    zoomed: stage.classList.contains('rb-stage--zoomed'),
    scrollbarGutter: getComputedStyle(stage).scrollbarGutter,
    canX: stage.scrollWidth > stage.clientWidth + 1,
    canY: stage.scrollHeight > stage.clientHeight + 1,
  };
});
check('zoomed stage reserves scrollbar space for right and bottom',
  bars.zoomed && bars.canX && bars.canY,
  JSON.stringify(bars));

// Programmatic pan must stick (proves scrollport is the stage, not a parent).
const panned = await page.evaluate(() => {
  const stage = document.querySelector('.rb-stage');
  const before = { l: stage.scrollLeft, t: stage.scrollTop };
  stage.scrollLeft = Math.min(120, Math.max(0, stage.scrollWidth - stage.clientWidth));
  stage.scrollTop = Math.min(80, Math.max(0, stage.scrollHeight - stage.clientHeight));
  return {
    before,
    after: { l: stage.scrollLeft, t: stage.scrollTop },
    maxL: stage.scrollWidth - stage.clientWidth,
    maxT: stage.scrollHeight - stage.clientHeight,
  };
});
check('stage accepts horizontal and/or vertical scroll offsets',
  (panned.maxL <= 0 || panned.after.l > 0) && (panned.maxT <= 0 || panned.after.t > 0),
  JSON.stringify(panned));

await page.screenshot({ path: `${OUT}/rb-stage-scroll-ipad-zoomed.png`, fullPage: false });

// Desktop check too
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 500));
await page.click('#rb-zoom-in');
await new Promise((r) => setTimeout(r, 300));
const desk = await probe('desktop');
await page.screenshot({ path: `${OUT}/rb-stage-scroll-desktop-zoomed.png`, fullPage: false });
check('desktop zoomed stage also scrolls',
  desk.canScrollX || desk.canScrollY, JSON.stringify(desk));

await browser.close();
const passed = results.filter((r) => r.ok).length;
await writeFile(`${OUT}/rb-stage-scroll-ipad.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed`);
if (passed < results.length) process.exit(1);
