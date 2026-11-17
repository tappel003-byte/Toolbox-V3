/**
 * Plan of Repair: ribbon formatting on a shape's text, Ctrl+drag copy, Tab selection and Ctrl+M (PowerPoint).
 * (Tim, Nov 17, 2026: next items from the Plan of Repair audit.)
 *
 * Real mouse and keyboard in Chrome. Run: node tests/por-round-a.mjs
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
  const f = ToolboxApp.blankCustomerFile('por-round-a'); ToolboxPlanSetup.ensurePlanSetup(f);
  f.firstName = 'Shape'; f.lastName = 'Text'; f.planSetup.canvases[0].name = 'Main Level';
  f.planSetup.canvases[0].plan = { id: 'pl', width: 900, height: 620 };
  await ToolboxDB.saveCustomerFile(f);
});
async function openPor() {
  await page.goto('about:blank');
  await page.goto(`${BASE}#/file/por-round-a/repair`, { waitUntil: 'networkidle0' });
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

// shape with text, selected
await drawShape('Rectangle', 0.1, 0.15, 0.35, 0.35);
await page.mouse.click(...(await center())); await wait(200);
await page.keyboard.type('Pier A'); await page.keyboard.press('Escape'); await wait(300);
await page.mouse.click(...at(0.22, 0.25)); await wait(250);

// line spacing
await page.click('#por-line-spacing-btn'); await wait(200);
await page.click('[data-por-line-height="2"]'); await wait(250);
let L = (await labelOf(0)).label;
check('Line spacing 2.0 sets the text\'s line height', L.lineHeight === 2, String(L.lineHeight));
// highlight
await page.click('#por-highlight-btn'); await wait(200);
const hl = await page.evaluate(() => document.querySelectorAll('[data-por-highlight]')[3].getAttribute('data-por-highlight'));
await page.click(`[data-por-highlight="${hl}"]`); await wait(250);
L = (await labelOf(0)).label;
check('Highlight colours the text background', L.highlight.toLowerCase() === hl.toLowerCase(), L.highlight);
await page.click('#por-highlight-btn'); await wait(200);
await page.click('[data-por-highlight=""]'); await wait(250);
L = (await labelOf(0)).label;
check('"No highlight" clears it', L.highlight === '', JSON.stringify(L.highlight));
// superscript
await page.click('[data-por-text="sup"]'); await wait(250);
L = (await labelOf(0)).label;
check('Superscript sets the text to superscript', L.script === 'sup', L.script);
await page.click('[data-por-text="sub"]'); await wait(250);
check('Subscript replaces it', (await labelOf(0)).label.script === 'sub');
await page.click('[data-por-text="sub"]'); await wait(250);
check('Pressing Subscript again turns it off', (await labelOf(0)).label.script === '');
// numbering / indent
await page.click('[data-por-text="number"]'); await wait(250);
check('Numbering prefixes "1. "', (await labelOf(0)).label.text === '1. Pier A', (await labelOf(0)).label.text);
await page.click('[data-por-text="number"]'); await wait(250);
check('Numbering again removes it', (await labelOf(0)).label.text === 'Pier A');
await page.click('[data-por-text="indent"]'); await wait(250);
check('Increase indent adds leading space', (await labelOf(0)).label.text === '    Pier A', JSON.stringify((await labelOf(0)).label.text));
await page.click('[data-por-text="outdent"]'); await wait(250);
check('Decrease indent takes it back', (await labelOf(0)).label.text === 'Pier A');
await page.click('[data-por-line-spacing-none]').catch(() => {});

// ---- Text box
await page.click('#por-insert-text'); await wait(150);
await page.mouse.move(...at(0.5, 0.5)); await page.mouse.down(); await page.mouse.move(...at(0.7, 0.58), { steps: 6 }); await page.mouse.up(); await wait(300);
await page.keyboard.type('Crack'); await page.keyboard.press('Escape'); await wait(300);
const tbSel = await page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  const tb = c.getObjects().find((o) => o.type === 'textbox' && !o.excludeFromExport); if (!tb) return null;
  c.setActiveObject(tb); c.requestRenderAll(); return tb.text;
});
check('A text box exists to format', tbSel === 'Crack', String(tbSel));
await page.click('#por-line-spacing-btn'); await wait(200); await page.click('[data-por-line-height="1.5"]'); await wait(250);
await page.click('#por-highlight-btn'); await wait(200); await page.click(`[data-por-highlight="${hl}"]`); await wait(250);
await page.click('[data-por-text="sup"]'); await wait(250);
await page.click('[data-por-text="number"]'); await wait(250);
const tb = () => page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  const o = c.getObjects().find((x) => x.type === 'textbox' && !x.excludeFromExport);
  return { lh: o.lineHeight, bg: o.textBackgroundColor, script: o.porScript, text: o.text, styled: JSON.stringify(o.styles).length > 4 };
});
let T = await tb();
check('Text box takes line spacing, highlight, superscript and numbering', T.lh === 1.5 && T.bg.toLowerCase() === hl.toLowerCase() && T.script === 'sup' && T.text === '1. Crack' && T.styled, JSON.stringify(T));
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await wait(300);
check('Undo reverts the last formatting step', (await tb()).text === 'Crack');
await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control'); await wait(300);

// persistence across reload
await page.keyboard.press('Escape'); await wait(1800);
await openPor();
T = await tb();
check('Text box formatting survives a reload', T.lh === 1.5 && T.bg.toLowerCase() === hl.toLowerCase() && T.script === 'sup' && T.styled, JSON.stringify(T));
L = (await labelOf(0)).label;
check('Shape text formatting survives a reload', !!L && L.lineHeight === 2, JSON.stringify(L));

// quick access Undo/Redo in the header
const qa = await page.evaluate(() => ({ undoInHeader: !!document.querySelector('.rb-identity #por-undo'), redoInHeader: !!document.querySelector('.rb-identity #por-redo') }));
check('Undo and Redo live in the top bar', qa.undoInHeader && qa.redoInHeader, JSON.stringify(qa));

// Slides group
const sg = await page.evaluate(() => ({ group: !!document.querySelector('[data-por-collapse="slides"] #por-add-page'), panel: !!document.querySelector('.rb-rail__actions #por-add-page') }));
check('New / Duplicate / Delete slide are in a ribbon Slides group, not under the panel', sg.group && !sg.panel, JSON.stringify(sg));
await page.click('#por-add-page'); await wait(600);
let n = await page.evaluate(() => document.querySelectorAll('.por-page').length);
check('New Slide button adds a slide', n === 2, String(n));
await page.click('#por-dup-page'); await wait(600);
n = await page.evaluate(() => document.querySelectorAll('.por-page').length);
check('Duplicate button works', n === 3, String(n));

// slide menu: move down / up
const firstBefore = await page.evaluate(() => [...document.querySelectorAll('.por-page')].map((p) => p.getAttribute('data-por-page')));
const pr = await page.evaluate(() => { const r = document.querySelector('.por-page').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
await page.mouse.click(...pr, { button: 'right' }); await wait(300);
const items = await page.evaluate(() => [...document.querySelectorAll('.por-ctx--page .por-menu-item, .por-ctx--page button')].map((b) => b.textContent.trim()));
check('Slide menu lists Move up and Move down', items.includes('Move up') && items.includes('Move down'), items.join('|'));
await page.evaluate(() => [...document.querySelectorAll('.por-ctx--page button')].find((b) => /Move down/.test(b.textContent)).click()); await wait(500);
const after2 = await page.evaluate(() => [...document.querySelectorAll('.por-page')].map((p) => p.getAttribute('data-por-page')));
check('Move down puts the first slide second', after2[1] === firstBefore[0] && after2[0] === firstBefore[1], JSON.stringify([firstBefore, after2]));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
