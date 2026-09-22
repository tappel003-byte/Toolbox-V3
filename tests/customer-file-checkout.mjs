/**
 * File Cabinet Check Out foundation tests (no live Cloudflare required).
 * Run: node tests/customer-file-checkout.mjs
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
    '/home/ubuntu/.cache/ms-playwright/chromium-*/chrome-linux/chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c.includes('*')) continue;
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

  // Pure helper: device id stability
  const device = await page.evaluate(() => {
    localStorage.removeItem('toolboxDeviceId');
    const a = ToolboxSync.getDeviceId();
    const b = ToolboxSync.getDeviceId();
    return { a, b, same: a === b && !!a };
  });
  check('Device id is created once and reused', device.same, JSON.stringify(device));

  const out = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;

    const state = {
      identity: { email: 'tim@example.com', sub: 'sub-tim' },
      indexes: Object.create(null),
      components: Object.create(null),
      media: Object.create(null),
      purged: Object.create(null),
      etags: Object.create(null),
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
        if (state.purged[id]) return new Response('Customer File permanently deleted', { status: 409 });
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
        // Simulate atomic acquire: bump etag; concurrent losers not modeled beyond etag check.
        state.etags[id] = (prevEtag || 0) + 1;
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
        const deviceId = deviceFrom(opts);
        const existing = state.indexes[id].checkout || null;
        if (!existing || !existing.deviceId) {
          return new Response(JSON.stringify({ ok: true, released: false, index: state.indexes[id] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (!sameOwner(existing, state.identity.email, deviceId)) {
          return new Response('Only the checkout owner can release this lease', { status: 403 });
        }
        const next = Object.assign({}, state.indexes[id]);
        delete next.checkout;
        state.indexes[id] = next;
        state.etags[id] = (state.etags[id] || 0) + 1;
        return new Response(JSON.stringify({ ok: true, released: true, index: next }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)$/.exec(path);
      if (match && method === 'DELETE') {
        const id = decodeURIComponent(match[1]);
        delete state.indexes[id];
        Object.keys(state.components).forEach((k) => {
          if (k.startsWith(id + '::')) delete state.components[k];
        });
        state.purged[id] = { id: id, purgedAt: '2026-09-22T20:00:00.000Z', reason: 'permanent-delete' };
        return new Response(JSON.stringify({ ok: true, deleted: id, purged: state.purged[id] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)\/index$/.exec(path);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (state.purged[id] && method === 'PUT') {
          return new Response('Customer File permanently deleted', { status: 409 });
        }
        if (method === 'GET') {
          if (!state.indexes[id]) return new Response('Not found', { status: 404 });
          return new Response(JSON.stringify(state.indexes[id]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (method === 'PUT') {
          const body = JSON.parse(opts.body);
          const existing = state.indexes[id];
          if (existing && existing.checkout && existing.checkout.deviceId) {
            const deviceId = deviceFrom(opts);
            if (!sameOwner(existing.checkout, state.identity.email, deviceId)) {
              return new Response('Customer File is checked out by another user or device', { status: 403 });
            }
            body.checkout = existing.checkout;
          } else {
            delete body.checkout;
          }
          state.indexes[id] = body;
          state.etags[id] = (state.etags[id] || 0) + 1;
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
        if (state.purged[id] && method === 'PUT') {
          return new Response('Customer File permanently deleted', { status: 409 });
        }
        if (method === 'GET') {
          if (!(key in state.components)) return new Response('Not found', { status: 404 });
          return new Response(JSON.stringify(state.components[key]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (method === 'PUT') {
          const existing = state.indexes[id];
          if (existing && existing.checkout && existing.checkout.deviceId) {
            const deviceId = deviceFrom(opts);
            if (!sameOwner(existing.checkout, state.identity.email, deviceId)) {
              return new Response('Customer File is checked out by another user or device', { status: 403 });
            }
          }
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

    function seedRemote(id) {
      const customer = {
        firstName: 'Cloud',
        lastName: 'Job',
        propertyAddress: '9 Cabinet Rd',
        cellPhone: '', homePhone: '', email: '', notes: '', companyName: '',
        spouseName: '', spouseCellPhone: '', spouseHomePhone: '', spouseEmail: '',
        mailingSameAsProperty: false, mailingAddress: '',
        propertyAddressLat: null, propertyAddressLon: null,
        customerUpdatedAt: '2026-02-01T00:00:00.000Z',
      };
      const plans = {
        id: 'ps-cloud', updatedAt: '2026-02-01T00:00:00.000Z', buildingType: 'residential',
        activeCanvasId: 'c-cloud',
        canvases: [{
          id: 'c-cloud', name: 'Floor Plan',
          plan: { id: 'plan-cloud', width: 100, height: 80 },
          rooms: [], frontDoorFacing: 'S', frontDoor: null,
        }],
      };
      const distress = {
        id: 'd-cloud', updatedAt: '2026-02-01T00:00:00.000Z',
        pins: [{ id: 'pin-c', canvasId: 'c-cloud', photos: ['ph_cloud'], num: 1 }],
        drawings: [], startNum: 1, nextNum: 2,
      };
      const floor = {
        id: 'f-cloud', updatedAt: '2026-02-01T00:00:00.000Z', schemaVersion: 1,
        byCanvasId: { 'c-cloud': { canvasId: 'c-cloud', points: [{ x: 0.2, y: 0.3, elev: 0 }] } },
      };
      const trash = { trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH, deletedAt: null, purgeAfter: null };
      state.components[compKey(id, 'customer')] = customer;
      state.components[compKey(id, 'plans')] = plans;
      state.components[compKey(id, 'distress')] = distress;
      state.components[compKey(id, 'floor')] = floor;
      state.components[compKey(id, 'trash')] = trash;
      state.indexes[id] = {
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
        displayName: 'Cloud Job',
        propertyAddress: '9 Cabinet Rd',
      };
      state.etags[id] = 1;
      // tiny PNG-ish bytes
      state.media['plan-cloud'] = { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' };
      state.media['ph_cloud'] = { bytes: new Uint8Array([5, 6, 7, 8]), contentType: 'image/jpeg' };
    }

    const report = {};

    // Clear local
    const prior = await ToolboxDB.getAllCustomerFiles();
    if (prior.length) await ToolboxDB.permanentlyDeleteCustomerFiles(prior);

    seedRemote('cf-cloud-1');
    seedRemote('cf-cloud-2');

    // A: browse sees cloud-only without materializing
    const browse1 = await ToolboxSync.browseCabinet();
    report.A_browseCount = browse1.entries.length;
    report.A_cloudOnly = browse1.entries.every((e) => e.presence === 'cloud-only');
    report.A_noLocal = !(await ToolboxDB.getCustomerFile('cf-cloud-1')) &&
      !(await ToolboxDB.getCustomerFile('cf-cloud-2'));

    // K: ordinary Sync leaves remote-only remote
    const syncK = await ToolboxSync.syncNow();
    report.K_syncOk = syncK.ok === true && syncK.remoteOnlySkipped >= 2;
    report.K_stillRemote = !(await ToolboxDB.getCustomerFile('cf-cloud-1'));

    // B: Check Out acquires for this user+device
    localStorage.setItem('toolboxDeviceId', 'device-ipad');
    const co = await ToolboxSync.checkOutCustomerFile('cf-cloud-1');
    report.B_ok = co.ok === true;
    report.B_checkout = state.indexes['cf-cloud-1'].checkout;
    report.B_owner = report.B_checkout &&
      report.B_checkout.email === 'tim@example.com' &&
      report.B_checkout.deviceId === 'device-ipad';

    // F + G: only selected file materialized + media present
    report.F_selectedLocal = !!(await ToolboxDB.getCustomerFile('cf-cloud-1'));
    report.F_otherRemote = !(await ToolboxDB.getCustomerFile('cf-cloud-2'));
    const local1 = await ToolboxDB.getCustomerFile('cf-cloud-1');
    report.F_name = local1 && local1.firstName === 'Cloud' && local1.lastName === 'Job';
    report.G_plan = !!(await ToolboxDB.getMedia('plan-cloud'));
    // Distress photos live in the FRP photo store, not ToolboxDB media.
    const photoDb = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pgg_photos_v1', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    report.G_photo = await new Promise((resolve, reject) => {
      const tx = photoDb.transaction('photos', 'readonly');
      const get = tx.objectStore('photos').get('ph_cloud');
      get.onsuccess = () => resolve(!!get.result);
      get.onerror = () => reject(get.error);
    });
    photoDb.close();

    // C: same user + same device acquire idempotent
    const again = await ToolboxSync.acquireRemoteCheckout('cf-cloud-1');
    report.C_idempotent = again.ok === true && again.idempotent === true;

    // D: same user + different device refused
    localStorage.setItem('toolboxDeviceId', 'device-phone');
    let dRefused = false;
    let dCheckout = null;
    try {
      await ToolboxSync.acquireRemoteCheckout('cf-cloud-1');
    } catch (err) {
      dRefused = err && err.code === 'checkout';
      dCheckout = err && err.checkout;
    }
    report.D_refused = dRefused && dCheckout && dCheckout.deviceId === 'device-ipad';

    // E: different user refused
    state.identity = { email: 'lee@example.com', sub: 'sub-lee' };
    localStorage.setItem('toolboxDeviceId', 'device-lee');
    let eRefused = false;
    try {
      await ToolboxSync.acquireRemoteCheckout('cf-cloud-1');
    } catch (err) {
      eRefused = err && err.code === 'checkout';
    }
    report.E_refused = eRefused;
    // restore Tim identity for later
    state.identity = { email: 'tim@example.com', sub: 'sub-tim' };

    // I: non-owner device cannot push
    localStorage.setItem('toolboxDeviceId', 'device-phone');
    const stale = await ToolboxDB.getCustomerFile('cf-cloud-1');
    stale.firstName = 'StalePhone';
    stale.customerUpdatedAt = '2026-09-22T21:00:00.000Z';
    await ToolboxDB.saveCustomerFile(stale);
    const blocked = await ToolboxSync._test.syncOneRecord(stale, state.indexes['cf-cloud-1']);
    report.I_blocked = blocked.checkoutBlocked === true &&
      state.components['cf-cloud-1::customer'].firstName === 'Cloud';

    // J: owning user+device can Sync while checked out
    localStorage.setItem('toolboxDeviceId', 'device-ipad');
    const ownerLocal = await ToolboxDB.getCustomerFile('cf-cloud-1');
    ownerLocal.firstName = 'TimIpad';
    ownerLocal.customerUpdatedAt = '2026-09-22T22:00:00.000Z';
    await ToolboxDB.saveCustomerFile(ownerLocal);
    const ownerSync = await ToolboxSync.syncNow();
    report.J_syncOk = ownerSync.ok === true;
    report.J_pushed = state.components['cf-cloud-1::customer'].firstName === 'TimIpad';
    report.J_leaseKept = !!(state.indexes['cf-cloud-1'].checkout &&
      state.indexes['cf-cloud-1'].checkout.deviceId === 'device-ipad');

    // L: local-only first-upload still works
    const draft = ToolboxApp.blankCustomerFile('cf-local-draft');
    ToolboxPlanSetup.ensurePlanSetup(draft);
    draft.firstName = 'Local';
    draft.lastName = 'Draft';
    draft.customerUpdatedAt = '2026-09-22T23:00:00.000Z';
    await ToolboxDB.saveCustomerFile(draft);
    const draftSync = await ToolboxSync.syncNow();
    report.L_upload = draftSync.ok === true && !!state.indexes['cf-local-draft'];
    report.L_noCheckoutForced = !state.indexes['cf-local-draft'].checkout;

    // H: failed materialization releases lease
    seedRemote('cf-fail-media');
    // Break media so ensureLocalMedia fails during Check Out
    delete state.media['plan-cloud'];
    // Use unique media id for this file after reseeding carefully
    state.components[compKey('cf-fail-media', 'plans')].canvases[0].plan.id = 'plan-missing';
    state.indexes['cf-fail-media'].plansUpdatedAt = '2026-02-01T00:00:00.000Z';
    let hFailed = false;
    try {
      localStorage.setItem('toolboxDeviceId', 'device-ipad');
      await ToolboxSync.checkOutCustomerFile('cf-fail-media');
    } catch (err) {
      hFailed = true;
      report.H_errorCode = err && err.code;
    }
    report.H_failed = hFailed;
    report.H_leaseReleased = !state.indexes['cf-fail-media'].checkout;
    report.H_notLocal = !(await ToolboxDB.getCustomerFile('cf-fail-media'));

    // M: shell/epoch helper still intact
    const shell = ToolboxSync._test.shellForRemotePull('cf-x', state.indexes['cf-cloud-2']);
    report.M_epoch = shell.customerUpdatedAt === ToolboxSync.REMOTE_PULL_EPOCH;

    // N: tombstone 409 remains
    await ToolboxSync.deleteRemoteCustomerFile('cf-cloud-2');
    report.N_tombstone = !!state.purged['cf-cloud-2'];
    let n409 = false;
    try {
      await ToolboxSync._test.syncOneRecord(
        ToolboxSync._test.shellForRemotePull('cf-cloud-2', { id: 'cf-cloud-2' }),
        null,
      );
    } catch (err) {
      n409 = /permanently deleted|409/i.test(String(err && err.message)) || err;
    }
    // Direct put path:
    let put409 = false;
    try {
      const resp = await fetch(base + '/files/cf-cloud-2/index', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-toolbox-device-id': 'device-ipad' },
        body: JSON.stringify({ id: 'cf-cloud-2' }),
      });
      put409 = resp.status === 409;
    } catch (_) {}
    report.N_409 = put409;

    return report;
  });

  check('A: cloud-only browse without materialize', out.A_browseCount >= 2 && out.A_cloudOnly && out.A_noLocal, JSON.stringify(out));
  check('B: Check Out acquires user+device ownership', out.B_ok && out.B_owner, JSON.stringify(out));
  check('C: same user+device acquire is idempotent', out.C_idempotent, JSON.stringify(out));
  check('D: same user different device refused', out.D_refused, JSON.stringify(out));
  check('E: different user refused', out.E_refused, JSON.stringify(out));
  check('F: Check Out materializes only selected file', out.F_selectedLocal && out.F_otherRemote && out.F_name, JSON.stringify(out));
  check('G: required media accompanies Check Out', out.G_plan && out.G_photo, JSON.stringify(out));
  check('H: failed materialization releases lease', out.H_failed && out.H_leaseReleased && out.H_notLocal, JSON.stringify(out));
  check('I: non-owner cannot push checked-out file', out.I_blocked, JSON.stringify(out));
  check('J: owner can Sync while checked out', out.J_syncOk && out.J_pushed && out.J_leaseKept, JSON.stringify(out));
  check('K: Sync Now leaves remote-only remote', out.K_syncOk && out.K_stillRemote, JSON.stringify(out));
  check('L: local-only first-upload still works', out.L_upload && out.L_noCheckoutForced, JSON.stringify(out));
  check('M: shell/epoch protections remain', out.M_epoch, JSON.stringify(out));
  check('N: permanent-delete tombstone / 409 remains', out.N_tombstone && out.N_409, JSON.stringify(out));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
