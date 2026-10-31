/**
 * High and Low markers reach Presentation and the PDF, where the editor puts
 * them.
 *
 * Run: node tests/report-highlow-output.mjs   (static server on 8765)
 *
 * The slide draws the High and Low markers on its live canvas. Presentation
 * and Print draw every Floor Survey sheet from a composed still instead, and
 * the still composer forced the markers off -- so a sheet that showed High and
 * Low on screen presented and printed without them (CLAUDE-016, D1).
 *
 * "The images differ" would pass for a marker drawn anywhere. This checks
 * WHERE: each marker is found in the still (by its own colour, against the
 * same still composed with the markers off), centred on the reading it names,
 * sitting above it the way drawPin draws it, at the level's saved nudge, at
 * the CORRECTED high rather than the raw one, at the size the slide asks for,
 * and gone when the slide turns them off. Then the same in the printed deck
 * and in a real PDF rasterized back to pixels.
 *
 * Expected positions are the fixture's own numbers, not the composer's.
 */
import { createRequire } from 'module';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-highlow-out';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- the fixture, in plan pixels --------------------------------------
// Two boundaries side by side on one 1200 x 900 plan.
const A0 = [{ x: 40, y: 40 }, { x: 580, y: 40 }, { x: 580, y: 860 }, { x: 40, y: 860 }];
const A1 = [{ x: 620, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 620, y: 860 }];
const DELTA = 1.3; // T1: readingA 9.0, readingB 7.7
const POINTS = [
  // Boundary a0. r1 is the RAW high; r2 sits behind transition T1 and is
  // lifted by 1.3 to 9.3, so the CORRECTED high is r2.
  { id: 'r1', x: 150, y: 150, v: 8.8 },
  { id: 'r2', x: 450, y: 700, v: 8.0, t: 't1' },
  { id: 'd0', x: 300, y: 450, v: 7.2, t: 't1', anchor: true },
  { id: 'p1', x: 450, y: 150, v: 7.8 },
  { id: 'p2', x: 150, y: 450, v: 7.5 },
  { id: 'p3', x: 300, y: 150, v: 7.6 },
  { id: 'p4', x: 450, y: 450, v: 7.9 },
  { id: 'lo0', x: 150, y: 700, v: 6.5 },
  // Boundary a1.
  { id: 'hi1', x: 1000, y: 200, v: 9.0 },
  { id: 'lo1', x: 700, y: 750, v: 6.0 },
  { id: 'q1', x: 850, y: 200, v: 8.0 },
  { id: 'q2', x: 1000, y: 750, v: 7.0 },
  { id: 'q3', x: 850, y: 450, v: 7.5 },
  { id: 'q4', x: 700, y: 200, v: 7.7 },
  { id: 'q5', x: 1000, y: 450, v: 8.2 },
];
// The level's saved marker nudges (Floor Survey stores them per level and
// they apply to every boundary's markers).
const NUDGE = { high: { dx: 70, dy: 40 }, low: { dx: 0, dy: 0 } };
const at = (id) => POINTS.find((p) => p.id === id);
const nudged = (id, kind) => ({ x: at(id).x + NUDGE[kind].dx, y: at(id).y + NUDGE[kind].dy });
const EXPECT = {
  a0: { high: nudged('r2', 'high'), low: nudged('lo0', 'low') },
  a1: { high: nudged('hi1', 'high'), low: nudged('lo1', 'low') },
};
// Where a marker must NOT be: the raw high, and the corrected high without
// its nudge.
const WRONG = { rawHigh: nudged('r1', 'high'), unNudged: { x: at('r2').x, y: at('r2').y } };

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

