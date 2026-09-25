/**
 * Floor Survey field menu no longer opens 3D or Export.
 * Diagnostics opens the existing 3D view against saved Floor Survey data.
 * Run: node tests/floor-survey-diagnostics.mjs
 * Requires: Chrome, puppeteer-core, static server on :8765
 */
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

const tiny =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle0' });

const seeded = await page.evaluate(async (planUrl) => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('toolbox', 2);
    req.onerror = () => rej(req.error);
    req.onsuccess = () => res(req.result);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });

  const id = 'dx-3d-1';
  const planId = 'plan-dx-1';
  await window.ToolboxDB.putMedia(planId, planUrl);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Dana';
  rec.lastName = 'Diagnostics';
  rec.propertyAddress = '58 Survey Court';
  const now = new Date().toISOString();
  rec.planSetup.canvases = [
    {
      id: 'canvas-dx-1',
      name: 'First Floor',
      createdAt: now,
      updatedAt: now,
      plan: { id: planId, width: 200, height: 140 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
    {
      id: 'canvas-dx-2',
      name: 'Second Floor',
      createdAt: now,
      updatedAt: now,
      plan: { id: planId, width: 200, height: 140 },
      rooms: [],
      frontDoorFacing: 'N',
      frontDoor: null,
    },
  ];
  rec.planSetup.activeCanvasId = 'canvas-dx-1';
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'canvas-dx-1');
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'canvas-dx-2');
  const boundary = [
    { x: 10, y: 10 },
    { x: 180, y: 10 },
    { x: 180, y: 120 },
    { x: 10, y: 120 },
  ];
  rec.floorSurvey.byCanvasId['canvas-dx-1'].boundary = boundary;
  rec.floorSurvey.byCanvasId['canvas-dx-1'].points = [
    { id: 'p1', floorId: 'canvas-dx-1', index: 1, x: 40, y: 40, value: 0.1, createdAt: 1 },
    { id: 'p2', floorId: 'canvas-dx-1', index: 2, x: 140, y: 40, value: 0.4, createdAt: 1 },
    { id: 'p3', floorId: 'canvas-dx-1', index: 3, x: 40, y: 100, value: 0.8, createdAt: 1 },
    { id: 'p4', floorId: 'canvas-dx-1', index: 4, x: 140, y: 100, value: 1.2, createdAt: 1 },
  ];
  rec.floorSurvey.byCanvasId['canvas-dx-2'].boundary = boundary;
  rec.floorSurvey.byCanvasId['canvas-dx-2'].points = [
    { id: 'q1', floorId: 'canvas-dx-2', index: 1, x: 50, y: 50, value: 2.0, createdAt: 1 },
  ];
  rec.floorSurvey.inspectionDate = '2026-04-18';
  rec.floorSurvey.updatedAt = '2026-09-24T12:00:00.000Z';
  rec.updatedAt = '2026-09-24T12:00:00.000Z';
  delete rec.diagnostics;
  await window.ToolboxDB.saveCustomerFile(rec);
  const saved = await window.ToolboxDB.getCustomerFile(id);
  return {
    id,
    floorUpdatedAt: saved.floorSurvey.updatedAt,
    points1: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.length,
    points2: saved.floorSurvey.byCanvasId['canvas-dx-2'].points.length,
    hasDiagnostics: !!saved.diagnostics,
  };
}, tiny);

check('synthetic Customer File saved', seeded.points1 === 4 && seeded.points2 === 1, JSON.stringify(seeded));

await page.goto(BASE + '#/file/dx-3d-1/floor', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

await page.click('[aria-label="More"]');
await new Promise((r) => setTimeout(r, 300));
const fieldChrome = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent || '').trim());
  const text = document.body.innerText || '';
  return {
    items,
    hasData: /\bData\b/.test(text),
    hasTopo: /\bTopo\b/.test(text),
    has3dView: !!document.querySelector('[aria-label="Close 3D view"]'),
  };
});
check(
  'Floor Survey menu keeps Review, Setup, and Transitions',
  fieldChrome.items.includes('Review') && fieldChrome.items.includes('Setup') && fieldChrome.items.includes('Transitions'),
  fieldChrome.items.join(', '),
);
check(
  'Floor Survey menu has no 3D or Export',
  !fieldChrome.items.includes('3D') && !fieldChrome.items.includes('Export') && !fieldChrome.has3dView,
  fieldChrome.items.join(', '),
);
check('Floor Survey still offers Data and Topo', fieldChrome.hasData && fieldChrome.hasTopo);
await page.screenshot({ path: OUT + '/diagnostics-field-menu-desktop.png' });

