/**
 * Survey date: always reachable from the Floor Survey ⋯ menu, flagged while it is
 * empty, asked for once the first point is down, and carried into the report.
 * (Tim, Nov 12, 2026: it was missed in the field and could not be added afterwards.)
 *
 * Run: node tests/survey-date-menu.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'fs-survey-date-menu';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', async (d) => { await d.accept(); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

async function seed({ withPoints }) {
  await page.evaluate(async (id, withPts) => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
    x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
    await window.ToolboxDB.putMedia('plan-sd', c.toDataURL('image/jpeg', 0.9));
    const rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Survey'; rec.lastName = 'Date';
    rec.propertyAddress = '5 Date Lane';
    const cv = rec.planSetup.canvases[0];
    cv.name = 'Main Level';
    cv.plan = { id: 'plan-sd', width: 800, height: 600 };
    cv.frontDoorFacing = 'N';
    const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
    const points = [];
    if (withPts) {
      for (let i = 1; i <= 6; i += 1) {
        points.push({ id: 'p' + i, floorId: cv.id, index: i, x: 100 + i * 90, y: 200 + (i % 2) * 60, value: 5 + i * 0.3 });
      }
    }
    rec.floorSurvey = {
      id: 'fs-' + id, inspectionDate: '',
      byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } },
    };
    await window.ToolboxDB.saveCustomerFile(rec);
  }, FILE, withPoints);
}
const stored = () => page.evaluate(async (id) => {
  const r = await window.ToolboxDB.getCustomerFile(id);
  return r && r.floorSurvey ? r.floorSurvey.inspectionDate : null;
}, FILE);
async function openSurvey() {
  // Leave the app first: a hash-only change would keep the old, already-mounted survey.
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="More"]', { timeout: 30000 });
  await wait(1200);
}
async function realClick(sel) {
  const el = await page.$(sel);
  if (!el) return false;
  const bb = await el.boundingBox();
  if (!bb) return false;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await wait(400);
  return true;
}
async function typeDate(sel, mmddyyyy) {
  await page.focus(sel);
  await page.keyboard.type(mmddyyyy, { delay: 40 });
  await wait(1800);
}

// ---- No points yet: no bar, but ⋯ already carries the amber flag
await seed({ withPoints: false });
await openSurvey();
check('No points yet: no survey-date bar in the way of capture', !(await page.$('[data-fs-survey-date-bar]')));
check('No date yet: the ⋯ button carries the "not set" flag', !!(await page.$('[aria-label="More"][data-survey-date-missing="true"]')));

// ---- First point down, date empty: the bar asks for it
await seed({ withPoints: true });
await openSurvey();
await page.waitForSelector('[data-fs-survey-date-bar]', { timeout: 8000 }).catch(() => {});
check('Points down and no date: "Survey date not set" bar is shown',
  await page.$eval('[data-fs-survey-date-bar]', (el) => /not set/i.test(el.textContent || '')).catch(() => false));
check('Opening Floor Survey does not invent today as the date', (await stored()) === '');

// ---- ⋯ → Survey date (first item), type a date
await realClick('[aria-label="More"]');
const firstItem = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
  return items.length ? items[0].textContent.trim() : null;
});
check('⋯ menu lists "Survey date … not set" first', !!firstItem && /^Survey date/.test(firstItem) && /not set/.test(firstItem), String(firstItem));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((x) => /^Survey date/.test(x.textContent.trim()));
  b?.click();
});
await wait(400);
await typeDate('#fs-survey-date-menu', '11102026');
check('Typing a date in ⋯ → Survey date saves it on the Customer File', (await stored()) === '2026-11-10', String(await stored()));
check('Bar and flag go away once the date is set',
  !(await page.$('[data-fs-survey-date-bar]')) && !(await page.$('[aria-label="More"][data-survey-date-missing="true"]')));

// ---- After the fact: change it, and "Today"
await openSurvey();
await realClick('[aria-label="More"]');
const shown = await page.evaluate(() => (document.querySelector('[data-fs-survey-date-menu]')?.textContent || '').trim());
check('Reopened: ⋯ shows the saved date', /2026/.test(shown) && /Nov/.test(shown) && /10/.test(shown), shown);
await page.evaluate(() => {
  [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((x) => /^Survey date/.test(x.textContent.trim()))?.click();
});
await wait(400);
await typeDate('#fs-survey-date-menu', '10152026');
check('Changing the date afterwards works', (await stored()) === '2026-10-15', String(await stored()));
await realClick('[aria-label="More"]');
await page.evaluate(() => {
  [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((x) => /^Survey date/.test(x.textContent.trim()))?.click();
});
await wait(300);
await page.evaluate(() => {
  [...document.querySelectorAll('[data-fs-survey-date-menu] button')].find((b) => /^Today$/.test(b.textContent.trim()))?.click();
});
await wait(900);
const today = await page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
check('"Today" sets today on request', (await stored()) === today, `${await stored()} vs ${today}`);

// ---- The bar's own date field works too
await seed({ withPoints: true });
await openSurvey();
await page.waitForSelector('#fs-survey-date-bar', { timeout: 8000 });
await typeDate('#fs-survey-date-bar', '09302026');
check('The "not set" bar takes a typed date', (await stored()) === '2026-09-30', String(await stored()));

// ---- The report picks it up
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await wait(4000);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-import]') || !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 25000 });
await page.evaluate(() => document.querySelector('[data-rb-floor-import]')?.click());
await wait(3500);
const sheetText = await page.evaluate(() => (document.querySelector('.rb-sheet:not(.rb-sheet--thumb)')?.innerText || ''));
check('The report sheet shows the survey date (Sep 30, 2026)', /(Sep(tember)?\.? 30,? 2026|9\/30\/2026|2026-09-30|30 Sep(tember)? 2026)/i.test(sheetText),
  (sheetText.match(/SURVEY DATE[\s\S]{0,40}/i) || [''])[0].replace(/\s+/g, ' '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