await page.evaluate(async (id, a0, a1, points, delta, nudge) => {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
  x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'High'; rec.lastName = 'Low';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-hl-out', c.toDataURL('image/png'));
  cv.plan = { id: 'plan-hl-out', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const layer = {
    canvasId: cv.id,
    inspectionDate: '2026-10-09',
    points: points.map((p, i) => {
      const pt = { id: p.id, floorId: cv.id, index: i + 1, x: p.x, y: p.y, value: p.v };
      if (p.t) pt.transitionId = p.t;
      if (p.anchor) pt.isTransitionAnchor = true;
      return pt;
    }),
    areas: [
      { id: 'a0', name: 'Living', polygon: a0, createdAt: 1 },
      { id: 'a1', name: 'Garage Wing', polygon: a1, createdAt: 2 },
    ],
    transitions: [{
      id: 't1', x: 300, y: 600, surfaceA: 'Tile', surfaceB: 'Carpet',
      readingA: 9.0, readingB: 9.0 - delta, createdAt: 1,
    }],
    transitionGroupAverages: {},
    highPinDx: nudge.high.dx, highPinDy: nudge.high.dy,
    lowPinDx: nudge.low.dx, lowPinDy: nudge.low.dy,
  };
  rec.floorSurvey = { id: 'fs-' + id, inspectionDate: '2026-10-09', byCanvasId: { [cv.id]: layer } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE, A0, A1, POINTS, DELTA, NUDGE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 60000 });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]').length >= 3,
  { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));

// Record every still the composer makes, and keep the original to make the
// markers-off reference with the same frame.
await page.evaluate(() => {
  const api = window.ToolboxFloorSurvey;
  const original = api.composeReportTopoFigureForPage.bind(api);
  window.__composeOriginal = original;
  window.__stills = [];
  api.composeReportTopoFigureForPage = async function (rec, spec, getMedia) {
    const out = await original(rec, spec, getMedia);
    if (out && out.dataUrl) {
      window.__stills.push({
        spec: JSON.parse(JSON.stringify(spec)),
        dataUrl: out.dataUrl,
        extent: out.extent,
        scale: out.scale,
        width: out.width,
        height: out.height,
      });
    }
    return out;
  };
});