await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1800));

const opened = await page.evaluate(() => {
  const close = document.querySelector('[aria-label="Close 3D view"]');
  const floor = document.querySelector('[data-diagnostics-floor]');
  const canvas = document.querySelector('canvas');
  const text = document.body.innerText || '';
  return {
    close: !!close,
    title: text.includes('3D'),
    floorOptions: floor ? [...floor.options].map((o) => o.textContent) : [],
    selected: floor ? floor.value : '',
    canvas: !!canvas,
    message: /Need at least 3 survey points|Boundary is missing|Building surface|could not start/.test(text) ? text.slice(0, 180) : '',
    fieldMenu: !!document.querySelector('[aria-label="More"]'),
    exportImage: /Export image/.test(text),
    diagnosticsOpen: document.body.classList.contains('diagnostics-open'),
  };
});
check('Diagnostics opens the existing 3D view', opened.close && opened.title && opened.diagnosticsOpen, JSON.stringify(opened));
check('Diagnostics can switch floors', opened.floorOptions.join('|') === 'First Floor|Second Floor', opened.floorOptions.join('|'));
check('3D canvas is present', opened.canvas, opened.message);
check('Field capture menu is not on the 3D view', !opened.fieldMenu);
check('3D image export control remains with the engine', opened.exportImage);

const ribbon = await page.evaluate(() => {
  const bar = document.querySelector('[data-diagnostics-ribbon]');
  const back = document.querySelector('[data-diagnostics-back]');
  const view = document.querySelector('[data-diagnostics-view="3d"]');
  const add = document.querySelector('[data-diagnostics-add-report]');
  const placeholders = [...document.querySelectorAll('[data-diagnostics-placeholder]')].map((el) => ({
    id: el.getAttribute('data-diagnostics-placeholder'),
    disabled: el.disabled,
    title: el.getAttribute('title') || '',
  }));
  const groups = [...document.querySelectorAll('.dx-ribbon__group')].map((el) => el.getAttribute('aria-label'));
  return {
    bar: !!bar,
    back: back ? (back.textContent || '').trim() : '',
    viewPressed: view ? view.getAttribute('aria-pressed') : '',
    add: !!add,
    placeholders,
    groups,
  };
});
check(
  'Workbench ribbon has View, Capture, Imaging, Plots, and Epochs',
  ribbon.bar && ribbon.groups.join(',') === 'View,Capture,Imaging,Plots,Epochs',
  ribbon.groups.join(','),
);
check(
  'Back path is labeled Customer File',
  ribbon.back === '‹ Customer File',
  ribbon.back,
);
check('3D is the current view', ribbon.viewPressed === 'true');
const placeholderOk = ribbon.placeholders.length === 6 && ribbon.placeholders.every((item) => item.disabled && item.title === 'Not available yet');
check(
  'Unimplemented ribbon controls are disabled',
  placeholderOk,
  JSON.stringify(ribbon.placeholders),
);
check('Add to Report is on the ribbon', ribbon.add);

if (opened.floorOptions.length === 2) {
  await page.select('[data-diagnostics-floor]', 'canvas-dx-2');
  await new Promise((r) => setTimeout(r, 600));
  const second = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const readout = document.querySelector('[data-diagnostics-readout]');
    return {
      selected: document.querySelector('[data-diagnostics-floor]')?.value || '',
      needsPoints: text.includes('Need at least 3 survey points'),
      surface: readout ? readout.getAttribute('data-surface') : '',
      tooFew: text.includes('Too few survey points for a surface.'),
      level: text.includes('Second Floor'),
      legend: !!document.querySelector('[data-diagnostics-legend]'),
    };
  });
  check(
    'Second floor uses its own survey in 3D',
    second.selected === 'canvas-dx-2' && second.needsPoints && second.surface === 'too-few-points' && second.tooFew && second.level && !second.legend,
    JSON.stringify(second),
  );
  await page.screenshot({ path: OUT + '/diagnostics-3d-second-floor.png' });
}

