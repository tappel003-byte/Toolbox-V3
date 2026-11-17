/**
 * Plan of Repair: ribbon formatting on a shape's text, Ctrl+drag copy, Tab selection and Ctrl+M (PowerPoint).
 * (Tim, Nov 17, 2026: next items from the Plan of Repair audit.)
 *
 * Real mouse and keyboard in Chrome. Run: node tests/por-round-b.mjs
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
  const f = ToolboxApp.blankCustomerFile('por-round-b'); ToolboxPlanSetup.ensurePlanSetup(f);
  f.firstName = 'Shape'; f.lastName = 'Text'; f.planSetup.canvases[0].name = 'Main Level';
  f.planSetup.canvases[0].plan = { id: 'pl', width: 900, height: 620 };
  await ToolboxDB.saveCustomerFile(f);
});
async function openPor() {
  await page.goto('about:blank');
  await page.goto(`${BASE}#/file/por-round-b/repair`, { waitUntil: 'networkidle0' });
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

// ---- View tab
const homeVisible = await page.evaluate(() => ({ grid: !!document.querySelector('#por-toggle-grid').offsetParent, shapes: !!document.querySelector('#por-shapes-btn').offsetParent }));
check('On Home the grid / rulers / hand buttons are not in the way', !homeVisible.grid && homeVisible.shapes, JSON.stringify(homeVisible));
await page.click('#por-tab-view'); await wait(300);
const viewVis = await page.evaluate(() => ({ g: !!document.querySelector('#por-toggle-grid').offsetParent, r: !!document.querySelector('#por-toggle-rulers').offsetParent, h: !!document.querySelector('#por-hand').offsetParent, shapes: !!document.querySelector('#por-shapes-btn').offsetParent, active: document.querySelector('.por-tabs__tab.is-active').textContent }));
check('The View tab shows Grid, Rulers and Hand and hides the Home tools', viewVis.g && viewVis.r && viewVis.h && !viewVis.shapes && viewVis.active === 'View', JSON.stringify(viewVis));
await page.click('#por-toggle-grid'); await wait(300);
check('Grid toggles from the View tab', (await page.$eval('#por-toggle-grid', (b) => b.getAttribute('aria-pressed'))) === 'true');
await page.click('#por-toggle-grid'); await wait(200);
await page.click('#por-toggle-rulers'); await wait(300);
check('Rulers toggle from the View tab', (await page.$eval('#por-toggle-rulers', (b) => b.getAttribute('aria-pressed'))) === 'true');
await page.click('#por-toggle-rulers'); await wait(200);
await page.click('.por-tabs__tab[data-por-tab="home"]'); await wait(300);
const back = await page.evaluate(() => ({ shapes: !!document.querySelector('#por-shapes-btn').offsetParent, paste: !!document.querySelector('#por-paste').offsetParent, print: !!document.querySelector('#por-print').offsetParent }));
check('Back on Home the tools return', back.shapes && back.paste && back.print, JSON.stringify(back));

// ---- Shape gallery
const kinds = ['diamond', 'pentagon', 'hexagon', 'star', 'blockArrow', 'chevron', 'callout', 'cross'];
check('The gallery offers all eight new block shapes', (await page.evaluate((k) => k.every((n) => !!document.querySelector(`[data-rb-tool="${n}"]`)), kinds)));
const sheetBox = await page.evaluate(() => { const r = document.querySelector('canvas.upper-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const pt = (a, b) => [sheetBox.x + sheetBox.w * a, sheetBox.y + sheetBox.h * b];
const polys = () => page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e._porCanvas)._porCanvas;
  return c.getObjects().filter((o) => !o.excludeFromExport && o.type === 'polygon').map((o) => ({ k: o.porKind, n: o.points.length, w: Math.round(o.width), h: Math.round(o.height), label: o.porLabel && o.porLabel.text }));
});
for (let i = 0; i < kinds.length; i += 1) {
  await page.click(`[data-rb-tool="${kinds[i]}"]`);
  const a = 0.08 + (i % 4) * 0.2; const b = 0.1 + Math.floor(i / 4) * 0.25;
  await page.mouse.move(...pt(a, b)); await page.mouse.down();
  await page.mouse.move(...pt(a + 0.08, b + 0.1), { steps: 4 }); await page.mouse.move(...pt(a + 0.16, b + 0.2), { steps: 4 });
  await page.mouse.up(); await wait(300); await page.keyboard.press('Escape'); await wait(150);
}
let P = await polys();
check('Each shape draws as its own shape', P.length === 8 && kinds.every((k) => P.some((p) => p.k === k)), JSON.stringify(P.map((p) => p.k)));
check('Shapes have the right corner counts', P.find((p) => p.k === 'star').n === 10 && P.find((p) => p.k === 'hexagon').n === 6 && P.find((p) => p.k === 'cross').n === 12);
check('Shapes get a real size from the drag', P.every((p) => p.w > 30 && p.h > 30), JSON.stringify(P.map((p) => [p.w, p.h])));

// text in a block shape, then reload
await page.mouse.click(...pt(0.08 + 0.08, 0.1 + 0.1)); await wait(250);   // diamond centre
await page.keyboard.type('Hex'); await page.keyboard.press('Escape'); await wait(400);
P = await polys();
check('A block shape holds text like any other shape', P.some((p) => p.k === 'diamond' && p.label === 'Hex'), JSON.stringify(P.map((p) => [p.k, p.label])));
await page.keyboard.press('Escape'); await wait(1800);
await openPor();
P = await polys();
check('Block shapes and their text survive a reload', P.length === 8 && P.some((p) => p.k === 'diamond' && p.label === 'Hex'), JSON.stringify(P.map((p) => [p.k, p.label])));
// fill
await page.mouse.click(...pt(0.08 + 0.08, 0.1 + 0.1)); await wait(250);
const fillState = await page.evaluate(() => { const i = document.querySelector('#por-fill'); return i ? !i.disabled : null; });
check('Fill is available for a block shape', fillState === true, String(fillState));
// copy
await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.press('v'); await page.keyboard.up('Control'); await wait(500);
P = await polys();
check('Copy and paste keep the shape kind', P.length === 9 && P.filter((p) => p.k === 'diamond').length === 2, String(P.length));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
