/**
 * The contents list shrinks by the same amount however big the page is drawn.
 *
 * Run: node tests/report-contents-fit-one-scale.mjs   (static server on 8765)
 *
 * fitCoverContents took the room left on the page from getBoundingClientRect
 * -- screen pixels, carrying whatever the stage is drawn at -- and the room
 * needed from scrollHeight, which is in the element's own pixels and carries
 * nothing. The error was exactly the display scale: the same arithmetic on
 * one unchanged box reported 1.130 at Fit and 1.837 at 100%.
 *
 * So a long contents list shrank in the editor and did not shrink in the
 * print deck, and since zoom now changes that scale on demand, the box
 * resized as the page was zoomed. Audit finding 6.
 *
 * The list here is deliberately long enough to make the fitting ENGAGE --
 * a test where everything fits would pass without proving anything -- and
 * short enough not to hit the floor, where every scale clamps to the same
 * number and the bug hides again.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-contents-fit';
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
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });

// Enough levels that the CONTENTS list is genuinely long.
await p.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Contents'; rec.lastName = 'Fit';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  // Enough levels that the CONTENTS list overruns the box it is given at
  // its default place on the cover. Fitting has to actually engage or the
  // test proves nothing.
  const names = [];
  for (let i = 1; i <= 22; i += 1) names.push('Level ' + i + ' Survey Area');
  rec.planSetup.canvases[0].name = names[0];
  for (let i = 1; i < names.length; i += 1) {
    rec.planSetup.canvases.push(window.ToolboxPlanSetup.blankCanvas(names[i]));
  }
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 },
    { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const byCanvas = {};
  for (let i = 0; i < rec.planSetup.canvases.length; i += 1) {
    const cv = rec.planSetup.canvases[i]; cv.name = names[i];
    const pid = 'plan-cf-' + i;
    await window.ToolboxDB.putMedia(pid, plan);
    cv.plan = { id: pid, width: 1200, height: 900 };
    cv.frontDoorFacing = 'E';
    const points = []; let n = 0;
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + i + '_' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
    byCanvas[cv.id] = { canvasId: cv.id, points,
      areas: [{ id: 'a' + i, name: names[i], polygon: poly, createdAt: 1 }],
      boundary: poly };
  }
  rec.floorSurvey = { id: 'fs-cf', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await p.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 9000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /cover|title/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 2500));

const sample = async () => {
  await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise((r) => setTimeout(r, 900));
  return p.evaluate(() => {
    const box = document.querySelector('.rb-stage [data-rb-cover-box="contents"]');
    if (!box) return null;
    const sheet = box.closest('.rb-sheet');
    const sr = sheet.getBoundingClientRect();
    return {
      fit: +getComputedStyle(box).getPropertyValue('--rb-contents-fit').trim(),
      scale: +(sr.height / sheet.clientHeight).toFixed(4),
      level: (document.querySelector('#rb-zoom-level') || {}).textContent,
      rows: box.querySelectorAll('*').length,
      topPct: +(((box.getBoundingClientRect().top - sr.top) / sr.height) * 100).toFixed(1),
      needs: box.scrollHeight,
      roomOwn: +(sheet.clientHeight * 0.96
        - ((box.getBoundingClientRect().top - sr.top) / (sr.height / sheet.clientHeight))).toFixed(1),
    };
  });
};

const atFit = await sample();
check('the cover is on screen with a contents list on it',
  !!atFit && atFit.rows > 4, JSON.stringify(atFit));
check('the list is long enough that fitting has to engage',
  !!atFit && atFit.fit < 1, `fit ${atFit && atFit.fit} at scale ${atFit && atFit.scale}`);
check('and it has not hit the floor, where every scale would agree anyway',
  !!atFit && atFit.fit > 0.61, String(atFit && atFit.fit));

await p.click('#rb-zoom-in'); await p.click('#rb-zoom-in'); await p.click('#rb-zoom-in');
const at100 = await sample();
await p.click('#rb-zoom-in'); await p.click('#rb-zoom-in');
const at150 = await sample();
await p.click('#rb-zoom-level');
const back = await sample();

check('zooming really did change the display scale',
  at100.scale > atFit.scale + 0.1 && at150.scale > at100.scale,
  JSON.stringify([atFit.scale, at100.scale, at150.scale]));
check('the list shrinks by the same amount at every zoom',
  Math.abs(at100.fit - atFit.fit) < 0.005 && Math.abs(at150.fit - atFit.fit) < 0.005,
  JSON.stringify({ fit: atFit.fit, at100: at100.fit, at150: at150.fit,
    levels: [atFit.level, at100.level, at150.level] }));
check('and returning to Fit does not change it either',
  Math.abs(back.fit - atFit.fit) < 0.005, `${back.fit} vs ${atFit.fit}`);

await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
await p.click('#rb-print');
await p.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));
const printed = await p.evaluate(() => {
  const box = document.querySelector('.rb-print [data-rb-cover-box="contents"]');
  if (!box) return null;
  const sheet = box.closest('.rb-sheet');
  const sr = sheet.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  return {
    fit: +getComputedStyle(box).getPropertyValue('--rb-contents-fit').trim(),
    own: [sheet.clientWidth, sheet.clientHeight],
    needs: box.scrollHeight,
    topPct: +(((br.top - sr.top) / sr.height) * 100).toFixed(1),
    kids: [...box.children].map((c) => c.className + ':' + c.offsetHeight).join(' | ').slice(0, 220),
  };
});
check('the printed cover is in the print deck', !!printed, JSON.stringify(printed));
check('and the printed list shrinks by the same amount as the editor',
  !!printed && Math.abs(printed.fit - atFit.fit) < 0.005,
  JSON.stringify({ editor: atFit.fit, printed: printed && printed.fit }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
