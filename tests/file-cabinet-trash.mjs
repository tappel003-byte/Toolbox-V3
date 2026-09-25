/**
 * File Cabinet Trash: recoverable delete, restore, checkout refusal, Empty Trash.
 * Uses a page-local mock cabinet. No production data.
 * Run: node tests/file-cabinet-trash.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';

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
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate);
      return candidate;
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
await new Promise((resolve) => setTimeout(resolve, 400));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxDB && window.ToolboxApp);

  const out = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    localStorage.setItem('toolboxDeviceId', 'device-ipad');

    const state = {
      identity: { email: 'tim@example.com', sub: 'sub-tim' },
      indexes: Object.create(null),
      components: Object.create(null),
      media: Object.create(null),
      purged: Object.create(null),
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
    function hasLease(index) {
      return !!(index && index.checkout && index.checkout.deviceId && index.checkout.email);
    }

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const path = href.slice(base.length).replace(/^\//, '');
      const method = (opts && opts.method) || 'GET';
      state.fetchLog.push({ method: method, path: path, body: opts && opts.body });
      if (state.failNetwork) throw new Error('offline');

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
      if (path === 'explore/files' || path.indexOf('explore/files/') === 0) {
        return new Response('Not found', { status: 404 });
      }
      if (path === 'files' && method === 'GET') {
        return new Response(JSON.stringify({
          files: Object.values(state.indexes),
          purged: Object.values(state.purged),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      let match = /^files\/([^/]+)$/.exec(path);
      if (match && method === 'DELETE') {
        const id = decodeURIComponent(match[1]);
        const index = state.indexes[id];
        if (hasLease(index)) {
          return new Response('Customer File is checked out. Check it in before permanently deleting it.', { status: 403 });
        }
        const plans = state.components[compKey(id, 'plans')];
        const distress = state.components[compKey(id, 'distress')];
        const mediaIds = [];
        ((plans && plans.canvases) || []).forEach(function (canvas) {
          if (canvas && canvas.plan && canvas.plan.id) mediaIds.push(canvas.plan.id);
        });
        ((distress && distress.pins) || []).forEach(function (pin) {
          (pin && pin.photos || []).forEach(function (id) {
            if (typeof id === 'string' && id.indexOf('ph_') === 0) mediaIds.push(id);
          });
        });
        ((distress && distress.quickCapture) || []).forEach(function (item) {
          if (item && typeof item.id === 'string' && item.id.indexOf('ph_') === 0) mediaIds.push(item.id);
        });
        const floor = state.components[compKey(id, 'floor')];
        const layers = floor && floor.byCanvasId ? floor.byCanvasId : {};
        Object.keys(layers).forEach(function (key) {
          const mediaId = layers[key] && layers[key].recoveryPdfMediaId;
          if (typeof mediaId === 'string' && mediaId.indexOf('fsrec_') === 0 &&
              mediaId.indexOf('/') === -1 && mediaId.indexOf('..') === -1) {
            mediaIds.push(mediaId);
          }
        });
        const diagnostics = state.components[compKey(id, 'diagnostics')];
        ((diagnostics && diagnostics.figures) || []).forEach(function (fig) {
          const mediaId = fig && fig.mediaId;
          if (typeof mediaId === 'string' && mediaId.indexOf('dxfig_') === 0 &&
              mediaId.indexOf('/') === -1 && mediaId.indexOf('\\') === -1 && mediaId.indexOf('..') === -1) {
            mediaIds.push(mediaId);
          }
        });
        state.purged[id] = {
          id: id,
          purgedAt: '2026-09-23T00:00:00.000Z',
          reason: 'permanent-delete',
          mediaIds: mediaIds,
        };
        mediaIds.forEach(function (mediaId) { delete state.media[mediaId]; });
        delete state.indexes[id];
        Object.keys(state.components).forEach(function (key) {
          if (key.indexOf(id + '::') === 0) delete state.components[key];
        });
        return new Response(JSON.stringify({ ok: true, deleted: id, purged: state.purged[id] }), {
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
      if (match && method === 'PUT') {
        const id = decodeURIComponent(match[1]);
        const body = JSON.parse(opts.body);
        if (hasLease(state.indexes[id])) {
          const deviceId = deviceFrom(opts);
          const checkout = state.indexes[id].checkout;
          if (normalizeEmail(checkout.email) !== normalizeEmail(state.identity.email) ||
              checkout.deviceId !== deviceId) {
            return new Response('Customer File is checked out by another user or device', { status: 403 });
          }
          body.checkout = checkout;
        } else {
          delete body.checkout;
        }
        state.indexes[id] = body;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
      if (match && method === 'GET') {
        const key = compKey(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
        if (!(key in state.components)) return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(state.components[key]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (match && method === 'PUT') {
        const id = decodeURIComponent(match[1]);
        const name = decodeURIComponent(match[2]);
        if (hasLease(state.indexes[id])) {
          const deviceId = deviceFrom(opts);
          const checkout = state.indexes[id].checkout;
          if (normalizeEmail(checkout.email) !== normalizeEmail(state.identity.email) ||
              checkout.deviceId !== deviceId) {
            return new Response('Customer File is checked out by another user or device', { status: 403 });
          }
        }
        state.components[compKey(id, name)] = JSON.parse(opts.body);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^media\/([^/]+)\/exists$/.exec(path);
      if (match && method === 'GET') {
        const mediaId = decodeURIComponent(match[1]);
        return new Response(JSON.stringify({ exists: !!state.media[mediaId] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      match = /^media\/([^/]+)$/.exec(path);
      if (match && method === 'PUT') {
        state.media[decodeURIComponent(match[1])] = 'uploaded';
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (match && method === 'GET') {
        const mediaId = decodeURIComponent(match[1]);
        if (!state.media[mediaId]) return new Response('Not found', { status: 404 });
        return new Response(state.media[mediaId], {
          status: 200, headers: { 'content-type': 'text/plain' },
        });
      }

      match = /^files\/([^/]+)\/checkout\/release$/.exec(path);
      if (match && method === 'POST') {
        const id = decodeURIComponent(match[1]);
        const index = state.indexes[id];
        if (!hasLease(index)) {
          return new Response(JSON.stringify({ message: 'No checkout' }), {
            status: 409, headers: { 'content-type': 'application/json' },
          });
        }
        const deviceId = deviceFrom(opts);
        if (normalizeEmail(index.checkout.email) !== normalizeEmail(state.identity.email) ||
            index.checkout.deviceId !== deviceId) {
          return new Response('Only the checkout owner can release this lease', { status: 403 });
        }
        delete index.checkout;
        return new Response(JSON.stringify({ ok: true, index: index }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    };

    function seed(id, overrides) {
      const customer = Object.assign({
        firstName: 'Cloud',
        lastName: 'Job',
        propertyAddress: '9 Cabinet Rd',
        customerUpdatedAt: '2026-02-01T00:00:00.000Z',
      }, (overrides && overrides.customer) || {});
      const plans = {
        id: 'ps-' + id,
        updatedAt: '2026-02-01T00:00:00.000Z',
        canvases: [{ id: 'c-' + id, name: 'Floor Plan', plan: { id: 'plan-' + id, width: 40, height: 40 } }],
      };
      const distress = {
        id: 'd-' + id,
        updatedAt: '2026-02-01T00:00:00.000Z',
        pins: [{ id: 'pin-' + id, photos: ['ph_' + id] }],
      };
      const trash = Object.assign({
        trashUpdatedAt: '2026-02-01T00:00:00.000Z',
        deletedAt: null,
        purgeAfter: null,
      }, (overrides && overrides.trash) || {});
      state.components[compKey(id, 'customer')] = customer;
      state.components[compKey(id, 'plans')] = plans;
      state.components[compKey(id, 'distress')] = distress;
      state.components[compKey(id, 'trash')] = trash;
      state.media['plan-' + id] = 'plan';
      state.media['ph_' + id] = 'photo';
      state.indexes[id] = Object.assign({
        id: id,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        customerUpdatedAt: customer.customerUpdatedAt,
        plansUpdatedAt: plans.updatedAt,
        distressUpdatedAt: distress.updatedAt,
        floorUpdatedAt: '',
        diagnosticsUpdatedAt: '',
        reportUpdatedAt: '',
        trashUpdatedAt: trash.trashUpdatedAt,
        deletedAt: trash.deletedAt,
        purgeAfter: trash.purgeAfter,
        displayName: ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim(),
        propertyAddress: customer.propertyAddress || '',
      }, (overrides && overrides.index) || {});
    }

    const prior = await ToolboxDB.getAllCustomerFiles();
    if (prior.length) await ToolboxDB.removeLocalWorkingCopy(prior);

    const soon = new Date(Date.now() + 10 * 86400000).toISOString();
    const deletedAt = new Date().toISOString();
    seed('cf-active', { customer: { firstName: 'Ada', lastName: 'Active', propertyAddress: '1 Active Way' } });
    seed('cf-trashed', {
      customer: { firstName: 'Bea', lastName: 'Trashed', propertyAddress: '2 Trash Lane' },
      trash: { trashUpdatedAt: deletedAt, deletedAt: deletedAt, purgeAfter: soon },
    });
    state.components[compKey('cf-trashed', 'floor')] = {
      byCanvasId: {
        'c-cf-trashed': { recoveryPdfMediaId: 'fsrec_c-cf-trashed' },
        bad: { recoveryPdfMediaId: '../no-pdf' },
      },
    };
    state.media['fsrec_c-cf-trashed'] = 'pdf';
    state.components[compKey('cf-trashed', 'diagnostics')] = {
      figures: [
        { id: 'dxf_bea', mediaId: 'dxfig_c-cf-trashed' },
        { id: 'dxf_bad', mediaId: 'dxfig_../no' },
      ],
    };
    state.components[compKey('cf-trashed', 'report')] = { updatedAt: '2026-02-01T00:00:00.000Z' };
    state.media['dxfig_c-cf-trashed'] = 'figure';
    seed('cf-leased', {
      customer: { firstName: 'Cy', lastName: 'Leased', propertyAddress: '3 Lease Road' },
      index: {
        checkout: {
          email: 'lee@example.com',
          deviceId: 'device-lee',
          checkedOutAt: '2026-09-22T00:00:00.000Z',
        },
      },
    });
    seed('cf-leased-trash', {
      customer: { firstName: 'Dee', lastName: 'Held', propertyAddress: '4 Held Court' },
      trash: { trashUpdatedAt: deletedAt, deletedAt: deletedAt, purgeAfter: soon },
      index: {
        checkout: {
          email: 'lee@example.com',
          deviceId: 'device-lee',
          checkedOutAt: '2026-09-22T00:00:00.000Z',
        },
      },
    });
    seed('cf-mine', {
      customer: { firstName: 'Eve', lastName: 'Mine', propertyAddress: '5 Mine Street' },
      index: {
        checkout: {
          email: 'tim@example.com',
          deviceId: 'device-ipad',
          checkedOutAt: '2026-09-22T00:00:00.000Z',
        },
      },
    });
    const oldAt = new Date(Date.now() - 130 * 86400000).toISOString();
    seed('cf-old', {
      customer: { firstName: 'Old', lastName: 'File', propertyAddress: '8 Old Road' },
      trash: {
        trashUpdatedAt: oldAt,
        deletedAt: oldAt,
        purgeAfter: new Date(Date.now() - 86400000).toISOString(),
      },
    });
    seed('cf-held', {
      customer: { firstName: 'Held', lastName: 'Copy', propertyAddress: '6 Held Way' },
      index: {
        checkout: {
          email: 'tim@example.com',
          deviceId: 'device-ipad',
          checkedOutAt: '2026-09-22T00:00:00.000Z',
        },
      },
    });

    const report = {};
    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 80));
    report.homeTrashButton = !!document.querySelector('#cabinet-trash');
    report.homeTrashCount = !!document.querySelector('#cabinet-trash-count');

    const localDraft = ToolboxApp.blankCustomerFile('local-draft');
    localDraft.firstName = 'Local';
    localDraft.lastName = 'Draft';
    localDraft.deletedAt = deletedAt;
    localDraft.purgeAfter = soon;
    localDraft.trashUpdatedAt = deletedAt;
    await ToolboxDB.saveCustomerFile(localDraft);
    window.location.hash = '#/trash';
    await new Promise((resolve) => setTimeout(resolve, 40));
    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 250));
    const link = document.querySelector('#local-trash-recovery');
    report.quietLink = link && !link.hidden ? link.textContent.trim() : '';
    report.quietHasDigit = /\d/.test(report.quietLink);

    window.location.hash = '#/cabinet';
    await new Promise((resolve) => setTimeout(resolve, 300));
    report.cabinetTrashLabel = (document.querySelector('#file-cabinet-trash') || {}).textContent || '';
    report.cabinetTrashLabel = report.cabinetTrashLabel.trim();
    report.activeNames = Array.from(document.querySelectorAll('.cabinet-index__owner')).map(function (node) {
      return node.textContent;
    });
    report.cleanupVisible = !!(document.querySelector('#file-cabinet-cleanup') &&
      !document.querySelector('#file-cabinet-cleanup').hidden);
    const oldBeforeTimer = !!state.indexes['cf-old'];
    await ToolboxDB.purgeExpiredCustomerFiles();
    report.oldSurvivedTimer = oldBeforeTimer && !!state.indexes['cf-old'] && !!state.indexes['cf-old'].deletedAt &&
      !!state.media['plan-cf-old'] && !!state.media['ph_cf-old'];
    report.deleteButtons = Array.from(document.querySelectorAll('.cabinet-delete-btn')).map(function (button) {
      const row = button.closest('.cabinet-row-shell');
      return row ? row.dataset.customerFileId : '';
    });
    report.overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

    state.fetchLog.length = 0;
    let ownError = null;
    try { await ToolboxSync.trashCabinetCustomerFile('cf-mine'); } catch (err) { ownError = err; }
    let foreignError = null;
    try { await ToolboxSync.trashCabinetCustomerFile('cf-leased'); } catch (err) { foreignError = err; }
    report.ownCheckoutRefused = !!(ownError && ownError.code === 'checkout');
    report.foreignCheckoutRefused = !!(foreignError && foreignError.code === 'checkout');
    report.checkoutWrote = state.fetchLog.some(function (entry) {
      return entry.method === 'PUT' || entry.method === 'DELETE';
    });

    state.fetchLog.length = 0;
    const trashed = await ToolboxSync.trashCabinetCustomerFile('cf-active');
    report.cloudTrashDeletedAt = state.indexes['cf-active'].deletedAt;
    report.cloudTrashPurge = state.indexes['cf-active'].purgeAfter;
    report.cloudTrashComponent = state.components[compKey('cf-active', 'trash')];
    report.cloudTrashLocal = await ToolboxDB.getCustomerFile('cf-active');
    report.cloudTrashNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });
    report.cloudTrashNoCheckout = !state.fetchLog.some(function (entry) { return /checkout/.test(entry.path); });
    const trashPut = state.fetchLog.findIndex(function (entry) {
      return entry.method === 'PUT' && entry.path === 'files/cf-active/components/trash';
    });
    const indexPut = state.fetchLog.findIndex(function (entry) {
      return entry.method === 'PUT' && entry.path === 'files/cf-active/index';
    });
    report.componentBeforeIndex = trashPut !== -1 && indexPut > trashPut;
    report.retentionDays = Math.round((Date.parse(report.cloudTrashPurge) - Date.parse(report.cloudTrashDeletedAt)) / 86400000);
    report.trashResultLocal = trashed && trashed.local === false;

    state.fetchLog.length = 0;
    await ToolboxSync.restoreCabinetCustomerFile('cf-active');
    report.restoredDeletedAt = state.indexes['cf-active'].deletedAt;
    report.restoredComponent = state.components[compKey('cf-active', 'trash')];
    report.restoreLocal = await ToolboxDB.getCustomerFile('cf-active');
    report.restoreNoCheckout = !state.fetchLog.some(function (entry) { return /checkout/.test(entry.path); });
    report.restoreNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });

    const draftDuringMove = await ToolboxDB.getCustomerFile('local-draft');
    if (draftDuringMove) await ToolboxDB.removeLocalWorkingCopy([draftDuringMove]);

    const held = ToolboxApp.blankCustomerFile('cf-held');
    ToolboxPlanSetup.ensurePlanSetup(held);
    held.checkedOutFromCabinet = true;
    held.firstName = 'Held';
    held.lastName = 'Copy';
    held.propertyAddress = '6 Held Way';
    held.customerUpdatedAt = '2026-02-01T00:00:00.000Z';
    held.planSetup.updatedAt = '2026-02-01T00:00:00.000Z';
    held.planSetup.canvases[0].plan = { id: 'plan-cf-held', width: 40, height: 40 };
    held.distress.updatedAt = '2026-09-24T12:00:00.000Z';
    held.distress.pins = [{ id: 'pin-cf-held', num: 1, photos: ['ph_cf-held'] }];
    held.distress.quickCapture = [{ id: 'ph_quick_held' }];
    held.floorSurvey.updatedAt = '2026-09-24T12:00:00.000Z';
    held.floorSurvey.inspectionDate = '2026-09-01';
    const heldCanvasId = held.planSetup.canvases[0].id;
    const heldPdfId = 'fsrec_' + heldCanvasId;
    const heldFigureId = 'dxfig_cf-held';
    held.floorSurvey.byCanvasId = held.floorSurvey.byCanvasId || {};
    held.floorSurvey.byCanvasId[heldCanvasId] = { points: [], recoveryPdfMediaId: heldPdfId };
    held.floorSurvey.byCanvasId.bad = { points: [], recoveryPdfMediaId: '../no-pdf' };
    held.diagnostics = {
      schemaVersion: 1,
      updatedAt: '2026-09-24T12:00:00.000Z',
      figures: [
        { id: 'dxf_held', mediaId: heldFigureId, canvasName: 'Floor Plan' },
        { id: 'dxf_bad', mediaId: 'dxfig_../no' },
      ],
    };
    held.diagnosticsUpdatedAt = '2026-09-24T12:00:00.000Z';
    held.report = { updatedAt: '2026-09-24T12:00:00.000Z', title: 'Held report' };
    held.reportUpdatedAt = '2026-09-24T12:00:00.000Z';
    state.media['ph_quick_held'] = 'quick';
    await ToolboxDB.putMedia('plan-cf-held', 'data:image/png;base64,cGxhbg==');
    await ToolboxDB.putMedia(heldPdfId, 'data:application/pdf;base64,JVBERi0=');
    await ToolboxDB.putMedia(heldFigureId, 'data:image/png;base64,ZmlndXJl');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('photos')) request.result.createObjectStore('photos');
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put('data:image/jpeg;base64,cGhvdG8=', 'ph_cf-held');
        tx.objectStore('photos').put('data:image/jpeg;base64,cXVpY2s=', 'ph_quick_held');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    await ToolboxDB.saveCustomerFile(held);
    state.failNetwork = true;
    state.fetchLog.length = 0;
    let offlineError = null;
    try { await ToolboxSync.moveCheckedOutFileToCabinetTrash('cf-held'); } catch (err) { offlineError = err; }
    const heldAfterFail = await ToolboxDB.getCustomerFile('cf-held');
    report.offlineKept = !!(offlineError && heldAfterFail && heldAfterFail.cabinetTrashRequestedAt);
    report.offlinePlanKept = !!(await ToolboxDB.getMedia('plan-cf-held'));
    report.offlinePdfKept = !!(await ToolboxDB.getMedia(heldPdfId));
    report.offlineFigureKept = !!(await ToolboxDB.getMedia(heldFigureId));
    report.offlineNotTrashed = !state.indexes['cf-held'].deletedAt;
    report.offlineNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });
    state.failNetwork = false;
    state.fetchLog.length = 0;
    const finished = await ToolboxSync.syncNow();
    const heldRemote = state.indexes['cf-held'];
    const heldDistress = state.components[compKey('cf-held', 'distress')];
    const heldFloor = state.components[compKey('cf-held', 'floor')];
    const heldDiagnostics = state.components[compKey('cf-held', 'diagnostics')];
    const heldReport = state.components[compKey('cf-held', 'report')];
    report.heldSyncOk = !!(finished && finished.ok);
    report.heldLocalGone = !(await ToolboxDB.getCustomerFile('cf-held'));
    report.heldTrashed = !!(heldRemote && heldRemote.deletedAt && !heldRemote.checkout);
    report.heldMediaKept = state.media['plan-cf-held'] && state.media['ph_cf-held'] === 'photo' && state.media['ph_quick_held'];
    report.heldQuickKept = !!(heldDistress && heldDistress.quickCapture && heldDistress.quickCapture[0].id === 'ph_quick_held' &&
      heldDistress.pins && heldDistress.pins[0].photos[0] === 'ph_cf-held');
    report.heldFloorKept = !!(heldFloor && heldFloor.inspectionDate === '2026-09-01' &&
      heldFloor.byCanvasId[heldCanvasId].recoveryPdfMediaId === heldPdfId);
    report.heldPdfKept = state.media[heldPdfId] === 'uploaded' && !state.media['../no-pdf'];
    report.heldPdfLocalGone = !(await ToolboxDB.getMedia(heldPdfId));
    report.heldFigureKept = state.media[heldFigureId] === 'uploaded' && !state.media['dxfig_../no'] &&
      !!(heldDiagnostics && heldDiagnostics.figures && heldDiagnostics.figures[0].mediaId === heldFigureId) &&
      !!(heldReport && heldReport.title === 'Held report');
    report.heldFigureLocalGone = !(await ToolboxDB.getMedia(heldFigureId));
    report.heldNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });
    state.fetchLog.length = 0;
    await ToolboxSync.restoreCabinetCustomerFile('cf-held');
    report.heldRestored = !state.indexes['cf-held'].deletedAt &&
      state.components[compKey('cf-held', 'distress')].quickCapture[0].id === 'ph_quick_held' &&
      !!state.media['ph_quick_held'] && !!state.media['plan-cf-held'];
    report.heldRestoreNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });

    await ToolboxSync.trashCabinetCustomerFile('cf-active');

    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 40));
    window.location.hash = '#/cabinet';
    await new Promise((resolve) => setTimeout(resolve, 250));
    report.namesAfterTrash = Array.from(document.querySelectorAll('.cabinet-index__owner')).map(function (node) {
      return node.textContent;
    });
    document.querySelector('#file-cabinet-trash').click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    report.trashHash = window.location.hash;
    report.trashNames = Array.from(document.querySelectorAll('.trash-row strong')).map(function (node) {
      return node.textContent;
    });
    report.countdown = Array.from(document.querySelectorAll('.trash-row small')).map(function (node) {
      return node.textContent;
    });
    report.emptyLabel = (document.querySelector('#trash-empty') || {}).textContent || '';

    const restoreRow = Array.from(document.querySelectorAll('.trash-row')).find(function (row) {
      return /Ada Active/.test(row.textContent || '');
    });
    state.fetchLog.length = 0;
    restoreRow.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    report.uiRestoreDeletedAt = state.indexes['cf-active'].deletedAt;
    report.uiRestoreNoCheckout = !state.fetchLog.some(function (entry) { return /checkout/.test(entry.path); });
    report.uiRestoreNoLocal = !(await ToolboxDB.getCustomerFile('cf-active'));

    const beaRow = Array.from(document.querySelectorAll('.trash-row')).find(function (row) {
      return /Bea Trashed/.test(row.textContent || '');
    });
    state.fetchLog.length = 0;
    beaRow.querySelector('.btn--danger').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const permanentYes = document.querySelector('#confirm-yes');
    report.permanentEnabled = !!(permanentYes && !permanentYes.disabled && /Delete permanently/i.test(permanentYes.textContent || ''));
    report.permanentNoPhrase = !document.querySelector('#confirm-phrase-input') ||
      document.querySelector('#confirm-phrase').hidden;
    document.querySelector('#confirm-no').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    report.permanentCancelKept = !!state.indexes['cf-trashed'];
    beaRow.querySelector('.btn--danger').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    state.fetchLog.length = 0;
    document.querySelector('#confirm-yes').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    report.permanentDeleted = !state.indexes['cf-trashed'] && !!state.purged['cf-trashed'];
    report.permanentMediaGone = !state.media['plan-cf-trashed'] && !state.media['ph_cf-trashed'] &&
      !state.media['fsrec_c-cf-trashed'] && !state.media['dxfig_c-cf-trashed'] &&
      !state.components[compKey('cf-trashed', 'diagnostics')] &&
      !state.components[compKey('cf-trashed', 'report')];
    report.permanentBefore120 = Date.parse(soon) > Date.now();
    report.permanentOnlyBea = state.fetchLog.filter(function (entry) { return entry.method === 'DELETE'; })
      .map(function (entry) { return entry.path; }).join(',') === 'files/cf-trashed';
    report.oldStillThere = !!state.indexes['cf-old'] && !!state.indexes['cf-old'].deletedAt;

    state.fetchLog.length = 0;
    document.querySelector('#trash-empty').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const yes = document.querySelector('#confirm-yes');
    report.emptyEnabled = !!(yes && !yes.disabled);
    report.emptyNoPhrase = !document.querySelector('#confirm-phrase') || document.querySelector('#confirm-phrase').hidden;
    document.querySelector('#confirm-no').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    report.cancelKeptOld = !!state.indexes['cf-old'];
    report.cancelNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });

    document.querySelector('#trash-empty').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    state.fetchLog.length = 0;
    document.querySelector('#confirm-yes').click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const deletePaths = state.fetchLog.filter(function (entry) { return entry.method === 'DELETE'; }).map(function (entry) {
      return entry.path;
    });
    report.deletePaths = deletePaths;
    report.activeSurvives = !!state.indexes['cf-active'] && !state.indexes['cf-active'].deletedAt;
    report.oldPurged = !!state.purged['cf-old'] && !state.indexes['cf-old'];
    report.leasedTrashSurvives = !!state.indexes['cf-leased-trash'] && !!state.indexes['cf-leased-trash'].deletedAt;
    report.leasedMediaKept = state.media['plan-cf-leased-trash'] === 'plan' && state.media['ph_cf-leased-trash'] === 'photo';
    report.oldMediaGone = !state.media['plan-cf-old'] && !state.media['ph_cf-old'];
    report.otherMediaKept = state.media['plan-cf-active'] === 'plan' && state.media['plan-cf-held'];
    const localDraftAgain = ToolboxApp.blankCustomerFile('local-draft');
    localDraftAgain.firstName = 'Local';
    localDraftAgain.lastName = 'Draft';
    localDraftAgain.deletedAt = deletedAt;
    localDraftAgain.purgeAfter = soon;
    localDraftAgain.trashUpdatedAt = deletedAt;
    await ToolboxDB.saveCustomerFile(localDraftAgain);
    report.localDraftKept = !!(await ToolboxDB.getCustomerFile('local-draft'));
    report.checkInWouldNotDelete = deletePaths.length === 1 && deletePaths[0] === 'files/cf-old';

    const sendLogStart = state.fetchLog.length;
    let sendError = null;
    try { await ToolboxSync.sendToFileCabinet('local-draft'); } catch (err) { sendError = err && err.message; }
    let checkInError = null;
    try { await ToolboxSync.checkInCustomerFile('local-draft'); } catch (err) { checkInError = err && err.message; }
    const laterDeletes = state.fetchLog.slice(sendLogStart).filter(function (entry) { return entry.method === 'DELETE'; });
    report.sendCheckInNoDelete = laterDeletes.length === 0 && !!sendError && !!checkInError;
    report.draftStillLocal = !!(await ToolboxDB.getCustomerFile('local-draft'));

    const working = ToolboxApp.blankCustomerFile('cf-active');
    ToolboxPlanSetup.ensurePlanSetup(working);
    working.firstName = 'Ada';
    working.lastName = 'Active';
    delete working.deletedAt;
    delete working.purgeAfter;
    await ToolboxDB.saveCustomerFile(working);
    state.fetchLog.length = 0;
    let workingError = null;
    try { await ToolboxSync.trashCabinetCustomerFile('cf-active'); } catch (err) { workingError = err; }
    report.workingCopyRefused = !!(workingError && /still on this device/i.test(workingError.message || ''));
    report.workingCopyNoWrite = !state.fetchLog.some(function (entry) {
      return entry.method === 'PUT' || entry.method === 'DELETE';
    });
    report.workingCopyKept = !!(await ToolboxDB.getCustomerFile('cf-active'));

    const mirror = ToolboxApp.blankCustomerFile('cf-mirror');
    mirror.firstName = 'Sip';
    mirror.lastName = 'Mirror';
    mirror.propertyAddress = '9 Mirror Lane';
    delete mirror.checkedOutFromCabinet;
    const offlineMirror = ToolboxApp.blankCustomerFile('cf-offline-mirror');
    offlineMirror.firstName = 'Off';
    offlineMirror.lastName = 'Mirror';
    offlineMirror.propertyAddress = '10 Offline Way';
    delete offlineMirror.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(mirror);
    await ToolboxDB.saveCustomerFile(offlineMirror);
    state.indexes['cf-foreign'] = {
      id: 'cf-foreign',
      displayName: 'Foreign Mirror',
      propertyAddress: '11 Lease Road',
      deletedAt: null,
      checkout: {
        email: 'lee@example.com',
        deviceId: 'device-lee',
        checkedOutAt: '2026-09-01T00:00:00.000Z',
      },
    };
    const foreign = ToolboxApp.blankCustomerFile('cf-foreign');
    foreign.firstName = 'Foreign';
    foreign.lastName = 'Mirror';
    foreign.propertyAddress = '11 Lease Road';
    foreign.cabinetMirroredAt = '2026-09-25T00:00:00.000Z';
    delete foreign.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(foreign);

    let mirrorSyncError = null;
    try { await ToolboxSync.syncNow(); } catch (err) { mirrorSyncError = err && err.message; }
    const mirrorAfterSync = await ToolboxDB.getCustomerFile('cf-mirror');
    const offlineAfterSync = await ToolboxDB.getCustomerFile('cf-offline-mirror');
    report.mirrorSynced = !!(state.indexes['cf-mirror'] && !state.indexes['cf-mirror'].deletedAt);
    report.mirrorNoCheckout = !!(mirrorAfterSync && mirrorAfterSync.checkedOutFromCabinet !== true &&
      offlineAfterSync && offlineAfterSync.checkedOutFromCabinet !== true);
    report.mirrorMarked = !!(mirrorAfterSync && mirrorAfterSync.cabinetMirroredAt &&
      offlineAfterSync && offlineAfterSync.cabinetMirroredAt);
    report.mirrorSyncError = mirrorSyncError;

    state.failNetwork = true;
    const offlineDecision = await ToolboxSync.resolveWorkingFileDelete('cf-offline-mirror');
    report.offlineMirrorDecision = offlineDecision && offlineDecision.action;
    let offlineMirrorError = null;
    try { await ToolboxSync.moveWorkingFileToCabinetTrash('cf-offline-mirror'); } catch (err) { offlineMirrorError = err; }
    const offlineMirrorLocal = await ToolboxDB.getCustomerFile('cf-offline-mirror');
    report.offlineMirrorKept = !!(offlineMirrorError && offlineMirrorLocal && offlineMirrorLocal.cabinetTrashRequestedAt);
    report.offlineMirrorRemoteLive = !!(state.indexes['cf-offline-mirror'] && !state.indexes['cf-offline-mirror'].deletedAt);
    state.failNetwork = false;
    try { await ToolboxSync.syncNow(); } catch (_) {}
    report.offlineMirrorFinished = !state.indexes['cf-offline-mirror'] || !!state.indexes['cf-offline-mirror'].deletedAt;
    report.offlineMirrorLocalGone = !(await ToolboxDB.getCustomerFile('cf-offline-mirror'));

    const never = ToolboxApp.blankCustomerFile('cf-never');
    never.firstName = 'Never';
    never.lastName = 'Uploaded';
    delete never.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(never);
    state.failNetwork = true;
    const neverDecision = await ToolboxSync.resolveWorkingFileDelete('cf-never');
    report.neverDecision = neverDecision && neverDecision.action;
    state.failNetwork = false;
    report.neverNoRemote = !state.indexes['cf-never'];
    if (report.neverDecision === 'local-only') await ToolboxDB.permanentlyDeleteCustomerFiles([never]);
    report.neverLocalGone = !(await ToolboxDB.getCustomerFile('cf-never'));

    const foreignDecision = await ToolboxSync.resolveWorkingFileDelete('cf-foreign');
    let foreignMirrorError = null;
    try { await ToolboxSync.moveWorkingFileToCabinetTrash('cf-foreign'); } catch (err) { foreignMirrorError = err; }
    const foreignLocal = await ToolboxDB.getCustomerFile('cf-foreign');
    report.foreignRefused = foreignDecision && foreignDecision.action === 'foreign-checkout' &&
      foreignMirrorError && foreignMirrorError.code === 'checkout' &&
      !!(foreignLocal && !foreignLocal.cabinetTrashRequestedAt) &&
      !state.indexes['cf-foreign'].deletedAt;

    report.mirrorLocalBefore = !!(await ToolboxDB.getCustomerFile('cf-mirror'));
    const originalRemove = ToolboxDB.removeLocalWorkingCopy.bind(ToolboxDB);
    ToolboxDB.removeLocalWorkingCopy = function (records) {
      const hit = (records || []).some(function (row) { return row && row.id === 'cf-mirror'; });
      if (hit) {
        report.mirrorRemovedAfterTrash = !!(state.indexes['cf-mirror'] && state.indexes['cf-mirror'].deletedAt);
      }
      return originalRemove(records);
    };
    state.fetchLog.length = 0;
    const mirrorDecision = await ToolboxSync.resolveWorkingFileDelete('cf-mirror');
    report.mirrorDecision = mirrorDecision && mirrorDecision.action;
    await ToolboxSync.moveWorkingFileToCabinetTrash('cf-mirror');
    ToolboxDB.removeLocalWorkingCopy = originalRemove;
    report.mirrorLocalGone = !(await ToolboxDB.getCustomerFile('cf-mirror'));
    report.mirrorTrashed = !!(state.indexes['cf-mirror'] && state.indexes['cf-mirror'].deletedAt);
    report.mirrorNoDelete = !state.fetchLog.some(function (entry) { return entry.method === 'DELETE'; });
    const explore = await ToolboxSync.exploreListFiles();
    const exploreRow = (explore.files || []).find(function (row) { return row.id === 'cf-mirror'; });
    report.exploreTrashed = !!(exploreRow && exploreRow.deletedAt && exploreRow.displayName === 'Sip Mirror');
    const exploreDetail = await ToolboxSync.exploreListCustomerFile('cf-mirror');
    report.exploreDetailTrashed = !!(exploreDetail && exploreDetail.deletedAt &&
      (exploreDetail.objects || []).some(function (row) {
        return row && row.key === 'cf/cf-mirror/trash.json' && row.purpose === 'technical';
      }));
    const browse = await ToolboxSync.browseCabinet();
    report.cabinetHidesMirror = !(browse.entries || []).some(function (entry) {
      return entry && entry.id === 'cf-mirror' && !entry.deletedAt;
    });
    report.trashListsMirror = (browse.entries || []).some(function (entry) {
      return entry && entry.id === 'cf-mirror' && !!entry.deletedAt;
    });

    return report;
  });

  check('Customer Files has no Trash button or count', out.homeTrashButton === false && out.homeTrashCount === false, JSON.stringify(out));
  check('Quiet local recovery link has no count', out.quietLink === 'Recover files saved only on this device' && out.quietHasDigit === false, JSON.stringify(out));
  check('File Cabinet Trash control has no count', out.cabinetTrashLabel === 'Trash', JSON.stringify(out));
  check('Active cabinet list hides trashed files', out.activeNames.includes('Ada Active') && out.activeNames.includes('Cy Leased') && !out.activeNames.includes('Bea Trashed') && !out.activeNames.includes('Dee Held') && !out.activeNames.includes('Old File'), JSON.stringify(out));
  check('Files older than 120 days stay in Trash and can be cleaned up', out.cleanupVisible && out.oldSurvivedTimer, JSON.stringify(out));
  check('Delete is offered only for unlocked cloud files', out.deleteButtons.includes('cf-active') && !out.deleteButtons.includes('cf-leased') && !out.deleteButtons.includes('cf-mine') && !out.deleteButtons.includes('cf-trashed'), JSON.stringify(out));
  check('Phone File Cabinet does not overflow', out.overflow === false, JSON.stringify(out));
  check('Own and foreign checkout block cabinet delete before any write', out.ownCheckoutRefused && out.foreignCheckoutRefused && out.checkoutWrote === false, JSON.stringify(out));
  check('Cloud-only delete writes trash component then index and does not download or DELETE', out.cloudTrashNoDelete && out.cloudTrashNoCheckout && out.componentBeforeIndex && out.cloudTrashLocal == null && out.trashResultLocal === true && out.retentionDays === 120 && out.cloudTrashComponent && out.cloudTrashComponent.deletedAt === out.cloudTrashDeletedAt, JSON.stringify(out));
  check('Restore clears cabinet trash without Check Out or a local row', out.restoredDeletedAt == null && out.restoredComponent && out.restoredComponent.deletedAt == null && out.restoreLocal == null && out.restoreNoCheckout && out.restoreNoDelete, JSON.stringify(out));
  check('Checked-out delete keeps local evidence when the server cannot be reached', out.offlineKept && out.offlinePlanKept && out.offlinePdfKept && out.offlineNotTrashed && out.offlineNoDelete, JSON.stringify(out));
  check('Sync Now finishes the recorded delete and keeps plans, photos, and floor evidence', out.heldSyncOk && out.heldLocalGone && out.heldTrashed && out.heldMediaKept && out.heldQuickKept && out.heldFloorKept && out.heldPdfKept && out.heldPdfLocalGone && out.heldFigureKept && out.heldFigureLocalGone && out.heldNoDelete && out.offlineFigureKept, JSON.stringify(out));
  check('Restore returns the cabinet file and keeps its media', out.heldRestored && out.heldRestoreNoDelete, JSON.stringify(out));
  check('Cabinet list drops a trashed file and Trash does not auto-delete', out.namesAfterTrash.includes('Cy Leased') && !out.namesAfterTrash.includes('Ada Active') && out.trashHash === '#/cabinet/trash' && out.trashNames.includes('Ada Active') && out.trashNames.includes('Bea Trashed') && out.countdown.some(function (line) { return line === 'In Trash'; }) && out.countdown.some(function (line) { return line === 'Eligible for cleanup'; }) && !out.countdown.some(function (line) { return /Permanently deletes/i.test(line); }), JSON.stringify(out));
  check('Trash Restore does not Check Out', out.uiRestoreDeletedAt == null && out.uiRestoreNoCheckout && out.uiRestoreNoLocal, JSON.stringify(out));
  check('Permanent delete before 120 days uses a clear confirmation', out.permanentEnabled && out.permanentNoPhrase && out.permanentCancelKept && out.permanentDeleted && out.permanentMediaGone && out.permanentBefore120 && out.permanentOnlyBea && out.oldStillThere, JSON.stringify(out));
  check('Empty Trash uses a clear confirmation and deletes only unlocked trash', out.emptyLabel === 'Empty Trash' && out.emptyEnabled && out.emptyNoPhrase && out.cancelKeptOld && out.cancelNoDelete && out.checkInWouldNotDelete && out.oldPurged && out.oldMediaGone && out.leasedTrashSurvives && out.leasedMediaKept && out.activeSurvives && out.otherMediaKept, JSON.stringify(out));
  check('Empty Trash leaves local-only drafts and Check In / Send do not DELETE', out.localDraftKept && out.sendCheckInNoDelete && out.draftStillLocal, JSON.stringify(out));
  check('A working copy on this device blocks cabinet delete', out.workingCopyRefused && out.workingCopyNoWrite && out.workingCopyKept, JSON.stringify(out));
  check('Quiet mirror without checkout is moved to File Cabinet Trash', out.mirrorSynced && out.mirrorNoCheckout && out.mirrorMarked && out.mirrorDecision === 'cabinet' && out.mirrorLocalBefore && out.mirrorRemovedAfterTrash && out.mirrorLocalGone && out.mirrorTrashed && out.mirrorNoDelete && out.exploreTrashed && out.exploreDetailTrashed && out.cabinetHidesMirror && out.trashListsMirror, JSON.stringify(out));
  check('Offline mirror delete keeps the local file until Sync Now confirms Trash', out.offlineMirrorDecision === 'pending-offline' && out.offlineMirrorKept && out.offlineMirrorRemoteLive && out.offlineMirrorFinished && out.offlineMirrorLocalGone, JSON.stringify(out));
  check('A file that was never mirrored still deletes locally while offline', out.neverDecision === 'local-only' && out.neverNoRemote && out.neverLocalGone, JSON.stringify(out));
  check('A foreign checkout is not trashed from this device', out.foreignRefused, JSON.stringify(out));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.waitForFunction(() => document.querySelector('.trash-head h1'));
  await page.screenshot({ path: `${OUT}/file-cabinet-trash-phone.png`, fullPage: true });
  await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1 });
  await page.screenshot({ path: `${OUT}/file-cabinet-trash-ipad.png`, fullPage: true });
  const ipad = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('iPad File Cabinet Trash does not overflow', ipad === false);
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await page.screenshot({ path: `${OUT}/file-cabinet-trash-desktop.png`, fullPage: true });
  const desktop = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('Desktop File Cabinet Trash does not overflow', desktop === false);

  await page.evaluate(() => { window.location.hash = '#/cabinet'; });
  await page.waitForFunction(() => document.querySelector('#file-cabinet-trash'));
  await page.screenshot({ path: `${OUT}/file-cabinet-desktop.png`, fullPage: true });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.screenshot({ path: `${OUT}/file-cabinet-phone.png`, fullPage: true });
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForFunction(() => document.querySelector('#local-trash-recovery'));
  await page.screenshot({ path: `${OUT}/customer-files-quiet-recovery-phone.png`, fullPage: true });
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter(function (result) { return !result.ok; });
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