const unchanged = await page.evaluate(async () => {
  const saved = await window.ToolboxDB.getCustomerFile('dx-3d-1');
  return {
    floorUpdatedAt: saved.floorSurvey.updatedAt,
    points1: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.map((p) => p.value).join(','),
    points2: saved.floorSurvey.byCanvasId['canvas-dx-2'].points.length,
    hasDiagnostics: !!saved.diagnostics,
  };
});
check(
  'Opening Diagnostics does not write Floor Survey or Diagnostics data',
  unchanged.floorUpdatedAt === seeded.floorUpdatedAt &&
    unchanged.points1 === '0.1,0.4,0.8,1.2' &&
    unchanged.points2 === 1 &&
    unchanged.hasDiagnostics === false,
  JSON.stringify(unchanged),
);

async function waitForCaptureReady(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      const button = document.querySelector('[data-diagnostics-add-report]');
      const canvas = document.querySelector('.dx-stage canvas');
      return {
        enabled: !!(button && !button.disabled),
        canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
        status: (document.querySelector('[data-diagnostics-status]') || {}).textContent || '',
      };
    });
    if (ready.enabled) return ready;
    await new Promise((r) => setTimeout(r, 250));
  }
  return page.evaluate(() => ({
    enabled: false,
    text: (document.body.innerText || '').slice(0, 240),
  }));
}

