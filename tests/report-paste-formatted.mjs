/**
 * A paste keeps its formatting: bold, headings, lists and their nesting.
 *
 * Run: node tests/report-paste-formatted.mjs   (static server on 8765)
 *
 * The paste handler read only the clipboard's text/plain flavour, and only
 * when that looked like markdown. A list copied out of a browser flattens in
 * that flavour -- the marker and its text arrive on separate lines and the
 * nesting is gone -- so every bullet's text landed on the line below its
 * marker and three indent levels came in as one.
 *
 * Tim, after pasting two pages of report text: "what I'm looking for is a
 * right-click paste as formatted."
 *
 * The HTML flavour is read first now. Nothing from the clipboard is inserted
 * as markup: it is parsed detached, read into the report's model, and written
 * back out as the report's own markup.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-paste';
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
  rec.firstName = 'Paste'; rec.lastName = 'Formatted';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));

// The Discussion sheet.
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /discussion/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
check('the report has a Discussion sheet', at >= 0, String(at));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 2500));

// What a browser actually puts on the clipboard: real list markup, nested.
const CLIP = [
  '<p>The investigation included a visual review. ',
  '<b>This paragraph contains bold text</b> in the middle.</p>',
  '<ul>',
  '<li><b>Exterior:</b> Several conditions were recorded.',
  '<ul><li>North side: a short description.</li>',
  '<li>South side: a longer observation that wraps.</li></ul></li>',
  '<li><b>Interior:</b> Door operation was noted.',
  '<ul><li>Main level: sample text.',
  '<ul><li>Detail: a second level of indentation.</li></ul></li></ul></li>',
  '</ul>',
  '<ol><li>Compare with earlier photographs.</li>',
  '<li>Confirm which changes occurred.</li></ol>',
].join('');

const pasted = await page.evaluate(async (html) => {
  const field = document.querySelector('.rb-stage .rb-sheet [data-rb-rich][contenteditable="true"]');
  if (!field) return { field: false };
  field.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  // The plain flavour a browser pairs with it: markers split from their text.
  dt.setData('text/plain', 'The investigation included a visual review.\n\n•\nExterior: Several conditions were recorded.\n•\nNorth side: a short description.');
  field.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true, cancelable: true, clipboardData: dt,
  }));
  await new Promise((r) => setTimeout(r, 400));
  const items = [...field.querySelectorAll('li')].map((li) => {
    const cs = getComputedStyle(li);
    return {
      text: (li.textContent || '').trim().slice(0, 34),
      ml: cs.marginLeft,
      // The marker and the text share a line when the item is one line tall.
      lines: Math.round(li.getBoundingClientRect().height / parseFloat(cs.lineHeight || '0') || 0),
    };
  });
  return {
    field: true,
    bold: !!field.querySelector('b, strong'),
    lists: field.querySelectorAll('ul, ol').length,
    numbered: field.querySelectorAll('ol').length,
    items,
    indents: [...new Set(items.map((i) => i.ml))],
  };
}, CLIP);

check('the paste landed in the writing area', pasted.field, JSON.stringify(pasted).slice(0, 120));
check('bold survived the paste', pasted.bold, String(pasted.bold));
check('the bullets came in as a list', pasted.lists > 0, String(pasted.lists));
check('and the numbered list stayed numbered', pasted.numbered > 0, String(pasted.numbered));
check('every item keeps its text beside its marker, not below it',
  pasted.items.length > 0 && pasted.items.every((i) => i.lines <= 2),
  JSON.stringify(pasted.items.map((i) => i.lines)));
check('the nesting survived: more than one indent level',
  pasted.indents.length > 1, JSON.stringify(pasted.indents));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