// Which floor page is which boundary, from the saved book.
const floorPages = await page.evaluate(async (id) => {
  for (let i = 0; i < 40; i += 1) {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const pages = ((rec.reportBuilder || {}).pages || []).filter((p) => p && p.type === 'floor');
    if (pages.length >= 3) {
      return pages.map((p) => ({ id: p.id, areaId: (p.meta && p.meta.areaId) || null, scope: p.meta && p.meta.scope }));
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}, FILE);
const pageFor = (areaId) => floorPages.find((p) => (areaId ? p.areaId === areaId && p.scope !== 'all' : p.scope === 'all'));
const P_A0 = pageFor('a0');
const P_A1 = pageFor('a1');
const P_ALL = pageFor(null);
check('the book holds a page per boundary and a Combined View',
  !!P_A0 && !!P_A1 && !!P_ALL, JSON.stringify(floorPages));

// ---- pixel analysis, in the page ----------------------------------------
// A marker is the pixels that are the marker's own colour AND are not there
// in the same still composed with the markers off. drawPin centres its box
// on the reading horizontally and stands it above the reading: the box runs
// from 1.4 to 0.4 box-heights above the point.
const ANALYZE = `async (still, expect, wrong) => {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
  const pixels = async (src) => {
    const im = await load(src);
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data };
  };
  const spec = Object.assign({}, still.spec, {
    settings: Object.assign({}, still.spec.settings || {}, { showHighLow: false }),
  });
  const rec = await window.ToolboxDB.getCustomerFile(${JSON.stringify(FILE)});
  const off = await window.__composeOriginal(rec, spec, window.ToolboxDB.getMedia.bind(window.ToolboxDB));
  const on = await pixels(still.dataUrl);
  const ref = await pixels(off.dataUrl);
  const COLORS = { high: [181, 29, 22], low: [31, 95, 159] };
  const toImg = (p) => ({
    x: (p.x - still.extent.x) * still.scale,
    y: (p.y - still.extent.y) * still.scale,
  });
  function marker(kind, plan) {
    const want = COLORS[kind];
    const pt = toImg(plan);
    const r = 60 * still.scale;
    let n = 0; let minX = 1e9; let maxX = -1; let minY = 1e9; let maxY = -1; let sx = 0;
    for (let y = Math.max(0, Math.floor(pt.y - 3 * r)); y <= Math.min(on.h - 1, Math.ceil(pt.y + r / 4)); y++) {
      for (let x = Math.max(0, Math.floor(pt.x - r)); x <= Math.min(on.w - 1, Math.ceil(pt.x + r)); x++) {
        const i = (y * on.w + x) * 4;
        const dc = Math.abs(on.d[i] - want[0]) + Math.abs(on.d[i + 1] - want[1]) + Math.abs(on.d[i + 2] - want[2]);
        if (dc > 60) continue;
        const dr = Math.abs(on.d[i] - ref.d[i]) + Math.abs(on.d[i + 1] - ref.d[i + 1]) + Math.abs(on.d[i + 2] - ref.d[i + 2]);
        if (dr < 80) continue;
        n += 1; sx += x;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (n < 20) return { found: false, n, at: pt };
    const boxH = maxY - minY + 1;
    return {
      found: true, n, at: pt,
      cx: +(sx / n).toFixed(1),
      dx: +((sx / n) - pt.x).toFixed(1),
      // Distance from the box's foot up to... the point, in box heights.
      footGap: +((pt.y - maxY) / boxH).toFixed(2),
      boxH,
      // The box in PLAN pixels: a still is composed at whatever scale its
      // frame asks for, so marker size is compared against the plan.
      planH: +(boxH / still.scale).toFixed(2),
    };
  }
  const out = { size: [on.w, on.h], markers: {}, wrong: {} };
  Object.keys(expect).forEach((key) => {
    const [kind] = key.split(':');
    out.markers[key] = marker(kind, expect[key]);
  });
  Object.keys(wrong || {}).forEach((key) => {
    out.wrong[key] = marker('high', wrong[key]);
  });
  return out;
}`;

// A marker is where it should be: centred within 3 px, its box foot about
// 0.4 box-heights above the reading (drawPin), and found at all.
const placed = (m) => !!m && m.found && Math.abs(m.dx) <= 3 && m.footGap > 0.25 && m.footGap < 0.6;

async function present() {
  await page.evaluate(() => { window.__stills = []; });
  await page.click('#rb-present');
  await page.waitForFunction(
    () => document.querySelector('.rb-print--present') &&
      document.querySelectorAll('.rb-print--present .rb-topo-still').length >= 3,
    { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 800));
  const shown = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.rb-print--present .rb-sheet[data-page-id]').forEach((sheet) => {
      const img = sheet.querySelector('.rb-topo-still');
      if (img) out[sheet.getAttribute('data-page-id')] = img.getAttribute('src');
    });
    return { shown: out, stills: window.__stills };
  });
  await page.evaluate(() => document.querySelector('.rb-present-bar [data-present="close"]')?.click());
  await page.waitForFunction(() => !document.querySelector('.rb-print--present'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  return shown;
}

function stillFor(run, pg) {
  const src = run.shown[pg.id];
  return run.stills.find((s) => s.dataUrl === src) || null;
}

async function analyze(still, expect, wrong) {
  return page.evaluate(async (fn, s, e, w) => (0, eval)(fn)(s, e, w), ANALYZE, still, expect, wrong);
}

// ===== 1. Presentation, as the slides open ====================================
const run1 = await present();
const a0Still = stillFor(run1, P_A0);
const a1Still = stillFor(run1, P_A1);
const allStill = stillFor(run1, P_ALL);
check('Presentation shows the stills composed for it, one per floor page',
  !!a0Still && !!a1Still && !!allStill,
  JSON.stringify({ shown: Object.keys(run1.shown).length, composed: run1.stills.length }));

const a0 = await analyze(a0Still, { 'high:a0': EXPECT.a0.high, 'low:a0': EXPECT.a0.low }, WRONG);
check('the High marker is on the CORRECTED high, at the saved nudge',
  placed(a0.markers['high:a0']), JSON.stringify(a0.markers['high:a0']));
check('the Low marker is on the low reading',
  placed(a0.markers['low:a0']), JSON.stringify(a0.markers['low:a0']));
check('nothing marks the raw (uncorrected) high',
  !a0.wrong.rawHigh.found, JSON.stringify(a0.wrong.rawHigh));
// The nudge is only 70 plan pixels, so the nudged marker can fall inside the
// search window around the un-nudged spot. What must not happen is a marker
// CENTRED there.
check('nothing marks the corrected high without its saved nudge',
  !placed(a0.wrong.unNudged), JSON.stringify(a0.wrong.unNudged));

const a1 = await analyze(a1Still, { 'high:a1': EXPECT.a1.high, 'low:a1': EXPECT.a1.low }, {});
check('the second boundary\'s page marks its own High and Low',
  placed(a1.markers['high:a1']) && placed(a1.markers['low:a1']), JSON.stringify(a1.markers));

const all1 = await analyze(allStill, {
  'high:a0': EXPECT.a0.high, 'low:a0': EXPECT.a0.low,
  'high:a1': EXPECT.a1.high, 'low:a1': EXPECT.a1.low,
}, {});
check('Combined View marks each boundary\'s High and Low, as its slide does',
  Object.values(all1.markers).every(placed), JSON.stringify(all1.markers));

// ===== 2. The slide's own marker size =========================================
async function openSlide(pg) {
  await page.click(`.rb-thumb[data-page-id="${pg.id}"]`);
  await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => document.querySelector('[data-rb-floor-task="topo"]')?.click());
  await new Promise((r) => setTimeout(r, 400));
  // Contours / Readings / Accessories — High/Low size lives under Accessories.
  // (Older builds used a single legendhl rail tab and a "Marker size" label.)
  await page.evaluate(() => {
    document.querySelector('[data-rb-rail-tab="accessories"]')?.click()
      || document.querySelector('[data-rb-rail-tab="legendhl"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Accessories"] [role="tab"]')];
    tabs.find((t) => /High\/Low/.test((t.textContent || '').trim()))?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
}

await openSlide(P_A0);
// Accessory steppers are unitless (− / +), so aria-label no longer carries the
// px value. Default highLowPinSize is 11. Each click must wait for the rail →
// report settings round-trip; rapid clicks reused the same value and looked
// like a no-op.
const sizeBefore = 11;
const sizeTarget = 22;
let sizeAfter = sizeBefore;
const hasSizeControl = await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  return !!(panel && (
    panel.querySelector('button[aria-label="Increase High/Low size"]')
    || panel.querySelector('button[aria-label="Increase Marker size"]')
  ));
});
for (let n = sizeBefore; n < sizeTarget; n += 1) {
  const ok = await page.evaluate(() => {
    const panel = document.querySelector('#rb-topo-group-panel');
    const btn = (panel && (
      panel.querySelector('button[aria-label="Increase High/Low size"]')
      || panel.querySelector('button[aria-label="Increase Marker size"]')
    )) || null;
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!ok) break;
  sizeAfter = n + 1;
  await new Promise((r) => setTimeout(r, 450));
}
await new Promise((r) => setTimeout(r, 800));
check('the rail\'s High/Low size control is the one being driven',
  hasSizeControl && sizeAfter > sizeBefore,
  JSON.stringify({ sizeBefore, sizeAfter, hasSizeControl }));

const run2 = await present();
const a0Big = await analyze(stillFor(run2, P_A0), { 'high:a0': EXPECT.a0.high }, {});
const ratio = a0Big.markers['high:a0'].planH / a0.markers['high:a0'].planH;
const wantRatio = sizeAfter / sizeBefore;
check('a bigger High/Low size on the slide is a bigger marker in Presentation, in proportion',
  placed(a0Big.markers['high:a0']) && wantRatio > 1 && Math.abs(ratio - wantRatio) <= 0.15 * wantRatio,
  JSON.stringify({ ratio: +ratio.toFixed(2), wantRatio: +wantRatio.toFixed(2), sizeBefore, sizeAfter }));
const a1Same = await analyze(stillFor(run2, P_A1), { 'high:a1': EXPECT.a1.high }, {});
check('and only on that slide: another page keeps its own size',
  Math.abs(a1Same.markers['high:a1'].planH - a1.markers['high:a1'].planH) <= 1.5,
  JSON.stringify({ before: a1.markers['high:a1'].planH, after: a1Same.markers['high:a1'].planH }));

// ===== 3. Turned off on Combined View only ====================================
await openSlide(P_ALL);
const switched = await page.evaluate(() => {
  const row = [...document.querySelectorAll('label')]
    .find((l) => (l.textContent || '').trim() === 'High / low');
  const sw = row && row.parentElement && row.parentElement.querySelector('[role="switch"]');
  if (!sw) return { found: false };
  const was = sw.getAttribute('aria-checked');
  sw.click();
  return { found: true, was };
});
await new Promise((r) => setTimeout(r, 1500));
const switchedNow = await page.evaluate(() => {
  const row = [...document.querySelectorAll('label')]
    .find((l) => (l.textContent || '').trim() === 'High / low');
  const sw = row && row.parentElement && row.parentElement.querySelector('[role="switch"]');
  return sw ? sw.getAttribute('aria-checked') : null;
});
check('the slide\'s High / low switch is the one turned off',
  switched.found && switched.was === 'true' && switchedNow === 'false',
  JSON.stringify({ switched, switchedNow }));

const run3 = await present();
const allOff = await analyze(stillFor(run3, P_ALL), {
  'high:a0': EXPECT.a0.high, 'low:a0': EXPECT.a0.low,
  'high:a1': EXPECT.a1.high, 'low:a1': EXPECT.a1.low,
}, {});
check('turned off on Combined View, it presents with no markers',
  Object.values(allOff.markers).every((m) => !m.found), JSON.stringify(allOff.markers));
const a0Still3 = stillFor(run3, P_A0);
const a0On = await analyze(a0Still3, { 'high:a0': EXPECT.a0.high }, {});
check('while the boundary slide that kept them on still shows its marker',
  placed(a0On.markers['high:a0']), JSON.stringify(a0On.markers['high:a0']));

// ===== 4. The printed deck and a real PDF =====================================
await page.evaluate(() => {
  window.__stills = [];
  window.print = () => { window.__printed = true; };
});
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 800));
const deck = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print .rb-print__page')];
  return sheets.map((paper, index) => {
    const sheet = paper.querySelector('.rb-sheet[data-page-id]');
    const img = sheet && sheet.querySelector('.rb-topo-still');
    const pr = paper.getBoundingClientRect();
    const ir = img ? img.getBoundingClientRect() : null;
    return {
      index,
      pageId: sheet ? sheet.getAttribute('data-page-id') : '',
      src: img ? img.getAttribute('src') : '',
      natural: img ? [img.naturalWidth, img.naturalHeight] : null,
      fit: img ? getComputedStyle(img).objectFit : '',
      // The still's box as fractions of its paper.
      box: ir ? [(ir.left - pr.left) / pr.width, (ir.top - pr.top) / pr.height, ir.width / pr.width, ir.height / pr.height] : null,
    };
  });
});
const stills4 = await page.evaluate(() => window.__stills);
const printedA0 = deck.find((d) => d.pageId === P_A0.id);
const printedAll = deck.find((d) => d.pageId === P_ALL.id);
check('the printed deck draws the floor pages from freshly composed stills',
  !!printedA0 && !!printedAll && stills4.some((s) => s.dataUrl === printedA0.src) &&
  stills4.some((s) => s.dataUrl === printedAll.src),
  JSON.stringify({ deckPages: deck.length, stills: stills4.length }));

