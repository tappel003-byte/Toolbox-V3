/**
 * Quick Capture controls survive a pinch.
 * Run: node tests/quick-capture-chrome.mjs   (needs a static server on 8765)
 *
 * Tim, from the field: "When I pinched the zoom in I just know the buttons
 * went away." The viewfinder is fixed to the page, and a pinch on a phone
 * does not move the page -- it shrinks the window onto it and lets you pan.
 * So the bars stay where the page puts them, outside what can now be seen,
 * while the camera keeps filling the screen.
 *
 * visualViewport reports the rectangle that is actually visible, so the
 * control layer is mapped onto it. What this checks is that the shutter and
 * Done land inside that rectangle at any pinch and pan -- and that at normal
 * zoom nothing is applied at all, because proven capture behaviour should not
 * move for a fix aimed at the zoomed case.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/distress-survey/survey.html';
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));

check(
  'the viewfinder puts its controls on their own layer',
  await page.evaluate(() => !!document.getElementById('qcChrome')),
);

// Show the chrome for measurement. Opening a real session needs a project;
// what is under test is where the controls land, not the capture flow.
await page.evaluate(() => { document.getElementById('qcOverlay').classList.add('open'); });
await new Promise((r) => setTimeout(r, 200));

async function measure(fake) {
  return page.evaluate((input) => {
    if (input) {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: {
          offsetLeft: input.l, offsetTop: input.t, width: input.w, height: input.h,
          scale: input.s, addEventListener() {}, removeEventListener() {},
        },
      });
    }
    syncQcChrome();
    const vv = window.visualViewport;
    const vis = { l: vv.offsetLeft, t: vv.offsetTop, w: vv.width, h: vv.height };
    const within = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return b.width > 0 && b.height > 0 &&
        b.left >= vis.l - 1 && b.right <= vis.l + vis.w + 1 &&
        b.top >= vis.t - 1 && b.bottom <= vis.t + vis.h + 1;
    };
    const shoot = document.getElementById('qcShoot').getBoundingClientRect();
    return {
      shootVisible: within('qcShoot'),
      doneVisible: within('qcDone'),
      transform: document.getElementById('qcChrome').style.transform || '',
      // The apparent size under a thumb: CSS size times the pinch.
      thumbWidth: Math.round(shoot.width * (vv.scale || 1)),
    };
  }, fake);
}

const normal = await measure(null);
check(
  'unzoomed, nothing is applied and the controls are where they always were',
  normal.shootVisible && normal.doneVisible && normal.transform === '',
  JSON.stringify(normal),
);

// 2.5x, panned to the middle of the page.
const pinched = await measure({ l: 120, t: 300, w: 156, h: 337.6, s: 2.5 });
check(
  'pinched, the shutter and Done are still on screen',
  pinched.shootVisible && pinched.doneVisible,
  JSON.stringify(pinched),
);

// Panned hard into the bottom-right corner, which is where a fixed bar is
// furthest from what can be seen.
const corner = await measure({ l: 234, t: 506.4, w: 156, h: 337.6, s: 2.5 });
check(
  'panned into the corner, they follow',
  corner.shootVisible && corner.doneVisible,
  JSON.stringify(corner),
);

check(
  'the shutter stays the same size under a thumb',
  Math.abs(pinched.thumbWidth - normal.thumbWidth) <= 2,
  normal.thumbWidth + ' then ' + pinched.thumbWidth,
);

// Back to normal: the fix must not leave an offset behind.
const released = await measure({ l: 0, t: 0, w: 390, h: 844, s: 1 });
check(
  'letting go clears it again',
  released.transform === '' && released.shootVisible && released.doneVisible,
  JSON.stringify(released),
);

check('No JavaScript errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) process.exitCode = 1;