await page.select('[data-diagnostics-floor]', 'canvas-dx-1');
await new Promise((r) => setTimeout(r, 400));
const ready = await waitForCaptureReady(8000);
check('Add to Report enables when the 3D surface is ready', ready.enabled, JSON.stringify(ready));
const readout = await page.evaluate(() => {
  const root = document.querySelector('[data-diagnostics-readout]');
  const legend = document.querySelector('[data-diagnostics-legend]');
  const text = root ? root.innerText : '';
  const height = (document.body.innerText || '').match(/Height exaggeration · ([0-9.]+)×/);
  return {
    text,
    surface: root ? root.getAttribute('data-surface') : '',
    exaggeration: root ? root.getAttribute('data-exaggeration') : '',
    heightLabel: height ? height[1] : '',
    legendLow: legend ? legend.getAttribute('data-legend-low') : '',
    legendHigh: legend ? legend.getAttribute('data-legend-high') : '',
    palette: legend ? legend.getAttribute('data-palette') : '',
    colors: legend ? (legend.getAttribute('data-legend-colors') || '') : '',
    notice: !!document.querySelector('[data-diagnostics-notice]'),
    evidence: (document.querySelector('[data-diagnostics-evidence]') || {}).textContent || '',
  };
});
check(
  'Readout shows the active level, survey date, count, and measured range in inches',
  readout.surface === 'ready' &&
    readout.text.includes('First Floor') &&
    readout.text.includes('Survey date 2026-04-18') &&
    readout.text.includes('4 usable survey points') &&
    readout.text.includes('High 1.20 in · Low 0.10 in · Range 1.10 in') &&
    readout.text.includes('High and low are measured readings.') &&
    readout.text.includes('No base-point reference recorded.') &&
    !readout.text.includes('9.0'),
  readout.text,
);
check(
  'Legend matches the displayed range and the exaggeration matches the slider',
  readout.legendLow === '0.1' &&
    readout.legendHigh === '1.2' &&
    readout.palette === 'brown' &&
    readout.colors.startsWith('rgb(130,90,55)') &&
    readout.exaggeration === '3.0' &&
    readout.heightLabel === '3.0' &&
    readout.text.includes('Vertical exaggeration 3.0×') &&
    readout.notice &&
    readout.evidence.includes('does not infer heave, settlement, cause, or repair'),
  JSON.stringify(readout),
);
if (ready.enabled) {
  await page.screenshot({ path: OUT + '/diagnostics-3d-desktop.png' });
}
if (ready.enabled) {
  await page.click('[data-diagnostics-add-report]');
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-diagnostics-status]');
    return status && /Added to Report|did not save|could not be captured/i.test(status.textContent || '');
  }, { timeout: 8000 });
}
const captured = await page.evaluate(async () => {
  const saved = await window.ToolboxDB.getCustomerFile('dx-3d-1');
  const figures = window.ToolboxDiagnostics.listReportFigures(saved);
  const figure = figures[0] || null;
  const media = figure ? await window.ToolboxDB.getMedia(figure.mediaId) : null;
  const placement = figure && figure.reportPlacement;
  return {
    status: (document.querySelector('[data-diagnostics-status]') || {}).textContent || '',
    floorUpdatedAt: saved.floorSurvey.updatedAt,
    points1: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.map((p) => p.value).join(','),
    count: figures.length,
    kind: figure && figure.kind,
    canvasId: figure && figure.canvasId,
    sequence: figure && figure.sequence,
    narrative: placement ? placement.narrative : 'missing',
    caption: placement ? placement.caption : 'missing',
    sheet: placement && placement.sheet,
    box: placement && placement.box,
    mediaId: figure && figure.mediaId,
    mediaPng: typeof media === 'string' && media.indexOf('data:image/png') === 0 && media.length > 32,
    context: figure && figure.context,
    media,
    syncIds: window.ToolboxSync.mediaIdsForComponent(saved, 'diagnostics'),
    payloadIds: window.ToolboxSync._test.mediaIdsFromPayload(saved.diagnostics, 'diagnostics'),
    floorMedia: window.ToolboxSync.mediaIdsForComponent(saved, 'floor'),
  };
});
check(
  'Add to Report stores a Diagnostics figure without changing Floor Survey',
  ready.enabled &&
    captured.count === 1 &&
    captured.kind === '3d-elevation' &&
    captured.canvasId === 'canvas-dx-1' &&
    captured.sequence === 1 &&
    captured.narrative === null &&
    captured.caption === null &&
    captured.sheet === '11x17-landscape' &&
    captured.box && captured.box.width === 0.88 && captured.box.height === 0.58 &&
    typeof captured.mediaId === 'string' && captured.mediaId.indexOf('dxfig_') === 0 &&
    captured.mediaPng &&
    captured.floorUpdatedAt === seeded.floorUpdatedAt &&
    captured.points1 === '0.1,0.4,0.8,1.2' &&
    captured.syncIds.length === 1 &&
    captured.syncIds[0] === captured.mediaId &&
    captured.payloadIds.length === 1 &&
    captured.payloadIds[0] === captured.mediaId &&
    captured.floorMedia.length === 0 &&
    /No conclusion was written/.test(captured.status) &&
    captured.context &&
    captured.context.canvasId === 'canvas-dx-1' &&
    captured.context.levelName === 'First Floor' &&
    captured.context.surveyDate === '2026-04-18' &&
    captured.context.unit === 'in' &&
    captured.context.high === 1.2 &&
    captured.context.low === 0.1 &&
    captured.context.range === 1.1 &&
    captured.context.reference === null &&
    captured.context.exaggeration === 3 &&
    captured.context.legendLow === 0.1 &&
    captured.context.legendHigh === 1.2 &&
    captured.context.palette === 'brown' &&
    Array.isArray(captured.context.lines) &&
    captured.context.lines.join('\n').includes('Vertical exaggeration. Visualization is not to scale.') &&
    captured.context.lines.join('\n').includes('Vertical exaggeration 3.0×'),
  JSON.stringify({ status: captured.status, context: captured.context, count: captured.count }),
);

