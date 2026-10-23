/**
 * The returns are the spacing.
 *
 * Run: node tests/report-return-spacing.mjs   (static server on 8765)
 *
 * Every discussion paragraph carried an automatic 0.75em gap, so one return
 * already opened a space and two returns opened two of them plus an empty
 * line. The only way to close any of it was a menu offering "Remove Space
 * After Paragraph" / "Add Space After Paragraph" -- one setting written as
 * two commands, with nothing to say which was in force, and a label that
 * reads as though it removes returns. It never touched a return.
 *
 * Tim: "that always jacks up my spacing. It's the bane of my existence. I
 * don't like that setting in Word ... basically every time you hit return,
 * or hit return twice, it adds one line space in it, I'm fine with that."
 *
 * So: one return starts a new line, two returns leave a blank one, and
 * nothing is added behind the typing.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-spacing';
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
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Return'; rec.lastName = 'Spacing';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /discussion/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
check('the report has a Discussion sheet', at >= 0, String(at));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 2500));

const measured = await page.evaluate(() => {
  const f = document.querySelector('.rb-stage .rb-sheet [data-rb-rich][contenteditable="true"]');
  const read = (html) => {
    // The report's own markup, so the report's own spacing rules apply. Plain
    // <p> tags carry no rb-rt__p class and the rule never reached them, which
    // made this measure nothing at all.
    f.innerHTML = html;
    f.dispatchEvent(new Event('input', { bubbles: true }));
    const ps = [...f.querySelectorAll('p')];
    // Both measured off rects. The editing sheet is the paper ZOOMED to the
    // stage, so a computed line-height is in the sheet's own pixels while a
    // rect is in zoomed ones -- mixing them reads every gap as short by
    // exactly the zoom.
    const first = ps[0].getBoundingClientRect();
    const last = ps[ps.length - 1].getBoundingClientRect();
    return { gap: +(last.top - first.top).toFixed(1), line: +first.height.toFixed(1) };
  };
  // Two paragraphs, one return between them.
  const one = read('<p class="rb-rt__p">First line here.</p>'
    + '<p class="rb-rt__p">Second line here.</p>');
  // Two returns: an empty paragraph sits between them.
  const two = read('<p class="rb-rt__p">First line here.</p>'
    + '<p class="rb-rt__p"><br></p>'
    + '<p class="rb-rt__p">Second line here.</p>');
  return { one, two };
});

const line = measured.one.line;
check('one return moves the next line down exactly one line',
  Math.abs(measured.one.gap - line) < 2,
  JSON.stringify({ gap: measured.one.gap, line }));
check('two returns leave exactly one blank line',
  Math.abs(measured.two.gap - line * 2) < 3,
  JSON.stringify({ gap: measured.two.gap, twoLines: line * 2 }));

const menu = await page.evaluate(() =>
  [...document.querySelectorAll('[data-rb-spacing]')].map((b) => (b.textContent || '').trim()));
check('the spacing menu offers the three line heights',
  ['Single', '1.5', 'Double'].every((l) => menu.includes(l)), menu.join(' | '));
check('and no longer says Remove or Add Space After Paragraph',
  !menu.some((l) => /space after paragraph/i.test(l)), menu.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
