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
