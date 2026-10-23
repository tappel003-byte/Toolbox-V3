/**
 * A pasted list arrives as a list, and a styled paragraph keeps its styling.
 *
 * Run: node tests/report-paste-structure.mjs   (static server on 8765)
 *
 * Audit finding 4, three faults in the DOM-to-model reader:
 *
 * 1. <li> and <p> are both blocks, so <li><p>First</p></li> -- which is what
 *    Google Docs and Word put on the clipboard -- started a paragraph with
 *    the item's marker and then immediately replaced it with a fresh one
 *    carrying neither marker nor indent. A pasted list came in as an empty
 *    bullet above unmarked text, one pair per item.
 * 2. Only INLINE elements were read into the run context, so bold, size and
 *    colour written on the paragraph itself were dropped.
 * 3. The markdown reader matched "1." in the same alternation as "-" and
 *    then set bullet, so a numbered list lost its numbers.
 *
 * The existing suite passed throughout because its fixture uses the
 * <li>text</li> shape, which always worked. That shape is checked here too:
 * the fix must not be a swap of one broken form for another.
 *
 * Carried the whole way -- paste, save, reopen, Presentation, and the
 * printed 11x17 landscape sheet -- because the model is the unit of
 * pagination, so a reader fault shows up on paper, not just on screen.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-paste-structure';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const WORD_LIST = '<ul><li><p>First</p><ul><li><p>Nested</p></li></ul></li>'
  + '<li><p>Second</p></li></ul>';
const STYLED = '<p style="font-weight:bold;font-size:20pt;color:#ff0000">'
  + 'Styled paragraph</p>';
const PLAIN_LIST = '<ul><li>Plain one<ul><li>Plain nested</li></ul></li></ul>';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });

// ---------------------------------------------- the reader, on its own
const model = await p.evaluate((word, styled, plain) => {
  const api = window.ToolboxReportText;
  const read = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return api.compact(api.fromElement(host)).paragraphs.map((q) => ({
      text: q.runs.map((r) => r.text).join(''),
      bullet: !!q.bullet, numbered: !!q.numbered, indent: q.indent || 0,
      bold: q.runs.some((r) => r.bold === true),
      size: (q.runs[0] || {}).size || null,
      color: (q.runs[0] || {}).color || null,
    }));
  };
  return {
    word: read(word), styled: read(styled), plain: read(plain),
    inline: read('<p><span style="font-size:20pt;color:#ff0000">Inline styled</span></p>'),
    md: api.fromMarkdown('1. First\n2. Second\n- A bullet').paragraphs.map((q) => ({
      text: q.runs.map((r) => r.text).join(''),
      bullet: !!q.bullet, numbered: !!q.numbered,
    })),
  };
}, WORD_LIST, STYLED, PLAIN_LIST);

check('a list item containing a paragraph keeps its marker',
  model.word.length === 3 && model.word.every((q) => q.bullet),
  JSON.stringify(model.word));
check('and no empty marker paragraph is left behind',
  model.word.every((q) => q.text.length > 0), JSON.stringify(model.word.map((q) => q.text)));
check('and the nesting survives as indent',
  model.word[0].indent === 0 && model.word[1].indent === 1 && model.word[2].indent === 0,
  JSON.stringify(model.word.map((q) => [q.text, q.indent])));
check('a paragraph set bold keeps its bold',
  model.styled.length === 1 && model.styled[0].bold, JSON.stringify(model.styled));
// Deliberately NOT size and colour on a block. A narrative pasted out of a
// chat answer carries the chat's theme on every block -- Inter, #374151,
// 22px headings -- and the settled rule is that it arrives in the report's
// own type, not the chat's (report-discussion-paste). The two cannot both
// hold for the same paste; the proven one does, and the question is Tim's.
check('but not a block size or colour, which is the chat theme in disguise',
  model.styled[0].size === null && model.styled[0].color === null,
  JSON.stringify(model.styled[0]));
check('an INLINE size and colour are still read, as they always were',
  model.inline.length === 1 && model.inline[0].size === 20 &&
  model.inline[0].color === '#ff0000', JSON.stringify(model.inline));
check('the plain <li>text</li> shape still reads as it always did',
  model.plain.length === 2 && model.plain[0].bullet && model.plain[1].bullet &&
  model.plain[1].indent === 1, JSON.stringify(model.plain));
check('markdown "1." comes in numbered, not bulleted',
  model.md[0].numbered && model.md[1].numbered &&
  !model.md[0].bullet && !model.md[1].bullet, JSON.stringify(model.md));
check('and markdown "-" is still a bullet',
  model.md[2].bullet && !model.md[2].numbered, JSON.stringify(model.md[2]));

// An edit round-trips through the same reader on every keystroke, so the
// strut a paragraph carries must not become a run size.
const roundTrip = await p.evaluate(() => {
  const api = window.ToolboxReportText;
  const once = api.compact(api.fromMarkdown('Plain body text with no size.'));
  const html = api.toHtml(once);
  const host = document.createElement('div');
  host.innerHTML = html;
  const twice = api.compact(api.fromElement(host));
  return {
    before: once.paragraphs[0].runs.map((r) => r.size || null),
    after: twice.paragraphs[0].runs.map((r) => r.size || null),
  };
});
check('an edit round trip does not invent a run size from the block strut',
  JSON.stringify(roundTrip.before) === JSON.stringify(roundTrip.after),
  JSON.stringify(roundTrip));

// ----------------------------------------------- the whole way to paper
await p.evaluate(async (id) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Paste'; rec.lastName = 'Structure';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);
await p.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /discussion/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 2000));

const pasted = await p.evaluate((html) => {
  const field = document.querySelector('.rb-stage .rb-discussion__body [data-rb-rich]')
    || document.querySelector('.rb-stage [data-rb-rich]');
  if (!field) return { none: true };
  field.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  sel.removeAllRanges();
  sel.addRange(range);
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', 'First\nNested\nSecond\nStyled paragraph');
  field.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true, cancelable: true, clipboardData: dt,
  }));
  return { fired: true };
}, WORD_LIST + STYLED);
await new Promise((r) => setTimeout(r, 2000));

const readSheet = (scope) => p.evaluate((sel) => {
  const field = document.querySelector(sel + ' [data-rb-rich]');
  if (!field) return null;
  const rows = [...field.querySelectorAll('.rb-rt__p')].map((el) => ({
    text: (el.textContent || '').trim(),
    tag: el.tagName,
    bullet: el.classList.contains('rb-rt__p--bullet'),
    number: el.classList.contains('rb-rt__p--number'),
    indentPct: (el.style.marginLeft || '0'),
    bold: !!el.querySelector('strong'),
    color: (el.querySelector('span[style*="color"]') || {}).style
      ? el.querySelector('span[style*="color"]').style.color : '',
  }));
  return rows.filter((r) => r.text);
}, scope);

const live = await readSheet('.rb-stage .rb-sheet');
check('the paste landed on the sheet as marked list rows',
  !!live && live.filter((r) => r.bullet).length === 3,
  JSON.stringify(live));
check('with the nested row indented',
  !!live && live.some((r) => r.text === 'Nested' && /%/.test(r.indentPct)),
  JSON.stringify((live || []).map((r) => [r.text, r.indentPct])));
check('and the styled paragraph is bold on the page, in the report\u2019s own type',
  !!live && live.some((r) => /Styled paragraph/.test(r.text) && r.bold && !r.color),
  JSON.stringify((live || []).filter((r) => /Styled/.test(r.text))));

// Save, leave, come back.
await p.evaluate(() => { const b = document.querySelector('#rb-back'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2500));
await p.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /discussion/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 2500));
const reopened = await readSheet('.rb-stage .rb-sheet');
check('it is still a list after save, close and reopen',
  !!reopened && reopened.filter((r) => r.bullet).length === 3 &&
  reopened.some((r) => r.text === 'Nested' && /%/.test(r.indentPct)),
  JSON.stringify(reopened));
check('and the styling survived the round trip too',
  !!reopened && reopened.some((r) => /Styled paragraph/.test(r.text) && r.bold),
  JSON.stringify((reopened || []).filter((r) => /Styled/.test(r.text))));

// Presentation.
await p.click('#rb-present');
await p.waitForFunction(() => !!document.querySelector('.rb-print--present'),
  { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
const presented = await p.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print--present .rb-sheet')];
  const disc = sheets.find((s) => s.querySelector('.rb-discussion'));
  if (!disc) return null;
  const rows = [...disc.querySelectorAll('.rb-rt__p')]
    .map((el) => ({ text: (el.textContent || '').trim(),
      bullet: el.classList.contains('rb-rt__p--bullet'), tag: el.tagName }))
    .filter((r) => r.text);
  return { rows, own: [disc.clientWidth, disc.clientHeight] };
});
check('Presentation shows the list as a list',
  !!presented && presented.rows.filter((r) => r.bullet).length === 3,
  JSON.stringify(presented && presented.rows));

await p.evaluate(() => {
  const bar = document.querySelector('.rb-present-bar');
  const close = bar && [...bar.querySelectorAll('button')]
    .find((b) => /close/i.test(b.textContent || ''));
  if (close) close.click();
  const d = document.querySelector('.rb-print');
  if (d) d.remove();
  document.body.classList.remove('rb-printing');
});
await new Promise((r) => setTimeout(r, 1200));

// And on paper: 11x17 landscape.
await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
await p.click('#rb-print');
await p.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));
const paper = await p.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  const disc = sheets.find((s) => s.querySelector('.rb-discussion'));
  if (!disc) return null;
  const rows = [...disc.querySelectorAll('.rb-rt__p')]
    .map((el) => ({ text: (el.textContent || '').trim(),
      bullet: el.classList.contains('rb-rt__p--bullet'),
      indentPct: el.style.marginLeft || '0',
      bold: !!el.querySelector('strong') }))
    .filter((r) => r.text);
  return { rows, own: [disc.clientWidth, disc.clientHeight],
    sheetOwn: [disc.clientWidth, disc.clientHeight] };
});
check('the printed sheet is 11x17 landscape at 96dpi',
  !!paper && paper.own[0] === 1632 && paper.own[1] === 1056,
  JSON.stringify(paper && paper.own));
check('the printed page carries the markers and the nesting',
  !!paper && paper.rows.filter((r) => r.bullet).length === 3 &&
  paper.rows.some((r) => r.text === 'Nested' && /%/.test(r.indentPct)),
  JSON.stringify(paper && paper.rows));
check('and the printed page carries the paragraph styling',
  !!paper && paper.rows.some((r) => /Styled paragraph/.test(r.text) && r.bold),
  JSON.stringify((paper ? paper.rows : []).filter((r) => /Styled/.test(r.text))));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
