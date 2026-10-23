/**
 * The page can be made bigger to work on.
 *
 * Run: node tests/report-stage-zoom.mjs   (static server on 8765)
 *
 * The sheet is 11x17 and the stage is whatever is left after the rail and
 * the panel, so on a laptop the page is drawn at about 70% and the
 * discussion type is small to write in. Tim went looking for Presentation
 * view to edit in, because it draws the same page at 84%: "It's a lot
 * easier to work in the presentation view if we could do that... I don't
 * say font, zoom in, zoom out, so we can read it easier."
 *
 * Presentation is a composed COPY of every page, so editing there would
 * give one page two editable versions. Zoom instead: the real sheet, the
 * real toolbar, drawn bigger. Two things have to hold or it is a trap --
 * the magnification must not touch the type on the page (that would change
 * the printed report), and nothing may be cut off where it cannot be
 * scrolled back to.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-stage-zoom';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Stage'; rec.lastName = 'Zoom';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));

// Work on the discussion page, which is the one that was hard to read.
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /discussion/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 1500));

const read = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet');
  const stage = document.querySelector('.rb-stage');
  const paper = document.querySelector('.rb-stage__paper');
  const sr = stage.getBoundingClientRect();
  const pr = paper.getBoundingClientRect();
  const field = sheet.querySelector('.rb-discussion__body [data-rb-rich]')
    || sheet.querySelector('[data-rb-rich]');
  return {
    level: document.querySelector('#rb-zoom-level').textContent.trim(),
    drawnW: Math.round(sheet.getBoundingClientRect().width),
    // Unzoomed: the sheet's own pixels. These must never move.
    sheetOwnW: sheet.clientWidth,
    sheetOwnH: sheet.clientHeight,
    typePx: field ? parseFloat(getComputedStyle(field).fontSize) : 0,
    paperLeftInStage: Math.round(pr.left - sr.left),
    paperTopInStage: Math.round(pr.top - sr.top),
    scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop,
    scrolls: stage.scrollWidth > stage.clientWidth + 1,
  };
});

const fit = await read();
check('the page fits the window to begin with, and says so',
  fit.level === 'Fit', fit.level);

await page.click('#rb-zoom-in');
await page.click('#rb-zoom-in');
await new Promise((r) => setTimeout(r, 600));
const big = await read();

check('zooming in draws the page bigger',
  big.drawnW > fit.drawnW + 100, `${fit.drawnW}px → ${big.drawnW}px`);
check('and at 100% the page is the paper, exactly',
  big.level === '100%' && big.drawnW === 1632, `${big.level}, ${big.drawnW}px`);
check('the type on the page is untouched — zoom is magnification, not a restyle',
  big.sheetOwnW === fit.sheetOwnW && big.sheetOwnH === fit.sheetOwnH &&
  Math.abs(big.typePx - fit.typePx) < 0.01,
  JSON.stringify({ own: [big.sheetOwnW, big.sheetOwnH], type: big.typePx }));
check('the stage scrolls once the page is bigger than it', big.scrolls,
  String(big.scrolls));
check('and nothing is cut off past the top-left corner',
  big.paperLeftInStage >= 0 && big.paperTopInStage >= 0 &&
  big.scrollLeft === 0 && big.scrollTop === 0,
  JSON.stringify({ left: big.paperLeftInStage, top: big.paperTopInStage }));

// The point of the exercise: write on it while it is big.
const typed = await page.evaluate(async () => {
  const field = document.querySelector('.rb-stage .rb-discussion__body [data-rb-rich]')
    || document.querySelector('.rb-stage [data-rb-rich]');
  if (!field) return { none: true };
  field.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return { focused: document.activeElement === field ||
    field.contains(document.activeElement) };
});
await page.keyboard.type('Zoomed and typed.');
await new Promise((r) => setTimeout(r, 900));
const after = await page.evaluate(() => {
  const field = document.querySelector('.rb-stage .rb-discussion__body [data-rb-rich]')
    || document.querySelector('.rb-stage [data-rb-rich]');
  return field ? (field.textContent || '').slice(0, 40) : '';
});
check('the sheet still takes typing while it is zoomed',
  typed.focused === true && after.indexOf('Zoomed and typed.') === 0,
  JSON.stringify({ focused: typed.focused, text: after }));

// Zoom is a view, so the printer must never see it.
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 900));
const printed = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  return { n: sheets.length,
    own: sheets.map((s) => [s.clientWidth, s.clientHeight]).slice(0, 3) };
});
check('and the printed page is the paper whatever the stage is zoomed to',
  printed.n >= 2 && printed.own.every((wh) => wh[0] === 1632 && wh[1] === 1056),
  JSON.stringify(printed.own));

await page.evaluate(() => {
  const d = document.querySelector('.rb-print');
  if (d) d.remove();
  document.body.classList.remove('rb-printing');
});
await new Promise((r) => setTimeout(r, 500));

await page.click('#rb-zoom-level');
await new Promise((r) => setTimeout(r, 600));
const back = await read();
check('clicking the readout puts the whole page back in the window',
  back.level === 'Fit' && Math.abs(back.drawnW - fit.drawnW) <= 2,
  `${back.level}, ${back.drawnW}px`);

await page.click('#rb-zoom-out');
await new Promise((r) => setTimeout(r, 500));
const small = await read();
check('and it zooms out below fit as well',
  small.level !== 'Fit' && small.drawnW < fit.drawnW,
  `${small.level}, ${small.drawnW}px`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
