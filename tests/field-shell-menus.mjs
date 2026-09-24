/**
 * Toolbox Distress / Floor Survey shell menu inventory.
 * Synthetic Customer Files only. Run: node tests/field-shell-menus.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c);
      return c;
    } catch (_) {}
  }
  return '/usr/bin/google-chrome-stable';
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function makePlanDataUrl(page, w, h, label) {
  return page.evaluate(
    (W, H, L) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#f7f4ee';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 4;
      ctx.strokeRect(24, 24, W - 48, H - 48);
      ctx.fillStyle = '#444';
      ctx.font = '28px sans-serif';
      ctx.fillText(L || 'Plan', 48, 72);
      return c.toDataURL('image/png');
    },
    w,
    h,
    label,
  );
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 400));
const BASE = `http://127.0.0.1:${port}/index.html`;

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const viewports = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
  ipad: { width: 768, height: 1024, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.setViewport(viewports.desktop);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxDB && window.ToolboxApp && window.ToolboxPlanSetup);

  const plan = await makePlanDataUrl(page, 800, 600, 'Ground');
  const seeded = await page.evaluate(async (planUrl) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('toolbox', 2);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
      tx.objectStore('customerFiles').clear();
      tx.objectStore('media').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await window.ToolboxDB.putMedia('plan-shell', planUrl);
    const id = 'shell-menu-1';
    const rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Ada';
    rec.lastName = 'Inspector';
    rec.propertyAddress = '15 Canvas Street';
    const now = new Date().toISOString();
    rec.planSetup.canvases = [
      {
        id: 'canvas-ground',
        name: 'Ground Floor',
        createdAt: now,
        updatedAt: now,
        plan: { id: 'plan-shell', width: 800, height: 600 },
        rooms: [{ name: 'Living', x: 200, y: 200 }],
        frontDoorFacing: 'S',
        frontDoor: null,
      },
    ];
    rec.planSetup.activeCanvasId = 'canvas-ground';
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.distress.activeCanvasId = 'canvas-ground';
    window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'canvas-ground');
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id };
  }, plan);

  await page.goto(BASE + `#/file/${seeded.id}/distress`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1800));
  const frame = () => page.frames().find((fr) => /distress-survey\/survey\.html/.test(fr.url()));
  let fr = frame();
  check('Distress iframe mounted', !!fr);
  if (!fr) throw new Error('no distress iframe');
  await fr.waitForSelector('#screenWork.active', { timeout: 15000 });

  const beforeMenu = await fr.evaluate(() => {
    const menu = document.getElementById('workMenu');
    const buttons = [...menu.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
      hidden: getComputedStyle(b).display === 'none' || b.hidden,
    }));
    return {
      host: document.body.classList.contains('host-mode'),
      work: document.getElementById('screenWork')?.classList.contains('active'),
      setup: document.getElementById('screenSetup')?.classList.contains('active'),
      home: document.getElementById('screenHome')?.classList.contains('active'),
      buttons,
      exportFns: typeof exportProjectZip === 'function' && typeof exportProjectPdfWithLog === 'function',
    };
  });
  check('Host opens the work canvas', beforeMenu.host && beforeMenu.work && !beforeMenu.setup && !beforeMenu.home, JSON.stringify(beforeMenu));
  check('ZIP and PDF export functions remain', beforeMenu.exportFns);

  const hidden = beforeMenu.buttons.filter((b) => b.hidden).map((b) => b.text);
  const shown = beforeMenu.buttons.filter((b) => !b.hidden).map((b) => b.text);
  check('Export is not in the host menu', hidden.some((t) => /Export/.test(t)) && !shown.some((t) => /Export/.test(t)), JSON.stringify(shown));
  check('Edit setup is not in the host menu', hidden.some((t) => /Edit setup/.test(t)));
  check('Move to trash is not in the host menu', hidden.some((t) => /Move to trash/.test(t)));
  check('Quick Capture stays', shown.some((t) => /Quick Capture/.test(t)), shown.join(' | '));
  check('Voice memo stays', shown.some((t) => /Voice memo/.test(t)));
  check('Clear all drawings stays', shown.some((t) => /Clear all drawings/.test(t)));

  await fr.evaluate(() => {
    document.querySelector('#workMenu')?.previousElementSibling;
    const more = document.querySelector('.work-head button[title="More"]');
    more?.click();
  });
  await new Promise((r) => setTimeout(r, 250));
  const menuOpen = await fr.evaluate(() => {
    openExport();
    const sheet = document.getElementById('exportSheet');
    const menu = document.getElementById('workMenu');
    const box = menu.getBoundingClientRect();
    const stage = document.getElementById('stage').getBoundingClientRect();
    return {
      menuOpen: menu.classList.contains('open'),
      sheetOpen: sheet.classList.contains('open'),
      menu: { x: box.x, y: box.y, w: box.width, h: box.height },
      stageTop: stage.y,
      overlapsStage: box.bottom > stage.y + 8 && box.top < stage.bottom,
    };
  });
  check('More menu opens', menuOpen.menuOpen, JSON.stringify(menuOpen.menu));
  check('openExport does not open the delivery sheet', menuOpen.sheetOpen === false);
  await page.screenshot({ path: `${OUT}/distress-menu-desktop.png` });

  // Place one pin to confirm capture still works with the simplified menu.
  const iframeBox = await page.$eval('iframe', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const stage = await fr.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await fr.evaluate(() => document.getElementById('workMenu')?.classList.remove('open'));
  await page.mouse.click(iframeBox.x + stage.x + stage.w * 0.42, iframeBox.y + stage.y + stage.h * 0.48);
  await new Promise((r) => setTimeout(r, 700));
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Done/i.test(b.textContent || ''))?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const pin = await page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const pins = rec.distress?.pins || [];
    return { count: pins.length, num: pins[0]?.num, canvasId: pins[0]?.canvasId, photos: pins[0]?.photos || [] };
  }, seeded.id);
  check('Pin capture still persists on the Customer File', pin.count === 1 && pin.num === 1 && pin.canvasId === 'canvas-ground', JSON.stringify(pin));

  for (const [name, vp] of Object.entries(viewports)) {
    if (name === 'desktop') continue;
    await page.setViewport(vp);
    await page.goto(BASE + `#/file/${seeded.id}/distress`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1600));
    fr = frame();
    if (fr) {
      await fr.waitForSelector('#screenWork.active', { timeout: 10000 }).catch(() => {});
      await fr.evaluate(() => document.querySelector('.work-head button[title="More"]')?.click());
    }
    await new Promise((r) => setTimeout(r, 300));
    const fit = await page.evaluate(() => {
      const bar = document.querySelector('.app-bar');
      const barBox = bar ? bar.getBoundingClientRect() : null;
      return {
        barBottom: barBox ? barBox.bottom : 0,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      };
    });
    const menuFit = fr
      ? await fr.evaluate(() => {
          const menu = document.getElementById('workMenu');
          const head = document.querySelector('.work-head');
          const mb = menu.getBoundingClientRect();
          const hb = head.getBoundingClientRect();
          const visible = [...menu.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none' && !b.hidden);
          return {
            menuOpen: menu.classList.contains('open'),
            menuRight: mb.right,
            headRight: hb.right,
            menuInside: mb.right <= hb.right + 2 && mb.left >= -1,
            labels: visible.map((b) => (b.textContent || '').trim()),
          };
        })
      : null;
    check(
      `Distress menu fits ${name}`,
      !!(menuFit && menuFit.menuOpen && menuFit.menuInside && fit.scrollW <= fit.innerW + 2),
      JSON.stringify({ fit, menuFit }),
    );
    await page.screenshot({ path: `${OUT}/distress-menu-${name}.png` });
  }

  await page.setViewport(viewports.desktop);
  await page.goto(BASE + `#/file/${seeded.id}/floor`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1800));
  const floorLaunch = await page.evaluate(() => ({
    open: document.body.classList.contains('floor-survey-open'),
    text: (document.body.innerText || '').slice(0, 400),
  }));
  check('Floor Survey host mounts', floorLaunch.open, floorLaunch.text);

  await page.evaluate(() => document.querySelector('[aria-label="More"]')?.click());
  await new Promise((r) => setTimeout(r, 250));
  const floorMenu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || '').trim());
    const menu = document.querySelector('[role="menu"]');
    const box = menu ? menu.getBoundingClientRect() : null;
    return { items, box: box ? { x: box.x, y: box.y, w: box.width, h: box.height, right: box.right } : null, innerW: window.innerWidth };
  });
  const want = ['Review', 'Setup', 'Transitions'];
  check(
    'Floor menu keeps Review, Setup, and Transitions',
    want.every((label) => floorMenu.items.includes(label)) &&
      floorMenu.items.length === want.length &&
      !floorMenu.items.includes('3D') &&
      !floorMenu.items.includes('Export'),
    JSON.stringify(floorMenu.items),
  );
  check(
    'Floor menu stays inside the desktop viewport',
    !!(floorMenu.box && floorMenu.box.x >= 0 && floorMenu.box.right <= floorMenu.innerW + 1),
    JSON.stringify(floorMenu.box),
  );
  await page.screenshot({ path: `${OUT}/floor-menu-desktop.png` });

  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent || '').trim() === 'Setup')?.click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '1. Details'),
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '1. Details')?.click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Save details'),
  );
  const details = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')].map((el) => (el.textContent || '').trim());
    const active = [...document.querySelectorAll('button')].find((b) =>
      (b.className || '').includes('border-primary') && /Details/.test(b.textContent || ''),
    );
    return {
      labels,
      active: (active?.textContent || '').trim(),
      hasDate: !!document.querySelector('input[type="date"]'),
      hasNotes: !!document.querySelector('textarea') && labels.some((l) => l === 'Notes'),
      hasName: labels.some((l) => l === 'Project name'),
      hasAddress: labels.some((l) => l === 'Address') || /Auto-fill address/i.test(document.body.innerText || ''),
      hasClient: labels.some((l) => l === 'Client'),
      hasInspector: labels.some((l) => l === 'Inspector'),
      steps:
        [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '1. Details') &&
        [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '3. Topo boundary'),
    };
  });
  check('Setup still has Details and Topo boundary', details.steps, JSON.stringify(details));
  check('Inspection date stays on Details', details.hasDate);
  check('Survey notes stay on Details', details.hasNotes);
  check('Project name is not asked again', !details.hasName, details.labels.join(' | '));
  check('Address setup is not asked again', !details.hasAddress);
  check('Client and inspector are not asked again', !details.hasClient && !details.hasInspector);
  await page.screenshot({ path: `${OUT}/floor-details-desktop.png` });

  for (const [name, vp] of [['ipad', viewports.ipad], ['phone', viewports.phone]]) {
    await page.setViewport(vp);
    await new Promise((r) => setTimeout(r, 500));
    // A mobile viewport change can reload the shell back onto Topo boundary.
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '1. Details')?.click();
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Save details'),
    );
    const overlap = await page.evaluate(() => {
      const date = document.querySelector('input[type="date"]');
      const notes = document.querySelector('textarea');
      const db = date?.getBoundingClientRect();
      const nb = notes?.getBoundingClientRect();
      return {
        date: db ? { top: db.top, bottom: db.bottom, w: db.width } : null,
        notes: nb ? { top: nb.top, w: nb.width } : null,
        innerW: window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
      };
    });
    const stacked =
      overlap.date &&
      overlap.notes &&
      overlap.notes.top >= overlap.date.bottom - 1 &&
      overlap.date.w <= overlap.innerW &&
      overlap.scrollW <= overlap.innerW + 2;
    check(`Floor Details stacks on ${name}`, !!stacked, JSON.stringify(overlap));
    await page.screenshot({ path: `${OUT}/floor-details-${name}.png` });
    await page.evaluate(() => document.querySelector('[aria-label="More"]')?.click());
    await new Promise((r) => setTimeout(r, 250));
    const menu = await page.evaluate(() => {
      const el = document.querySelector('[role="menu"]');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, innerW: window.innerWidth, items: [...el.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent.trim()) };
    });
    check(
      `Floor menu fits ${name}`,
      !!(
        menu &&
        menu.left >= -1 &&
        menu.right <= menu.innerW + 1 &&
        menu.items.includes('Review') &&
        menu.items.includes('Transitions') &&
        !menu.items.includes('3D') &&
        !menu.items.includes('Export')
      ),
      JSON.stringify(menu),
    );
    await page.screenshot({ path: `${OUT}/floor-menu-${name}.png` });
    await page.evaluate(() => document.querySelector('[aria-label="More"]')?.click());
  }
} finally {
  await browser.close();
  server.kill();
}

fs.writeFileSync(`${OUT}/field-shell-menus.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
