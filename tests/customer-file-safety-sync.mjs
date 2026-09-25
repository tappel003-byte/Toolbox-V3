/**
 * Live safety sync + checked-out-elsewhere lock.
 * Run: node tests/customer-file-safety-sync.mjs
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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c);
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
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxDB && window.ToolboxApp);

  const out = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    localStorage.removeItem('toolboxForeignCheckouts');
    localStorage.setItem('toolboxDeviceId', 'device-b');

    const state = {
      online: true,
      identity: { email: 'lee@example.com', sub: 'sub-lee' },
      indexes: Object.create(null),
      components: Object.create(null),
      media: Object.create(null),
      purged: Object.create(null),
    };

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: function () { return state.online; },
    });

    function compKey(id, name) { return id + '::' + name; }
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      if (!state.online) throw new TypeError('offline');
      const path = href.slice(base.length).replace(/^\//, '');
      const method = (opts && opts.method) || 'GET';
      if (path === 'health' && method === 'GET') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === 'me' && method === 'GET') {
        return new Response(JSON.stringify(state.identity), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === 'files' && method === 'GET') {
        return new Response(JSON.stringify({
          files: Object.values(state.indexes),
          purged: Object.keys(state.purged).map((id) => state.purged[id]),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      let match = /^files\/([^/]+)\/index$/.exec(path);
      if (match && method === 'PUT') {
        const id = decodeURIComponent(match[1]);
        const existing = state.indexes[id];
        if (existing && existing.checkout && existing.checkout.deviceId &&
            existing.checkout.deviceId !== localStorage.getItem('toolboxDeviceId')) {
          return new Response('Customer File is checked out by another user or device', { status: 403 });
        }
        const body = JSON.parse(opts.body);
        if (existing && existing.checkout) body.checkout = existing.checkout;
        state.indexes[id] = body;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (match && method === 'GET') {
        const id = decodeURIComponent(match[1]);
        if (!state.indexes[id]) return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(state.indexes[id]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      match = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
      if (match && method === 'PUT') {
        const id = decodeURIComponent(match[1]);
        const name = decodeURIComponent(match[2]);
        const existing = state.indexes[id];
        if (existing && existing.checkout && existing.checkout.deviceId &&
            existing.checkout.deviceId !== localStorage.getItem('toolboxDeviceId')) {
          return new Response('Customer File is checked out by another user or device', { status: 403 });
        }
        state.components[id + '::' + name] = JSON.parse(opts.body);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (match && method === 'GET') {
        const key = compKey(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
        if (!(key in state.components)) return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(state.components[key]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      match = /^media\/([^/]+)\/exists$/.exec(path);
      if (match && method === 'GET') {
        return new Response(JSON.stringify({ exists: !!state.media[decodeURIComponent(match[1])] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      match = /^media\/([^/]+)$/.exec(path);
      if (match && method === 'PUT') {
        state.media[decodeURIComponent(match[1])] = { bytes: 1 };
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    };

    const report = {};
    const prior = await ToolboxDB.getAllCustomerFiles();
    if (prior.length) await ToolboxDB.permanentlyDeleteCustomerFiles(prior);

    const offline = ToolboxApp.blankCustomerFile('cf-offline');
    ToolboxPlanSetup.ensurePlanSetup(offline);
    offline.firstName = 'Offline';
    offline.lastName = 'Save';
    offline.customerUpdatedAt = '2026-09-24T12:00:00.000Z';
    state.online = false;
    await ToolboxDB.saveCustomerFile(offline);
    const offlineSaved = await ToolboxDB.getCustomerFile('cf-offline');
    report.offlineName = offlineSaved && offlineSaved.firstName;
    report.offlineStillLocal = !!offlineSaved;
    let offlineCode = '';
    try { await ToolboxSync.syncNow(); } catch (err) { offlineCode = err && err.code; }
    report.offlineSyncCode = offlineCode;
    report.offlineNotUploaded = !state.indexes['cf-offline'];
    const offlineAfter = await ToolboxDB.getCustomerFile('cf-offline');
    report.offlineKept = offlineAfter && offlineAfter.firstName === 'Offline';

    state.online = true;
    state.indexes['cf-cloud-only'] = {
      id: 'cf-cloud-only',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      customerUpdatedAt: '2026-01-01T00:00:00.000Z',
      plansUpdatedAt: '2026-01-01T00:00:00.000Z',
      distressUpdatedAt: '2026-01-01T00:00:00.000Z',
      floorUpdatedAt: '2026-01-01T00:00:00.000Z',
      trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH,
      displayName: 'Cloud Only',
      propertyAddress: '1 Remote Rd',
      deletedAt: null,
    };
    state.components['cf-cloud-only::customer'] = { firstName: 'Cloud', lastName: 'Only', customerUpdatedAt: '2026-01-01T00:00:00.000Z' };

    const uploaded = await ToolboxSync.syncNow();
    report.uploadMessage = uploaded && uploaded.message;
    report.uploadOk = uploaded && uploaded.ok === true && uploaded.uploaded === true;
    report.uploadName = state.components['cf-offline::customer'] && state.components['cf-offline::customer'].firstName;
    report.cloudOnlyStayedRemote = !(await ToolboxDB.getCustomerFile('cf-cloud-only'));

    const again = await ToolboxSync.syncNow();
    report.noopMessage = again && again.message;
    report.noopUploaded = again && again.uploaded;

    const unrelated = ToolboxApp.blankCustomerFile('cf-unrelated');
    ToolboxPlanSetup.ensurePlanSetup(unrelated);
    unrelated.firstName = 'Unrelated';
    unrelated.lastName = 'Local';
    unrelated.customerUpdatedAt = '2026-09-24T13:00:00.000Z';
    await ToolboxDB.saveCustomerFile(unrelated);

    const shared = ToolboxApp.blankCustomerFile('cf-shared');
    ToolboxPlanSetup.ensurePlanSetup(shared);
    shared.firstName = 'Safety';
    shared.lastName = 'Copy';
    shared.propertyAddress = '9 Field Lane';
    shared.customerUpdatedAt = '2026-09-24T15:00:00.000Z';
    await ToolboxDB.saveCustomerFile(shared);
    await ToolboxDB.putMedia('plan-safety', 'data:image/png;base64,c2FmZQ==');
    state.indexes['cf-shared'] = {
      id: 'cf-shared',
      createdAt: shared.createdAt,
      updatedAt: '2026-09-24T14:00:00.000Z',
      customerUpdatedAt: '2026-09-24T14:00:00.000Z',
      plansUpdatedAt: '2026-09-24T14:00:00.000Z',
      distressUpdatedAt: '2026-09-24T14:00:00.000Z',
      floorUpdatedAt: '2026-09-24T14:00:00.000Z',
      trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH,
      displayName: 'Cabinet Copy',
      propertyAddress: '9 Field Lane',
      deletedAt: null,
      checkout: {
        email: 'tim@example.com',
        sub: 'sub-tim',
        deviceId: 'device-a',
        deviceLabel: 'Field iPad',
        checkedOutAt: '2026-09-24T14:30:00.000Z',
      },
    };
    state.components['cf-shared::customer'] = {
      firstName: 'Cabinet',
      lastName: 'Copy',
      propertyAddress: '9 Field Lane',
      customerUpdatedAt: '2026-09-24T14:00:00.000Z',
    };

    const locks = await ToolboxSync.refreshLocalCheckoutLocks();
    report.lockOk = locks.ok === true;
    report.locked = ToolboxSync.isCheckedOutElsewhere('cf-shared');
    report.lockLabel = ToolboxSync.foreignCheckoutLabel('cf-shared');
    report.unrelatedUnlocked = !ToolboxSync.isCheckedOutElsewhere('cf-unrelated');
    report.offlineUnlocked = !ToolboxSync.isCheckedOutElsewhere('cf-offline');
    const safety = await ToolboxDB.getCustomerFile('cf-shared');
    report.safetyName = safety && safety.firstName;
    report.safetyMedia = await ToolboxDB.getMedia('plan-safety');
    let mutateBlocked = false;
    try {
      safety.firstName = 'Mutated';
      safety.customerUpdatedAt = '2026-09-24T16:00:00.000Z';
      await ToolboxDB.saveCustomerFile(safety);
    } catch (err) {
      mutateBlocked = err && err.code === 'checkout';
    }
    const safetyAfter = await ToolboxDB.getCustomerFile('cf-shared');
    report.mutateBlocked = mutateBlocked && safetyAfter && safetyAfter.firstName === 'Safety';
    let syncCode = '';
    let syncMessage = '';
    try {
      await ToolboxSync.syncNow();
    } catch (err) {
      syncCode = err && err.code;
      syncMessage = err && err.message;
    }
    report.syncBlockedCode = syncCode;
    report.syncBlockedMessage = syncMessage;
    report.syncNotSuccess = syncMessage.indexOf('Sync complete.') === -1 &&
      syncMessage.indexOf('Everything is already synced.') === -1;
    report.remoteUnchanged = state.components['cf-shared::customer'].firstName === 'Cabinet';
    report.localKept = !!(await ToolboxDB.getCustomerFile('cf-shared'));
    report.cloudOnlyStillRemote = !(await ToolboxDB.getCustomerFile('cf-cloud-only'));
    const unrelatedStill = await ToolboxDB.getCustomerFile('cf-unrelated');
    report.unrelatedKept = unrelatedStill && unrelatedStill.firstName === 'Unrelated';

    delete state.indexes['cf-shared'].checkout;
    const released = await ToolboxSync.refreshLocalCheckoutLocks();
    report.released = released.ok === true && !ToolboxSync.isCheckedOutElsewhere('cf-shared');
    report.releasedLabel = ToolboxSync.foreignCheckoutLabel('cf-shared');
    safetyAfter.firstName = 'Available';
    safetyAfter.customerUpdatedAt = '2026-09-24T17:00:00.000Z';
    await ToolboxDB.saveCustomerFile(safetyAfter);
    report.savedAfterRelease = (await ToolboxDB.getCustomerFile('cf-shared')).firstName === 'Available';

    const quiet = ToolboxApp.blankCustomerFile('cf-quiet');
    ToolboxPlanSetup.ensurePlanSetup(quiet);
    quiet.firstName = 'Quiet';
    quiet.lastName = 'Sync';
    quiet.customerUpdatedAt = '2026-09-24T19:00:00.000Z';
    delete state.indexes['cf-shared'].checkout;
    await ToolboxSync.refreshLocalCheckoutLocks();
    await ToolboxDB.saveCustomerFile(quiet);
    ToolboxSync._test.queueLocalSaveForQuietSync('cf-quiet');
    const quietResult = await ToolboxSync.flushQuietSync();
    report.quietUploaded = quietResult && quietResult.uploaded === true &&
      state.components['cf-quiet::customer'] &&
      state.components['cf-quiet::customer'].firstName === 'Quiet';
    report.quietDidNotMaterializeCloud = !(await ToolboxDB.getCustomerFile('cf-cloud-only'));

    state.indexes['cf-shared'].checkout = {
      email: 'tim@example.com',
      sub: 'sub-tim',
      deviceId: 'device-a',
      checkedOutAt: '2026-09-24T18:00:00.000Z',
    };
    await ToolboxSync.refreshLocalCheckoutLocks();
    report.plainLabel = ToolboxSync.foreignCheckoutLabel('cf-shared');
    report.plainNotInvented = report.plainLabel === 'Checked out on another device';

    const broken = ToolboxApp.blankCustomerFile('cf-broken-media');
    ToolboxPlanSetup.ensurePlanSetup(broken);
    broken.firstName = 'Broken';
    broken.customerUpdatedAt = '2026-09-24T20:00:00.000Z';
    broken.planSetup.canvases[0].plan = { id: 'plan-missing-safety', width: 8, height: 8 };
    broken.planSetup.updatedAt = '2026-09-24T20:00:00.000Z';
    await ToolboxDB.saveCustomerFile(broken);
    let failMessage = '';
    try { await ToolboxSync.syncNow(); } catch (err) { failMessage = err && err.message || ''; }
    report.failMessage = failMessage;
    report.failIdentifies = /plan-missing-safety|Missing local media/i.test(failMessage);
    report.failNotSuccess = failMessage.indexOf('Sync complete.') === -1 &&
      failMessage.indexOf('Everything is already synced.') === -1;

    window.location.hash = '#/trash';
    window.location.hash = '#/';
    await new Promise((r) => setTimeout(r, 600));
    const shell = document.querySelector('.cabinet-row-shell[data-customer-file-id="cf-shared"]');
    const other = document.querySelector('.cabinet-row-shell[data-customer-file-id="cf-unrelated"]');
    report.rowLocked = !!(shell && shell.classList.contains('is-checked-out-elsewhere'));
    report.rowText = shell ? (shell.querySelector('.cabinet-row__location') || {}).textContent || '' : '';
    report.rowNoTrash = !(shell && shell.querySelector('.cabinet-row-menu__danger'));
    report.otherOpen = !!(other && !other.classList.contains('is-checked-out-elsewhere'));
    report.rowPresent = !!shell;

    window.location.hash = '#/file/cf-shared/distress';
    await new Promise((r) => setTimeout(r, 200));
    report.distressBlocked = !!document.querySelector('.cf-readonly__status');
    report.distressNoFrame = !document.querySelector('iframe');
    report.readonlyText = (document.querySelector('.cf-readonly__status') || {}).textContent || '';

    return report;
  });

  check('Offline local Save persists without a network', out.offlineName === 'Offline' && out.offlineStillLocal && out.offlineKept && out.offlineNotUploaded, JSON.stringify(out));
  check('Offline Sync Now does not pretend to upload', out.offlineSyncCode === 'offline', out.offlineSyncCode);
  check('Reconnect Sync Now uploads', out.uploadOk && out.uploadMessage === 'Sync complete.' && out.uploadName === 'Offline', JSON.stringify(out));
  check('Sync Now with nothing to upload says everything is already synced', out.noopMessage === 'Everything is already synced.' && out.noopUploaded === false, JSON.stringify(out));
  check('Cloud-only Customer File is not auto-materialized', out.cloudOnlyStayedRemote === true, JSON.stringify(out));
  check('Foreign checkout locks the existing local copy', out.lockOk && out.locked && out.lockLabel === 'Checked out on Field iPad', JSON.stringify(out));
  check('Locked local copy and its media stay on the device', out.safetyName === 'Safety' && out.safetyMedia && out.localKept, JSON.stringify(out));
  check('Locked Customer File cannot be mutated', out.mutateBlocked === true, JSON.stringify(out));
  check('Locked Customer File cannot sync over the other device', out.syncBlockedCode === 'incomplete' && out.syncNotSuccess && out.remoteUnchanged && /Checked out on Field iPad/.test(out.syncBlockedMessage), out.syncBlockedMessage);
  check('Unrelated local file and cloud-only file stay unaffected', out.unrelatedUnlocked && out.unrelatedKept && out.cloudOnlyStillRemote && out.offlineUnlocked, JSON.stringify(out));
  check('Releasing the other device checkout restores local availability', out.released && out.releasedLabel === '' && out.savedAfterRelease, JSON.stringify(out));
  check('Missing device label does not invent one', out.plainNotInvented, out.plainLabel);
  check('Quiet sync uploads the saved local file only', out.quietUploaded && out.quietDidNotMaterializeCloud, JSON.stringify(out));
  check('Media failure is identified and is not called success', out.failIdentifies && out.failNotSuccess, out.failMessage);
  check('Customer Files card is gray and read-only', out.rowPresent && out.rowLocked && out.rowText === 'Checked out on another device' && out.rowNoTrash && out.otherOpen, JSON.stringify(out));
  check('Distress capture is not opened while checked out elsewhere', out.distressBlocked && out.distressNoFrame && /Checked out on another device/.test(out.readonlyText), out.readonlyText);

  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await page.screenshot({ path: '/opt/cursor/artifacts/checked-out-readonly-desktop.png', fullPage: true });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForFunction(() => document.querySelector('.cabinet-row-shell.is-checked-out-elsewhere'));
  await page.screenshot({ path: '/opt/cursor/artifacts/checked-out-gray-phone.png', fullPage: true });
  const phone = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    locked: !!document.querySelector('.cabinet-row-shell.is-checked-out-elsewhere'),
  }));
  check('Phone list does not overflow horizontally', phone.locked && !phone.overflow, JSON.stringify(phone));

  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
  const ipad = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  check('iPad list does not overflow horizontally', !ipad.overflow, JSON.stringify(ipad));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