if (captured.mediaPng) {
  const shot = await page.evaluate(async (url) => {
    const canvas = document.querySelector('.dx-stage canvas');
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
    return {
      image: dims,
      canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
    };
  }, captured.media);
  check(
    'Captured figure is taller than the bare 3D canvas so the context band is in the image',
    !!(shot.image && shot.canvas && shot.image.w === shot.canvas.w && shot.image.h > shot.canvas.h),
    JSON.stringify(shot),
  );
  const png = Buffer.from(captured.media.split(',')[1], 'base64');
  writeFileSync(OUT + '/diagnostics-3d-capture.png', png);
} else {
  check('Captured figure is taller than the bare 3D canvas so the context band is in the image', false, 'no png');
}

const exported = await page.evaluate(async () => {
  const saved = await window.ToolboxDB.getCustomerFile('dx-3d-1');
  const built = await window.ToolboxAiExport.buildPackage(saved);
  const names = built.manifest.files;
  const image = names.find((path) => path.indexOf('diagnostics/images/') === 0) || '';
  const text = await built.zip.file('diagnostics/diagnostics.json').async('string');
  const doc = JSON.parse(text);
  const fig = doc.figures && doc.figures[0];
  return {
    image,
    file: fig && fig.file,
    narrative: fig && fig.reportPlacement ? fig.reportPlacement.narrative : 'missing',
    floorUntouched: saved.floorSurvey.updatedAt,
  };
});
check(
  'AI export carries the Diagnostics figure bytes and blank caption',
  exported.image && exported.file === exported.image && exported.narrative === null && exported.floorUntouched === seeded.floorUpdatedAt,
  JSON.stringify(exported),
);

async function refuseBareCapture(failOnCall, label) {
  const before = await page.evaluate(async () => {
    const saved = await window.ToolboxDB.getCustomerFile('dx-3d-1');
    return {
      figures: saved.diagnostics && saved.diagnostics.figures ? saved.diagnostics.figures.length : 0,
      points: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.map((p) => p.value).join(','),
      status: (document.querySelector('[data-diagnostics-status]') || {}).textContent || '',
    };
  });
  await page.evaluate((failOn) => {
    const orig = HTMLCanvasElement.prototype.getContext;
    let calls = 0;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === '2d') {
        calls += 1;
        if (calls === failOn) return null;
      }
      return orig.apply(this, [type, ...args]);
    };
    window.__dxRestoreGetContext = () => {
      HTMLCanvasElement.prototype.getContext = orig;
    };
    window.__dx2dCalls = () => calls;
  }, failOnCall);
  await page.click('[data-diagnostics-add-report]');
  await page.waitForFunction(
    (failOn) => typeof window.__dx2dCalls === 'function' && window.__dx2dCalls() >= failOn,
    { timeout: 4000 },
    failOnCall,
  );
  const after = await page.evaluate(async () => {
    const calls = window.__dx2dCalls();
    window.__dxRestoreGetContext();
    const saved = await window.ToolboxDB.getCustomerFile('dx-3d-1');
    return {
      figures: saved.diagnostics && saved.diagnostics.figures ? saved.diagnostics.figures.length : 0,
      points: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.map((p) => p.value).join(','),
      status: (document.querySelector('[data-diagnostics-status]') || {}).textContent || '',
      calls,
    };
  });
  check(
    label,
    after.figures === before.figures &&
      after.points === before.points &&
      after.calls >= failOnCall &&
      /could not be captured/i.test(after.status) &&
      !/Added to Report/i.test(after.status),
    JSON.stringify(after),
  );
}

await refuseBareCapture(1, 'Missing 2D measure context does not store a bare Diagnostics figure');
await refuseBareCapture(2, 'Missing 2D output context does not store a bare Diagnostics figure');

const sliderMoved = await page.evaluate(() => {
  const slider = document.querySelector('[role="slider"]');
  if (slider) slider.focus();
  return !!slider;
});
if (sliderMoved) await page.keyboard.press('ArrowRight');
await new Promise((r) => setTimeout(r, 250));
const exaggerated = await page.evaluate(() => {
  const root = document.querySelector('[data-diagnostics-readout]');
  const height = (document.body.innerText || '').match(/Height exaggeration · ([0-9.]+)×/);
  const text = root ? root.innerText : '';
  return {
    exaggeration: root ? root.getAttribute('data-exaggeration') : '',
    heightLabel: height ? height[1] : '',
    line: text.includes('Vertical exaggeration ' + (height ? height[1] : '') + '×'),
  };
});
check(
  'Current exaggeration stays tied to the height control',
  sliderMoved && exaggerated.exaggeration === '3.1' && exaggerated.heightLabel === '3.1' && exaggerated.line,
  JSON.stringify(exaggerated),
);

