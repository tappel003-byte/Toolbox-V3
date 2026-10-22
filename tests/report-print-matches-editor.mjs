/**
 * The paper shows the sheet the editor settled.
 *
 * Run: node tests/report-print-matches-editor.mjs   (static server on 8765)
 *
 * Printing used to build a SECOND deck at paper size -- 17in x 11in, i.e.
 * 11x17 landscape -- and everything that has to fit was worked out again at
 * that size: text re-wrapped, captions shrank by a different amount, photos
 * were measured against a different box, pin size came off a different plan
 * rect. The PDF therefore disagreed with the editor Tim had just approved:
 * notes missing, captions cut, pictures the wrong size, a level clipped.
 *
 * The printed deck is now built and fitted at the EDITOR's own 680 x 440 and
 * each finished sheet is scaled onto its own sheet of paper. This test walks
 * every page in the editor, fingerprints it, prints, and fingerprints the
 * printed sheets -- then insists they agree. It also renders a real PDF and
 * checks the page count and the paper size.
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-print-match';
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

// A report with every page type on it: cover, a floor level, Picture
// Locations, and enough photographs to make more than one Pictures sheet.
await page.evaluate(async (id) => {
  const photo = (w, h, seed) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#c8b89a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#333'; x.font = '48px sans-serif';
    x.fillText('P' + seed, 40, 80);
    return c.toDataURL('image/jpeg', 0.85);
  };
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Print';
  rec.lastName = 'Match';
  // Long enough that the street line has to come down to fit.
  rec.propertyAddress = '15 Rabbitbrush Road And Then Some More\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-pmx', photo(1200, 900, 0));
  cv.plan = { id: 'plan-pmx', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const pins = [];
  for (let k = 1; k <= 12; k += 1) {
    const pid = 'ph-pmx-' + k;
    await window.ToolboxDB.putMedia(pid, photo(1600, 1200, k));
    pins.push({
      id: 'pin-' + k, num: k, canvasId: cv.id,
      x: 180 + (k % 4) * 220, y: 220 + Math.floor(k / 4) * 200,
      location: 'Room ' + k,
      description: 'A long caption that has to shrink to fit the plate under '
        + 'the photograph without moving the picture or being cut off.',
      photos: [{ id: pid }],
      note: 'Pen log note ' + k + ', which must print as text.',
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

// One fingerprint of a sheet: everything that has to fit, as a fraction of
// the sheet so it can be compared at any scale.
const FINGERPRINT = `(sheet) => {
  const box = sheet.getBoundingClientRect();
  const w = box.width || 1;
  const h = box.height || 1;
  const frac = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: +(((r.left - box.left) / w) * 100).toFixed(2),
      y: +(((r.top - box.top) / h) * 100).toFixed(2),
      w: +((r.width / w) * 100).toFixed(2),
      h: +((r.height / h) * 100).toFixed(2),
    };
  };
  // Font size relative to the sheet, so it survives the scale.
  const typeSize = (el) => {
    const px = parseFloat(window.getComputedStyle(el).fontSize);
    return isFinite(px) ? +((px / h) * 100).toFixed(3) : 0;
  };
  const list = (sel, extra) => [...sheet.querySelectorAll(sel)].map((el) => {
    const out = { k: sel, ...frac(el) };
    if (extra) Object.assign(out, extra(el));
    return out;
  });
  const clipped = [...sheet.querySelectorAll('[data-rb-caption], [data-rb-rich], .rb-sheet__note')]
    .filter((el) => el.scrollHeight > el.clientHeight + 1).length;
  return {
    type: sheet.getAttribute('data-page-type') || '',
    sheetW: Math.round(box.width),
    sheetH: Math.round(box.height),
    captions: list('[data-rb-caption]', (el) => ({ fs: typeSize(el) })),
    street: list('[data-rb-fit-line]', (el) => ({ fs: typeSize(el) })),
    coverBoxes: list('[data-rb-cover-box]'),
    floorPieces: list('[data-rb-floor-kind]'),
    pictures: list('.rb-plate img, .rb-pic img, .rb-sheet img'),
    pinSize: (() => {
      const fit = sheet.querySelector('.rb-penlog__fit');
      return fit ? (fit.style.getPropertyValue('--rb-pin-size') || '').trim() : '';
    })(),
    clipped,
  };
}`;

// Walk every page in the editor and fingerprint each one.
const pageIds = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-thumb[data-page-id]')].map((b) => b.getAttribute('data-page-id')));
check('the report has every page type on it', pageIds.length >= 5, `${pageIds.length} pages`);

const editor = [];
for (const id of pageIds) {
  await page.click(`.rb-thumb[data-page-id="${id}"]`);
  await new Promise((r) => setTimeout(r, 1200));
  editor.push(await page.evaluate(
    (fp) => (0, eval)(fp)(document.querySelector('.rb-stage .rb-sheet')),
    FINGERPRINT,
  ));
}

// Back to the first page, then print.
await page.click(`.rb-thumb[data-page-id="${pageIds[0]}"]`);
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 800));

const printed = await page.evaluate((fp) => {
  const fn = (0, eval)(fp);
  return [...document.querySelectorAll('.rb-print .rb-sheet')].map(fn);
}, FINGERPRINT);

const papers = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-print__page')].length);

check('every printed sheet sits on its own sheet of paper',
  papers === printed.length && papers === editor.length,
  `${papers} paper boxes, ${printed.length} sheets, ${editor.length} editor pages`);

const edSize = editor[0] ? `${editor[0].sheetW}x${editor[0].sheetH}` : '';
check('every printed sheet is built at the size the editor sheet is',
  printed.length > 0 && printed.every((s) => `${s.sheetW}x${s.sheetH}` === edSize),
  `editor ${edSize}; printed ${[...new Set(printed.map((s) => `${s.sheetW}x${s.sheetH}`))].join(' ')}`);

// The comparison. Same geometry, same type size, page for page.
const drift = [];
const near = (a, b, tol) => Math.abs((a || 0) - (b || 0)) <= tol;
printed.forEach((p, at) => {
  const e = editor[at];
  if (!e) { drift.push(`page ${at + 1}: no editor page`); return; }
  if (e.type !== p.type) { drift.push(`page ${at + 1}: ${e.type} vs ${p.type}`); return; }
  ['captions', 'street', 'coverBoxes', 'floorPieces', 'pictures'].forEach((key) => {
    const a = e[key] || [];
    const b = p[key] || [];
    if (a.length !== b.length) {
      drift.push(`page ${at + 1} ${p.type} ${key}: ${a.length} on screen, ${b.length} on paper`);
      return;
    }
    a.forEach((one, i) => {
      const two = b[i];
      if (!near(one.x, two.x, 0.6) || !near(one.y, two.y, 0.6)
        || !near(one.w, two.w, 0.6) || !near(one.h, two.h, 0.6)) {
        drift.push(`page ${at + 1} ${p.type} ${key}[${i}] moved: `
          + `${one.x}/${one.y} ${one.w}x${one.h} -> ${two.x}/${two.y} ${two.w}x${two.h}`);
      }
      if (one.fs !== undefined && !near(one.fs, two.fs, 0.08)) {
        drift.push(`page ${at + 1} ${p.type} ${key}[${i}] type size `
          + `${one.fs} -> ${two.fs}`);
      }
    });
  });
});

check('nothing moves or resizes between the editor and the paper',
  drift.length === 0, drift.slice(0, 8).join(' | ') || 'identical');

const clipped = printed.filter((s) => s.clipped > 0);
check('no printed sheet is silently clipping its text',
  clipped.length === 0,
  clipped.map((s) => `${s.type}:${s.clipped}`).join(' ') || 'none');

// A real PDF: the right number of pages, on 11x17 landscape.
const pdf = await page.pdf({
  width: '17in', height: '11in', printBackground: true, preferCSSPageSize: true,
});
await writeFile(`${OUT}/report-print-matches-editor.pdf`, pdf);
let info = '';
try {
  info = execFileSync('pdfinfo', [`${OUT}/report-print-matches-editor.pdf`], { encoding: 'utf8' });
} catch (err) {
  info = '';
}
const pdfPages = Number((info.match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
const pdfSize = (info.match(/^Page size:\s+(.+)$/m) || [])[1] || '';
check('the PDF has one page per sheet',
  !info || pdfPages === printed.length,
  info ? `${pdfPages} PDF pages, ${printed.length} sheets` : 'pdfinfo not installed — skipped');
// 11x17 landscape is 1224 x 792 points.
check('the PDF is 11x17 landscape',
  !info || /^1224(\.\d+)? x 792(\.\d+)?/.test(pdfSize.trim()),
  info ? pdfSize.trim() : 'pdfinfo not installed — skipped');

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
