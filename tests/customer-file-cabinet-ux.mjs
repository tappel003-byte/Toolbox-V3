/**
 * Closed File Cabinet / dedicated #/cabinet UX tests (no live Cloudflare).
 * Run: node tests/customer-file-cabinet-ux.mjs
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

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      require('fs').accessSync(c);
      return c;
    } catch (_) {}
  }
  return '/usr/bin/google-chrome';
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

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 400));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxDB && window.ToolboxApp);

  const out = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;

    const state = {
      identity: { email: 'tim@example.com', sub: 'sub-tim' },
      indexes: Object.create(null),
      components: Object.create(null),
      media: Object.create(null),
      etags: Object.create(null),
      fetchLog: [],
    };

    function compKey(id, name) { return id + '::' + name; }
    function normalizeEmail(value) {
      return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }
    function deviceFrom(opts) {
      const headers = (opts && opts.headers) || {};
      return headers['x-toolbox-device-id'] || headers['X-Toolbox-Device-Id'] || '';
    }
    function sameOwner(checkout, email, deviceId) {
      return checkout &&
        normalizeEmail(checkout.email) === normalizeEmail(email) &&
        String(checkout.deviceId || '') === String(deviceId || '');
    }

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const path = href.slice(base.length).replace(/^\//, '');
      const method = (opts && opts.method) || 'GET';
      state.fetchLog.push({ method: method, path: path });

      if (path === 'health' && method === 'GET') {
        return new Response(JSON.stringify({ ok: true, accessConfigured: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (path === 'me' && method === 'GET') {
        return new Response(JSON.stringify(state.identity), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (path === 'files' && method === 'GET') {
        return new Response(JSON.stringify({
          files: Object.values(state.indexes),
          purged: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      let match = /^files\/([^/]+)\/checkout$/.exec(path);
      if (match && method === 'POST') {
        const id = decodeURIComponent(match[1]);
        if (!state.indexes[id]) return new Response('Not found', { status: 404 });
        const body = JSON.parse(opts.body || '{}');
        const deviceId = body.deviceId || deviceFrom(opts);
        const existing = state.indexes[id].checkout || null;
        if (existing && existing.deviceId && existing.email) {
          if (sameOwner(existing, state.identity.email, deviceId)) {
            return new Response(JSON.stringify({
              ok: true, idempotent: true, index: state.indexes[id], checkout: existing,
            }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          return new Response(JSON.stringify({
            ok: false, code: 'checked_out',
            message: 'Customer File is checked out by another user or device',
            checkout: existing,
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        const prevEtag = state.etags[id];
        if (!prevEtag || typeof prevEtag !== 'string') {
          return new Response('Missing object ETag; refusing unsafe checkout acquire', { status: 500 });
        }
        state.etags[id] = 'etag-' + (Number(String(prevEtag).replace(/\D/g, '') || 0) + 1);
        state.indexes[id] = Object.assign({}, state.indexes[id], {
          checkout: {
            email: normalizeEmail(state.identity.email),
            sub: state.identity.sub,
            deviceId: deviceId,
            checkedOutAt: '2026-09-22T20:00:00.000Z',
          },
        });
        return new Response(JSON.stringify({
          ok: true, idempotent: false, index: state.indexes[id], checkout: state.indexes[id].checkout,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      match = /^files\/([^/]+)\/checkout\/release$/.exec(path);
      if (match && method === 'POST') {
        const id = decodeURIComponent(match[1]);
        if (!state.indexes[id]) return new Response('Not found', { status: 404 });
        const next = Object.assign({}, state.indexes[id]);
        delete next.checkout;
        state.indexes[id] = next;
        return new Response(JSON.stringify({ ok: true, released: true, index: next }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)\/index$/.exec(path);
      if (match && method === 'GET') {
        const id = decodeURIComponent(match[1]);
        if (!state.indexes[id]) return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(state.indexes[id]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const name = decodeURIComponent(match[2]);
        const key = compKey(id, name);
        if (method === 'GET') {
          if (!(key in state.components)) return new Response('Not found', { status: 404 });
          return new Response(JSON.stringify(state.components[key]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (method === 'PUT') {
          state.components[key] = JSON.parse(opts.body);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
      }

      match = /^media\/([^/]+)\/exists$/.exec(path);
      if (match && method === 'GET') {
        const mediaId = decodeURIComponent(match[1]);
        return new Response(JSON.stringify({ exists: !!state.media[mediaId] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      match = /^media\/([^/]+)$/.exec(path);
      if (match && method === 'GET') {
        const mediaId = decodeURIComponent(match[1]);
        if (!state.media[mediaId]) return new Response('Not found', { status: 404 });
        return new Response(state.media[mediaId].bytes, {
          status: 200,
          headers: { 'content-type': state.media[mediaId].contentType || 'application/octet-stream' },
        });
      }

      return new Response('Not found', { status: 404 });
    };

    function seedRemote(id, overrides) {
      const customer = Object.assign({
        firstName: 'Cloud',
        lastName: 'Job',
        propertyAddress: '9 Cabinet Rd',
        cellPhone: '', homePhone: '', email: '', notes: '', companyName: '',
        spouseName: '', spouseCellPhone: '', spouseHomePhone: '', spouseEmail: '',
        mailingSameAsProperty: false, mailingAddress: '',
        propertyAddressLat: null, propertyAddressLon: null,
        customerUpdatedAt: '2026-02-01T00:00:00.000Z',
      }, (overrides && overrides.customer) || {});
      const plans = {
        id: 'ps-' + id, updatedAt: '2026-02-01T00:00:00.000Z', buildingType: 'residential',
        activeCanvasId: 'c-' + id,
        canvases: [{
          id: 'c-' + id, name: 'Floor Plan',
          plan: { id: 'plan-' + id, width: 100, height: 80 },
          rooms: [], frontDoorFacing: 'S', frontDoor: null,
        }],
      };
      const distress = {
        id: 'd-' + id, updatedAt: '2026-02-01T00:00:00.000Z',
        pins: [], drawings: [], startNum: 1, nextNum: 1,
      };
      const floor = {
        id: 'f-' + id, updatedAt: '2026-02-01T00:00:00.000Z', schemaVersion: 1,
        byCanvasId: {},
      };
      const trash = { trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH, deletedAt: null, purgeAfter: null };
      state.components[compKey(id, 'customer')] = customer;
      state.components[compKey(id, 'plans')] = plans;
      state.components[compKey(id, 'distress')] = distress;
      state.components[compKey(id, 'floor')] = floor;
      state.components[compKey(id, 'trash')] = trash;
      state.indexes[id] = Object.assign({
        id: id,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        customerUpdatedAt: customer.customerUpdatedAt,
        plansUpdatedAt: plans.updatedAt,
        distressUpdatedAt: distress.updatedAt,
        floorUpdatedAt: floor.updatedAt,
        diagnosticsUpdatedAt: '',
        reportUpdatedAt: '',
        trashUpdatedAt: trash.trashUpdatedAt,
        deletedAt: null,
        purgeAfter: null,
        displayName: ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim() || 'Customer File',
        propertyAddress: customer.propertyAddress || '',
      }, (overrides && overrides.index) || {});
      state.etags[id] = 'etag-1';
      state.media['plan-' + id] = { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' };
    }

    const report = {};
    const prior = await ToolboxDB.getAllCustomerFiles();
    if (prior.length) await ToolboxDB.permanentlyDeleteCustomerFiles(prior);

    seedRemote('cf-alpha', {
      customer: { firstName: 'Alpha', lastName: 'One', propertyAddress: '100 Alpha Ave' },
    });
    seedRemote('cf-beta', {
      customer: { firstName: 'Beta', lastName: 'Two', propertyAddress: '200 Beta Blvd' },
      index: {
        checkout: {
          email: 'lee@example.com', sub: 'sub-lee', deviceId: 'device-lee',
          checkedOutAt: '2026-09-22T19:00:00.000Z',
        },
      },
    });
    seedRemote('cf-gamma', {
      customer: { firstName: 'Gamma', lastName: 'Three', propertyAddress: '300 Gamma Gate' },
    });

    localStorage.setItem('toolboxDeviceId', 'device-ipad');

    // Customer Files home: no cloud inventory, closed File Cabinet entry
    window.location.hash = '#/';
    await new Promise((r) => setTimeout(r, 120));
    report.homeEyebrow = (document.querySelector('.cabinet-hero .eyebrow') || {}).textContent || '';
    report.homeHasOnDevice = !!document.querySelector('.cabinet-section-title') &&
      Array.from(document.querySelectorAll('.cabinet-section-title'))
        .some((el) => /On this device/i.test(el.textContent || ''));
    report.homeNoCloudList = !document.querySelector('#cabinet-cloud-list');
    report.homeClosedEntry = !!document.querySelector('#open-file-cabinet');
    report.homeCta = (document.querySelector('#open-file-cabinet .file-cabinet-entry__cta') || {}).textContent || '';
    report.homeNoCloudRows = !document.querySelector('.cabinet-row--cloud');

    // Navigate to dedicated File Cabinet
    document.querySelector('#open-file-cabinet').click();
    await new Promise((r) => setTimeout(r, 200));
    report.navHash = window.location.hash;
    report.cabinetHeading = !!(document.querySelector('.file-cabinet-head h1') &&
      /File Cabinet/i.test(document.querySelector('.file-cabinet-head h1').textContent || ''));
    report.cabinetBack = !!document.querySelector('#file-cabinet-back');
    report.cabinetSearch = !!document.querySelector('#file-cabinet-search');

    // Browse uses lightweight /files only (no components/media yet)
    const beforeBrowse = state.fetchLog.slice();
    state.fetchLog.length = 0;
    // Force re-browse by re-entering
    window.location.hash = '#/';
    await new Promise((r) => setTimeout(r, 80));
    window.location.hash = '#/cabinet';
    await new Promise((r) => setTimeout(r, 250));
    const browseFetches = state.fetchLog.slice();
    report.browseOnlyFiles = browseFetches.length > 0 &&
      browseFetches.every((f) =>
        f.path === 'files' || f.path === 'me' || f.path === 'health' ||
        /^files\/[^/]+\/checkout$/.test(f.path) === false
      ) &&
      !browseFetches.some((f) => /\/components\//.test(f.path) || /^media\//.test(f.path));
    report.browseHadFilesGet = browseFetches.some((f) => f.path === 'files' && f.method === 'GET');
    void beforeBrowse;

    // Status labels present
    const metas = Array.from(document.querySelectorAll('.cabinet-row--cloud .cabinet-row__meta'))
      .map((el) => el.textContent || '');
    report.statusAvailable = metas.some((t) => /Available to Check Out/i.test(t));
    report.statusElsewhere = metas.some((t) => /Checked out elsewhere/i.test(t));
    report.checkoutButtons = document.querySelectorAll('.cabinet-checkout-btn').length;

    // Name search
    const search = document.querySelector('#file-cabinet-search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    let names = Array.from(document.querySelectorAll('.cabinet-row--cloud .cabinet-row__name'))
      .map((el) => el.textContent || '');
    report.nameSearch = names.length === 1 && /Alpha/i.test(names[0]);

    // Address search
    search.value = 'beta blvd';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    names = Array.from(document.querySelectorAll('.cabinet-row--cloud .cabinet-row__name'))
      .map((el) => el.textContent || '');
    report.addressSearch = names.length === 1 && /Beta/i.test(names[0]);

    // Clear search — still no materialization from typing
    const fetchesBeforeSearch = state.fetchLog.length;
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    report.searchNoExtraNetwork = state.fetchLog.length === fetchesBeforeSearch;
    report.searchNoMaterialize = !state.fetchLog.some((f) =>
      /\/components\//.test(f.path) || /^media\//.test(f.path)
    );

    // Check Out gamma → returns to #/ with notice + local presence
    search.value = 'gamma';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const coBtn = Array.from(document.querySelectorAll('.cabinet-checkout-btn'))
      .find((btn) => /Check Out/i.test(btn.textContent || ''));
    report.foundCheckoutBtn = !!coBtn;
    if (coBtn) coBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    report.afterCheckoutHash = window.location.hash;
    report.afterCheckoutNotice = (document.querySelector('#cabinet-notice') || {}).textContent || '';
    report.afterCheckoutLocal = !!(await ToolboxDB.getCustomerFile('cf-gamma'));
    report.afterCheckoutOnDeviceVisible = Array.from(document.querySelectorAll('.cabinet-row__name'))
      .some((el) => /Gamma/i.test(el.textContent || ''));
    report.materializeHadComponents = state.fetchLog.some((f) => /\/components\//.test(f.path));

    // Selective-local Sync still skips remote-only
    const sync = await ToolboxSync.syncNow();
    report.syncOk = sync && sync.ok === true;
    report.syncSkippedRemote = (sync.remoteOnlySkipped || 0) >= 1;
    report.alphaStillRemote = !(await ToolboxDB.getCustomerFile('cf-alpha'));

    // Trash still reachable from home
    window.location.hash = '#/';
    await new Promise((r) => setTimeout(r, 120));
    document.querySelector('#cabinet-trash').click();
    await new Promise((r) => setTimeout(r, 120));
    report.trashHash = window.location.hash;
    report.trashHeading = !!(document.querySelector('.trash-head h1') &&
      /Trash/i.test(document.querySelector('.trash-head h1').textContent || ''));

    return report;
  });

  check('#/ has On this device', out.homeHasOnDevice, JSON.stringify(out));
  check('#/ eyebrow is Toolbox', /Toolbox/i.test(out.homeEyebrow) && !/file cabinet/i.test(out.homeEyebrow), out.homeEyebrow);
  check('#/ has no cloud inventory list', out.homeNoCloudList && out.homeNoCloudRows, JSON.stringify(out));
  check('#/ has closed File Cabinet entry', out.homeClosedEntry && /Open File Cabinet/i.test(out.homeCta), out.homeCta);
  check('Open File Cabinet navigates to #/cabinet', out.navHash === '#/cabinet' && out.cabinetHeading && out.cabinetBack && out.cabinetSearch, JSON.stringify(out));
  check('#/cabinet browse uses lightweight /files only', out.browseOnlyFiles && out.browseHadFilesGet, JSON.stringify(out));
  check('search causes no component/media materialization', out.searchNoMaterialize && out.searchNoExtraNetwork, JSON.stringify(out));
  check('name search filters Cabinet rows', out.nameSearch, JSON.stringify(out));
  check('address search filters Cabinet rows', out.addressSearch, JSON.stringify(out));
  check('checkout statuses visible', out.statusAvailable && out.statusElsewhere && out.checkoutButtons >= 1, JSON.stringify(out));
  check('Check Out returns to #/ with confirmation', out.afterCheckoutHash === '#/' && /Gamma.*checked out to this device/i.test(out.afterCheckoutNotice), JSON.stringify(out));
  check('Check Out materializes and shows under On this device', out.afterCheckoutLocal && out.afterCheckoutOnDeviceVisible && out.materializeHadComponents, JSON.stringify(out));
  check('selective-local Sync leaves remote-only remote', out.syncOk && out.syncSkippedRemote && out.alphaStillRemote, JSON.stringify(out));
  check('Trash still reachable from Customer Files', out.trashHash === '#/trash' && out.trashHeading, JSON.stringify(out));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
