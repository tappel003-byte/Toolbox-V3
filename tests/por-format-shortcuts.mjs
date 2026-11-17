/**
 * Plan of Repair: ribbon formatting on a shape's text, Ctrl+drag copy, Tab selection and Ctrl+M (PowerPoint).
 * (Tim, Nov 17, 2026: next items from the Plan of Repair audit.)
 *
 * Real mouse and keyboard in Chrome. Run: node tests/por-format-shortcuts.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  s.on('error', reject);
});
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/index.html`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch (_) {} await wait(100); }

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', async (d) => { await d.accept(); });
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 620;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 620);
  await ToolboxDB.putMedia('pl', c.toDataURL('image/png'));
  const f = ToolboxApp.blankCustomerFile('por-format-shortcuts'); ToolboxPlanSetup.ensurePlanSetup(f);
  f.firstName = 'Shape'; f.lastName = 'Text'; f.planSetup.canvases[0].name = 'Main Level';
  f.planSetup.canvases[0].plan = { id: 'pl', width: 900, height: 620 };
  await ToolboxDB.saveCustomerFile(f);
});
async function openPor() {
  await page.goto('about:blank');
  await page.goto(`${BASE}#/file/por-format-shortcuts/repair`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.por-ribbon', { timeout: 30000 });
  await wait(2200);
}
await openPor();

const objs = () => page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  const a = c.getActiveObject();
  return {
    all: c.getObjects().filter((o) => !o.excludeFromExport).map((o) => ({ t: o.type, k: o.porKind, label: o.porLabel && o.porLabel.text, text: o.text || '', angle: Math.round(o.angle || 0), w: Math.round(o.getScaledWidth()) })),
    active: a ? { t: a.type, editing: !!a.isEditing, temp: !!a.porTemp } : null,
  };
});
const sheet = await page.evaluate(() => { const r = document.querySelector('canvas.upper-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const at = (a, b) => [sheet.x + sheet.w * a, sheet.y + sheet.h * b];
const center = () => page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  const o = c.getObjects().filter((x) => !x.excludeFromExport).at(-1); const p = o.getCenterPoint();
  const r = c.upperCanvasEl.getBoundingClientRect(); const k = r.width / c.getWidth();
  return [r.left + p.x * c.viewportTransform[0] * k, r.top + p.y * c.viewportTransform[3] * k];
});
async function drawShape(label, a, b, c2, d) {
  await page.click(`[aria-label="${label}"]`);
  await page.mouse.move(...at(a, b)); await page.mouse.down();
  await page.mouse.move(...at((a + c2) / 2, (b + d) / 2), { steps: 5 }); await page.mouse.move(...at(c2, d), { steps: 5 });
  await page.mouse.up(); await wait(350); await page.keyboard.press('Escape'); await wait(150);
}
async function doubleClick(pt) { await page.mouse.click(...pt); await wait(80); await page.mouse.click(...pt); await wait(450); }


const labelOf = (i) => page.evaluate((idx) => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  const o = c.getObjects().filter((x) => !x.excludeFromExport)[idx]; return o ? { label: o.porLabel || null, stroke: o.stroke, left: Math.round(o.left), top: Math.round(o.top) } : null;
}, i);
const statusText = () => page.evaluate(() => (document.querySelector('#por-status') || {}).textContent || '');

// two shapes: one with text, one without
await drawShape('Rectangle', 0.1, 0.15, 0.35, 0.35);
await page.mouse.click(...(await center())); await wait(200);
await page.keyboard.type('Pier A'); await page.keyboard.press('Escape'); await wait(300);
await drawShape('Circle', 0.5, 0.15, 0.62, 0.35);
await page.mouse.click(...at(0.22, 0.25)); await wait(250);          // select the rectangle with text
let L = (await labelOf(0)).label;
check('A rectangle holds "Pier A" (starting point)', !!L && L.text === 'Pier A' && !L.bold && L.fontSize === 18, JSON.stringify(L));

// ---- ribbon formatting on a SELECTED shape (not editing)
await page.click('[data-por-text="bold"]'); await wait(250);
L = (await labelOf(0)).label;
check('Bold on a selected shape makes its text bold', !!L && L.bold === true, JSON.stringify(L));
await page.click('[data-por-text="italic"]'); await wait(200);
L = (await labelOf(0)).label;
check('Italic works too', L.italic === true);
await page.click('#por-font-grow'); await wait(250);
L = (await labelOf(0)).label;
check('Grow font makes the text 2 points bigger', L.fontSize === 20, String(L.fontSize));
const fam = await page.evaluate(() => [...document.querySelectorAll('#por-font-family option')].map((o) => o.value));
await page.select('#por-font-family', fam[fam.length - 1]); await wait(250);
L = (await labelOf(0)).label;
check('The Font box changes the text\'s typeface', L.fontFamily === fam[fam.length - 1], L.fontFamily);
await page.click('[data-por-align="left"]'); await wait(250);
L = (await labelOf(0)).label;
check('Align left works on the shape\'s text', L.align === 'left', L.align);
const strokeBefore = (await labelOf(0)).stroke;
await page.click('#por-font-color-btn'); await wait(250);
const swatch = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-por-font-color]')].find((x) => x.getAttribute('data-por-font-color').toLowerCase() === '#16a34a') || document.querySelectorAll('[data-por-font-color]')[2]; return b.getAttribute('data-por-font-color'); });
await page.click(`[data-por-font-color="${swatch}"]`); await wait(300);
let after = await labelOf(0);
check('Font colour recolours the text and leaves the shape\'s outline alone', after.label.color.toLowerCase() === swatch.toLowerCase() && after.stroke === strokeBefore, JSON.stringify({ c: after.label.color, stroke: after.stroke }));
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await wait(350);
after = await labelOf(0);
check('Undo takes the colour change back', after.label.color.toLowerCase() !== swatch.toLowerCase(), after.label.color);

// a shape with no text yet
await page.mouse.click(...at(0.56, 0.25)); await wait(250);
await page.click('[data-por-text="bold"]'); await wait(250);
check('Bold on a shape with no text yet says so and changes nothing', (await labelOf(1)).label === null && /text in the shape first/i.test(await statusText()), await statusText());

// several shapes at once
await page.mouse.click(...at(0.56, 0.25)); await wait(150); await page.keyboard.type('P2'); await page.keyboard.press('Escape'); await wait(300);
await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await wait(250);
await page.click('[data-por-text="underline"]'); await wait(300);
check('With several shapes selected, the font controls apply to all of their text', (await labelOf(0)).label.underline === true && (await labelOf(1)).label.underline === true, JSON.stringify([(await labelOf(0)).label.underline, (await labelOf(1)).label.underline]));
await page.keyboard.press('Escape'); await wait(1500);
await openPor();
const kept = await page.evaluate(() => { const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas; return c.getObjects().filter((o) => !o.excludeFromExport).map((o) => o.porLabel && { b: o.porLabel.bold, i: o.porLabel.italic, u: o.porLabel.underline, size: o.porLabel.fontSize, align: o.porLabel.align }); });
check('The formatting is saved with the drawing', !!kept[0] && kept[0].b && kept[0].i && kept[0].u && kept[0].size === 20 && kept[0].align === 'left', JSON.stringify(kept));

// ---- Ctrl+drag copies
let nObj = (await objs()).all.length;
const startPt = at(0.56, 0.25);
await page.mouse.click(...startPt); await wait(200);
await page.keyboard.down('Control');
await page.mouse.move(...startPt); await page.mouse.down(); await page.mouse.move(startPt[0] + 60, startPt[1] + 120, { steps: 8 }); await page.mouse.up();
await page.keyboard.up('Control'); await wait(400);
let s = await objs();
check('Ctrl+drag leaves a copy behind and moves the original', s.all.length === nObj + 1, `${nObj} → ${s.all.length}`);
const circles = await page.evaluate(() => { const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas; return c.getObjects().filter((o) => o.porKind === 'circle').map((o) => ({ top: Math.round(o.top), label: o.porLabel && o.porLabel.text })); });
check('Both circles carry the text, one where it was and one moved', circles.length === 2 && circles.every((o) => o.label === 'P2') && Math.abs(circles[0].top - circles[1].top) > 20, JSON.stringify(circles));
nObj = s.all.length;
const p2 = at(0.22, 0.25);
await page.mouse.click(...p2); await wait(200);
await page.mouse.move(...p2); await page.mouse.down(); await page.mouse.move(p2[0] + 20, p2[1] + 30, { steps: 5 }); await page.mouse.up(); await wait(350);
check('A plain drag still just moves (no copy)', (await objs()).all.length === nObj);
await page.keyboard.down('Control'); await page.mouse.click(...at(0.22, 0.28)); await page.keyboard.up('Control'); await wait(300);
check('A Ctrl+click with no drag leaves no copy', (await objs()).all.length === nObj);

// ---- Tab selects the next mark
await page.keyboard.press('Escape'); await wait(200);
const total = (await objs()).all.length;
const activeIndex = () => page.evaluate(() => { const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas; const a = c.getActiveObject(); return a ? c.getObjects().filter((o) => !o.excludeFromExport).indexOf(a) : -1; });
await page.keyboard.press('Tab'); await wait(200);
const t1 = await activeIndex();
await page.keyboard.press('Tab'); await wait(200);
const t2 = await activeIndex();
check('Tab selects the first mark, then the next', t1 === 0 && t2 === 1, `${t1}, ${t2}`);
await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await wait(200);
check('Shift+Tab goes back', (await activeIndex()) === 0);
for (let i = 0; i < total - 1; i += 1) { await page.keyboard.press('Tab'); await wait(60); }
await page.keyboard.press('Tab'); await wait(200);
check('Tab wraps round from the last mark to the first', (await activeIndex()) === 0);
await page.focus('#por-undo'); await page.keyboard.press('Tab'); await wait(200);
check('With a ribbon button focused, Tab still moves along the ribbon (it is not taken by the sheet)', (await activeIndex()) === 0 && !(await page.evaluate(() => document.activeElement === document.querySelector('#por-undo'))));

// ---- Ctrl+M
await page.mouse.click(...at(0.9, 0.9)); await wait(150);
const pagesBefore = await page.evaluate(() => document.querySelectorAll('.por-page').length);
await page.keyboard.down('Control'); await page.keyboard.press('m'); await page.keyboard.up('Control'); await wait(700);
const pagesAfter = await page.evaluate(() => ({ n: document.querySelectorAll('.por-page').length, active: (document.querySelector('.por-page.is-active') || {}).innerText }));
check('Ctrl+M adds a slide and opens it', pagesAfter.n === pagesBefore + 1 && /Drawing 2/.test(pagesAfter.active || ''), JSON.stringify(pagesAfter));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
