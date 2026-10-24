/**
 * Parser-blocking CDN must not gate Distress work-surface ready.
 * After GPT-020, export libs are local+deferred; a hung cdn.jsdelivr must not
 * prevent #screenWork. Run: node tests/distress-startup-cdn-hang.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server down');
}

const port = await freePort();
const host = 'toolbox-offline.test';
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});
await waitForServer(port);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--host-resolver-rules=MAP ${host} 127.0.0.1`,
    `--unsafely-treat-insecure-origin-as-secure=http://${host}:${port}`,
  ],
});
const page = await browser.newPage();
let cdnHits = 0;
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = request.url();
  if (url.startsWith('https://cdn.jsdelivr.net/')) {
    cdnHits += 1;
    // Never answer — would have blocked parser-blocking CDN scripts forever.
    return;
  }
  request.continue();
});

const base = `http://${host}:${port}/index.html`;
await page.goto(base, { waitUntil: 'networkidle0' });
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 100; c.height = 80;
  c.getContext('2d').fillRect(0, 0, 100, 80);
  await ToolboxDB.putMedia('cdn-plan', c.toDataURL('image/png'));
  const record = ToolboxApp.blankCustomerFile('cdn-distress');
  ToolboxPlanSetup.ensurePlanSetup(record);
  record.propertyAddress = 'CDN';
  const canvas = record.planSetup.canvases[0];
  canvas.plan = { id: 'cdn-plan', width: 100, height: 80 };
  record.distress.activeCanvasId = canvas.id;
  record.distress.pins = [{
    id: 'p1', num: 1, x: 20, y: 20, photos: [], description: 'seed',
    location: '', category: null, extPhotoCount: 0, isExterior: false, canvasId: canvas.id,
  }];
  record.distress.nextNum = 2;
  await ToolboxDB.saveCustomerFile(record);
});

await page.goto(`${base}#/file/cdn-distress`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
await page.click('[data-app="distress"]');
let ready = false;
try {
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe')?.contentDocument;
    return !!(doc && doc.querySelector('#screenWork.active'));
  }, { timeout: 5000 });
  ready = true;
} catch {}
const ms = Date.now() - t0;
const frame = page.frames().find((item) => /distress-survey\/survey\.html/.test(item.url()));
const detail = frame
  ? await frame.evaluate(() => ({
      pins: document.querySelectorAll('#gPins .pin').length,
      hasJSZip: typeof window.JSZip !== 'undefined',
      hasJsPDF: !!(window.jspdf && window.jspdf.jsPDF),
      cdnScriptTags: [...document.scripts].filter((s) => /cdn\.jsdelivr/.test(s.src)).length,
      vendorScriptTags: [...document.scripts].filter((s) => /\/js\/vendor\//.test(s.src)).length,
    }))
  : null;

check('Distress work surface ready despite hung CDN', ready && ms < 2000, JSON.stringify({ ms, cdnHits, detail }));
check('survey.html does not request cdn.jsdelivr on open', cdnHits === 0, String(cdnHits));
check('local vendor scripts are present', detail && detail.vendorScriptTags >= 2 && detail.cdnScriptTags === 0, JSON.stringify(detail));
check('plan/pin restored without export libs on critical path', detail && detail.pins === 1, JSON.stringify(detail));

await browser.close();
server.kill();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
