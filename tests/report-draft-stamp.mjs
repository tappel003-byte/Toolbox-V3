/**
 * The DRAFT stamp: one switch, on the page that is written.
 *
 * Run: node tests/report-draft-stamp.mjs   (static server on 8765)
 *
 * Tim, Oct 23, 2026: "One thing that I need is a big draft stamp that I can
 * put as a watermark behind the text. So I can send this out tonight." Then:
 * "I need to be able to turn it on and off. I was thinking primarily more on
 * the discussion page as opposed to every page."
 *
 * So: a toolbar switch, a stamp on the discussion sheet and nowhere else, and
 * it has to PRINT -- a draft stamp the printer drops is worse than none,
 * because the page then says it is final when it is not. It must also stay
 * out of the way of the writing: no pointer events, and faint enough to read
 * through.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-draft-stamp';
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
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Draft'; rec.lastName = 'Stamp';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-ds', img);
  cv.plan = { id: 'plan-ds', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-ds', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

// The switch is there, and it starts off.
const before = await page.evaluate(() => {
  const btn = document.querySelector('#rb-draft');
  return {
    present: !!btn,
    pressed: btn ? btn.getAttribute('aria-pressed') : null,
    label: btn ? (btn.textContent || '').trim() : '',
    stamps: document.querySelectorAll('[data-rb-draft]').length,
  };
});
check('there is a Draft stamp switch in the toolbar', before.present, before.label);
check('and it starts off, with no stamp anywhere',
  before.pressed === 'false' && before.stamps === 0, JSON.stringify(before));

await page.click('#rb-draft');
await new Promise((r) => setTimeout(r, 1200));

// Open the discussion sheet on the stage and read the stamp off it.
const discussionId = await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll('.rb-thumb[data-page-id]')];
  const hit = thumbs.find((t) => /discussion/i.test(t.getAttribute('aria-label') || ''));
  if (hit) hit.click();
  return hit ? hit.getAttribute('data-page-id') : null;
});
await new Promise((r) => setTimeout(r, 1500));

const on = await page.evaluate(() => {
  const btn = document.querySelector('#rb-draft');
  const sheet = document.querySelector('.rb-stage .rb-sheet');
  const stamp = sheet ? sheet.querySelector('[data-rb-draft]') : null;
  const out = {
    pressed: btn ? btn.getAttribute('aria-pressed') : null,
    label: btn ? (btn.textContent || '').trim() : '',
    pageType: sheet ? sheet.getAttribute('data-page-type') : null,
    sectionId: null,
    onSheet: !!stamp,
    text: stamp ? (stamp.textContent || '').trim() : '',
  };
  if (!stamp) return out;
  const cs = getComputedStyle(stamp);
  // Unzoomed: the sheet's own pixels, not the stage's scaled rect.
  out.widthPx = stamp.clientWidth;
  out.fontPx = parseFloat(cs.fontSize);
  out.sheetW = sheet.clientWidth;
  out.color = cs.color;
  out.pointerEvents = cs.pointerEvents;
  out.ariaHidden = stamp.getAttribute('aria-hidden');
  out.rotated = /matrix|rotate/.test(cs.transform || '') && cs.transform !== 'none';
  const r = sheet.getBoundingClientRect();
  const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  out.notInTheWay = !(hitEl && hitEl.closest('[data-rb-draft]'));
  return out;
});

const alpha = (() => {
  const m = /rgba?\(([^)]+)\)/.exec(on.color || '');
  if (!m) return 1;
  const parts = m[1].split(',').map((v) => parseFloat(v));
  return parts.length > 3 ? parts[3] : 1;
})();

check('the switch reads on', on.pressed === 'true', on.label);
check('the discussion sheet carries the stamp, and it says DRAFT',
  on.onSheet && on.text === 'DRAFT', JSON.stringify({ type: on.pageType, text: on.text }));
check('it is big — the type is a quarter of the sheet height or more',
  on.fontPx >= 200, `${Math.round(on.fontPx)}px on a ${on.sheetW}px sheet`);
check('it is laid across the page, not set upright', on.rotated === true, String(on.rotated));
check('it is faint enough to read the writing through', alpha > 0 && alpha <= 0.4,
  `${on.color} (alpha ${alpha})`);
check('it is not in the way of the work',
  on.pointerEvents === 'none' && on.notInTheWay === true,
  JSON.stringify({ pointerEvents: on.pointerEvents, notInTheWay: on.notInTheWay }));
check('and it is not read out as text', on.ariaHidden === 'true', String(on.ariaHidden));

// It is the discussion's stamp, not the whole book's.
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 900));

const deck = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  const rows = sheets.map((s) => {
    const stamp = s.querySelector('[data-rb-draft]');
    return {
      type: s.getAttribute('data-page-type'),
      label: (s.getAttribute('aria-label') || '').slice(0, 40),
      stamped: !!stamp,
      shown: stamp ? getComputedStyle(stamp).display !== 'none' : false,
      opaque: stamp ? getComputedStyle(stamp).opacity : null,
    };
  });
  return { sheets: sheets.length, stamped: rows.filter((r) => r.stamped), rows };
});

check('the printed deck stamps exactly one sheet', deck.stamped.length === 1,
  JSON.stringify({ sheets: deck.sheets, stamped: deck.stamped.map((r) => r.label) }));
check('and the printer draws it, rather than hiding it as editor chrome',
  deck.stamped.length === 1 && deck.stamped[0].shown && deck.stamped[0].opaque !== '0',
  JSON.stringify(deck.stamped[0] || null));

await page.evaluate(() => {
  const d = document.querySelector('.rb-print');
  if (d) d.remove();
  document.body.classList.remove('rb-printing');
});
await new Promise((r) => setTimeout(r, 600));

// It is saved with the report: it is still on after a reload.
const reloaded = await (async () => {
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 6000));
  return page.evaluate(() => {
    const btn = document.querySelector('#rb-draft');
    return {
      pressed: btn ? btn.getAttribute('aria-pressed') : null,
      stamps: document.querySelectorAll('[data-rb-draft]').length,
    };
  });
})();
check('the stamp is saved with the report, not lost on reload',
  reloaded.pressed === 'true' && reloaded.stamps >= 1, JSON.stringify(reloaded));

// And it comes off.
await page.click('#rb-draft');
await new Promise((r) => setTimeout(r, 1200));
const off = await page.evaluate(() => {
  const btn = document.querySelector('#rb-draft');
  return {
    pressed: btn ? btn.getAttribute('aria-pressed') : null,
    stamps: document.querySelectorAll('[data-rb-draft]').length,
  };
});
check('clicking it again takes the stamp off every sheet',
  off.pressed === 'false' && off.stamps === 0, JSON.stringify(off));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
