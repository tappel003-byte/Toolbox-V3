/**
 * The discussion takes a narrative pasted in whole and lays it out.
 * Run: node tests/report-discussion-paste.mjs   (needs a static server on 8765)
 *
 * This is the one page whose words do not come from Toolbox. Tim: "the
 * discussion page is primarily going to be two column... I want to be able
 * to copy and paste full text from a Grok and it fill out the page correctly,
 * meaning it just flows from one column to the next, and if we need to add a
 * new page we add a new page."
 *
 * So what is checked here is the paste as he would make it: a whole answer
 * off the clipboard, carrying the HTML a chat answer actually puts there
 * rather than its markdown. It has to flow down the left column and continue
 * into the right, make its own continuation sheet when it runs past the
 * bottom, keep its headings and its bullets -- and bring none of the source's
 * typeface, colour or heading sizes onto a Sandia Geo page.
 *
 * A heading pasted as HTML is bold only because the browser's own stylesheet
 * says so, which is not an inline style; until that was read, every section
 * heading in a pasted narrative arrived indistinguishable from the prose.
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-disc-paste';
const results = [];

// A chat answer as the clipboard carries it: headings, prose, bullets, and
// the site's own type and colours on every block.
const SECTION = (n) =>
  `<h2 style="font-family:Inter;color:#111827;font-size:22px">Section ${n}: Observations</h2>` +
  `<p style="font-family:Inter;line-height:1.7;color:#374151">The floor level survey recorded a total relative difference of 2.6 inches across the measured area, with the high point at the north-west corner and the low point at the south-east corner of the living room. Readings were taken on a nominal grid and <strong>corrected for flooring differences</strong>.</p>` +
  `<ul style="color:#374151"><li>Stair-step cracking was observed in the north wall</li>` +
  `<li>Door binding at the top corner of the hall door</li>` +
  `<li>Separation at the baseboard of approximately one quarter inch</li></ul>` +
  `<p style="font-family:Inter;line-height:1.7;color:#374151">The pattern of movement is consistent across the measured area and does not reverse direction within any single room.</p>`;
const ANSWER = [1, 2, 3, 4, 5, 6].map(SECTION).join('');
const WORDS = ANSWER.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;

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
await browser.defaultBrowserContext()
  .overridePermissions('http://127.0.0.1:8765', ['clipboard-read', 'clipboard-write']);
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(['customerFiles', 'media'], 'readwrite');
    transaction.objectStore('customerFiles').clear();
    transaction.objectStore('media').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Jason';
  record.lastName = 'Mitchell';
  record.propertyAddress = '59 Lodge Trail\nSanta Fe, New Mexico, 87506';
  record.floorSurvey.inspectionDate = '2026-10-08';
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-thumb[data-page-id="section-discussion"]'), { timeout: 25000 });

async function openDiscussion() {
  await page.evaluate(() => {
    const thumb = [...document.querySelectorAll('.rb-thumb')]
      .find((t) => /^section-discussion|^discussion-cont/.test(t.getAttribute('data-page-id') || ''));
    thumb?.click();
  });
  await page.waitForFunction(
    () => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body'),
    { timeout: 15000 });
}
await openDiscussion();

const seeded = await page.evaluate(() => {
  const body = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body');
  const cs = getComputedStyle(body);
  return {
    columns: cs.columnCount,
    width: Math.round(body.clientWidth),
    gap: cs.columnGap,
    text: body.innerText.trim(),
    secondColumnUsed: [...body.children].some((el) => el.offsetLeft > body.clientWidth / 2),
  };
});
check('the discussion is one box of two columns', seeded.columns === '2', JSON.stringify(seeded));
check('and a short seed stays in the first of them, not spread across both',
  /Floor Level Survey Results/.test(seeded.text) && !seeded.secondColumnUsed,
  JSON.stringify({ text: seeded.text.slice(0, 40), second: seeded.secondColumnUsed }));

// The paste itself: a real one off the clipboard, because a browser performs
// its own paste only for a trusted event -- which is the path a narrative
// with no markdown markers in it takes.
// Chromium refuses a clipboard write from a document that is not focused,
// which headless pages are not until they are brought forward.
await page.bringToFront();
const cdp = await browser.target().createCDPSession();
await cdp.send('Browser.grantPermissions', {
  origin: 'http://127.0.0.1:8765',
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
});
await page.evaluate(async (html) => {
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plain], { type: 'text/plain' }),
  })]);
}, ANSWER);
await page.evaluate(() => {
  const body = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body');
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.keyboard.down('Control');
await page.keyboard.press('KeyV');
await page.keyboard.up('Control');
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb[data-page-id^="discussion-cont"]').length >= 1,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));

const flowed = await page.evaluate(() => {
  const body = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body');
  const warn = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__overflow');
  const limit = body.clientWidth - 1;
  return {
    sheets: document.querySelectorAll(
      '.rb-thumb[data-page-id="section-discussion"], .rb-thumb[data-page-id^="discussion-cont"]').length,
    secondColumnUsed: [...body.children].some((el) => el.offsetLeft > body.clientWidth / 2),
    pastTheColumns: [...body.children].filter((el) => el.offsetLeft >= limit).length,
    warned: !!(warn && !warn.hidden),
  };
});
check('a long narrative runs down the left column and into the right',
  flowed.secondColumnUsed, JSON.stringify(flowed));
check('what will not fit makes its own continuation sheet, not a hidden column',
  flowed.sheets >= 2 && flowed.pastTheColumns === 0 && !flowed.warned,
  JSON.stringify(flowed));

const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const api = window.ToolboxReportText;
  const chain = (record.reportBuilder?.pages || [])
    .filter((p) => p.type === 'section' && p.meta?.sectionId === 'discussion');
  const paragraphs = chain.flatMap((p) => api.normalize(p.reportText?.body || '').paragraphs);
  const runs = paragraphs.flatMap((p) => p.runs);
  return {
    sheets: chain.length,
    words: chain.reduce((n, p) =>
      n + api.toPlain(p.reportText?.body || '').trim().split(/\s+/).filter(Boolean).length, 0),
    headings: paragraphs.filter((p) =>
      p.runs.length === 1 && p.runs[0].bold && /^Section \d+: Observations$/.test(p.runs[0].text)).length,
    bullets: paragraphs.filter((p) => p.bullet).length,
    styled: runs.filter((r) => r.font || r.color || r.size).length,
  };
}, FILE);
check('every word of it is on the Customer File',
  stored.words >= WORDS, JSON.stringify({ stored: stored.words, pasted: WORDS }));
check('its headings stay headings and its bullets stay bullets',
  stored.headings === 6 && stored.bullets === 18,
  JSON.stringify({ headings: stored.headings, bullets: stored.bullets }));
check('and it arrives in the report’s own type, not the chat’s',
  stored.styled === 0, String(stored.styled));

// A narrative that arrives as plain prose is formatted here, so the bar has
// to carry what the ribbon carries. Tim: "this is why we need full editing
// control with all of the different PowerPoint icons -- section, indent,
// bullets etc. If it comes in as plain text so be it."
const bar = await page.evaluate(() => ({
  commands: [...document.querySelectorAll('.rb-format [data-rb-fmt]')]
    .map((b) => b.getAttribute('data-rb-fmt')),
  rows: new Set([...document.querySelectorAll('.rb-format__group')]
    .map((g) => Math.round(g.getBoundingClientRect().top))).size,
}));
check('the bar carries the ribbon\u2019s controls',
  ['bold', 'italic', 'underline', 'strike', 'textcase', 'clearfmt', 'textcolor',
    'bullet', 'number', 'outdent', 'indent',
    'left', 'center', 'right', 'justify'].every((c) => bar.commands.indexOf(c) !== -1),
  bar.commands.join(','));

async function selectFirstBlock() {
  await page.evaluate(() => {
    const body = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body');
    body.focus();
    const range = document.createRange();
    range.selectNodeContents(body.children[0]);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await new Promise((r) => setTimeout(r, 300));
}
async function press(command) {
  await selectFirstBlock();
  await page.evaluate((c) => {
    const btn = document.querySelector('.rb-format [data-rb-fmt="' + c + '"]');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, command);
  await new Promise((r) => setTimeout(r, 700));
  return page.evaluate(() => {
    const body = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body');
    return { html: body.children[0].innerHTML, text: body.children[0].textContent };
  });
}
const struck = await press('strike');
check('strikethrough marks the words and stays on them',
  /<(s|strike)>/i.test(struck.html), struck.html.slice(0, 80));
const upper = await press('textcase');
const lower = await press('textcase');
const title = await press('textcase');
check('change case steps UPPER, lower, then Capitals',
  upper.text === upper.text.toUpperCase() &&
  lower.text === lower.text.toLowerCase() &&
  title.text !== upper.text && title.text !== lower.text,
  JSON.stringify({ upper: upper.text, lower: lower.text, title: title.text }));
const cleared = await press('clearfmt');
check('clear all formatting leaves the words and takes the rest',
  !/<(b|strong|s|strike|i|em|u)>/i.test(cleared.html) && cleared.text === title.text,
  cleared.html.slice(0, 80));

// The writing area is a box the investigator places. Tim: "if you let me
// adjust the size of the box then I can use the white space that I want."
await openDiscussion();
// Pointer off the sheet and nothing focused: the writing area is being
// looked at, not worked in.
await page.evaluate(() => document.activeElement?.blur());
await page.mouse.move(4, 4);
await new Promise((r) => setTimeout(r, 400));
const atRest = await page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-disc-box]');
  const grips = [...box.querySelectorAll('[data-rb-disc-move], [data-rb-disc-resize]')];
  return {
    grips: grips.length,
    showing: grips.filter((g) => getComputedStyle(g).display !== 'none').length,
    outline: getComputedStyle(box).outlineStyle,
  };
});
check('the writing area shows no handles until it is pointed at',
  atRest.grips === 2 && atRest.showing === 0 && atRest.outline === 'none',
  JSON.stringify(atRest));

function boxNow() {
  return page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const sr = sheet.getBoundingClientRect();
    const r = sheet.querySelector('[data-rb-disc-box]').getBoundingClientRect();
    return {
      x: +(((r.left - sr.left) / sr.width) * 100).toFixed(1),
      y: +(((r.top - sr.top) / sr.height) * 100).toFixed(1),
      w: +((r.width / sr.width) * 100).toFixed(1),
      h: +((r.height / sr.height) * 100).toFixed(1),
      sheets: document.querySelectorAll(
        '.rb-thumb[data-page-id="section-discussion"], .rb-thumb[data-page-id^="discussion-cont"]').length,
    };
  });
}
// How the narrative is divided between the sheets. A smaller box does not
// always need one more sheet -- the one after it may have had room -- so
// what proves the re-flow ran is that the first sheet gives text up.
function splitNow() {
  return page.evaluate(async (id) => {
    const record = await window.ToolboxDB.getCustomerFile(id);
    const api = window.ToolboxReportText;
    return (record.reportBuilder?.pages || [])
      .filter((p) => p.type === 'section' && p.meta?.sectionId === 'discussion')
      .map((p) => api.normalize(p.reportText?.body || '').paragraphs.length);
  }, FILE);
}
async function dragGrip(selector, dx, dy) {
  const at = await page.evaluate((sel) => {
    const g = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) ' + sel);
    g.style.display = 'block';
    const r = g.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1500));
}

const boxStart = await boxNow();
const splitStart = await splitNow();
await dragGrip('[data-rb-disc-resize]', -220, -150);
const boxSmaller = await boxNow();
const splitSmaller = await splitNow();
check('dragging its corner makes the writing area smaller',
  boxSmaller.w < boxStart.w - 5 && boxSmaller.h < boxStart.h - 5,
  JSON.stringify({ boxStart, boxSmaller }));
check('and the narrative re-flows into the room that is left',
  splitSmaller[0] < splitStart[0] &&
  splitSmaller.reduce((a, b) => a + b, 0) === splitStart.reduce((a, b) => a + b, 0),
  JSON.stringify({ splitStart, splitSmaller }));

await dragGrip('[data-rb-disc-move]', 60, 40);
const boxMoved = await boxNow();
check('dragging its corner handle moves it without resizing it',
  boxMoved.x > boxSmaller.x + 1 && boxMoved.y > boxSmaller.y + 1 &&
  Math.abs(boxMoved.w - boxSmaller.w) < 1.5 && Math.abs(boxMoved.h - boxSmaller.h) < 1.5,
  JSON.stringify({ boxSmaller, boxMoved }));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 });
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-thumb[data-page-id="section-discussion"]'), { timeout: 25000 });
await openDiscussion();
const boxReopened = await boxNow();
check('where it was put is where it is when the report is reopened',
  Math.abs(boxReopened.x - boxMoved.x) < 1.5 && Math.abs(boxReopened.y - boxMoved.y) < 1.5 &&
  Math.abs(boxReopened.w - boxMoved.w) < 1.5 && Math.abs(boxReopened.h - boxMoved.h) < 1.5,
  JSON.stringify({ boxMoved, boxReopened }));

// And a way back to the placement the shipped reports use.
await page.evaluate(() => document.querySelector('[data-rb-disc-reset]')?.click());
await new Promise((r) => setTimeout(r, 1800));
const boxReset = await boxNow();
check('Reset writing area puts it back where the reports put it',
  Math.abs(boxReset.x - boxStart.x) < 1 && Math.abs(boxReset.w - boxStart.w) < 1 &&
  Math.abs(boxReset.h - boxStart.h) < 1,
  JSON.stringify({ boxStart, boxReset }));

// Take it away again and the sheet it needed goes with it.
await openDiscussion();
await page.evaluate(() => {
  const body = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-discussion__body');
  body.innerHTML = '';
  body.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb[data-page-id^="discussion-cont"]').length === 0,
  { timeout: 20000 });
check('and deleting it pulls the continuation sheet back out of the book', true, '');

await page.screenshot({ path: `${OUT}/report-discussion-paste.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
