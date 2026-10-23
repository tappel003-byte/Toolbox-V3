/**
 * One report, one typeface.
 *
 * Run: node tests/report-one-typeface.mjs   (static server on 8765)
 *
 * The cover and the discussion were set in Calibri; the figure pages were
 * set in a Segoe stack. The distress descriptions in the Picture Locations
 * table set no font of their own and inherit the figure page's, so the
 * notes Tim writes in Distress came out in a different face from the
 * discussion he writes in Report Builder -- on facing pages of the same
 * report.
 *
 * Tim, Oct 23, 2026: "whatever font you use in Report Builder on the main
 * screen, it needs to apply to the distress survey descriptions as well";
 * "everything should be in the discussion page cover font stream."
 *
 * This compares what the browser actually resolved, not what the stylesheet
 * says, because the fault was an inherited font nobody had declared.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-one-typeface';
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
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const shot = (label) => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 675;
    const x = c.getContext('2d');
    x.fillStyle = '#9aa7b0'; x.fillRect(0, 0, 900, 675);
    x.fillStyle = '#111'; x.font = '48px sans-serif'; x.fillText(label, 24, 72);
    return c.toDataURL('image/jpeg', 0.7);
  };
  const plan = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'One'; rec.lastName = 'Typeface';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  await window.ToolboxDB.putMedia('plan-ot', plan);
  rec.planSetup.canvases = [
    { id: 'cv-main', name: 'Main Level', rooms: [],
      plan: { id: 'plan-ot', width: 1200, height: 900 }, frontDoorFacing: 'E' },
  ];
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const mid = 'ot-ph' + i;
    await window.ToolboxDB.putMedia(mid, shot('Photo ' + i));
    ids.push(mid);
  }
  rec.distress.updatedAt = '2026-10-09T11:00:00.000Z';
  rec.distress.pins = ids.map((mid, i) => ({
    id: 'ot-pin' + (i + 1), canvasId: 'cv-main',
    x: 120 + (i % 4) * 260, y: 150 + Math.floor(i / 4) * 300,
    photos: [mid],
    description: 'Foyer — stair-stepping wall crack with evidence of prior repair',
    location: 'Foyer',
  }));
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 },
    { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'ot-p' + n, floorId: 'cv-main', index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
  }
  rec.floorSurvey = { id: 'ot-fs', inspectionDate: '2026-10-09', byCanvasId: {
    'cv-main': { canvasId: 'cv-main', points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 8000));

// Build the whole deck so every page type is in the DOM at once.
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));

const fonts = await page.evaluate(() => {
  const norm = (el) => (getComputedStyle(el).fontFamily || '')
    .replace(/["']/g, '').replace(/\s*,\s*/g, ',').toLowerCase();
  const first = (sel) => {
    const el = document.querySelector('.rb-print ' + sel);
    return el ? { sel, font: norm(el), text: (el.textContent || '').trim().slice(0, 30) } : null;
  };
  const penNotes = [...document.querySelectorAll('.rb-print .rb-penlog td, ' +
    '.rb-print .rb-penlog__note, .rb-print .rb-penlog__notes, ' +
    '.rb-print .rb-penlog tbody *')]
    .filter((el) => (el.textContent || '').indexOf('stair-stepping') >= 0);
  return {
    discussion: first('.rb-discussion'),
    discussionBody: first('.rb-discussion__body'),
    cover: first('.rb-cover'),
    topo: first('.rb-topo-page'),
    penlog: first('.rb-penlog'),
    note: penNotes.length ? { sel: '.rb-penlog (distress description)',
      font: norm(penNotes[0]), text: (penNotes[0].textContent || '').trim().slice(0, 30) } : null,
    titleRail: first('.rb-rail__rail'),
  };
});

const body = ['discussion', 'discussionBody', 'cover', 'topo', 'penlog', 'note']
  .map((k) => fonts[k]).filter(Boolean);

check('every page type was built', body.length >= 5,
  body.map((b) => b.sel).join(', '));

const want = fonts.discussion ? fonts.discussion.font : '';
check('the discussion is on the Calibri stack',
  want.indexOf('calibri') === 0 && want.indexOf('carlito') > 0, want);

const odd = body.filter((b) => b.font !== want);
check('the cover, the figure pages and the distress descriptions are all on it too',
  odd.length === 0,
  odd.length ? odd.map((b) => `${b.sel} = ${b.font}`).join(' | ') : 'all match');

check('and the distress description really was found, not skipped',
  !!fonts.note && /stair-stepping/.test(fonts.note.text),
  fonts.note ? fonts.note.text : 'not found');

// The drawing's title rail is a serif title block on purpose. Stated here so
// a change to it is a decision rather than a surprise.
check('the drawing title rail is still the one deliberate exception',
  !!fonts.titleRail && /georgia/.test(fonts.titleRail.font),
  fonts.titleRail ? fonts.titleRail.font : 'no title rail on this deck');

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
