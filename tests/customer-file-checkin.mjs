/**
 * Check In / Send to File Cabinet tests (no live Cloudflare).
 * Run: node tests/customer-file-checkin.mjs
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
  for (const c of [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)) {
    try { require('fs').accessSync(c); return c; } catch (_) {}
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
      purged: Object.create(null),
      deleteCalls: [],
      failNextPutIndex: false,
      failNextRelease: false,
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
          purged: Object.keys(state.purged).map((id) => state.purged[id]),
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
            ok: false, message: 'checked out elsewhere', checkout: existing,
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        const prevEtag = state.etags[id];
        if (!prevEtag) return new Response('Missing object ETag', { status: 500 });
        state.etags[id] = 'etag-' + (Number(String(prevEtag).replace(/\D/g, '') || 0) + 1);
        state.indexes[id] = Object.assign({}, state.indexes[id], {
          checkout: {
            email: normalizeEmail(state.identity.email),
            sub: state.identity.sub,
            deviceId: deviceId,
            checkedOutAt: '2026-09-23T02:00:00.000Z',
          },
        });
        return new Response(JSON.stringify({
          ok: true, idempotent: false, index: state.indexes[id], checkout: state.indexes[id].checkout,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      match = /^files\/([^/]+)\/checkout\/release$/.exec(path);
      if (match && method === 'POST') {
        const id = decodeURIComponent(match[1]);
        if (state.failNextRelease) {
          state.failNextRelease = false;
          return new Response('release failed', { status: 500 });
        }
        if (!state.indexes[id]) return new Response('Not found', { status: 404 });
        const next = Object.assign({}, state.indexes[id]);
        delete next.checkout;
        state.indexes[id] = next;
        state.etags[id] = 'etag-rel';
        return new Response(JSON.stringify({ ok: true, released: true, index: next }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)$/.exec(path);
      if (match && method === 'DELETE') {
        const id = decodeURIComponent(match[1]);
        state.deleteCalls.push(id);
        delete state.indexes[id];
        Object.keys(state.components).forEach((k) => {
          if (k.startsWith(id + '::')) delete state.components[k];
        });
        state.purged[id] = { id: id, purgedAt: '2026-09-23T02:00:00.000Z' };
        return new Response(JSON.stringify({ ok: true, deleted: id }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)\/index$/.exec(path);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (method === 'GET') {
          if (!state.indexes[id]) return new Response('Not found', { status: 404 });
          return new Response(JSON.stringify(state.indexes[id]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (method === 'PUT') {
          if (state.failNextPutIndex) {
            state.failNextPutIndex = false;
            return new Response('put index failed', { status: 500 });
          }
          const body = JSON.parse(opts.body);
          const existing = state.indexes[id];
          if (existing && existing.checkout) body.checkout = existing.checkout;
          else delete body.checkout;
          state.indexes[id] = body;
          state.etags[id] = state.etags[id] || 'etag-1';
          return new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
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
      if (match) {
        const mediaId = decodeURIComponent(match[1]);
        if (method === 'GET') {
          if (!state.media[mediaId]) return new Response('Not found', { status: 404 });
          return new Response(state.media[mediaId].bytes, {
            status: 200,
            headers: { 'content-type': state.media[mediaId].contentType || 'application/octet-stream' },
          });
        }
        if (method === 'PUT') {
          const bytes = opts.body instanceof Uint8Array
            ? opts.body
            : new Uint8Array(await (new Response(opts.body)).arrayBuffer());
          state.media[mediaId] = {
            bytes: bytes,
            contentType: (opts.headers && (opts.headers['content-type'] || opts.headers['Content-Type'])) || 'application/octet-stream',
          };
          return new Response(JSON.stringify({ ok: true, bytes: bytes.length }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
      }

      return new Response('Not found', { status: 404 });
    };

    function seedRemote(id, overrides) {
      const customer = Object.assign({
        firstName: 'Cloud', lastName: 'Job', propertyAddress: '9 Cabinet Rd',
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
      const distress = { id: 'd-' + id, updatedAt: '2026-02-01T00:00:00.000Z', pins: [], drawings: [], startNum: 1, nextNum: 1 };
      const floor = { id: 'f-' + id, updatedAt: '2026-02-01T00:00:00.000Z', schemaVersion: 1, byCanvasId: {} };
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
        displayName: ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim(),
        propertyAddress: customer.propertyAddress || '',
      }, (overrides && overrides.index) || {});
      state.etags[id] = 'etag-1';
      state.media['plan-' + id] = { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' };
    }

    const report = {};
    const prior = await ToolboxDB.getAllCustomerFiles();
    if (prior.length) await ToolboxDB.permanentlyDeleteCustomerFiles(prior);
    localStorage.setItem('toolboxDeviceId', 'device-ipad');

    // --- Send to File Cabinet ---
    const draft = ToolboxApp.blankCustomerFile('cf-send-1');
    ToolboxPlanSetup.ensurePlanSetup(draft);
    draft.firstName = 'Send';
    draft.lastName = 'Me';
    draft.propertyAddress = '1 Send St';
    draft.customerUpdatedAt = '2026-09-23T02:10:00.000Z';
    await ToolboxDB.saveCustomerFile(draft);

    report.menuSend = ToolboxSync.isCheckedOutFromCabinet(draft) === false;

    const sent = await ToolboxSync.sendToFileCabinet('cf-send-1');
    report.sendOk = sent && sent.ok === true;
    report.sendRemoteExists = !!state.indexes['cf-send-1'];
    report.sendLocalGone = !(await ToolboxDB.getCustomerFile('cf-send-1'));
    report.sendNoCloudDelete = state.deleteCalls.indexOf('cf-send-1') === -1;
    report.sendInCabinetBrowse = (await ToolboxSync.browseCabinet()).entries
      .some((e) => e.id === 'cf-send-1' && e.presence === 'cloud-only');

    // Failed send keeps local
    const draftFail = ToolboxApp.blankCustomerFile('cf-send-fail');
    ToolboxPlanSetup.ensurePlanSetup(draftFail);
    draftFail.firstName = 'Fail';
    draftFail.lastName = 'Send';
    draftFail.customerUpdatedAt = '2026-09-23T02:11:00.000Z';
    await ToolboxDB.saveCustomerFile(draftFail);
    state.failNextPutIndex = true;
    let sendFailed = false;
    try {
      await ToolboxSync.sendToFileCabinet('cf-send-fail');
    } catch (err) {
      sendFailed = true;
      report.sendFailMsg = err && err.message;
    }
    report.sendFailKeptLocal = sendFailed && !!(await ToolboxDB.getCustomerFile('cf-send-fail'));
    report.sendFailNoRemote = !state.indexes['cf-send-fail'];

    // --- Check Out provenance ---
    seedRemote('cf-co-1', {
      customer: { firstName: 'Checkout', lastName: 'One', propertyAddress: '2 Check Rd' },
    });
    const co = await ToolboxSync.checkOutCustomerFile('cf-co-1');
    report.coOk = co && co.ok === true;
    let localCo = await ToolboxDB.getCustomerFile('cf-co-1');
    report.coProvenance = !!(localCo && localCo.checkedOutFromCabinet === true);
    // Survive "reload" via re-read
    localCo = await ToolboxDB.getCustomerFile('cf-co-1');
    report.coProvenanceReload = ToolboxSync.isCheckedOutFromCabinet(localCo) === true;
    report.menuCheckIn = report.coProvenanceReload === true;

    // Modify + Check In
    localCo.firstName = 'CheckedIn';
    localCo.customerUpdatedAt = '2026-09-23T02:20:00.000Z';
    await ToolboxDB.saveCustomerFile(localCo);
    state.deleteCalls = [];
    const checkedIn = await ToolboxSync.checkInCustomerFile('cf-co-1');
    report.ciOk = checkedIn && checkedIn.ok === true;
    report.ciRemoteUpdated = state.components['cf-co-1::customer'] &&
      state.components['cf-co-1::customer'].firstName === 'CheckedIn';
    report.ciLeaseReleased = !(state.indexes['cf-co-1'] && state.indexes['cf-co-1'].checkout);
    report.ciLocalGone = !(await ToolboxDB.getCustomerFile('cf-co-1'));
    report.ciCabinetRemains = !!state.indexes['cf-co-1'];
    report.ciNoCloudDelete = state.deleteCalls.length === 0;

    // Failed Check In write keeps local + lease
    seedRemote('cf-ci-fail', {
      customer: { firstName: 'Keep', lastName: 'Lease', propertyAddress: '3 Keep Ln' },
    });
    await ToolboxSync.checkOutCustomerFile('cf-ci-fail');
    const failLocal = await ToolboxDB.getCustomerFile('cf-ci-fail');
    failLocal.firstName = 'ShouldNotPush';
    failLocal.customerUpdatedAt = '2026-09-23T02:30:00.000Z';
    await ToolboxDB.saveCustomerFile(failLocal);
    state.failNextPutIndex = true;
    let ciWriteFailed = false;
    try {
      await ToolboxSync.checkInCustomerFile('cf-ci-fail');
    } catch (_) {
      ciWriteFailed = true;
    }
    report.ciFailKeptLocal = ciWriteFailed && !!(await ToolboxDB.getCustomerFile('cf-ci-fail'));
    report.ciFailLeaseKept = !!(state.indexes['cf-ci-fail'] && state.indexes['cf-ci-fail'].checkout);

    // Failed release keeps local
    seedRemote('cf-ci-relfail', {
      customer: { firstName: 'Rel', lastName: 'Fail', propertyAddress: '4 Rel Rd' },
    });
    await ToolboxSync.checkOutCustomerFile('cf-ci-relfail');
    const relLocal = await ToolboxDB.getCustomerFile('cf-ci-relfail');
    relLocal.firstName = 'RelUpdated';
    relLocal.customerUpdatedAt = '2026-09-23T02:40:00.000Z';
    await ToolboxDB.saveCustomerFile(relLocal);
    state.failNextRelease = true;
    let relFailed = false;
    try {
      await ToolboxSync.checkInCustomerFile('cf-ci-relfail');
    } catch (_) {
      relFailed = true;
    }
    report.ciRelFailKeptLocal = relFailed && !!(await ToolboxDB.getCustomerFile('cf-ci-relfail'));
    // release failed — lease should still be present (mock only clears on success)
    report.ciRelFailLeaseKept = !!(state.indexes['cf-ci-relfail'] && state.indexes['cf-ci-relfail'].checkout);

    // --- Legacy same-id remote + no marker (Test 1 class) ---
    seedRemote('cf-legacy-1', {
      customer: { firstName: 'Legacy', lastName: 'One', propertyAddress: '10 Legacy Ln' },
    });
    // Simulate pre-v56 local working copy: same id, already remote, NO checkedOutFromCabinet.
    const legacyLocal = ToolboxApp.blankCustomerFile('cf-legacy-1');
    ToolboxPlanSetup.ensurePlanSetup(legacyLocal);
    legacyLocal.firstName = 'Legacy';
    legacyLocal.lastName = 'LocalNewer';
    legacyLocal.propertyAddress = '10 Legacy Ln';
    legacyLocal.customerUpdatedAt = '2026-09-23T03:00:00.000Z';
    delete legacyLocal.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(legacyLocal);
    // Keep remote plan media so verifyRemoteCabinetCopy can pass after reconcile.
    state.deleteCalls = [];
    const legacySend = await ToolboxSync.sendToFileCabinet('cf-legacy-1');
    report.legacyOk = legacySend && legacySend.ok === true && legacySend.path === 'reconcile-existing';
    report.legacyLocalGone = !(await ToolboxDB.getCustomerFile('cf-legacy-1'));
    report.legacyRemoteRemains = !!state.indexes['cf-legacy-1'];
    report.legacyPushed = state.components['cf-legacy-1::customer'] &&
      state.components['cf-legacy-1::customer'].lastName === 'LocalNewer';
    report.legacyNoCloudDelete = state.deleteCalls.length === 0;
    report.legacyNoLease = !(state.indexes['cf-legacy-1'] && state.indexes['cf-legacy-1'].checkout);

    // Legacy + own lease (no marker) → Send completes Check In ceremony
    seedRemote('cf-legacy-own', {
      customer: { firstName: 'Own', lastName: 'Lease', propertyAddress: '11 Own Rd' },
    });
    state.indexes['cf-legacy-own'].checkout = {
      email: 'tim@example.com', sub: 'sub-tim', deviceId: 'device-ipad',
      checkedOutAt: '2026-09-23T02:50:00.000Z',
    };
    const ownLocal = ToolboxApp.blankCustomerFile('cf-legacy-own');
    ToolboxPlanSetup.ensurePlanSetup(ownLocal);
    ownLocal.firstName = 'Own';
    ownLocal.lastName = 'Updated';
    ownLocal.propertyAddress = '11 Own Rd';
    ownLocal.customerUpdatedAt = '2026-09-23T03:05:00.000Z';
    delete ownLocal.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(ownLocal);
    state.deleteCalls = [];
    const ownSend = await ToolboxSync.sendToFileCabinet('cf-legacy-own');
    report.ownLeaseOk = ownSend && ownSend.ok === true && ownSend.path === 'own-lease';
    report.ownLeaseLocalGone = !(await ToolboxDB.getCustomerFile('cf-legacy-own'));
    report.ownLeaseReleased = !(state.indexes['cf-legacy-own'] && state.indexes['cf-legacy-own'].checkout);
    report.ownLeaseRemoteRemains = !!state.indexes['cf-legacy-own'];
    report.ownLeaseNoCloudDelete = state.deleteCalls.length === 0;

    // Legacy + foreign lease → refuse
    seedRemote('cf-legacy-foreign', {
      customer: { firstName: 'Foreign', lastName: 'Lease', propertyAddress: '12 Foreign Rd' },
    });
    state.indexes['cf-legacy-foreign'].checkout = {
      email: 'lee@example.com', sub: 'sub-lee', deviceId: 'device-lee',
      checkedOutAt: '2026-09-23T02:55:00.000Z',
    };
    const foreignLocal = ToolboxApp.blankCustomerFile('cf-legacy-foreign');
    ToolboxPlanSetup.ensurePlanSetup(foreignLocal);
    foreignLocal.firstName = 'Foreign';
    foreignLocal.lastName = 'Local';
    foreignLocal.customerUpdatedAt = '2026-09-23T03:06:00.000Z';
    delete foreignLocal.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(foreignLocal);
    let foreignRefused = false;
    let foreignCode = '';
    try {
      await ToolboxSync.sendToFileCabinet('cf-legacy-foreign');
    } catch (err) {
      foreignRefused = true;
      foreignCode = err && err.code;
    }
    report.foreignRefused = foreignRefused && foreignCode === 'checkout';
    report.foreignLocalKept = !!(await ToolboxDB.getCustomerFile('cf-legacy-foreign'));
    report.foreignLeaseKept = !!(state.indexes['cf-legacy-foreign'] &&
      state.indexes['cf-legacy-foreign'].checkout &&
      state.indexes['cf-legacy-foreign'].checkout.deviceId === 'device-lee');

    // Legacy reconcile + release failure keeps local
    seedRemote('cf-legacy-relfail', {
      customer: { firstName: 'Rel', lastName: 'SendFail', propertyAddress: '13 Rel Ln' },
    });
    state.indexes['cf-legacy-relfail'].checkout = {
      email: 'tim@example.com', sub: 'sub-tim', deviceId: 'device-ipad',
      checkedOutAt: '2026-09-23T02:56:00.000Z',
    };
    const relSendLocal = ToolboxApp.blankCustomerFile('cf-legacy-relfail');
    ToolboxPlanSetup.ensurePlanSetup(relSendLocal);
    relSendLocal.firstName = 'Rel';
    relSendLocal.lastName = 'SendFail';
    relSendLocal.customerUpdatedAt = '2026-09-23T03:07:00.000Z';
    delete relSendLocal.checkedOutFromCabinet;
    await ToolboxDB.saveCustomerFile(relSendLocal);
    state.failNextRelease = true;
    let legacyRelFailed = false;
    try {
      await ToolboxSync.sendToFileCabinet('cf-legacy-relfail');
    } catch (_) {
      legacyRelFailed = true;
    }
    report.legacyRelFailKeptLocal = legacyRelFailed && !!(await ToolboxDB.getCustomerFile('cf-legacy-relfail'));
    report.legacyRelFailLeaseKept = !!(state.indexes['cf-legacy-relfail'] &&
      state.indexes['cf-legacy-relfail'].checkout);

    // Browse still lightweight (no auto materialize of remaining cloud-only)
    const beforeBrowse = state.fetchLog.length;
    const browse = await ToolboxSync.browseCabinet();
    report.browseOk = browse && browse.ok === true;
    report.browseHasCloudOnly = browse.entries.some((e) => e.id === 'cf-send-1' && e.presence === 'cloud-only');
    report.browseNoMaterialize = !state.fetchLog.slice(beforeBrowse).some((f) =>
      /\/components\//.test(f.path) || /^media\//.test(f.path)
    );

    // Existing Check Out still works on another file
    seedRemote('cf-co-2', {
      customer: { firstName: 'Still', lastName: 'Works', propertyAddress: '5 Still St' },
    });
    const co2 = await ToolboxSync.checkOutCustomerFile('cf-co-2');
    report.co2Ok = co2 && co2.ok === true && !!(await ToolboxDB.getCustomerFile('cf-co-2'));

    // Delete/Trash path still available and still cloud-deletes stubs (unchanged)
    const stub = ToolboxApp.blankCustomerFile('cf-stub-del');
    ToolboxPlanSetup.ensurePlanSetup(stub);
    await ToolboxDB.saveCustomerFile(stub);
    await ToolboxDB.permanentlyDeleteCustomerFiles([stub]);
    report.stubLocalGone = !(await ToolboxDB.getCustomerFile('cf-stub-del'));
    report.removeLocalExists = typeof ToolboxDB.removeLocalWorkingCopy === 'function';

    return report;
  });

  check('⋯ would show Send for local-only', out.menuSend, JSON.stringify(out));
  check('Send to File Cabinet creates remote and clears local', out.sendOk && out.sendRemoteExists && out.sendLocalGone, JSON.stringify(out));
  check('Send appears in Cabinet browse as cloud-only', out.sendInCabinetBrowse, JSON.stringify(out));
  check('Send does not cloud-delete', out.sendNoCloudDelete, JSON.stringify(out));
  check('Failed Send keeps local', out.sendFailKeptLocal && out.sendFailNoRemote, JSON.stringify(out));
  check('Check Out sets durable checkedOutFromCabinet', out.coOk && out.coProvenance && out.coProvenanceReload, JSON.stringify(out));
  check('⋯ would show Check In for checked-out file', out.menuCheckIn, JSON.stringify(out));
  check('Check In updates remote, releases lease, clears local', out.ciOk && out.ciRemoteUpdated && out.ciLeaseReleased && out.ciLocalGone && out.ciCabinetRemains, JSON.stringify(out));
  check('Check In does not cloud-delete', out.ciNoCloudDelete, JSON.stringify(out));
  check('Failed Check In write keeps local + lease', out.ciFailKeptLocal && out.ciFailLeaseKept, JSON.stringify(out));
  check('Failed lease release keeps local', out.ciRelFailKeptLocal && out.ciRelFailLeaseKept, JSON.stringify(out));
  check('Legacy same-id/no-lease Send reconciles and clears local', out.legacyOk && out.legacyLocalGone && out.legacyRemoteRemains && out.legacyPushed && out.legacyNoLease && out.legacyNoCloudDelete, JSON.stringify(out));
  check('Legacy same-id/own-lease Send releases and clears local', out.ownLeaseOk && out.ownLeaseLocalGone && out.ownLeaseReleased && out.ownLeaseRemoteRemains && out.ownLeaseNoCloudDelete, JSON.stringify(out));
  check('Legacy same-id/foreign-lease Send refused', out.foreignRefused && out.foreignLocalKept && out.foreignLeaseKept, JSON.stringify(out));
  check('Legacy own-lease Send release failure keeps local', out.legacyRelFailKeptLocal && out.legacyRelFailLeaseKept, JSON.stringify(out));
  check('Cabinet browse remains lightweight', out.browseOk && out.browseHasCloudOnly && out.browseNoMaterialize, JSON.stringify(out));
  check('Existing Check Out still works', out.co2Ok, JSON.stringify(out));
  check('Local-only remove primitive exists; stub hard-delete still local', out.removeLocalExists && out.stubLocalGone, JSON.stringify(out));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
