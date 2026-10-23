/**
 * A full-bleed figure prints the region the slide is showing.
 *
 * Run: node tests/report-bleed-figure-extent.mjs   (static server on 8765)
 *
 * cameraExtentFor worked the printed still's region out from the shape of
 * the stored layout.topo box. An IMPORTED slide does not use that box: it
 * draws full bleed, and report-floor-layout.js lays its frames across the
 * whole stage -- share% wide by 100% tall -- without reading layout.topo at
 * all. So the still was painted from a region of the wrong SHAPE, offset by
 * the camera's pan, and the left-hand rooms fell outside it.
 *
 * On Janis Fensterer's report the figure extracted from the PDF measured
 * 2616 x 3000 -- portrait, on a landscape sheet -- with the left-hand
 * readings cut in half at the image's own edge and white space to spare on
 * its right. Tim: "Still cropping the left-hand side on a screenshot of
 * preview. As well as the PDF."
 *
 * The fixture below is that shape: a stored topo box of 50 x 89 on a slide
 * that draws full bleed, already framed so the first-render fit does not
 * overwrite it, with the camera panned and zoomed. Without the fix the still
 * composes at 2605 x 3000. The region is taken from the frame the drawing is
 * actually in now.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }
const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-bleed-crop';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const b = await puppeteer.launch({ headless:'new', executablePath:'/usr/bin/google-chrome-stable',
  args:['--no-sandbox','--disable-dev-shm-usage'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
p.on('console', m => { const t = m.text(); if (/warn|error|could not|unavailable/i.test(t)) console.log('CONSOLE', t.slice(0, 200)); });
await p.setViewport({ width:1700, height:1050 });
await p.goto(BASE, { waitUntil:'networkidle0' });

// A plan with a hard mark in each corner and a label against each edge, so a
// crop of any side is visible rather than inferred.
await p.evaluate(async (id, zoom, cx, cy) => {
  const plan = (() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0,0,1200,900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30,30,1140,840);
    x.fillStyle = '#ff00ff'; x.fillRect(60, 100, 120, 700);
    x.fillStyle = '#c00'; x.font = 'bold 44px sans-serif';
    x.fillText('LEFT', 40, 460);
    x.fillText('RIGHT', 1030, 460);
    x.fillText('TOP', 560, 80);
    x.fillText('BOT', 560, 870);
    [[40,40],[1120,40],[40,850],[1120,850]].forEach(([mx,my]) => {
      x.fillRect(mx, my, 30, 30);
    });
    return c.toDataURL('image/jpeg', 0.92);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Crop'; rec.lastName = 'Probe';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const names = ['Main Level','Basement'];
  rec.planSetup.canvases[0].name = names[0];
  rec.planSetup.canvases.push(window.ToolboxPlanSetup.blankCanvas(names[1]));
  const poly = [{x:40,y:40},{x:1160,y:40},{x:1160,y:860},{x:40,y:860}];
  const byCanvas = {};
  for (let i = 0; i < rec.planSetup.canvases.length; i += 1) {
    const cv = rec.planSetup.canvases[i]; cv.name = names[i];
    const pid = 'plan-bleed-' + i;
    await window.ToolboxDB.putMedia(pid, plan);
    cv.plan = { id: pid, width: 1200, height: 900 };
    cv.frontDoorFacing = 'E';
    const points = []; let n = 0;
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id:'p'+i+'_'+n, floorId:cv.id, index:n,
        x: 120 + c*300, y: 150 + r*280, value: 7 + ((n*9)%27)/10 });
    }
    byCanvas[cv.id] = { canvasId: cv.id, points,
      areas:[{ id:'a'+i, name:names[i], polygon:poly, createdAt:1 }], boundary: poly };
  }
  rec.floorSurvey = { id:'fs-bleed', inspectionDate:'2026-10-09', byCanvasId: byCanvas };
  // A panned, zoomed camera -- the state the crop needs.
  rec.reportBuilder = {
    floorCamera: { cx, cy, zoom, rel: true },
    floorLayout: { topo: { x: 4, y: 5, w: 50, h: 89 }, overview: { x: 2.5, y: 74, w: 16, h: 18 } },
    // Already framed, so the first-render frame fit does not overwrite the
    // stored box -- which is the state any report that has been opened once
    // is in.
    floorFramed: true,
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE, 1.35, 0.42, 0.5);

await p.goto(`${BASE}#/file/${FILE}/report`, { waitUntil:'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout:40000 });
await new Promise(r => setTimeout(r, 7000));
const at = await p.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex(t => /Main Level/i.test((t.querySelector('.rb-thumb__caption')||{}).textContent||'')));
await p.evaluate(n => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise(r => setTimeout(r, 4500));

const live = await p.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet');
  const host = sheet.querySelector('[data-rb-topo-live]');
  const hr = host ? host.getBoundingClientRect() : null;
  return hr ? { w: Math.round(hr.width), h: Math.round(hr.height),
                aspect: +(hr.width / hr.height).toFixed(3) } : null;
});
check('the slide is drawing full bleed', !!live && live.aspect > 1,
  JSON.stringify(live));

await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
await p.click('#rb-print');
await p.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 900));

const png = await p.evaluate(() => {
  const img = document.querySelector('.rb-print .rb-topo-still');
  return img ? { w: img.naturalWidth, h: img.naturalHeight,
                 aspect: +(img.naturalWidth / img.naturalHeight).toFixed(3) } : null;
});
check('the printed figure is landscape, like the frame it goes in',
  !!png && png.w > png.h, JSON.stringify(png));
check('and its shape matches the drawing frame, not the stored box',
  !!png && Math.abs(png.aspect - live.aspect) < 0.03,
  JSON.stringify({ frame: live.aspect, figure: png.aspect }));

// What is PAINTED, either side. The plan carries a mark hard against its
// left edge; if the region is wrong, that mark is outside it.
const ink = await p.evaluate(() => {
  function span(canvas) {
    const w = canvas.width, h = canvas.height;
    let d;
    try { d = canvas.getContext('2d').getImageData(0, 0, w, h).data; }
    catch (e) { return { error: String(e) }; }
    let left = -1, right = -1;
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const i = (y * w + x) * 4;
        if (d[i + 1] < 15 && d[i + 2] > 50 && d[i] > 50) {
          if (left < 0 || x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (left < 0) return { none: true };
    return { left: +(left / w).toFixed(3), right: +(right / w).toFixed(3) };
  }
  const out = {};
  const lc = document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live] canvas');
  out.live = lc ? span(lc) : { missing: true };
  const img = document.querySelector('.rb-print .rb-topo-still');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  out.still = span(c);
  return out;
});
check('the plan reaches the same edges in both',
  !ink.live.none && !ink.still.none
    && Math.abs(ink.live.left - ink.still.left) < 0.03
    && Math.abs(ink.live.right - ink.still.right) < 0.03,
  JSON.stringify(ink));

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
