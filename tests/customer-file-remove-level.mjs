/**
 * Plans & levels — Remove level (Tim, Oct 26, 2026).
 * Recovered / extra levels must be deletable; the last level must stay.
 * Run: node tests/customer-file-remove-level.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE_API = 'cf-remove-level-api';
const FILE_UI = 'cf-remove-level-ui';
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
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

async function seedTwoLevel(id) {
  return page.evaluate(async (fileId) => {
    const mkPlan = async (mediaId, label) => {
      const c = document.createElement('canvas');
      c.width = 600; c.height = 400;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400);
      x.strokeStyle = '#111'; x.strokeRect(20, 20, 560, 360);
      x.fillStyle = '#333'; x.font = '20px sans-serif'; x.fillText(label, 40, 60);
      await window.ToolboxDB.putMedia(mediaId, c.toDataURL('image/jpeg', 0.9));
      return { id: mediaId, width: 600, height: 400 };
    };
    const planA = await mkPlan(fileId + '-plan-main', 'Main');
    const planB = await mkPlan(fileId + '-plan-recovered', 'Recovered');
    const rec = window.ToolboxApp.blankCustomerFile(fileId);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Richard'; rec.lastName = 'Carter';
    rec.propertyAddress = '1 Remove Lane';
    const main = rec.planSetup.canvases[0];
    main.name = '1st Floor';
    main.plan = planA;
    const recovered = window.ToolboxPlanSetup.blankCanvas('Recovered Plan');
    recovered.plan = planB;
    rec.planSetup.canvases.push(recovered);
    rec.planSetup.activeCanvasId = recovered.id;
    rec.distress = window.ToolboxPlanSetup.blankDistressSurvey(recovered.id);
    rec.distress.pins = [
      { id: 'pin-r1', canvasId: recovered.id, number: 1, x: 0.2, y: 0.3 },
      { id: 'pin-m1', canvasId: main.id, number: 2, x: 0.4, y: 0.5 },
    ];
    rec.floorSurvey = window.ToolboxPlanSetup.blankFloorSurvey();
    rec.floorSurvey.byCanvasId[recovered.id] = {
      canvasId: recovered.id,
      points: [{ id: 't1', floorId: recovered.id, index: 1, x: 100, y: 100, value: 5 }],
      areas: [],
    };
    rec.floorSurvey.byCanvasId[main.id] = {
      canvasId: main.id,
      points: [{ id: 't2', floorId: main.id, index: 1, x: 120, y: 120, value: 6 }],
      areas: [],
    };
    await window.ToolboxDB.saveCustomerFile(rec);
    return { mainId: main.id, recoveredId: recovered.id };
  }, id);
}

await seedTwoLevel(FILE_API);

const api = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const alone = JSON.parse(JSON.stringify(rec));
  alone.planSetup.canvases = [alone.planSetup.canvases[0]];
  alone.planSetup.activeCanvasId = alone.planSetup.canvases[0].id;
  const refused = window.ToolboxPlanSetup.removeCanvas(alone, alone.planSetup.canvases[0].id);
  const recoveredId = rec.planSetup.canvases.find((c) => c.name === 'Recovered Plan').id;
  const result = window.ToolboxPlanSetup.removeCanvas(rec, recoveredId);
  await window.ToolboxDB.saveCustomerFile(rec);
  const after = await window.ToolboxDB.getCustomerFile(id);
  return {
    refused,
    result,
    after: {
      names: after.planSetup.canvases.map((c) => c.name),
      active: after.planSetup.canvases.find((c) => c.id === after.planSetup.activeCanvasId)?.name,
      pins: after.distress.pins.map((p) => p.id),
      floorKeys: Object.keys(after.floorSurvey.byCanvasId),
      orphans: window.ToolboxPlanSetup.findOrphanedCanvasRefs(after),
    },
  };
}, FILE_API);

check('removeCanvas refuses deleting the last level',
  api.refused && api.refused.ok === false,
  JSON.stringify(api.refused));
check('removeCanvas removes Recovered Plan',
  api.result.ok && api.after.names.length === 1 && api.after.names[0] === '1st Floor',
  JSON.stringify({ result: api.result, after: api.after }));
check('Distress pins on the removed level are gone; other level kept',
  api.after.pins.length === 1 && api.after.pins[0] === 'pin-m1',
  JSON.stringify(api.after.pins));
check('Floor Survey layer for the removed level is gone; no orphans',
  api.after.floorKeys.length === 1 &&
    api.after.orphans.distressPins.length === 0 &&
    api.after.orphans.floorSurveyCanvasIds.length === 0,
  JSON.stringify(api.after));

await seedTwoLevel(FILE_UI);
await page.goto(`${BASE}#/file/${FILE_UI}/edit/plans`, { waitUntil: 'networkidle0' });
try {
  await page.waitForFunction(() => !!document.querySelector('#canvas-remove-btn'), { timeout: 30000 });
} catch (err) {
  const dump = await page.evaluate(() => ({
    hash: location.hash,
    text: (document.body.innerText || '').slice(0, 500),
  }));
  check('Plans & levels UI loaded', false, JSON.stringify(dump));
  await browser.close();
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 600));

await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.canvas-chip')]
    .find((el) => /Recovered Plan/i.test(el.textContent || ''));
  chip?.click();
});
await new Promise((r) => setTimeout(r, 500));

const uiBefore = await page.evaluate(() => ({
  removeVisible: !!document.querySelector('#canvas-remove-btn') &&
    !document.querySelector('#canvas-remove-btn').hidden,
  name: document.querySelector('#canvas-name-input')?.value || '',
  chips: [...document.querySelectorAll('.canvas-chip')].map((c) => c.textContent.trim()),
}));
check('Remove level is visible when two levels exist',
  uiBefore.removeVisible && /Recovered/i.test(uiBefore.name),
  JSON.stringify(uiBefore));

page.once('dialog', async (dialog) => { await dialog.accept(); });
await page.click('#canvas-remove-btn');
await new Promise((r) => setTimeout(r, 1500));

const uiAfter = await page.evaluate(() => ({
  name: document.querySelector('#canvas-name-input')?.value || '',
  chips: [...document.querySelectorAll('.canvas-chip')].map((c) => c.textContent.trim()),
  removeHidden: !document.querySelector('#canvas-remove-btn') ||
    document.querySelector('#canvas-remove-btn').hidden,
  feedback: document.querySelector('#plan-panel-feedback')?.textContent || '',
}));
const saved = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    names: rec.planSetup.canvases.map((c) => c.name),
    count: rec.planSetup.canvases.length,
  };
}, FILE_UI);

check('UI remove leaves one level and hides Remove',
  saved.count === 1 && saved.names[0] === '1st Floor' && uiAfter.removeHidden,
  JSON.stringify({ uiAfter, saved }));

await page.screenshot({ path: `${OUT}/cf-remove-level-after.png`, fullPage: false });
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
await writeFile(`${OUT}/cf-remove-level.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
if (passed < results.length) process.exit(1);
