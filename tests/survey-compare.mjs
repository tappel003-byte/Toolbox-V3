/**
 * Compare two surveys (Tim, Nov 20, 2026): two floor level survey pictures in, relative movement out.
 *
 * Builds two synthetic survey maps in the page -- the same house, the second drawn a little shifted and larger,
 * with one core area lowered 0.8 in and the whole survey 0.3 in higher -- then goes through the real dialog:
 * Diagnostics → Epoch (same as ToolboxSurveyCompare.open), two files, a legend box
 * dragged with the mouse, automatic alignment, and the result.
 * It checks that the zero is set from the crowd (the 0.3 in is removed), the core reads lower, the edges
 * read neutral, and nothing is written to any Customer File.
 *
 * Run: node tests/survey-compare.mjs   (static server on 8765)
 */
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1500, height: 950 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// ---- two synthetic surveys ----
const made = await page.evaluate(() => {
  const W = 700; const H = 900;
  const ramp = (v) => { // 12 = pale cream, 8 = dark brown
    const t = Math.max(0, Math.min(1, (12 - v) / 4));
    return [Math.round(240 - 130 * t), Math.round(230 - 160 * t), Math.round(200 - 165 * t)];
  };
  function survey(opts) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const img = x.getImageData(0, 0, W, H);
    const { dx, dy, k, shift, bowl } = opts;
    // house = a rectangle, 300 x 400 at the centre, in survey-1 coordinates
    for (let py = 0; py < H; py += 1) for (let px = 0; px < W; px += 1) {
      const hx = (px - dx - 350) / k + 350; const hy = (py - dy - 450) / k + 450; // back to survey-1 coordinates
      if (Math.abs(hx - 350) > 150 || Math.abs(hy - 450) > 200) continue;
      let z = 10.5 - 1.5 * ((hy - 250) / 400) - 0.6 * ((hx - 200) / 300) + shift; // gentle slope
      const d = Math.hypot(hx - 350, hy - 450);
      if (bowl && d < 70) z -= bowl * (1 - d / 70);
      z = Math.round(z / 0.2) * 0.2; // banded, as the printed maps are
      const col = ramp(z); const i = (py * W + px) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // walls
    x.strokeStyle = '#000'; x.lineWidth = 7;
    x.strokeRect(350 + dx - 150 * k, 450 + dy - 200 * k, 300 * k, 400 * k);
    x.beginPath(); x.moveTo(350 + dx, 450 + dy - 200 * k); x.lineTo(350 + dx, 450 + dy - 40 * k); x.stroke();
    x.beginPath(); x.moveTo(350 + dx - 150 * k, 450 + dy + 20 * k); x.lineTo(350 + dx - 20 * k, 450 + dy + 20 * k); x.stroke();
    // legend bar: 12 (top) to 8 (bottom) with an outline
    const lx = 620; const ly = 150; const lh = 400;
    for (let i = 0; i < lh; i += 1) { const v = 12 - (4 * i) / (lh - 1); const col = ramp(v); x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.fillRect(lx, ly + i, 22, 1); }
    x.strokeStyle = '#000'; x.lineWidth = 2; x.strokeRect(lx - 1, ly - 1, 24, lh + 2);
    return c.toDataURL('image/png');
  }
  return {
    a: survey({ dx: 0, dy: 0, k: 1, shift: 0, bowl: 0 }),
    b: survey({ dx: 24, dy: -18, k: 1.04, shift: 0.3, bowl: 0.8 }),
    legend: { x: 618, y: 140, w: 30, h: 422 },
  };
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
fs.writeFileSync(path.join(dir, 'earlier.png'), Buffer.from(made.a.split(',')[1], 'base64'));
fs.writeFileSync(path.join(dir, 'later.png'), Buffer.from(made.b.split(',')[1], 'base64'));

// ---- the dialog (Epoch door, not the Customer Files homepage) ----
check('Customer Files does not show Compare surveys', !(await page.$('#cabinet-compare')));

// Seed a file so Diagnostics → Epoch can open the same tool.
const FILE = 'sc-epoch-door';
await page.evaluate(async (id) => {
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ada'; rec.lastName = 'Compare';
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);
await page.goto(`${BASE}#/file/${FILE}/diagnostics`, { waitUntil: 'networkidle0' });
await wait(800);
check('Diagnostics home shows an Epoch tile', !!(await page.$('[data-dx-tool="epoch"]')));
await page.click('[data-dx-tool="epoch"]'); await wait(400);
check('Epoch opens the Compare surveys dialog', !!(await page.$('.sc')));
await (await page.$('#sc-file-0')).uploadFile(path.join(dir, 'earlier.png')); await wait(900);
await (await page.$('#sc-file-1')).uploadFile(path.join(dir, 'later.png')); await wait(900);
check('Both surveys loaded', await page.evaluate(() => window.ToolboxSurveyCompare._state().slots.every((s) => !!s.src)));
await page.click('#sc-next'); await wait(400);

// Legend: drag a box on each survey with the real mouse (loosely drawn, with paper around the strip).
async function dragLegend(slotIndex, rect) {
  const box = await page.evaluate((i) => {
    const c = document.querySelectorAll('.sc-canvas')[i]; const r = c.getBoundingClientRect();
    return { l: r.left, t: r.top, sx: r.width / c.width, sy: r.height / c.height };
  }, slotIndex);
  await page.mouse.move(box.l + rect.x * box.sx, box.t + rect.y * box.sy);
  await page.mouse.down();
  await page.mouse.move(box.l + (rect.x + rect.w) * box.sx, box.t + (rect.y + rect.h) * box.sy, { steps: 8 });
  await page.mouse.up(); await wait(300);
}
await dragLegend(0, made.legend);
await dragLegend(1, made.legend);
for (const i of [0, 1]) {
  await page.type(`#sc-top-${i}`, '12'); await page.type(`#sc-bottom-${i}`, '8');
}
await wait(200);
check('The legend boxes and values are in', await page.evaluate(() => window.ToolboxSurveyCompare._state().slots.every((s) => s.legend && s.top === '12' && s.bottom === '8')));
check('Next is enabled', !(await page.$eval('#sc-next', (b) => b.disabled)));
await page.click('#sc-next'); await wait(400);

// Align automatically, then compare.
await page.click('#sc-auto');
await page.waitForFunction(() => window.ToolboxSurveyCompare._state().slots.every((s) => s.pts.length === 2), { timeout: 60000 });
await wait(300);
check('Automatic alignment placed the two points on each survey', true);
await page.click('#sc-next');
await page.waitForSelector('#sc-out', { timeout: 60000 });
await wait(800);

const result = await page.evaluate(() => {
  const S = window.ToolboxSurveyCompare; const s = S._state();
  const z = S.core.setZero(s.diff, { zero: 'median' });
  const w = z.w; const h = z.h;
  // survey-1 coordinates: centre (350,450). Core = within 25 px of the centre; edge = ring 110-140 px out horizontally.
  const mean = (cells) => cells.length ? cells.reduce((a, b) => a + b, 0) / cells.length : NaN;
  const core = []; const edge = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const v = z.values[y * w + x]; if (v !== v) continue;
    const d = Math.hypot(x - 350, y - 450);
    if (d < 25) core.push(v);
    if (Math.abs(x - 350) > 105 && Math.abs(x - 350) < 135 && Math.abs(y - 450) < 120) edge.push(v);
  }
  return { shift: z.shift, n: z.n, core: mean(core), edge: mean(edge), nCore: core.length, nEdge: edge.length, info: document.querySelector('#sc-info').textContent };
});
check('The zero is the typical change, not a held point (the survey-wide +0.3 in is taken out)', Math.abs(result.shift - 0.3) < 0.25, JSON.stringify({ shift: result.shift }));
check('The core that was lowered reads lower (about -0.8 in)', result.core < -0.4 && result.core > -1.3, JSON.stringify({ core: result.core, nCore: result.nCore }));
check('The edges that did not move read neutral', Math.abs(result.edge) < 0.25, JSON.stringify({ edge: result.edge, nEdge: result.nEdge }));
check('The result says how the zero was set', /median change/.test(result.info), result.info);

// Controls
await page.select('#sc-zero', 'raw'); await wait(300);
check('Raw difference can be chosen', /not set/.test(await page.$eval('#sc-info', (e) => e.textContent)));
await page.select('#sc-zero', 'median'); await wait(300);
check('Save picture is offered', !!(await page.$('#sc-save')));

// Compare still writes nothing — only the seed file we opened Diagnostics from.
const stored = await page.evaluate(async (id) => {
  try {
    const list = await window.ToolboxDB.getAllCustomerFiles();
    return {
      count: list.length,
      onlySeed: list.length === 1 && list[0] && list[0].id === id,
      updatedAt: list[0] && list[0].updatedAt,
    };
  } catch (e) { return { count: -1 }; }
}, FILE);
check('Compare does not create or change a Customer File',
  stored.onlySeed === true, JSON.stringify(stored));

// Escape closes
await page.keyboard.press('Escape'); await wait(300);
check('Escape closes it', !(await page.$('.sc')));


// ---- a PDF goes through the same door (the surveys people hand us are PDFs) ----
await page.evaluate(() => { if (window.ToolboxSurveyCompare) window.ToolboxSurveyCompare.open(); });
await wait(300);
const pdfB64 = await page.evaluate(async (png) => {
  if (!window.jspdf) {
    await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/js/vendor/jspdf.umd.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.addImage(png, 'PNG', 20, 20, 560, 720);
  doc.addPage(); doc.text('second page', 40, 60);
  return doc.output('datauristring').split(',')[1];
}, made.a);
const pdfPath = path.join(dir, 'survey.pdf');
fs.writeFileSync(pdfPath, Buffer.from(pdfB64, 'base64'));
await (await page.$('#sc-file-0')).uploadFile(pdfPath);
await page.waitForFunction(() => { const s = window.ToolboxSurveyCompare._state(); return s.slots[0].src && s.slots[0].src.pages === 2; }, { timeout: 30000 });
const pdfState = await page.evaluate(() => { const s = window.ToolboxSurveyCompare._state().slots[0].src; return { pages: s.pages, page: s.page, w: s.canvas.width, h: s.canvas.height, ink: (() => { const d = s.canvas.getContext('2d').getImageData(0, 0, s.canvas.width, s.canvas.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) n += 1; return n; })() }; });
check('A PDF is read: two pages offered, page 1 drawn with the map on it', pdfState.pages === 2 && pdfState.page === 1 && pdfState.w > 500 && pdfState.ink > 20000, JSON.stringify(pdfState));
await page.keyboard.press('Escape'); await wait(300);

fs.rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
