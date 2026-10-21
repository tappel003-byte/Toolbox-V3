/**
 * A picture the job can travel without.
 *
 * Tim checked one Customer File out three times on an iPad mini and got
 * nothing each time: the row stopped at "report pictures 0 of 1", then went
 * back to Check Out with no sign the file had ever been checked out. The
 * Cabinet held the report but not one of its pictures, and a picture that
 * could not be fetched ended the whole materialization -- which releases the
 * lease behind it, so the job neither arrived nor looked like it had been
 * asked for.
 *
 * Plans and Distress photographs are the survey and still stop everything.
 * Report pictures and Diagnostics figures do not.
 *
 * Run: node tests/customer-file-report-media.mjs
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
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try { require('fs').accessSync(c); return c; } catch (_) {}
  }
  return '/usr/bin/google-chrome';
}

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
  server.on('error', reject);
});
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 500));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxDB);

  const out = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;

    const state = {
      identity: { email: 'tim@example.com', sub: 'sub-tim' },
      indexes: Object.create(null),
      components: Object.create(null),
      media: Object.create(null),
      etags: Object.create(null),
    };
    const ck = (id, name) => id + '::' + name;
    const em = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
    const dev = (o) => ((o && o.headers) || {})['x-toolbox-device-id'] || '';
    const sameOwner = (c, e, d) => c && em(c.email) === em(e) && String(c.deviceId || '') === String(d || '');

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const path = href.slice(base.length).replace(/^\//, '');
      const method = (opts && opts.method) || 'GET';
      const J = (body, status) => new Response(JSON.stringify(body), {
        status: status || 200, headers: { 'content-type': 'application/json' },
      });

      if (path === 'health') return J({ ok: true, accessConfigured: true });
      if (path === 'me') return J(state.identity);
      if (path === 'files' && method === 'GET') {
        return J({ files: Object.values(state.indexes), purged: [] });
      }

      let m = /^files\/([^/]+)\/checkout$/.exec(path);
      if (m && method === 'POST') {
        const id = decodeURIComponent(m[1]);
        if (!state.indexes[id]) return new Response('Not found', { status: 404 });
        const body = JSON.parse(opts.body || '{}');
        const deviceId = body.deviceId || dev(opts);
        const existing = state.indexes[id].checkout || null;
        if (existing && existing.deviceId && existing.email) {
          if (sameOwner(existing, state.identity.email, deviceId)) {
            return J({ ok: true, idempotent: true, index: state.indexes[id], checkout: existing });
          }
          return J({ ok: false, code: 'checked_out', message: 'checked out', checkout: existing }, 409);
        }
        state.indexes[id] = Object.assign({}, state.indexes[id], {
          checkout: {
            email: em(state.identity.email), sub: state.identity.sub,
            deviceId: deviceId, checkedOutAt: '2026-10-21T12:00:00.000Z',
          },
        });
        state.etags[id] = 'etag-2';
        return J({
          ok: true, idempotent: false,
          index: state.indexes[id], checkout: state.indexes[id].checkout,
        });
      }

      m = /^files\/([^/]+)\/checkout\/release$/.exec(path);
      if (m && method === 'POST') {
        const id = decodeURIComponent(m[1]);
        const next = Object.assign({}, state.indexes[id]);
        delete next.checkout;
        state.indexes[id] = next;
        return J({ ok: true, released: true, index: next });
      }

      m = /^files\/([^/]+)\/index$/.exec(path);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (method === 'GET') {
          return state.indexes[id] ? J(state.indexes[id]) : new Response('Not found', { status: 404 });
        }
        if (method === 'PUT') {
          const body = JSON.parse(opts.body);
          const existing = state.indexes[id];
          if (existing && existing.checkout && existing.checkout.deviceId) {
            if (!sameOwner(existing.checkout, state.identity.email, dev(opts))) {
              return new Response('Customer File is checked out by another user or device', { status: 403 });
            }
            body.checkout = existing.checkout;
          } else {
            delete body.checkout;
          }
          state.indexes[id] = body;
          state.etags[id] = 'etag-3';
          return J({ ok: true });
        }
      }

      m = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const name = decodeURIComponent(m[2]);
        if (method === 'GET') {
          return (ck(id, name) in state.components)
            ? J(state.components[ck(id, name)])
            : new Response('Not found', { status: 404 });
        }
        if (method === 'PUT') {
          state.components[ck(id, name)] = JSON.parse(opts.body);
          return J({ ok: true });
        }
      }

      m = /^media\/([^/]+)\/exists$/.exec(path);
      if (m && method === 'GET') {
        return J({ exists: !!state.media[decodeURIComponent(m[1])] });
      }
      m = /^media\/([^/]+)$/.exec(path);
      if (m) {
        const mediaId = decodeURIComponent(m[1]);
        if (method === 'GET') {
          if (!state.media[mediaId]) return new Response('Not found', { status: 404 });
          return new Response(state.media[mediaId].bytes, {
            status: 200, headers: { 'content-type': 'image/png' },
          });
        }
        if (method === 'PUT') {
          const bytes = new Uint8Array(await new Response(opts.body).arrayBuffer());
          state.media[mediaId] = { bytes: bytes };
          return J({ ok: true, bytes: bytes.length });
        }
      }
      return new Response('Not found', { status: 404 });
    };

    const stamp = '2026-10-07T00:00:00.000Z';

    /**
     * A job in the Cabinet with a plan, one Distress photograph and a report
     * that cites one cover picture. `holds` says which of those pictures the
     * Cabinet actually has.
     */
    function seed(id, holds) {
      state.components[ck(id, 'customer')] = {
        firstName: 'Rhonda', lastName: 'Sorenson', propertyAddress: '4925 Edwards Dr NE',
        cellPhone: '', homePhone: '', email: '', notes: '', companyName: '',
        spouseName: '', spouseCellPhone: '', spouseHomePhone: '', spouseEmail: '',
        mailingSameAsProperty: false, mailingAddress: '',
        propertyAddressLat: null, propertyAddressLon: null, customerUpdatedAt: stamp,
      };
      state.components[ck(id, 'plans')] = {
        id: 'ps-' + id, updatedAt: stamp, buildingType: 'residential', activeCanvasId: 'c1',
        canvases: [{
          id: 'c1', name: 'Main Level',
          plan: { id: 'plan-' + id, width: 100, height: 80 },
          rooms: [], frontDoorFacing: 'S', frontDoor: null,
        }],
      };
      state.components[ck(id, 'distress')] = {
        id: 'd-' + id, updatedAt: stamp,
        pins: [{ id: 'p1', canvasId: 'c1', photos: ['ph_' + id], num: 1 }],
        drawings: [], startNum: 1, nextNum: 2,
      };
      state.components[ck(id, 'floor')] = {
        id: 'f-' + id, updatedAt: stamp, schemaVersion: 1, byCanvasId: {},
      };
      state.components[ck(id, 'trash')] = {
        trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH, deletedAt: null, purgeAfter: null,
      };
      state.components[ck(id, 'report')] = {
        updatedAt: stamp,
        coverLayout: { locked: false, boxes: {}, overviewMediaId: 'report-cover-overview-' + id },
        pages: [],
      };
      state.indexes[id] = {
        id: id, createdAt: stamp, updatedAt: stamp,
        customerUpdatedAt: stamp, plansUpdatedAt: stamp, distressUpdatedAt: stamp,
        floorUpdatedAt: stamp, diagnosticsUpdatedAt: '', reportUpdatedAt: stamp,
        trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH, deletedAt: null, purgeAfter: null,
        displayName: 'Rhonda Sorenson', propertyAddress: '4925 Edwards Dr NE',
      };
      state.etags[id] = 'etag-1';
      if (holds.plan !== false) state.media['plan-' + id] = { bytes: new Uint8Array([1, 2, 3]) };
      if (holds.photo !== false) state.media['ph_' + id] = { bytes: new Uint8Array([4, 5, 6]) };
      if (holds.report === true) {
        state.media['report-cover-overview-' + id] = { bytes: new Uint8Array([7, 8, 9]) };
      }
    }

    async function clearLocal() {
      const prior = await ToolboxDB.getAllCustomerFiles();
      if (prior.length) await ToolboxDB.permanentlyDeleteCustomerFiles(prior);
    }

    const report = {};
    await clearLocal();
    localStorage.setItem('toolboxDeviceId', 'device-ipad-mini');

    // A. The report picture is not in the Cabinet. The job still arrives.
    seed('cf-a', { report: false });
    const seen = [];
    const stop = ToolboxSync.onSyncProgress(function (i) {
      if (i && i.total) seen.push(i.label + ' ' + i.done + ' of ' + i.total);
    });
    let outA = null;
    let errA = null;
    try { outA = await ToolboxSync.checkOutCustomerFile('cf-a'); }
    catch (err) { errA = (err && err.message) || String(err); }
    stop();
    const localA = await ToolboxDB.getCustomerFile('cf-a');
    report.A_ok = !errA && !!(outA && outA.ok);
    report.A_error = errA;
    report.A_onDevice = !!localA;
    report.A_leaseHeld = !!(state.indexes['cf-a'].checkout);
    report.A_reportCameToo = !!(localA && localA.reportBuilder &&
      localA.reportBuilder.coverLayout &&
      localA.reportBuilder.coverLayout.overviewMediaId === 'report-cover-overview-cf-a');
    report.A_named = ToolboxSync.describeMissingMedia(outA && outA.missingMedia);
    report.A_progressEnded = seen[seen.length - 1] || '';

    // B. A browse row says the job is here, not "available" again.
    const browseB = await ToolboxSync.browseCabinet();
    const rowB = (browseB.entries || []).find((e) => e.id === 'cf-a') || null;
    report.B_availability = rowB && rowB.availability;
    report.B_presence = rowB && rowB.presence;

    // C. A missing plan image still stops Check Out dead, and lets go of the lease.
    await clearLocal();
    seed('cf-c', { plan: false, report: true });
    let errC = null;
    try { await ToolboxSync.checkOutCustomerFile('cf-c'); }
    catch (err) { errC = (err && err.message) || String(err); }
    report.C_refused = !!errC;
    report.C_message = errC;
    report.C_notOnDevice = !(await ToolboxDB.getCustomerFile('cf-c'));
    report.C_leaseReleased = !state.indexes['cf-c'].checkout;

    // D. A missing Distress photograph still stops Check Out dead.
    await clearLocal();
    seed('cf-d', { photo: false, report: true });
    let errD = null;
    try { await ToolboxSync.checkOutCustomerFile('cf-d'); }
    catch (err) { errD = (err && err.message) || String(err); }
    report.D_refused = !!errD;
    report.D_notOnDevice = !(await ToolboxDB.getCustomerFile('cf-d'));

    // E. Check In of a job whose report picture is nowhere: it files, and
    //    says what is gone rather than keeping the job on this device.
    await clearLocal();
    seed('cf-e', { report: false });
    await ToolboxSync.checkOutCustomerFile('cf-e');
    let outE = null;
    let errE = null;
    try { outE = await ToolboxSync.checkInCustomerFile('cf-e'); }
    catch (err) { errE = (err && err.message) || String(err); }
    report.E_ok = !errE && !!(outE && outE.ok);
    report.E_error = errE;
    report.E_named = ToolboxSync.describeMissingMedia(outE && outE.missingMedia);
    report.E_offDevice = !(await ToolboxDB.getCustomerFile('cf-e'));
    report.E_leaseReleased = !state.indexes['cf-e'].checkout;

    // F. Check In when this device DOES hold the picture and the Cabinet does
    //    not: that is a failed upload with something real to lose, so Check In
    //    refuses and the job stays here.
    await clearLocal();
    seed('cf-f', { report: false });
    await ToolboxSync.checkOutCustomerFile('cf-f');
    // The picture appears on this device after Check Out, as it would when
    // the report is composed here.
    await ToolboxDB.putMedia('report-cover-overview-cf-f', 'data:image/png;base64,AAA');
    // Make the Cabinet refuse the upload so only this device holds it.
    const saved = window.fetch;
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (href === base + '/media/report-cover-overview-cf-f' && (opts && opts.method) === 'PUT') {
        return new Response('nope', { status: 500 });
      }
      return saved(url, opts);
    };
    let errF = null;
    try { await ToolboxSync.checkInCustomerFile('cf-f'); }
    catch (err) { errF = (err && err.message) || String(err); }
    window.fetch = saved;
    report.F_refused = !!errF;
    report.F_message = errF;
    report.F_stillHere = !!(await ToolboxDB.getCustomerFile('cf-f'));

    // G. Ordinary Sync Now of a local file whose report picture is gone from
    //    this device and from the Cabinet does not fail the whole file.
    await clearLocal();
    seed('cf-g', { report: true });
    await ToolboxSync.checkOutCustomerFile('cf-g');
    delete state.media['report-cover-overview-cf-g'];
    await ToolboxDB.deleteMedia('report-cover-overview-cf-g').catch(function () {});
    const recG = await ToolboxDB.getCustomerFile('cf-g');
    recG.notes = 'edited in the field';
    recG.customerUpdatedAt = '2026-10-21T13:00:00.000Z';
    if (recG.reportBuilder) recG.reportBuilder.updatedAt = '2026-10-21T13:00:00.000Z';
    await ToolboxDB.saveCustomerFile(recG);
    let errG = null;
    let outG = null;
    try { outG = await ToolboxSync.syncNow(); }
    catch (err) { errG = (err && err.message) || String(err); }
    report.G_ok = !errG && !!(outG && outG.ok);
    report.G_error = errG;
    report.G_message = outG && outG.message;

    return report;
  });

  check('Check Out finishes when the Cabinet has no report picture', out.A_ok, out.A_error || '');
  check('The job lands on the device', out.A_onDevice);
  check('The lease stays held', out.A_leaseHeld);
  check('The report itself still comes down', out.A_reportCameToo);
  check('What did not come is named',
    /1 report picture is not in the File Cabinet/.test(out.A_named || ''), out.A_named);
  check('Progress is not left stopped mid-count',
    out.A_progressEnded === 'report pictures 1 of 1', out.A_progressEnded);
  check('The Cabinet row says the job is on this device',
    out.B_availability === 'checked-out-here' && out.B_presence === 'local',
    out.B_availability + '/' + out.B_presence);
  check('A missing plan image still refuses Check Out', out.C_refused, out.C_message || '');
  check('And says which kind of picture, and that nothing here changed',
    /could not hand over a plan image this job needs/.test(out.C_message || '') &&
    /Nothing here was changed\./.test(out.C_message || ''), out.C_message);
  check('A refused Check Out leaves nothing on the device', out.C_notOnDevice);
  check('A refused Check Out lets go of the lease', out.C_leaseReleased);
  check('A missing Distress photograph still refuses Check Out', out.D_refused);
  check('A refused Check Out leaves no Distress job behind', out.D_notOnDevice);
  check('Check In files a job whose report picture is nowhere', out.E_ok, out.E_error || '');
  check('Check In names the picture that is gone',
    /1 report picture is not in the File Cabinet/.test(out.E_named || ''), out.E_named);
  check('Check In still clears this device', out.E_offDevice);
  check('Check In still releases the lease', out.E_leaseReleased);
  check('Check In refuses when only this device holds the picture', out.F_refused, out.F_message || '');
  check('A refused Check In keeps the job here', out.F_stillHere);
  check('Sync Now does not fail the file over a picture that is nowhere',
    out.G_ok, out.G_error || '');
  check('Sync Now still answers in its own words',
    out.G_message === 'Sync complete.' || out.G_message === 'Everything is already synced.',
    out.G_message);
} finally {
  await browser.close();
  server.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