await page.select('[data-diagnostics-floor]', 'canvas-dx-2');
await new Promise((r) => setTimeout(r, 700));
const blocked = await page.evaluate(() => {
  const button = document.querySelector('[data-diagnostics-add-report]');
  return {
    disabled: !!(button && button.disabled),
    needsPoints: (document.body.innerText || '').includes('Need at least 3 survey points'),
  };
});
check(
  'Add to Report stays disabled when the 3D view cannot be built',
  blocked.disabled && blocked.needsPoints,
  JSON.stringify(blocked),
);
await page.select('[data-diagnostics-floor]', 'canvas-dx-1');
await new Promise((r) => setTimeout(r, 400));

await page.click('[aria-label="Close 3D view"]');
await new Promise((r) => setTimeout(r, 700));
const home = await page.evaluate(() => ({
  hash: location.hash,
  apps: [...document.querySelectorAll('[data-app]')].map((el) => el.getAttribute('data-app')),
  still3d: !!document.querySelector('[aria-label="Close 3D view"]'),
}));
check(
  'Close returns to this Customer File',
  home.hash === '#/file/dx-3d-1' && home.apps.join(',') === 'distress,floor,diagnostics,report' && !home.still3d,
  JSON.stringify(home),
);

await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.click('[data-diagnostics-back]');
await new Promise((r) => setTimeout(r, 700));
const ribbonHome = await page.evaluate(() => ({
  hash: location.hash,
  ribbon: !!document.querySelector('[data-diagnostics-ribbon]'),
  apps: [...document.querySelectorAll('[data-app]')].map((el) => el.getAttribute('data-app')).join(','),
}));
check(
  'Ribbon Customer File returns to this Customer File',
  ribbonHome.hash === '#/file/dx-3d-1' && !ribbonHome.ribbon && ribbonHome.apps === 'distress,floor,diagnostics,report',
  JSON.stringify(ribbonHome),
);

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const canvas = document.querySelector('canvas');
  const text = document.body.innerText || '';
  return canvas && canvas.width > 10 && !text.includes('Building surface');
}, { timeout: 8000 }).catch(() => {});
const ipad = await page.evaluate(() => {
  const close = document.querySelector('[aria-label="Close 3D view"]');
  const exportBtn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('Export image'));
  const floor = document.querySelector('[data-diagnostics-floor]');
  const cards = [...document.querySelectorAll('div')].filter((el) => {
    const text = el.textContent || '';
    return text.includes('Height exaggeration') && text.includes('Show survey points');
  });
  cards.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  const panel = cards[0] || null;
  function box(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  function overlaps(a, b) {
    if (!a || !b) return false;
    return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
  }
  const ribbon = document.querySelector('[data-diagnostics-ribbon]');
  const readout = document.querySelector('[data-diagnostics-readout]');
  const closeBox = box(close);
  const exportBox = box(exportBtn);
  const floorBox = box(floor);
  const panelBox = box(panel);
  const ribbonBox = box(ribbon);
  const readoutBox = box(readout);
  const stage = document.querySelector('.dx-stage');
  const stageBox = box(stage);
  const canvasShare = stageBox && readoutBox
    ? 1 - ((readoutBox.bottom - readoutBox.top) * (readoutBox.right - readoutBox.left)) / (stageBox.width || (stageBox.right - stageBox.left) || 1) / ((stageBox.bottom - stageBox.top) || 1)
    : 0;
  return {
    close: !!close,
    panel: !!panelBox,
    ribbon: !!ribbonBox,
    readout: !!readoutBox,
    headerOverlap: overlaps(closeBox, exportBox) || overlaps(closeBox, floorBox) || overlaps(exportBox, floorBox),
    panelOverlap: overlaps(closeBox, panelBox) || overlaps(exportBox, panelBox) || overlaps(floorBox, panelBox),
    ribbonOverlap: overlaps(ribbonBox, closeBox) || overlaps(ribbonBox, exportBox) || overlaps(ribbonBox, floorBox) || overlaps(ribbonBox, panelBox),
    readoutOverlap: overlaps(readoutBox, panelBox) || overlaps(readoutBox, closeBox) || overlaps(readoutBox, exportBox) || overlaps(readoutBox, ribbonBox),
    canvasShare,
    vw: window.innerWidth,
  };
});
check(
  'iPad 3D header, height controls, and readout stay apart',
  ipad.close && ipad.panel && ipad.ribbon && ipad.readout && !ipad.headerOverlap && !ipad.panelOverlap && !ipad.ribbonOverlap && !ipad.readoutOverlap && ipad.canvasShare > 0.45,
  JSON.stringify(ipad),
);
await page.screenshot({ path: OUT + '/diagnostics-3d-ipad.png' });

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const canvas = document.querySelector('canvas');
  const text = document.body.innerText || '';
  return canvas && canvas.width > 10 && !text.includes('Building surface');
}, { timeout: 8000 }).catch(() => {});
const phone = await page.evaluate(() => {
  const close = document.querySelector('[aria-label="Close 3D view"]');
  const exportBtn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('Export image'));
  const floor = document.querySelector('[data-diagnostics-floor]');
  const ribbon = document.querySelector('[data-diagnostics-ribbon]');
  const boxes = [close, exportBtn, floor, ribbon].filter(Boolean).map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20), left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width };
  });
  function overlaps(a, b) {
    return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
  }
  let crowded = false;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlaps(boxes[i], boxes[j])) crowded = true;
    }
  }
  const offscreen = boxes.some((b) => b.left < 0 || b.right > window.innerWidth + 1);
  const add = document.querySelector('[data-diagnostics-add-report]');
  const addBox = add ? add.getBoundingClientRect() : null;
  const addVisible = !!addBox && addBox.left >= 0 && addBox.right <= window.innerWidth + 1 && addBox.bottom > addBox.top;
  const readout = document.querySelector('[data-diagnostics-readout]');
  const height = document.querySelector('[data-diagnostics-height]');
  function box(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
  }
  const readoutBox = box(readout);
  const heightBox = box(height);
  const stage = document.querySelector('.dx-stage');
  const stageBox = box(stage);
  const readoutOff = readoutBox && (readoutBox.left < -1 || readoutBox.right > window.innerWidth + 1);
  const readoutHeightOverlap = overlaps(readoutBox, heightBox);
  const stageH = stageBox ? stageBox.bottom - stageBox.top : 0;
  const readoutH = readoutBox ? readoutBox.bottom - readoutBox.top : 0;
  return {
    crowded, offscreen, addVisible, boxes, vw: window.innerWidth,
    readoutOff, readoutHeightOverlap, stageH, readoutH,
    notice: !!document.querySelector('[data-diagnostics-notice]'),
  };
});
check(
  'Phone 3D header controls do not overlap',
  !phone.crowded && !phone.offscreen && phone.addVisible && !phone.readoutOff && !phone.readoutHeightOverlap && phone.notice && phone.stageH > 0 && phone.readoutH < phone.stageH * 0.5,
  JSON.stringify(phone),
);
await page.screenshot({ path: OUT + '/diagnostics-3d-phone.png' });

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await page.goto(BASE + '#/file/dx-3d-1/floor', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
const backToField = await page.evaluate(() => ({
  more: !!document.querySelector('[aria-label="More"]'),
  three: !!document.querySelector('[aria-label="Close 3D view"]'),
  diagnostics: document.body.classList.contains('diagnostics-open'),
}));
check('Returning to Floor Survey restores field capture', backToField.more && !backToField.three && !backToField.diagnostics, JSON.stringify(backToField));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exitCode = 1;
