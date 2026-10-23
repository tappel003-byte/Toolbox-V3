/**
 * A printed report carries pictures at the size it prints them, not at the
 * size the phone took them.
 * Run: node tests/report-print-weight.mjs   (needs a static server on 8765)
 *
 * A phone hands over a 4032 x 3024 photograph. On a Pictures sheet it prints
 * about two and a half inches wide -- around 500 dots at 200 to the inch. The
 * other 23 million pixels went into the PDF and were thrown away by whatever
 * opened it. Tim, on a deck he had just saved: "I was trying to attach a
 * recently saved PDF but it's too big... The PDF rendered horribly." His file
 * was 53.9 MB.
 *
 * Measured here on thirty photographs: 22.1 MB of PDF became 0.8 MB.
 *
 * Nothing in the Customer File changes -- the original photograph stays as
 * captured, and only the throwaway print deck carries the smaller copy.
 */
import { createRequire } from 'module';
import { mkdir, stat, rm } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-print-weight';
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

// Twenty photographs at the size a phone actually produces, with enough
// noise in them that JPEG cannot compress them away to nothing.
await page.evaluate(async (id) => {
  const photo = (w, h, seed) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#b9c4ae');
    g.addColorStop(1, '#6d6256');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 30000; i += 1) {
      x.fillStyle = 'rgba(' + ((i * seed) % 255) + ',' + ((i * 7) % 255) + ',' +
        ((i * 13) % 255) + ',0.4)';
      x.fillRect((i * 37 + seed) % w, (i * 53 + seed) % h, 4, 4);
    }
    return c.toDataURL('image/jpeg', 0.92);
  };
  const plan = photo(1400, 1000, 3);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Janis';
  rec.lastName = 'Fensterer';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-w', plan);
  cv.plan = { id: 'plan-w', width: 1400, height: 1000 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 70, y: 70 }, { x: 1330, y: 70 }, { x: 1330, y: 930 }, { x: 70, y: 930 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 180 + c * 250, y: 200 + r * 220, value: 7 + ((n * 11) % 31) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-w', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  const pins = [];
  for (let k = 1; k <= 20; k += 1) {
    const pid = 'ph-w-' + k;
    await window.ToolboxDB.putMedia(pid, photo(4032, 3024, k * 11));
    pins.push({ id: 'pin-' + k, num: k, canvasId: cv.id,
      x: 200 + (k % 5) * 220, y: 250 + Math.floor(k / 5) * 140,
      location: 'Room ' + k, description: 'Crack at the sill, hairline.',
      photos: [{ id: pid }] });
  }
  rec.distress = { updatedAt: new Date().toISOString(), mode: 'internal', startNum: 1,
    nextNum: pins.length + 1, activeCanvasId: cv.id, pins };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 60000 });
await new Promise((r) => setTimeout(r, 12000));

await page.evaluate(() => { window.print = () => {}; });
await page.emulateMediaType('print');
await page.click('#rb-print');
await page.waitForFunction(() => !!document.querySelector('.rb-print .rb-sheet'), { timeout: 40000 });
// Polled from out here: the shrink runs on animation frames, and a headless
// page nobody is looking at does not always serve them unasked.
const until = Date.now() + 45000;
let weighed = null;
for (;;) {
  weighed = await page.evaluate(() => window.__toolboxPrintWeight || null);
  if (weighed) break;
  if (Date.now() > until) break;
  await new Promise((r) => setTimeout(r, 500));
}
check('the deck weighs its own pictures before it prints', !!weighed,
  JSON.stringify(weighed));

// The deck also carries a composed contour map for every floor slide now,
// and those are already at the resolution they print -- there is nothing to
// take off them, so they do not shrink the way a 4032px photograph does.
// What has to stay true is that the photographs are cut down hard -- that is
// the check with teeth, and it is the one below. The total size that follows
// it is a budget, not a delivery guarantee.
check('and the pictures in it are a fraction of what they were',
  weighed && weighed.redrawn >= 20 && weighed.after < weighed.before / 4,
  JSON.stringify({ redrawn: weighed && weighed.redrawn,
    beforeMB: weighed && +(weighed.before / 1048576).toFixed(1),
    afterMB: weighed && +(weighed.after / 1048576).toFixed(1) }));

const drawn = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.rb-print .rb-pictures-page__image')];
  return imgs.map((im) => ({ nat: im.naturalWidth, drawn: Math.round(im.getBoundingClientRect().width) }));
});
check('each photograph carries roughly the dots its own place on the paper needs',
  drawn.length > 0 && drawn.every((d) => d.nat > 0 && d.nat < 1200 && d.nat >= d.drawn),
  JSON.stringify(drawn.slice(0, 4)));

// The floor plan is drawn far larger, so it keeps far more of itself.
// The Picture Locations plan is drawn across most of the sheet, so the dots
// it needs are many times a thumbnail photograph's -- the rule is the size on
// the paper, not one number for everything.
const planKept = await page.evaluate(() => {
  const im = document.querySelector('.rb-print .rb-penlog__plan img');
  return im ? { nat: im.naturalWidth, drawn: Math.round(im.getBoundingClientRect().width) } : null;
});
check('a plan, which prints large, keeps far more of itself than a photograph',
  !!planKept && planKept.nat >= 1200,
  JSON.stringify(planKept));

const pdfPath = `${OUT}/report-print-weight.pdf`;
await page.pdf({ path: pdfPath, width: '17in', height: '11in', printBackground: true });
const size = await stat(pdfPath);
/**
 * The budget, and what it is NOT.
 *
 * This used to be `mb < 4`, a figure chosen here against this fixture's
 * twenty photographs. Tim's shipped report carries sixty to a hundred, came
 * out at 8.4 MB from about 25 MB before compression, and he emailed it. A
 * healthy file was being reported as a defect.
 *
 * 22 MB is TIM'S CHOSEN BUDGET for a report PDF (Oct 23, 2026), not a proven
 * delivery limit. Microsoft 365 has no single universal message ceiling --
 * it varies with service, account and client, and base64 adds roughly a
 * third on the way out -- so this says nothing about whether any particular
 * mailbox will take it. It is a line past which a report has grown enough to
 * look at, and nothing more.
 *
 * The check with teeth is the compression ratio above, not this. Compared in
 * bytes against a named number rather than against a rounded display value.
 */
const PDF_BUDGET_BYTES = 22000000;
const mb = +(size.size / 1048576).toFixed(1);
check('and the deck is within the report PDF size budget',
  size.size < PDF_BUDGET_BYTES, `${mb} MB of ${PDF_BUDGET_BYTES / 1000000} MB`);

// What the Customer File holds is untouched: the originals are the evidence.
const stored = await page.evaluate(async () => {
  const v = await window.ToolboxDB.getMedia('ph-w-1');
  const img = new Image();
  const got = await new Promise((done) => {
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = v;
  });
  return got;
});
check('the photograph on the Customer File is still the one that was taken',
  stored && stored.w === 4032 && stored.h === 3024, JSON.stringify(stored));

await rm(pdfPath, { force: true });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
