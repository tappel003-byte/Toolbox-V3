/**
 * A text box behaves like PowerPoint's.
 * Run: node tests/report-textbox.mjs   (needs a static server on 8765)
 *
 * Tim: "we talked about the text box tool and the functionality was supposed
 * to be almost exactly like PowerPoint... I know the text box is not
 * correct." It was not: the button dropped a box at a fixed spot with no
 * outline and no caret, so on white paper nothing appeared to have happened;
 * the writing surface was a thin strip across the top, so clicking the middle
 * of the box did nothing; it could not be dragged by its border; and an empty
 * one left behind stayed on the page for ever.
 *
 * So: the button arms the tool, the next click or drag on the sheet places
 * the box and sizes it, the caret is already in it, the whole inside is the
 * writing surface, the border moves it, and an empty one is thrown away when
 * it is left. This also covers the three formatting commands the bar was
 * missing against the ribbon -- font colour, numbering and justify -- because
 * they are what the box is for.
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
const FILE = 'rb-textbox';
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

await page.evaluate(async (id) => {
  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Pat';
  record.lastName = 'Quill';
  record.propertyAddress = '5 Ribbon Road\nSanta Fe, NM 87505';
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE);

async function openDiscussion() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id="section-discussion"]'),
    { timeout: 25000 });
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="section-discussion"]').click());
  await page.waitForFunction(
    () => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === 'section-discussion',
    { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  return page.evaluate(() => {
    const r = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

const boxNow = () => page.evaluate(() => {
  const n = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-ov--text');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  const field = n.querySelector('[contenteditable]');
  const fr = field ? field.getBoundingClientRect() : null;
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    outline: getComputedStyle(n).outlineStyle,
    fieldShare: fr ? Math.round((fr.height / r.height) * 100) : 0,
    caretInside: !!(field && document.activeElement === field),
    text: field ? field.textContent : '',
  };
});

const sheet = await openDiscussion();

// Arming, then placing.
await page.evaluate(() => document.querySelector('[data-rb-insert="text"]').click());
await new Promise((r) => setTimeout(r, 250));
const armed = await page.evaluate(() => ({
  lit: !!document.querySelector('[data-rb-insert="text"].is-on'),
  crosshair: !!document.querySelector('.rb-sheet--inking'),
}));
check('the button arms the tool and the sheet takes a crosshair',
  armed.lit && armed.crosshair, JSON.stringify(armed));

// Measured again right before the drag: the page rail finishes settling
// after the sheet first renders, which moves the sheet a few pixels.
const live = await page.evaluate(() => {
  const r = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const want = { x: live.x + live.w * 0.3, y: live.y + live.h * 0.25 };
await page.mouse.move(want.x, want.y);
await page.mouse.down();
await page.mouse.move(live.x + live.w * 0.62, live.y + live.h * 0.42, { steps: 10 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 900));

const placed = await boxNow();
check('the box lands where it was drawn, at the size it was drawn',
  !!placed && Math.abs(placed.x - want.x) < 6 && Math.abs(placed.y - want.y) < 6 &&
    placed.w > live.w * 0.25 && placed.h > live.h * 0.1,
  JSON.stringify({ placed, want: { x: Math.round(want.x), y: Math.round(want.y) } }));
check('it can be seen the moment it is placed, and the caret is in it',
  !!placed && placed.outline !== 'none' && placed.caretInside, JSON.stringify(placed));
check('the whole inside of the box is the writing surface',
  !!placed && placed.fieldShare > 80, JSON.stringify(placed));

// Clicking the middle -- which is what anyone does -- must type there.
await page.mouse.click(placed.x + placed.w / 2, placed.y + placed.h / 2);
await new Promise((r) => setTimeout(r, 300));
await page.keyboard.type('Settlement is concentrated at the north wall.');
await new Promise((r) => setTimeout(r, 800));
const typed = await boxNow();
check('clicking the middle of the box types into it',
  typed.text === 'Settlement is concentrated at the north wall.', JSON.stringify(typed));

/** Drag from a point inside the box, and say how far it moved. */
async function drag(offX, offY) {
  const from = await boxNow();
  await page.mouse.move(from.x + offX, from.y + offY);
  await page.mouse.down();
  await page.mouse.move(from.x + offX + 150, from.y + offY - 120, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 600));
  const to = await boxNow();
  return { dx: to.x - from.x, dy: to.y - from.y };
}
const onBorder = await drag(1, 1);
check('the border moves the box, the way a PowerPoint box is moved',
  onBorder.dx > 100 && onBorder.dy < -80, JSON.stringify(onBorder));
const onWords = await drag(40, 20);
check('and dragging across the words selects rather than moves',
  onWords.dx === 0 && onWords.dy === 0, JSON.stringify(onWords));

// Font colour, numbering and justify: the three the bar was missing.
const selectAll = () => page.evaluate(() => {
  const f = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-ov__text');
  const range = document.createRange();
  range.selectNodeContents(f);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  f.focus();
});
const written = () => page.evaluate(() => {
  const f = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-ov__text');
  if (!f) return null;
  return {
    numbered: f.querySelectorAll('ol.rb-rt__list--number li').length,
    align: [...f.querySelectorAll('.rb-rt__p')].map((p) => getComputedStyle(p).textAlign).join(','),
    red: [...f.querySelectorAll('[style*="color"]')]
      .filter((n) => /193, 74, 43|#c14a2b/i.test(n.getAttribute('style') || '')).length,
  };
});

await selectAll();
await page.evaluate(() => document.querySelector('[data-rb-open="textcolor"]').click());
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(
  () => document.querySelector('[data-rb-pick="textcolor"][data-rb-value="#c14a2b"]').click());
await new Promise((r) => setTimeout(r, 700));
check('a word can be given a colour', (await written()).red > 0, JSON.stringify(await written()));

await selectAll();
await page.evaluate(() => document.querySelector('[data-rb-fmt="number"]').click());
await new Promise((r) => setTimeout(r, 700));
check('and a numbered list is a numbered list', (await written()).numbered >= 1,
  JSON.stringify(await written()));

await selectAll();
await page.evaluate(() => document.querySelector('[data-rb-fmt="justify"]').click());
await new Promise((r) => setTimeout(r, 700));
check('and justify justifies', /justify/.test((await written()).align), JSON.stringify(await written()));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
await openDiscussion();
const kept = await written();
check('all three come back on reopening',
  kept && kept.red > 0 && kept.numbered >= 1 && /justify/.test(kept.align), JSON.stringify(kept));

// An empty box is thrown away, as PowerPoint throws one away.
const sheet2 = await page.evaluate(() => {
  const r = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const before = await page.evaluate(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) .rb-ov--text').length);
await page.evaluate(() => document.querySelector('[data-rb-insert="text"]').click());
await new Promise((r) => setTimeout(r, 250));
await page.mouse.click(sheet2.x + sheet2.w * 0.2, sheet2.y + sheet2.h * 0.75);
await new Promise((r) => setTimeout(r, 700));
await page.mouse.click(sheet2.x + sheet2.w * 0.85, sheet2.y + sheet2.h * 0.08);
await new Promise((r) => setTimeout(r, 800));
const after = await page.evaluate(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) .rb-ov--text').length);
check('an empty box is thrown away when it is left', after === before,
  JSON.stringify({ before, after }));

await page.screenshot({ path: `${OUT}/report-textbox.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