const pdf = await page.pdf({ width: '17in', height: '11in', printBackground: true, preferCSSPageSize: true });
const pdfPath = `${OUT}/report-highlow-output.pdf`;
await writeFile(pdfPath, pdf);
let info = '';
try { info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }); } catch (_) { info = ''; }
const pdfPages = Number((info.match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
check('the PDF has one page per sheet, on 11x17 landscape',
  pdfPages === deck.length && /^1224(\.\d+)? x 792(\.\d+)?/.test(((info.match(/^Page size:\s+(.+)$/m) || [])[1] || '').trim()),
  `${pdfPages} pages / ${deck.length} sheets`);

/**
 * Find a marker in a rasterized PDF page: map the plan point through the
 * still's extent and scale into the still, through object-fit: contain into
 * the still's box on the paper, and into the raster.
 */
async function pdfMarker(entry, still, plan, kind) {
  const DPI = 120;
  const prefix = `${OUT}/report-highlow-p${entry.index + 1}`;
  execFileSync('pdftoppm', ['-r', String(DPI), '-f', String(entry.index + 1), '-l', String(entry.index + 1),
    '-png', '-singlefile', pdfPath, prefix]);
  const png = (await readFile(`${prefix}.png`)).toString('base64');
  return page.evaluate(async (b64, e, s, p, k) => {
    const im = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64;
    });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const W = c.width; const H = c.height;
    // The still inside its box (object-fit: contain unless stated).
    const [bx, by, bw, bh] = [e.box[0] * W, e.box[1] * H, e.box[2] * W, e.box[3] * H];
    const [nw, nh] = e.natural;
    let k2 = Math.min(bw / nw, bh / nh);
    let ox = bx + (bw - nw * k2) / 2;
    let oy = by + (bh - nh * k2) / 2;
    if (e.fit === 'fill') { ox = bx; oy = by; }
    const px = ox + (p.x - s.extent.x) * s.scale * (e.fit === 'fill' ? bw / nw : k2);
    const py = oy + (p.y - s.extent.y) * s.scale * (e.fit === 'fill' ? bh / nh : k2);
    const want = k === 'high' ? [181, 29, 22] : [31, 95, 159];
    const r = Math.max(10, 60 * s.scale * k2);
    let n = 0; let sx = 0; let maxY = -1;
    for (let y = Math.max(0, Math.floor(py - 3 * r)); y <= Math.min(H - 1, Math.ceil(py + r / 4)); y++) {
      for (let xx = Math.max(0, Math.floor(px - r)); xx <= Math.min(W - 1, Math.ceil(px + r)); xx++) {
        const i = (y * W + xx) * 4;
        const dc = Math.abs(d[i] - want[0]) + Math.abs(d[i + 1] - want[1]) + Math.abs(d[i + 2] - want[2]);
        if (dc > 70) continue;
        n += 1; sx += xx; if (y > maxY) maxY = y;
      }
    }
    return { n, at: [+px.toFixed(1), +py.toFixed(1)], dx: n ? +((sx / n) - px).toFixed(1) : null, above: n ? maxY < py : null };
  }, png, entry, still, plan, kind);
}

const stillA0 = stills4.find((s) => s.dataUrl === printedA0.src);
const stillAll = stills4.find((s) => s.dataUrl === printedAll.src);
const pdfHigh = await pdfMarker(printedA0, stillA0, EXPECT.a0.high, 'high');
check('in the PDF, the High marker is printed on the corrected, nudged high',
  pdfHigh.n >= 8 && Math.abs(pdfHigh.dx) <= 3 && pdfHigh.above, JSON.stringify(pdfHigh));
const pdfLow = await pdfMarker(printedA0, stillA0, EXPECT.a0.low, 'low');
check('in the PDF, the Low marker is printed on the low reading',
  pdfLow.n >= 8 && Math.abs(pdfLow.dx) <= 3 && pdfLow.above, JSON.stringify(pdfLow));
const pdfOff = await pdfMarker(printedAll, stillAll, EXPECT.a1.high, 'high');
check('in the PDF, Combined View (turned off) prints no High marker',
  pdfOff.n < 4, JSON.stringify(pdfOff));

await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
