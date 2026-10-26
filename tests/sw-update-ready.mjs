/**
 * GPT-034 / GPT-035 — reliable red Update ready / Refresh.
 *
 * 1) Mocked lifecycle unit checks (deterministic event orderings).
 * 2) Real Chromium A→B shell + phone fit + actual #app-refresh click paths.
 *
 * Run: node tests/sw-update-ready.mjs
 */
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = '/opt/cursor/artifacts';
const SHELL = 'toolbox-shell-v378';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });

// ---------- 1. Mocked ToolboxUpdate lifecycle (deterministic) ----------
{
  const src = await readFile(path.join(ROOT, 'js/sw-register.js'), 'utf8');

  function makeEnv(opts = {}) {
    const autoFireTimeout = opts.autoFireTimeout !== false;
    const listeners = {
      load: [],
      focus: [],
      pageshow: [],
      online: [],
      visibilitychange: [],
      controllerchange: [],
    };
    const docListeners = { visibilitychange: [] };
    let controller = { scriptURL: '/sw.js#A' };
    const installingListeners = new Map();
    const regListeners = { updatefound: [] };
    const timers = [];
    let timerId = 0;

    const reg = {
      installing: null,
      waiting: null,
      active: controller,
      addEventListener(type, fn) {
        if (type === 'updatefound') regListeners.updatefound.push(fn);
      },
      update() {
        return Promise.resolve();
      },
    };

    function fireWorkerState(worker, state) {
      worker.state = state;
      (installingListeners.get(worker) || []).forEach((fn) => fn());
    }

    const fakeNav = {
      serviceWorker: {
        controller,
        register() {
          return Promise.resolve(reg);
        },
        addEventListener(type, fn) {
          if (type === 'controllerchange') listeners.controllerchange.push(fn);
        },
      },
    };

    const fakeWindow = {
      location: { reload() { fakeWindow.__reloads = (fakeWindow.__reloads || 0) + 1; } },
      addEventListener(type, fn) {
        if (listeners[type]) listeners[type].push(fn);
      },
      navigator: fakeNav,
      console,
    };
    const fakeDocument = {
      visibilityState: 'visible',
      addEventListener(type, fn) {
        if (docListeners[type]) docListeners[type].push(fn);
      },
    };

    const runner = new Function(
      'window', 'document', 'navigator', 'setInterval', 'setTimeout', 'clearTimeout',
      src + '\n;return window.ToolboxUpdate;',
    );
    const intervals = [];
    const ToolboxUpdate = runner(
      fakeWindow,
      fakeDocument,
      fakeNav,
      (fn, ms) => { intervals.push({ fn, ms }); return 1; },
      (fn, ms) => {
        const id = ++timerId;
        const entry = { id, fn, ms, cleared: false };
        timers.push(entry);
        if (autoFireTimeout) setTimeout(() => { if (!entry.cleared) fn(); }, 0);
        return id;
      },
      (id) => {
        const entry = timers.find((t) => t.id === id);
        if (entry) entry.cleared = true;
      },
    );

    listeners.load.forEach((fn) => fn());

    return {
      ToolboxUpdate,
      reg,
      listeners,
      docListeners,
      fakeDocument,
      fakeWindow,
      timers,
      fireWorkerState,
      installingListeners,
      regListeners,
      setController(c) {
        controller = c;
        fakeNav.serviceWorker.controller = c;
      },
      watchInstall(worker) {
        installingListeners.set(worker, []);
        const orig = worker.addEventListener;
        worker.addEventListener = function (type, fn) {
          if (type === 'statechange') installingListeners.get(worker).push(fn);
          else if (orig) orig.call(worker, type, fn);
        };
      },
      fireTimer(ms) {
        timers.filter((t) => !t.cleared && t.ms === ms).forEach((t) => {
          t.cleared = true;
          t.fn();
        });
      },
    };
  }

  // Late subscription after readiness
  {
    const env = makeEnv();
    await new Promise((r) => setTimeout(r, 20));
    const worker = { state: 'installing', addEventListener() {} };
    env.watchInstall(worker);
    env.reg.installing = worker;
    env.regListeners.updatefound.forEach((fn) => fn());
    env.fireWorkerState(worker, 'installed');
    let late = 0;
    env.ToolboxUpdate.onAvailable(() => { late += 1; });
    check('late onAvailable receives current readiness', late === 1 && env.ToolboxUpdate.isAvailable());
  }

  // Already waiting when syncing
  {
    const env = makeEnv();
    await new Promise((r) => setTimeout(r, 20));
    env.reg.waiting = { state: 'installed', addEventListener() {} };
    const seen = [];
    env.ToolboxUpdate.onAvailable(() => seen.push('a'));
    await env.ToolboxUpdate.check({ force: true });
    check('already-waiting worker marks available', env.ToolboxUpdate.isAvailable() && seen.length >= 1);
  }

  // Initial install (no controller) must NOT mark available
  {
    const env = makeEnv();
    env.setController(null);
    await new Promise((r) => setTimeout(r, 20));
    const worker = { state: 'installing', addEventListener() {} };
    env.watchInstall(worker);
    env.reg.installing = worker;
    env.regListeners.updatefound.forEach((fn) => fn());
    env.fireWorkerState(worker, 'installed');
    check('initial install without controller is not Update ready', !env.ToolboxUpdate.isAvailable());
  }

  // Sticky after activation (skipWaiting) — waiting cleared, still ready
  {
    const env = makeEnv();
    await new Promise((r) => setTimeout(r, 20));
    const worker = { state: 'installing', addEventListener() {} };
    env.watchInstall(worker);
    env.reg.installing = worker;
    env.regListeners.updatefound.forEach((fn) => fn());
    env.fireWorkerState(worker, 'installed');
    check('installed-with-controller sets ready', env.ToolboxUpdate.isAvailable());
    env.reg.installing = null;
    env.reg.waiting = null;
    env.setController({ scriptURL: '/sw.js#B' });
    env.listeners.controllerchange.forEach((fn) => fn());
    const after = await env.ToolboxUpdate.check({ force: true });
    check('readiness sticky after auto-activation without Refresh', after === true && env.ToolboxUpdate.isAvailable());
    check('auto-activation does not reload without Refresh', (env.fakeWindow.__reloads || 0) === 0);
  }

  // Offline check does not clear readiness
  {
    const env = makeEnv();
    await new Promise((r) => setTimeout(r, 20));
    const worker = { state: 'installing', addEventListener() {} };
    env.watchInstall(worker);
    env.reg.installing = worker;
    env.regListeners.updatefound.forEach((fn) => fn());
    env.fireWorkerState(worker, 'installed');
    env.reg.update = () => Promise.reject(new Error('offline'));
    const still = await env.ToolboxUpdate.check({ force: true });
    check('failed/offline check keeps known readiness', still === true && env.ToolboxUpdate.isAvailable());
  }

  // Foreground visibility triggers check after coalesce window (mocked events)
  {
    const env = makeEnv();
    await new Promise((r) => setTimeout(r, 20));
    let updates = 0;
    const orig = env.reg.update;
    env.reg.update = function () { updates += 1; return Promise.resolve(orig.call(this)); };
    await new Promise((r) => setTimeout(r, 8200));
    const before = updates;
    env.fakeDocument.visibilityState = 'visible';
    env.docListeners.visibilitychange.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 40));
    check('mocked visibilitychange invokes update check after coalesce', updates > before,
      `updates=${updates} before=${before}`);

    const beforeFocus = updates;
    env.listeners.focus.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 40));
    // Within coalesce of the visibility check — must NOT fire another update.
    check('mocked focus coalesces within 8s of visibility check', updates === beforeFocus,
      `updates=${updates} beforeFocus=${beforeFocus}`);
  }

  // GPT-035: stalled registration.update() still arms the 4s reload fallback
  {
    const env = makeEnv({ autoFireTimeout: false });
    await new Promise((r) => setTimeout(r, 20));
    env.reg.update = () => new Promise(() => { /* never settles */ });
    let settled = false;
    const p = env.ToolboxUpdate.refresh().then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    const armed = env.timers.filter((t) => !t.cleared && t.ms === 4000);
    check('stalled update() arms 4000ms fallback before settle', armed.length >= 1,
      `timers=${JSON.stringify(env.timers.map((t) => ({ ms: t.ms, cleared: t.cleared })))}`);
    check('stalled update() has not reloaded before fallback', (env.fakeWindow.__reloads || 0) === 0);
    check('stalled update() refresh promise still pending', settled === false);
    env.fireTimer(4000);
    await new Promise((r) => setTimeout(r, 20));
    check('stalled update() fallback reloads once', (env.fakeWindow.__reloads || 0) === 1);
    void p;
  }
}

