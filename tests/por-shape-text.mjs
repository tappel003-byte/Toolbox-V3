/**
 * Plan of Repair: text inside shapes, and the Text Box tool, the way PowerPoint does them.
 * (Tim, Nov 17, 2026: audit of Plan of Repair against PowerPoint -- a shape could not hold text, and the
 * Text button dropped a box at a fixed spot instead of where you click.)
 *
 * Real mouse and keyboard in Chrome. Run: node tests/por-shape-text.mjs
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
  const f = ToolboxApp.blankCustomerFile('por-shape-text'); ToolboxPlanSetup.ensurePlanSetup(f);
  f.firstName = 'Shape'; f.lastName = 'Text'; f.planSetup.canvases[0].name = 'Main Level';
  f.planSetup.canvases[0].plan = { id: 'pl', width: 900, height: 620 };
  await ToolboxDB.saveCustomerFile(f);
});
async function openPor() {
  await page.goto('about:blank');
  await page.goto(`${BASE}#/file/por-shape-text/repair`, { waitUntil: 'networkidle0' });
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

// ---- text in a shape: double-click
await drawShape('Rectangle', 0.12, 0.2, 0.4, 0.4);
await doubleClick(await center());
let s = await objs();
check('Double-click a rectangle puts it in text editing', !!(s.active && s.active.editing && s.active.temp), JSON.stringify(s.active));
await page.keyboard.type('Pier A, 3/8 in settlement');
await wait(250);
await page.keyboard.press('Escape'); await wait(400);
s = await objs();
check('Esc keeps the text in the shape and leaves no stray text box', s.all.length === 1 && s.all[0].label === 'Pier A, 3/8 in settlement' && s.all[0].t === 'rect', JSON.stringify(s.all));

// ---- select a shape and just start typing; Enter; the other closed shapes
await drawShape('Circle', 0.55, 0.2, 0.7, 0.4);
await page.mouse.click(...(await center())); await wait(200);
await page.keyboard.type('P1'); await wait(250); await page.keyboard.press('Escape'); await wait(300);
s = await objs();
check('Select a circle and just type: the text goes in the circle', s.all.some((o) => o.k === 'circle' && o.label === 'P1'), JSON.stringify(s.all.map((o) => o.k + ':' + o.label)));
await drawShape('Triangle', 0.3, 0.55, 0.45, 0.8);
await page.mouse.click(...(await center())); await wait(200);
await page.keyboard.press('Enter'); await wait(300);
s = await objs();
check('Select a triangle and press Enter: editing starts, empty and ready', !!(s.active && s.active.editing && s.active.temp));
await page.keyboard.type('Tri'); await page.keyboard.press('Escape'); await wait(300);
await drawShape('Rounded rectangle', 0.6, 0.55, 0.85, 0.7);
await page.mouse.click(...(await center())); await wait(200);
await page.keyboard.press('F2'); await wait(300);
s = await objs();
check('F2 also starts editing a rounded rectangle', !!(s.active && s.active.editing && s.active.temp));
await page.keyboard.type('RR'); await page.keyboard.press('Escape'); await wait(300);
s = await objs();
check('All four closed shapes hold their text', ['rect', 'circle', 'triangle', 'roundRect'].every((k) => s.all.some((o) => o.k === k && o.label)), JSON.stringify(s.all.map((o) => o.k + ':' + o.label)));

// ---- Edit Text in the right-click menu
await page.mouse.click(...at(0.26, 0.3), { button: 'right' }); await wait(450);
const menuState = await page.evaluate(() => { const b = [...document.querySelectorAll('button,[role=menuitem]')].find((x) => /^Edit Text/.test(x.textContent.trim())); return b ? { disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' } : null; });
check('Right-click a shape: Edit Text is available (it was greyed out for shapes)', !!menuState && !menuState.disabled, JSON.stringify(menuState));
await page.evaluate(() => [...document.querySelectorAll('button,[role=menuitem]')].find((x) => /^Edit Text/.test(x.textContent.trim()))?.click()); await wait(400);
s = await objs();
check('Edit Text opens the shape for typing', !!(s.active && s.active.editing && s.active.temp), JSON.stringify(s.active));
await page.keyboard.press('Escape'); await wait(300);

// ---- the text is drawn inside the shape and stays the same size when the shape is resized or rotated
await page.evaluate(() => {
  window.__fonts = [];
  const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { if (/Pier A/.test(t)) window.__fonts.push(this.font); return f.call(this, t, ...r); };
});
await page.mouse.click(...at(0.26, 0.3)); await wait(250);
const handle = await page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas; const a = c.getActiveObject(); a.setCoords();
  const r = c.upperCanvasEl.getBoundingClientRect(); const k = r.width / c.getWidth();
  return { br: { x: r.left + a.oCoords.br.x * k, y: r.top + a.oCoords.br.y * k }, mtr: { x: r.left + a.oCoords.mtr.x * k, y: r.top + a.oCoords.mtr.y * k } };
});
await page.evaluate(() => { window.__fonts = []; });
await page.mouse.move(handle.br.x, handle.br.y); await page.mouse.down(); await page.mouse.move(handle.br.x + 80, handle.br.y + 10, { steps: 8 }); await page.mouse.up(); await wait(350);
const afterResize = await page.evaluate(() => window.__fonts.slice(-3));
check('Resizing a shape keeps its text the same size (not stretched)', afterResize.length > 0 && afterResize.every((f) => /18px/.test(f)), JSON.stringify(afterResize));
const rotHandle = await page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas; const a = c.getActiveObject(); a.setCoords();
  const r = c.upperCanvasEl.getBoundingClientRect(); const k = r.width / c.getWidth();
  return { x: r.left + a.oCoords.mtr.x * k, y: r.top + a.oCoords.mtr.y * k };
});
await page.mouse.move(rotHandle.x, rotHandle.y); await page.mouse.down(); await page.mouse.move(rotHandle.x + 70, rotHandle.y + 40, { steps: 8 }); await page.mouse.up(); await wait(350);
s = await objs();
check('A rotated shape still carries its text', s.all.some((o) => o.label === 'Pier A, 3/8 in settlement' && Math.abs(o.angle) > 3), JSON.stringify(s.all.filter((o) => o.label).map((o) => o.k + ':' + o.angle)));
await page.screenshot({ path: new URL('./review-artifacts/por-shape-text-rotated.png', import.meta.url).pathname }).catch(() => {});

// ---- copy and paste, undo
const nBefore = (await objs()).all.length;
await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.press('v'); await page.keyboard.up('Control'); await wait(400);
s = await objs();
check('Copy and paste carries the text', s.all.length === nBefore + 1 && s.all.filter((o) => o.label === 'Pier A, 3/8 in settlement').length === 2, JSON.stringify(s.all.map((o) => o.k + ':' + o.label)));
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await wait(400);
s = await objs();
check('Undo takes the pasted copy away again', s.all.length === nBefore);
// undo an edit: type a label, then undo
await drawShape('Rectangle', 0.05, 0.75, 0.2, 0.9);
await page.mouse.click(...(await center())); await wait(200); await page.keyboard.type('Zed'); await page.keyboard.press('Escape'); await wait(350);
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await wait(400);
s = await objs();
check('Undo takes a typed label back out of the shape', !s.all.some((o) => o.label === 'Zed'), JSON.stringify(s.all.map((o) => o.k + ':' + o.label)));

// ---- saved with the drawing
await page.keyboard.press('Escape'); await wait(1500);
await openPor();
s = await objs();
check('The text is still in the shapes after closing and reopening the drawing', ['Pier A, 3/8 in settlement', 'P1', 'Tri', 'RR'].every((t) => s.all.some((o) => o.label === t)), JSON.stringify(s.all.map((o) => o.k + ':' + o.label)));
const saved = await page.evaluate(async () => {
  const rec = await ToolboxDB.getCustomerFile('por-shape-text');
  const pageDoc = rec.planOfRepair.pages.find((p) => p.id === rec.planOfRepair.activePageId) || rec.planOfRepair.pages[0];
  return (pageDoc.overlays || []).filter((o) => o.label && o.label.text).map((o) => o.kind + ':' + o.label.text);
});
check('The saved record holds each label on its shape', saved.length >= 4, JSON.stringify(saved));

// ---- the Text Box tool: arm, then click or drag on the sheet
await page.click('#por-insert-text'); await wait(150);
check('Clicking Text arms the tool and the button shows it is on', await page.evaluate(() => document.querySelector('#por-insert-text').classList.contains('is-on')));
let n0 = (await objs()).all.length;
await page.mouse.move(...at(0.55, 0.62)); await page.mouse.down(); await page.mouse.move(...at(0.7, 0.66), { steps: 6 }); await page.mouse.up(); await wait(500);
s = await objs();
check('Dragging on the sheet places a text box there, ready to type', s.all.length === n0 + 1 && !!(s.active && s.active.editing && s.active.t === 'textbox'), JSON.stringify(s.active));
const placed = await page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas; const a = c.getActiveObject();
  return { left: a.left / c.getWidth() * (c.upperCanvasEl.getBoundingClientRect().width / c.upperCanvasEl.getBoundingClientRect().width), width: Math.round(a.getScaledWidth()) };
});
await page.keyboard.type('Monitor crack');
await wait(200);
s = await objs();
check('The first keystrokes replace the "Text" placeholder', s.all.some((o) => o.text === 'Monitor crack'), JSON.stringify(s.all.map((o) => o.text)));
await page.keyboard.press('Escape'); await wait(300);
check('The tool puts itself down after one box', !(await page.evaluate(() => document.querySelector('#por-insert-text').classList.contains('is-on'))));
await page.click('#por-insert-text');
await page.mouse.click(...at(0.12, 0.74)); await wait(500);
s = await objs();
check('A single click with the Text tool also places a box, ready to type', !!(s.active && s.active.editing && s.active.t === 'textbox'), JSON.stringify(s.active));
await page.keyboard.press('Escape'); await wait(250); await page.keyboard.press('Escape');
// an emptied box goes away when you click off it
await page.click('#por-insert-text');
await page.mouse.click(...at(0.12, 0.84)); await wait(400);
await page.keyboard.type('x'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await wait(150);
n0 = (await objs()).all.length;
// click-away spot: somewhere on the sheet that no mark covers
const spot = await page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  const r = c.upperCanvasEl.getBoundingClientRect(); const k = r.width / c.getWidth();
  for (const [fx, fy] of [[0.5, 0.5], [0.6, 0.45], [0.45, 0.35], [0.7, 0.4], [0.35, 0.5], [0.5, 0.95]]) {
    const px = fx * r.width / k, py = fy * r.height / k;
    const hit = c.getObjects().some((o) => !o.excludeFromExport && o.containsPoint({ x: px / c.viewportTransform[0], y: py / c.viewportTransform[3] }));
    if (!hit) return [r.left + fx * r.width, r.top + fy * r.height];
  }
  return [r.left + r.width * 0.5, r.top + r.height * 0.97];
});
await page.mouse.click(...spot); await wait(500);
check('A text box emptied and clicked away from is removed', (await objs()).all.length === n0 - 1);
await page.keyboard.press('Escape'); await wait(200);
// the shape tools still draw as before
n0 = (await objs()).all.length;
await drawShape('Rectangle', 0.62, 0.12, 0.78, 0.22);
check('The shape tools still draw as before', (await objs()).all.length === n0 + 1);
check('A shape with no text draws no label', (await objs()).all.at(-1).label === undefined);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