// ---------- 2. Real browser A→B shell + GPT-035 click-path / phone fit ----------
{
  const port = 8791;
  let serveB = false;
  const swA = (await readFile(path.join(ROOT, 'sw.js'), 'utf8'))
    .replace(new RegExp(SHELL, 'g'), 'toolbox-shell-v377-testA');
  const swB = (await readFile(path.join(ROOT, 'sw.js'), 'utf8'))
    .replace(new RegExp(SHELL, 'g'), 'toolbox-shell-v378-testB');

  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      if (urlPath === '/sw.js') {
        const body = serveB ? swB : swA;
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-store',
          'Service-Worker-Allowed': '/',
        });
        res.end(body);
        return;
      }
      const filePath = path.join(ROOT, urlPath.replace(/^\//, ''));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404); res.end('missing'); return;
      }
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      const types = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webmanifest': 'application/manifest+json',
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500); res.end(String(err));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  // ---- Phone viewport: A→B discovery + fit ----
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${origin}/index.html#/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!(window.ToolboxUpdate && navigator.serviceWorker?.controller), { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const before = await page.evaluate(async () => {
    const btn = document.getElementById('app-refresh');
    return {
      ready: !!(window.ToolboxUpdate && window.ToolboxUpdate.isAvailable && window.ToolboxUpdate.isAvailable()),
      text: btn ? btn.textContent.trim() : null,
    };
  });
  check('fresh load of shell A is not Update ready', !before.ready && /Refresh/i.test(before.text || ''));

  serveB = true;
  await page.evaluate(async () => {
    if (window.ToolboxUpdate && window.ToolboxUpdate.check) {
      await window.ToolboxUpdate.check({ force: true });
    }
  });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    if (window.ToolboxUpdate) await window.ToolboxUpdate.check({ force: true });
  });
  await page.waitForFunction(
    () => window.ToolboxUpdate && window.ToolboxUpdate.isAvailable && window.ToolboxUpdate.isAvailable(),
    { timeout: 30000 },
  ).catch(() => {});

  const afterB = await page.evaluate(() => {
    const btn = document.getElementById('app-refresh');
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      ready: !!(window.ToolboxUpdate && window.ToolboxUpdate.isAvailable()),
      text: btn ? btn.textContent.trim() : null,
      hasClass: btn ? btn.classList.contains('is-update-ready') : false,
      reloads: window.__reloadCount || 0,
      rect: r ? { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom } : null,
      vw: window.innerWidth,
    };
  });
  check('Update ready after shell B is published',
    afterB.ready && afterB.hasClass && /Update/i.test(afterB.text || ''),
    JSON.stringify({ ready: afterB.ready, text: afterB.text, hasClass: afterB.hasClass }));

  const fit = afterB.rect && afterB.rect.width > 0
    && afterB.rect.left >= 0
    && afterB.rect.right <= afterB.vw + 0.5;
  check('phone Update ready fits viewport without clipping', !!fit,
    JSON.stringify({ rect: afterB.rect, vw: afterB.vw, text: afterB.text }));

  await page.screenshot({ path: `${OUT}/sw-update-ready-phone.png` });

  // Desktop visual
  await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 400));
  // Re-paint for desktop label length
  await page.evaluate(() => {
    if (window.ToolboxUpdate && window.ToolboxUpdate.isAvailable()) {
      const btn = document.getElementById('app-refresh');
      if (btn && !btn.disabled) {
        btn.classList.add('is-update-ready');
        btn.textContent = '↻ Update ready';
      }
    }
  });
  const deskFit = await page.evaluate(() => {
    const btn = document.getElementById('app-refresh');
    const rect = btn.getBoundingClientRect();
    return { left: rect.left, right: rect.right, vw: window.innerWidth, text: btn.textContent.trim() };
  });
  check('desktop Update ready fits viewport',
    deskFit.left >= 0 && deskFit.right <= deskFit.vw + 0.5,
    JSON.stringify(deskFit));
  await page.screenshot({ path: `${OUT}/sw-update-ready-desktop.png` });

  const sticky = await page.evaluate(async () => {
    const readyBefore = window.ToolboxUpdate.isAvailable();
    await window.ToolboxUpdate.check({ force: true });
    return { readyBefore, readyAfter: window.ToolboxUpdate.isAvailable() };
  });
  check('readiness remains while old page still open', sticky.readyBefore && sticky.readyAfter);

  // Refresh while red — one navigation into B; route hash preserved.
  await page.evaluate(() => { window.location.hash = '#/cabinet'; });
  const refreshNav = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 45000 }).catch(() => null);
  await page.click('#app-refresh');
  await refreshNav;
  await new Promise((r) => setTimeout(r, 2000));
  const afterRefresh = await page.evaluate(async () => {
    const btn = document.getElementById('app-refresh');
    const keys = await caches.keys();
    return {
      hash: location.hash,
      ready: !!(window.ToolboxUpdate && window.ToolboxUpdate.isAvailable && window.ToolboxUpdate.isAvailable()),
      text: btn ? btn.textContent.trim() : null,
      keys,
      hasB: keys.some((k) => /v378-testB/.test(k)),
      hasA: keys.some((k) => /v377-testA/.test(k)),
    };
  });
  check('Refresh loads shell B and clears ready on new document',
    /cabinet/i.test(afterRefresh.hash) && !afterRefresh.ready && afterRefresh.hasB,
    JSON.stringify(afterRefresh));

  // GPT-035: Refresh while NOT red — actual click, one reload, no loop.
  {
    const notRed = await page.evaluate(() => {
      const btn = document.getElementById('app-refresh');
      return {
        ready: window.ToolboxUpdate.isAvailable(),
        text: btn.textContent.trim(),
        cls: btn.classList.contains('is-update-ready'),
        disabled: btn.disabled,
      };
    });
    check('current shell does not show stale Update ready', !notRed.ready && !notRed.cls);

    await page.evaluate(() => { window.location.hash = '#/cabinet'; });
    const nav2 = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 45000 }).catch(() => null);
    await page.click('#app-refresh');
    await nav2;
    await new Promise((r) => setTimeout(r, 1500));
    const afterNotRed = await page.evaluate(async () => {
      const btn = document.getElementById('app-refresh');
      const keys = await caches.keys();
      return {
        hash: location.hash,
        ready: window.ToolboxUpdate.isAvailable(),
        text: btn.textContent.trim(),
        updating: /Updating/i.test(btn.textContent || ''),
        hasB: keys.some((k) => /v378-testB/.test(k)),
      };
    });
    check('Refresh while not red still reloads once into current shell',
      /cabinet/i.test(afterNotRed.hash) && !afterNotRed.ready && !afterNotRed.updating && afterNotRed.hasB,
      JSON.stringify(afterNotRed));
  }

  // GPT-035: actual #app-refresh click — rejected flush never calls refresh.
  {
    await page.goto(`${origin}/index.html#/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.ToolboxApp, { timeout: 30000 });
    const rejected = await page.evaluate(async () => {
      let refreshCalls = 0;
      const tu = window.ToolboxUpdate;
      const origRefresh = tu.refresh.bind(tu);
      tu.refresh = function () {
        refreshCalls += 1;
        return Promise.resolve(); // do not unload
      };
      window.ToolboxApp.registerActiveFlush(() => Promise.reject(new Error('save failed')));
      const btn = document.getElementById('app-refresh');
      btn.disabled = false;
      btn.click();
      await new Promise((r) => setTimeout(r, 80));
      const restored = !btn.disabled && !/Updating/i.test(btn.textContent || '');
      const locked = document.documentElement.classList.contains('tb-refresh-locked');
      tu.refresh = origRefresh;
      window.ToolboxApp.registerActiveFlush(null);
      return { refreshCalls, restored, locked, text: btn.textContent.trim() };
    });
    check('actual click: rejected save never calls ToolboxUpdate.refresh',
      rejected.refreshCalls === 0 && rejected.restored && !rejected.locked,
      JSON.stringify(rejected));
  }

  // GPT-035: held save + type-during — latest durable bytes before refresh.
  {
    await page.goto(`${origin}/index.html#/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!(window.ToolboxDB && window.ToolboxApp), { timeout: 30000 });
    await page.evaluate(async () => {
      const rec = window.ToolboxApp.blankCustomerFile('refresh-probe');
      window.ToolboxPlanSetup.ensurePlanSetup(rec);
      rec.firstName = 'Original';
      rec.lastName = 'Probe';
      rec.propertyAddress = '1 Test Lane';
      await window.ToolboxDB.saveCustomerFile(rec);
    });
    await page.goto(`${origin}/index.html#/file/refresh-probe/edit/customer`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#field-firstName', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 800));

    const probe = await page.evaluate(async () => {
      const db = window.ToolboxDB;
      const realSave = db.saveCustomerFile.bind(db);
      const held = [];
      const writes = [];
      db.saveCustomerFile = function (rec) {
        writes.push(rec && rec.firstName);
        return new Promise((resolve, reject) => {
          held.push(() => realSave(rec).then(resolve, reject));
        });
      };

      let refreshCalls = 0;
      let storedAtRefresh = null;
      let visibleAtRefresh = null;
      const tu = window.ToolboxUpdate;
      const origRefresh = tu.refresh.bind(tu);
      tu.refresh = async function () {
        refreshCalls += 1;
        const rec = await db.getCustomerFile('refresh-probe');
        storedAtRefresh = rec && rec.firstName;
        const el = document.getElementById('field-firstName');
        visibleAtRefresh = el ? el.value : null;
        return Promise.resolve();
      };

      const field = document.getElementById('field-firstName');
      field.focus();
      field.value = 'Before click';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      // Let autosave arm, then click Refresh (starts flush → held save).
      await new Promise((r) => setTimeout(r, 1000));
      const btn = document.getElementById('app-refresh');
      btn.click();
      await new Promise((r) => setTimeout(r, 100));

      const locked = document.documentElement.classList.contains('tb-refresh-locked');
      // Attempt mid-refresh typing (must not land while locked).
      field.value = 'Typed while saving';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      const visibleWhileLocked = field.value;

      // Release held saves (drain may issue more than one).
      for (let i = 0; i < 6 && held.length; i += 1) {
        const fn = held.shift();
        if (fn) await fn();
        await new Promise((r) => setTimeout(r, 30));
      }
      await new Promise((r) => setTimeout(r, 200));

      // If drain still pending more holds, release again.
      while (held.length) {
        const fn = held.shift();
        if (fn) await fn();
      }
      await new Promise((r) => setTimeout(r, 200));

      const finalRec = await db.getCustomerFile('refresh-probe');
      tu.refresh = origRefresh;
      db.saveCustomerFile = realSave;

      return {
        refreshCalls,
        storedAtRefresh,
        visibleAtRefresh,
        locked,
        visibleWhileLocked,
        finalStored: finalRec && finalRec.firstName,
        writes,
      };
    });

    // Lock prevents "Typed while saving" from becoming an edit; durable text
    // at refresh must be the pre-click snapshot (or drained latest), never lost.
    const durableOk = probe.refreshCalls === 1
      && probe.locked === true
      && probe.storedAtRefresh === 'Before click'
      && probe.finalStored === 'Before click';
    check('actual click: held save drains before refresh; lock blocks mid-refresh edit',
      durableOk,
      JSON.stringify(probe));
  }

  await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 1 });
  await page.goto(`${origin}/index.html#/`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: `${OUT}/sw-update-ready-desktop-after.png` });

  await browser.close();
  server.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
await writeFile(`${OUT}/sw-update-ready.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
if (passed < results.length) process.exit(1);
