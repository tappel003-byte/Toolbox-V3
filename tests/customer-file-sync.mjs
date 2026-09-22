/**
 * Stage A sync plumbing tests (no live Cloudflare required).
 * Run: node tests/customer-file-sync.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import vm from 'vm';
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

function loadSyncModule() {
  const code = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
  const sandbox = {
    window: {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    console,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'sync.js' });
  return sandbox.window.ToolboxSync;
}

const Sync = loadSyncModule();

// --- Pure revision / comparison tests ---
{
  const local = {
    id: 'cf-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    customerUpdatedAt: '2026-01-02T00:00:00.000Z',
    planSetup: { updatedAt: '2026-01-01T00:00:00.000Z', canvases: [] },
    distress: { updatedAt: '2026-01-03T00:00:00.000Z', pins: [] },
    floorSurvey: { updatedAt: '2026-01-01T12:00:00.000Z', byCanvasId: {} },
    trashUpdatedAt: '2026-01-01T00:00:00.000Z',
  };
  check(
    'Customer Information revision is independent',
    Sync.componentRevision(local, 'customer') === '2026-01-02T00:00:00.000Z' &&
      Sync.componentRevision(local, 'distress') === '2026-01-03T00:00:00.000Z',
  );
  check(
    'Distress revision does not use customer clock',
    Sync.componentRevision(local, 'distress') !== Sync.componentRevision(local, 'customer'),
  );
  check(
    'Floor revision does not use distress clock',
    Sync.componentRevision(local, 'floor') !== Sync.componentRevision(local, 'distress'),
  );
  check('Newer customer pushes independently', Sync.chooseSide('2026-01-05T00:00:00.000Z', '2026-01-01T00:00:00.000Z') === 'push');
  check('Newer remote distress pulls independently', Sync.chooseSide('2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z') === 'pull');
  check('Same-component newest wins (local)', Sync.chooseSide('2026-01-10T00:00:00.000Z', '2026-01-09T00:00:00.000Z') === 'push');
  check('Same-component newest wins (remote)', Sync.chooseSide('2026-01-08T00:00:00.000Z', '2026-01-09T00:00:00.000Z') === 'pull');
  check('Equal revisions skip', Sync.chooseSide('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z') === 'skip');
}

{
  const record = {
    planSetup: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      canvases: [{ id: 'c1', plan: { id: 'pl_abc', width: 10, height: 10 } }],
    },
    distress: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      pins: [{ id: 'p1', photos: ['ph_one', 'ph_two', 'note'] }],
    },
  };
  check('Plan media ids detected', Sync.mediaIdsForComponent(record, 'plans').join(',') === 'pl_abc');
  check('Distress photo ids detected', Sync.mediaIdsForComponent(record, 'distress').sort().join(',') === 'ph_one,ph_two');
}

{
  const record = {
    id: 'cf-import',
    customerUpdatedAt: '2026-01-01T00:00:00.000Z',
    planSetup: { updatedAt: '2026-01-01T00:00:00.000Z', canvases: [{ id: 'c', plan: { id: 'plan-import-1' } }] },
    distress: { updatedAt: '2026-01-01T00:00:00.000Z', pins: [{ photos: ['ph_import-9'] }] },
    floorSurvey: { updatedAt: '2026-01-01T00:00:00.000Z', byCanvasId: {} },
    recoveryImports: [{ fingerprint: 'abc' }],
    trashUpdatedAt: '2026-01-01T00:00:00.000Z',
  };
  const index = Sync.buildIndex(record);
  check(
    'Importer-created native CF is recognized by sync index',
    index.id === 'cf-import' &&
      index.plansUpdatedAt &&
      Sync.mediaIdsForComponent(record, 'plans')[0] === 'plan-import-1' &&
      Sync.mediaIdsForComponent(record, 'distress')[0] === 'ph_import-9',
  );
}

{
  const record = {
    trashUpdatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: '2026-02-01T00:00:00.000Z',
    purgeAfter: '2026-06-01T00:00:00.000Z',
  };
  check(
    'Trash revision uses trashUpdatedAt',
    Sync.componentRevision(record, 'trash') === '2026-02-01T00:00:00.000Z',
  );
  const applied = { id: 'x' };
  Sync.applyComponent(applied, 'trash', {
    trashUpdatedAt: '2026-03-01T00:00:00.000Z',
    deletedAt: null,
    purgeAfter: null,
  });
  check(
    'Trash restore payload clears deletedAt',
    !applied.deletedAt && applied.trashUpdatedAt === '2026-03-01T00:00:00.000Z',
  );
}

{
  const sample = 'data:text/plain;base64,' + Buffer.from('hello').toString('base64');
  const packed = Sync._test.dataUrlToBytes(sample);
  const round = Sync._test.bytesToDataUrl(packed.bytes, packed.contentType);
  check('Media bytes round-trip helper works', round.startsWith('data:text/plain;base64,') && packed.bytes.length === 5);
}

{
  const empty = {
    firstName: '',
    lastName: '',
    propertyAddress: '',
    planSetup: { buildingType: 'residential', canvases: [{ plan: null, rooms: [], frontDoor: null }] },
    distress: { pins: [], drawings: [], startNum: 1, nextNum: 1 },
    floorSurvey: { byCanvasId: { c1: { canvasId: 'c1' } } },
  };
  check('Default customer shell detected', Sync.isDefaultShellComponent(empty, 'customer'));
  check('Default plans shell detected', Sync.isDefaultShellComponent(empty, 'plans'));
  check('Default distress shell detected', Sync.isDefaultShellComponent(empty, 'distress'));
  check('Default floor shell detected (empty layer slots only)', Sync.isDefaultShellComponent(empty, 'floor'));

  const meaningful = {
    firstName: 'Tim',
    lastName: '',
    propertyAddress: '',
    planSetup: {
      buildingType: 'residential',
      canvases: [{ plan: { id: 'pl_1', width: 1, height: 1 }, rooms: [], frontDoor: null }],
    },
    distress: { pins: [{ id: 'p1', photos: [] }], drawings: [], startNum: 1, nextNum: 1 },
    floorSurvey: {
      byCanvasId: { c1: { canvasId: 'c1', points: [{ x: 1, y: 2, elev: 0 }] } },
    },
  };
  check('Name-only customer is not a default shell', !Sync.isDefaultShellComponent(meaningful, 'customer'));
  check('Plan-bearing plans component is not a default shell', !Sync.isDefaultShellComponent(meaningful, 'plans'));
  check('Pinned distress is not a default shell', !Sync.isDefaultShellComponent(meaningful, 'distress'));
  check('Floor with readings is not a default shell', !Sync.isDefaultShellComponent(meaningful, 'floor'));
  check('Meaningful customer payload recognized', Sync.isMeaningfulComponentPayload({ firstName: 'Lee' }, 'customer'));
  check('Empty customer payload not meaningful', !Sync.isMeaningfulComponentPayload({ firstName: '' }, 'customer'));
}

{
  const inv = Sync._test.compareInventories(
    [{ id: 'a', deletedAt: null }, { id: 'local-only', deletedAt: null }],
    [{ id: 'a', deletedAt: '2026-01-01T00:00:00.000Z' }, { id: 'remote-only', deletedAt: null }],
    { b: true },
  );
  check(
    'Inventory reports trash-state disagreement without treating selective local/cloud as failure',
    inv.ok === false &&
      inv.mismatches.some((m) => m.reason === 'trash-state-mismatch') &&
      inv.localOnly.includes('local-only') &&
      inv.remoteOnly.includes('remote-only'),
  );
  const withPurgedLocal = Sync._test.compareInventories(
    [{ id: 'a', deletedAt: null }, { id: 'b', deletedAt: null }],
    [{ id: 'a', deletedAt: null }],
    { b: true },
  );
  check(
    'Purged local ids excluded from inventory compare',
    withPurgedLocal.ok === true && !withPurgedLocal.localOnly.includes('b'),
  );
  const healthy = Sync._test.compareInventories(
    [{ id: 'a', deletedAt: null }],
    [{ id: 'a', deletedAt: null }, { id: 'cloud-job', deletedAt: null }],
    {},
  );
  check(
    'Remote-only Cabinet entries do not fail selective inventory compare',
    healthy.ok === true && healthy.remoteOnly.includes('cloud-job'),
  );
  const localDraft = Sync._test.compareInventories(
    [{ id: 'draft', deletedAt: null }],
    [],
    {},
  );
  check(
    'Local-only draft is not an inventory mismatch',
    localDraft.ok === true && localDraft.localOnly.includes('draft'),
  );
}

// --- Browser: local save without network; sync failure isolated ---
async function freePort() {
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
      const response = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});
await waitForServer(port);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });

  const saveOk = await page.evaluate(async () => {
    const record = ToolboxApp.blankCustomerFile('sync-save-local');
    ToolboxPlanSetup.ensurePlanSetup(record);
    record.firstName = 'Local';
    record.lastName = 'Only';
    record.customerUpdatedAt = new Date().toISOString();
    record.updatedAt = record.customerUpdatedAt;
    await ToolboxDB.saveCustomerFile(record);
    const loaded = await ToolboxDB.getCustomerFile('sync-save-local');
    return !!(loaded && loaded.firstName === 'Local' && loaded.customerUpdatedAt);
  });
  check('Local Save remains functional without sync network', saveOk);

  const isolated = await page.evaluate(async () => {
    window.ToolboxConfig.syncApiBase = 'http://127.0.0.1:9'; // guaranteed closed port
    const before = await ToolboxDB.getCustomerFile('sync-save-local');
    let failed = false;
    let code = '';
    try {
      await ToolboxSync.syncNow();
    } catch (err) {
      failed = true;
      code = err && err.code;
    }
    const after = await ToolboxDB.getCustomerFile('sync-save-local');
    return {
      failed,
      code,
      intact: after && after.firstName === before.firstName && after.customerUpdatedAt === before.customerUpdatedAt,
    };
  });
  check(
    'Sync/network failure does not damage local data',
    isolated.failed && isolated.intact,
    JSON.stringify(isolated),
  );

  const independentBump = await page.evaluate(async () => {
    const record = await ToolboxDB.getCustomerFile('sync-save-local');
    const customerBefore = record.customerUpdatedAt;
    record.distress.pins = [{ id: 'pin1', num: 1, photos: [], canvasId: record.planSetup.activeCanvasId }];
    record.distress.updatedAt = '2026-05-01T00:00:00.000Z';
    record.updatedAt = '2026-05-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(record);
    const loaded = await ToolboxDB.getCustomerFile('sync-save-local');
    return {
      customerSame: loaded.customerUpdatedAt === customerBefore,
      distressNew: loaded.distress.updatedAt === '2026-05-01T00:00:00.000Z',
      choose: ToolboxSync.chooseSide(loaded.customerUpdatedAt, '2020-01-01T00:00:00.000Z'),
    };
  });
  check(
    'Distress revision change leaves Customer Information revision intact',
    independentBump.customerSame && independentBump.distressNew && independentBump.choose === 'push',
    JSON.stringify(independentBump),
  );

  const remotePullShell = await page.evaluate(() => {
    const remote = {
      id: 'cf-remote-only',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      customerUpdatedAt: '2026-06-01T00:00:00.000Z',
      plansUpdatedAt: '2026-06-01T00:00:00.000Z',
      distressUpdatedAt: '2026-06-01T00:00:00.000Z',
      floorUpdatedAt: '2026-06-01T00:00:00.000Z',
      trashUpdatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    };
    const naive = ToolboxApp.blankCustomerFile(remote.id);
    ToolboxPlanSetup.ensurePlanSetup(naive);
    if (remote.createdAt) naive.createdAt = remote.createdAt;
    const naiveCustomer = ToolboxSync.chooseSide(
      ToolboxSync.componentRevision(naive, 'customer'),
      remote.customerUpdatedAt,
    );
    const naivePlans = ToolboxSync.chooseSide(
      ToolboxSync.componentRevision(naive, 'plans'),
      remote.plansUpdatedAt,
    );
    const shell = ToolboxSync._test.shellForRemotePull(remote.id, remote);
    const decisions = {
      customer: ToolboxSync.chooseSide(ToolboxSync.componentRevision(shell, 'customer'), remote.customerUpdatedAt),
      plans: ToolboxSync.chooseSide(ToolboxSync.componentRevision(shell, 'plans'), remote.plansUpdatedAt),
      distress: ToolboxSync.chooseSide(ToolboxSync.componentRevision(shell, 'distress'), remote.distressUpdatedAt),
      floor: ToolboxSync.chooseSide(ToolboxSync.componentRevision(shell, 'floor'), remote.floorUpdatedAt),
      trash: ToolboxSync.chooseSide(ToolboxSync.componentRevision(shell, 'trash'), remote.trashUpdatedAt),
    };
    return {
      naiveWouldPushCustomer: naiveCustomer === 'push',
      naiveWouldPushPlans: naivePlans === 'push',
      decisions,
      epochClocks: shell.customerUpdatedAt === '1970-01-01T00:00:00.001Z' &&
        shell.planSetup.updatedAt === '1970-01-01T00:00:00.001Z' &&
        shell.distress.updatedAt === '1970-01-01T00:00:00.001Z' &&
        shell.floorSurvey.updatedAt === '1970-01-01T00:00:00.001Z' &&
        shell.trashUpdatedAt === '1970-01-01T00:00:00.001Z',
      // componentRevision calls ensurePlanSetup; epoch must survive that backfill.
      afterRevisionStillEpoch: ToolboxSync.componentRevision(shell, 'customer') === '1970-01-01T00:00:00.001Z',
    };
  });
  check(
    'Naive remote-only shell would push empty clocks over older cloud data',
    remotePullShell.naiveWouldPushCustomer && remotePullShell.naiveWouldPushPlans,
    JSON.stringify(remotePullShell),
  );
  check(
    'Remote-only pull shell uses epoch clocks so every component pulls',
    remotePullShell.epochClocks &&
      remotePullShell.afterRevisionStillEpoch &&
      remotePullShell.decisions.customer === 'pull' &&
      remotePullShell.decisions.plans === 'pull' &&
      remotePullShell.decisions.distress === 'pull' &&
      remotePullShell.decisions.floor === 'pull' &&
      remotePullShell.decisions.trash === 'pull',
    JSON.stringify(remotePullShell),
  );

  const deleteProtect = await page.evaluate(() => {
    const named = ToolboxApp.blankCustomerFile('del-named');
    ToolboxPlanSetup.ensurePlanSetup(named);
    named.firstName = 'Tim';
    named.lastName = 'Appel';
    named.propertyAddress = '50 Steeplechase';
    const planned = ToolboxApp.blankCustomerFile('del-plan');
    ToolboxPlanSetup.ensurePlanSetup(planned);
    planned.planSetup.canvases[0].plan = { id: 'plan-1', width: 10, height: 10 };
    const empty = ToolboxApp.blankCustomerFile('del-empty');
    ToolboxPlanSetup.ensurePlanSetup(empty);
    return {
      namedIsStub: ToolboxApp.isEmptyCustomerFileStub(named),
      plannedIsStub: ToolboxApp.isEmptyCustomerFileStub(planned),
      emptyIsStub: ToolboxApp.isEmptyCustomerFileStub(empty),
    };
  });
  check(
    'Named or plan-bearing Customer Files are not empty stubs',
    deleteProtect.namedIsStub === false &&
      deleteProtect.plannedIsStub === false &&
      deleteProtect.emptyIsStub === true,
    JSON.stringify(deleteProtect),
  );

  const addressOnly = await page.evaluate(() => {
    const address = ToolboxApp.blankCustomerFile('del-address');
    ToolboxPlanSetup.ensurePlanSetup(address);
    address.propertyAddress = '50 Steeplechase';
    return ToolboxApp.isEmptyCustomerFileStub(address);
  });
  check('Address-only Customer File is not an empty stub', addressOnly === false);

  const trashEpoch = await page.evaluate(() => {
    const record = ToolboxApp.blankCustomerFile('trash-clock');
    ToolboxPlanSetup.ensurePlanSetup(record);
    record.updatedAt = '2026-09-01T00:00:00.000Z';
    delete record.trashUpdatedAt;
    ToolboxPlanSetup.ensurePlanSetup(record);
    return {
      trashUpdatedAt: record.trashUpdatedAt,
      blankUsesEpoch: ToolboxApp.blankCustomerFile('x').trashUpdatedAt === ToolboxSync.REMOTE_PULL_EPOCH,
    };
  });
  check(
    'Missing trashUpdatedAt backfills epoch (not updatedAt/now)',
    trashEpoch.blankUsesEpoch && trashEpoch.trashUpdatedAt === '1970-01-01T00:00:00.001Z',
    JSON.stringify(trashEpoch),
  );

  const syncBtn = await page.$('#app-sync');
  check('Sync Now control is present', !!syncBtn);

  // ---- Mock Sync API cabinet (deterministic, no Cloudflare) ----
  const hardening = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;

    const cabinet = {
      indexes: Object.create(null),
      components: Object.create(null),
      media: Object.create(null),
      purged: Object.create(null),
    };

    function compKey(id, name) { return id + '::' + name; }

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const path = href.slice(base.length).replace(/^\//, '');
      const method = (opts && opts.method) || 'GET';

      if (path === 'health' && method === 'GET') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === 'files' && method === 'GET') {
        return new Response(JSON.stringify({
          files: Object.values(cabinet.indexes),
          purged: Object.keys(cabinet.purged).map((id) => cabinet.purged[id]),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      let match = /^files\/([^/]+)$/.exec(path);
      if (match && method === 'DELETE') {
        const id = decodeURIComponent(match[1]);
        Object.keys(cabinet.indexes).forEach((k) => { if (k === id) delete cabinet.indexes[k]; });
        Object.keys(cabinet.components).forEach((k) => { if (k.startsWith(id + '::')) delete cabinet.components[k]; });
        cabinet.purged[id] = { id: id, purgedAt: '2026-09-01T00:00:00.000Z', reason: 'permanent-delete' };
        return new Response(JSON.stringify({ ok: true, deleted: id, purged: cabinet.purged[id] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      match = /^files\/([^/]+)\/index$/.exec(path);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (cabinet.purged[id] && method === 'PUT') {
          return new Response('Customer File permanently deleted', { status: 409 });
        }
        if (method === 'GET') {
          if (!cabinet.indexes[id]) return new Response('Not found', { status: 404 });
          return new Response(JSON.stringify(cabinet.indexes[id]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (method === 'PUT') {
          const body = JSON.parse(opts.body);
          cabinet.indexes[id] = body;
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
      }

      match = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const name = decodeURIComponent(match[2]);
        const key = compKey(id, name);
        if (cabinet.purged[id] && method === 'PUT') {
          return new Response('Customer File permanently deleted', { status: 409 });
        }
        if (method === 'GET') {
          if (!(key in cabinet.components)) return new Response('Not found', { status: 404 });
          return new Response(JSON.stringify(cabinet.components[key]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (method === 'PUT') {
          cabinet.components[key] = JSON.parse(opts.body);
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
      }

      match = /^media\/([^/]+)\/exists$/.exec(path);
      if (match && method === 'GET') {
        const mediaId = decodeURIComponent(match[1]);
        return new Response(JSON.stringify({ exists: !!cabinet.media[mediaId] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      match = /^media\/([^/]+)$/.exec(path);
      if (match) {
        const mediaId = decodeURIComponent(match[1]);
        if (method === 'GET') {
          if (!cabinet.media[mediaId]) return new Response('Not found', { status: 404 });
          return new Response(cabinet.media[mediaId].bytes, {
            status: 200,
            headers: { 'content-type': cabinet.media[mediaId].contentType || 'application/octet-stream' },
          });
        }
        if (method === 'PUT') {
          const bytes = opts.body instanceof Uint8Array ? opts.body : new Uint8Array(await (new Response(opts.body)).arrayBuffer());
          cabinet.media[mediaId] = {
            bytes: bytes,
            contentType: (opts.headers && (opts.headers['content-type'] || opts.headers['Content-Type'])) || 'application/octet-stream',
          };
          return new Response(JSON.stringify({ ok: true, bytes: bytes.length }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }

      return new Response('Not found', { status: 404 });
    };

    // Clear IDB for hardening scenarios
    const all = await ToolboxDB.getAllCustomerFiles();
    if (all.length) await ToolboxDB.permanentlyDeleteCustomerFiles(all);

    function seedRemoteMeaningful(id) {
      const customer = {
        firstName: 'Remote',
        lastName: 'Owner',
        propertyAddress: '1 Cloud Way',
        cellPhone: '',
        homePhone: '',
        email: '',
        notes: '',
        companyName: '',
        spouseName: '',
        spouseCellPhone: '',
        spouseHomePhone: '',
        spouseEmail: '',
        mailingSameAsProperty: false,
        mailingAddress: '',
        propertyAddressLat: null,
        propertyAddressLon: null,
        customerUpdatedAt: '2026-01-01T00:00:00.000Z',
      };
      const plans = {
        id: 'ps-remote',
        updatedAt: '2026-01-01T00:00:00.000Z',
        buildingType: 'residential',
        activeCanvasId: 'c-remote',
        canvases: [{
          id: 'c-remote',
          name: 'Floor Plan',
          plan: { id: 'plan-remote', width: 100, height: 80 },
          rooms: [{ id: 'r1', name: 'Kitchen' }],
          frontDoorFacing: 'S',
          frontDoor: null,
        }],
      };
      const distress = {
        id: 'd-remote',
        updatedAt: '2026-01-01T00:00:00.000Z',
        pins: [{ id: 'pin-r', canvasId: 'c-remote', photos: ['ph_remote'], num: 1 }],
        drawings: [],
        startNum: 1,
        nextNum: 2,
      };
      const floor = {
        id: 'f-remote',
        updatedAt: '2026-01-01T00:00:00.000Z',
        schemaVersion: 1,
        byCanvasId: {
          'c-remote': { canvasId: 'c-remote', points: [{ x: 0.1, y: 0.2, elev: 0 }] },
        },
      };
      const trash = { trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH, deletedAt: null, purgeAfter: null };
      cabinet.components[compKey(id, 'customer')] = customer;
      cabinet.components[compKey(id, 'plans')] = plans;
      cabinet.components[compKey(id, 'distress')] = distress;
      cabinet.components[compKey(id, 'floor')] = floor;
      cabinet.components[compKey(id, 'trash')] = trash;
      cabinet.indexes[id] = {
        id: id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        customerUpdatedAt: '2026-01-01T00:00:00.000Z',
        plansUpdatedAt: '2026-01-01T00:00:00.000Z',
        distressUpdatedAt: '2026-01-01T00:00:00.000Z',
        floorUpdatedAt: '2026-01-01T00:00:00.000Z',
        trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH,
        deletedAt: null,
        purgeAfter: null,
      };
      // tiny media bytes
      cabinet.media['plan-remote'] = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' };
      cabinet.media['ph_remote'] = { bytes: new Uint8Array([4, 5]), contentType: 'image/jpeg' };
    }

    const out = {};

    // A/B/T transition: remote-only CF must NOT auto-materialize; Sync must still succeed.
    seedRemoteMeaningful('cf-remote-only');
    let result = await ToolboxSync.syncNow();
    out.remoteOnlyOk = result.ok === true;
    out.remoteOnlySkipped = result.remoteOnlySkipped >= 1;
    out.A_noLocal = !(await ToolboxDB.getCustomerFile('cf-remote-only'));
    out.B_remoteIntact = cabinet.components['cf-remote-only::customer'].firstName === 'Remote';
    out.T_epoch = ToolboxSync.componentRevision(
      ToolboxSync._test.shellForRemotePull('tmp', cabinet.indexes['cf-remote-only']),
      'customer',
    ) === ToolboxSync.REMOTE_PULL_EPOCH;
    // Explicit future Check Out helper still pulls when invoked directly:
    const checkoutShell = ToolboxSync._test.shellForRemotePull('cf-remote-only', cabinet.indexes['cf-remote-only']);
    await ToolboxDB.saveCustomerFile(checkoutShell);
    // leave it for poison tests? better delete — keep remote only
    await ToolboxDB.permanentlyDeleteCustomerFiles([await ToolboxDB.getCustomerFile('cf-remote-only')]);

    // C/D/E: poisoned local default shells with HOT clocks must not overwrite meaningful older remote
    seedRemoteMeaningful('cf-poison');
    const poison = ToolboxApp.blankCustomerFile('cf-poison');
    ToolboxPlanSetup.ensurePlanSetup(poison);
    poison.customerUpdatedAt = '2026-08-01T00:00:00.000Z';
    poison.planSetup.updatedAt = '2026-08-01T00:00:00.000Z';
    poison.distress.updatedAt = '2026-08-01T00:00:00.000Z';
    poison.floorSurvey.updatedAt = '2026-08-01T00:00:00.000Z';
    poison.updatedAt = '2026-08-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(poison);

    const naiveCustomer = ToolboxSync.chooseSide(
      ToolboxSync.componentRevision(poison, 'customer'),
      cabinet.indexes['cf-poison'].customerUpdatedAt,
    );
    out.C_naiveWouldPush = naiveCustomer === 'push';
    result = await ToolboxSync.syncNow();
    out.C_syncOk = result.ok === true;
    const healed = await ToolboxDB.getCustomerFile('cf-poison');
    out.C_customerPreserved = healed && healed.firstName === 'Remote';
    out.D_plansPreserved = !!(healed && healed.planSetup.canvases[0].plan && healed.planSetup.canvases[0].plan.id === 'plan-remote');
    out.E_poisonDistress = !!(healed && healed.distress.pins.length === 1);
    out.E_poisonFloor = !!(healed && healed.floorSurvey.byCanvasId['c-remote'].points.length === 1);
    out.remoteStillRemote = cabinet.components['cf-poison::customer'].firstName === 'Remote';
    // Keep a remote-only neighbor present during later syncs
    out.E_distress = out.E_poisonDistress;
    out.E_floor = out.E_poisonFloor;
    out.A_customer = out.A_noLocal;
    out.B_plans = out.B_remoteIntact;

    // F: meaningful local is not mistaken for shell / not overwritten by empty remote
    await ToolboxDB.permanentlyDeleteCustomerFiles([healed]);
    delete cabinet.indexes['cf-poison'];
    Object.keys(cabinet.components).forEach((k) => { if (k.startsWith('cf-poison::')) delete cabinet.components[k]; });

    const goodLocal = ToolboxApp.blankCustomerFile('cf-good');
    ToolboxPlanSetup.ensurePlanSetup(goodLocal);
    goodLocal.firstName = 'Local';
    goodLocal.lastName = 'Hero';
    goodLocal.propertyAddress = '9 Survive St';
    goodLocal.customerUpdatedAt = '2026-01-01T00:00:00.000Z';
    goodLocal.planSetup.canvases[0].plan = { id: 'plan-local', width: 10, height: 10 };
    goodLocal.planSetup.updatedAt = '2026-01-01T00:00:00.000Z';
    goodLocal.distress.pins = [{ id: 'p', canvasId: goodLocal.planSetup.activeCanvasId, photos: [] }];
    goodLocal.distress.updatedAt = '2026-01-01T00:00:00.000Z';
    goodLocal.floorSurvey.byCanvasId[goodLocal.planSetup.activeCanvasId] = {
      canvasId: goodLocal.planSetup.activeCanvasId,
      points: [{ x: 1, y: 1, elev: 0 }],
    };
    goodLocal.floorSurvey.updatedAt = '2026-01-01T00:00:00.000Z';
    await ToolboxDB.putMedia('plan-local', 'data:image/png;base64,bG9jYWw=');
    await ToolboxDB.saveCustomerFile(goodLocal);

    // Poisoned remote empty with HOT clocks
    cabinet.indexes['cf-good'] = {
      id: 'cf-good',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      customerUpdatedAt: '2026-08-01T00:00:00.000Z',
      plansUpdatedAt: '2026-08-01T00:00:00.000Z',
      distressUpdatedAt: '2026-08-01T00:00:00.000Z',
      floorUpdatedAt: '2026-08-01T00:00:00.000Z',
      trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH,
      deletedAt: null,
    };
    cabinet.components['cf-good::customer'] = {
      firstName: '', lastName: '', propertyAddress: '', cellPhone: '', homePhone: '', email: '', notes: '',
      companyName: '', spouseName: '', spouseCellPhone: '', spouseHomePhone: '', spouseEmail: '',
      mailingSameAsProperty: false, mailingAddress: '', propertyAddressLat: null, propertyAddressLon: null,
      customerUpdatedAt: '2026-08-01T00:00:00.000Z',
    };
    cabinet.components['cf-good::plans'] = {
      updatedAt: '2026-08-01T00:00:00.000Z',
      buildingType: 'residential',
      canvases: [{ id: 'c', plan: null, rooms: [], frontDoor: null }],
    };
    cabinet.components['cf-good::distress'] = {
      updatedAt: '2026-08-01T00:00:00.000Z', pins: [], drawings: [], startNum: 1, nextNum: 1,
    };
    cabinet.components['cf-good::floor'] = {
      updatedAt: '2026-08-01T00:00:00.000Z', byCanvasId: {},
    };
    cabinet.components['cf-good::trash'] = {
      trashUpdatedAt: ToolboxSync.REMOTE_PULL_EPOCH, deletedAt: null, purgeAfter: null,
    };

    out.F_localNotShell = !ToolboxSync.isDefaultShellComponent(goodLocal, 'customer');
    const naivePull = ToolboxSync.chooseSide(goodLocal.customerUpdatedAt, '2026-08-01T00:00:00.000Z');
    out.F_naiveWouldPullEmpty = naivePull === 'pull';
    result = await ToolboxSync.syncNow();
    out.F_syncOk = result.ok === true;
    const protectedLocal = await ToolboxDB.getCustomerFile('cf-good');
    out.F_localPreserved = protectedLocal && protectedLocal.firstName === 'Local' && protectedLocal.lastName === 'Hero';
    out.F_remoteRepaired = cabinet.components['cf-good::customer'].firstName === 'Local';

    // J/K: trash + restore peer simulation via components
    await ToolboxDB.moveCustomerFileToTrash('cf-good');
    result = await ToolboxSync.syncNow();
    out.J_trashSyncOk = result.ok === true;
    out.J_remoteTrashed = !!cabinet.indexes['cf-good'].deletedAt;
    await ToolboxDB.restoreCustomerFile('cf-good');
    result = await ToolboxSync.syncNow();
    out.K_restoreSyncOk = result.ok === true;
    out.K_remoteRestored = !cabinet.indexes['cf-good'].deletedAt;

    // N: missing cloud WITHOUT purge → surviving device repopulates
    delete cabinet.indexes['cf-good'];
    Object.keys(cabinet.components).forEach((k) => { if (k.startsWith('cf-good::')) delete cabinet.components[k]; });
    result = await ToolboxSync.syncNow();
    out.N_repopulateOk = result.ok === true && !!cabinet.indexes['cf-good'];
    out.N_customerBack = cabinet.components['cf-good::customer'] && cabinet.components['cf-good::customer'].firstName === 'Local';

    // L/M: explicit permanent delete creates purge tombstone; stale peer cannot resurrect
    const stale = await ToolboxDB.getCustomerFile('cf-good');
    await ToolboxDB.permanentlyDeleteCustomerFiles([stale]);
    await ToolboxSync.deleteRemoteCustomerFile('cf-good');
    out.L_tombstone = !!(cabinet.purged['cf-good'] && cabinet.purged['cf-good'].reason === 'permanent-delete');
    out.L_indexGone = !cabinet.indexes['cf-good'];

    // Stale peer still holds local copy
    const zombie = ToolboxApp.blankCustomerFile('cf-good');
    ToolboxPlanSetup.ensurePlanSetup(zombie);
    zombie.firstName = 'Zombie';
    zombie.customerUpdatedAt = '2026-09-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(zombie);
    result = await ToolboxSync.syncNow();
    out.M_syncOk = result.ok === true;
    out.M_localRetired = !(await ToolboxDB.getCustomerFile('cf-good'));
    out.M_noResurrect = !cabinet.indexes['cf-good'] && !!cabinet.purged['cf-good'];

    // O: required media push failure prevents clean success
    const mediaFail = ToolboxApp.blankCustomerFile('cf-media-push');
    ToolboxPlanSetup.ensurePlanSetup(mediaFail);
    mediaFail.firstName = 'Media';
    mediaFail.customerUpdatedAt = '2026-01-02T00:00:00.000Z';
    mediaFail.planSetup.canvases[0].plan = { id: 'plan-missing', width: 1, height: 1 };
    mediaFail.planSetup.updatedAt = '2026-01-02T00:00:00.000Z';
    // deliberately do NOT putMedia
    await ToolboxDB.saveCustomerFile(mediaFail);
    let mediaPushCode = '';
    try {
      await ToolboxSync.syncNow();
    } catch (err) {
      mediaPushCode = err && err.code;
    }
    out.O_pushFail = mediaPushCode === 'incomplete' || mediaPushCode === 'sync';
    await ToolboxDB.permanentlyDeleteCustomerFiles([await ToolboxDB.getCustomerFile('cf-media-push')]);

    // P: required media pull failure prevents clean success (local must exist to pull)
    seedRemoteMeaningful('cf-media-pull');
    delete cabinet.media['plan-remote'];
    const localForPull = ToolboxApp.blankCustomerFile('cf-media-pull');
    ToolboxPlanSetup.ensurePlanSetup(localForPull);
    localForPull.customerUpdatedAt = '2020-01-01T00:00:00.000Z';
    localForPull.planSetup.updatedAt = '2020-01-01T00:00:00.000Z';
    localForPull.distress.updatedAt = '2020-01-01T00:00:00.000Z';
    localForPull.floorSurvey.updatedAt = '2020-01-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(localForPull);
    let mediaPullCode = '';
    try {
      await ToolboxSync.syncNow();
    } catch (err) {
      mediaPullCode = err && err.code;
    }
    out.P_pullFail = mediaPullCode === 'incomplete' || mediaPullCode === 'sync';
    delete cabinet.indexes['cf-media-pull'];
    Object.keys(cabinet.components).forEach((k) => { if (k.startsWith('cf-media-pull::')) delete cabinet.components[k]; });
    const orphanPull = await ToolboxDB.getCustomerFile('cf-media-pull');
    if (orphanPull) await ToolboxDB.permanentlyDeleteCustomerFiles([orphanPull]);

    // Q: remote-only must not fail Sync; trash-state on overlapping IDs still converges
    const invLocal = ToolboxApp.blankCustomerFile('cf-inv');
    ToolboxPlanSetup.ensurePlanSetup(invLocal);
    invLocal.firstName = 'Inv';
    invLocal.customerUpdatedAt = '2026-01-03T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(invLocal);
    result = await ToolboxSync.syncNow();
    out.Q_baselineOk = result.ok === true;
    // Neighbor remote-only remains; Sync must still succeed
    seedRemoteMeaningful('cf-remote-neighbor');
    result = await ToolboxSync.syncNow();
    out.Q_remoteOnlyOk = result.ok === true && result.remoteOnlySkipped >= 1;
    out.Q_neighborNotLocal = !(await ToolboxDB.getCustomerFile('cf-remote-neighbor'));

    cabinet.indexes['cf-inv'].deletedAt = '2026-09-01T00:00:00.000Z';
    cabinet.indexes['cf-inv'].trashUpdatedAt = '2026-09-01T00:00:00.000Z';
    cabinet.components['cf-inv::trash'] = {
      trashUpdatedAt: '2026-09-01T00:00:00.000Z',
      deletedAt: '2026-09-01T00:00:00.000Z',
      purgeAfter: '2027-01-01T00:00:00.000Z',
    };
    out.Q_compareDetects = !ToolboxSync._test.compareInventories(
      [{ id: 'cf-inv', deletedAt: null }],
      [{ id: 'cf-inv', deletedAt: '2026-09-01T00:00:00.000Z' }],
      {},
    ).ok;

    result = await ToolboxSync.syncNow();
    out.Q_trashPullOk = result.ok === true;
    const invAfter = await ToolboxDB.getCustomerFile('cf-inv');
    out.Q_localNowTrashed = !!(invAfter && invAfter.deletedAt);
    out.Q_postPassMismatch = ToolboxSync._test.compareInventories(
      await ToolboxDB.getAllCustomerFiles(),
      Object.values(cabinet.indexes),
      cabinet.purged,
    ).remoteOnly.length > 0;

    // R: imported-native shaped CF participates in sync
    const imported = ToolboxApp.blankCustomerFile('cf-import-native');
    ToolboxPlanSetup.ensurePlanSetup(imported);
    imported.firstName = 'Import';
    imported.lastName = 'Native';
    imported.customerUpdatedAt = '2026-02-01T00:00:00.000Z';
    imported.planSetup.canvases[0].plan = { id: 'plan-import-1', width: 20, height: 20 };
    imported.planSetup.updatedAt = '2026-02-01T00:00:00.000Z';
    imported.recoveryImports = [{ fingerprint: 'abc', kind: 'floor' }];
    await ToolboxDB.putMedia('plan-import-1', 'data:image/png;base64,aW1w');
    await ToolboxDB.saveCustomerFile(imported);
    result = await ToolboxSync.syncNow();
    out.R_importOk = result.ok === true && !!cabinet.indexes['cf-import-native'];
    out.R_importCustomer = cabinet.components['cf-import-native::customer'].firstName === 'Import';

    // S: sequential edits on the local working set update cloud (checkout cross-device pull is next slice)
    const seq = await ToolboxDB.getCustomerFile('cf-import-native');
    seq.firstName = 'DeviceA';
    seq.customerUpdatedAt = '2026-03-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(seq);
    result = await ToolboxSync.syncNow();
    out.S_aPush = result.ok === true && cabinet.components['cf-import-native::customer'].firstName === 'DeviceA';
    seq.firstName = 'DeviceB';
    seq.customerUpdatedAt = '2026-04-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(seq);
    result = await ToolboxSync.syncNow();
    out.S_bPush = result.ok === true && cabinet.components['cf-import-native::customer'].firstName === 'DeviceB';
    const reloaded = await ToolboxDB.getCustomerFile('cf-import-native');
    out.S_localMatches = reloaded && reloaded.firstName === 'DeviceB';
    out.S_aPull = out.S_localMatches;
    out.S_bPull = out.S_aPush;

    return out;
  });

  check('A: remote-only CF does not auto-materialize on Sync', hardening.A_noLocal && hardening.remoteOnlyOk && hardening.remoteOnlySkipped, JSON.stringify(hardening));
  check('B: remote-only meaningful cloud data remains intact without local pull', hardening.B_remoteIntact, JSON.stringify(hardening));
  check('C: poisoned hot local customer shell cannot overwrite meaningful remote', hardening.C_naiveWouldPush && hardening.C_customerPreserved && hardening.remoteStillRemote, JSON.stringify(hardening));
  check('D: poisoned hot local plans shell cannot overwrite meaningful remote', hardening.D_plansPreserved, JSON.stringify(hardening));
  check('E: distress/floor shell guard preserves meaningful remote', hardening.E_poisonDistress && hardening.E_poisonFloor, JSON.stringify(hardening));
  check('F: meaningful local not mistaken for shell; survives poisoned remote', hardening.F_localNotShell && hardening.F_naiveWouldPullEmpty && hardening.F_localPreserved && hardening.F_remoteRepaired, JSON.stringify(hardening));
  check('J: active → trash sync marks remote deletedAt', hardening.J_trashSyncOk && hardening.J_remoteTrashed, JSON.stringify(hardening));
  check('K: trash → restore sync clears remote deletedAt', hardening.K_restoreSyncOk && hardening.K_remoteRestored, JSON.stringify(hardening));
  check('L: explicit permanent delete creates durable purge tombstone', hardening.L_tombstone && hardening.L_indexGone, JSON.stringify(hardening));
  check('M: stale peer cannot resurrect explicitly purged Customer File', hardening.M_syncOk && hardening.M_localRetired && hardening.M_noResurrect, JSON.stringify(hardening));
  check('N: missing cloud without purge can be repopulated', hardening.N_repopulateOk && hardening.N_customerBack, JSON.stringify(hardening));
  check('O: required media push failure prevents clean sync success', hardening.O_pushFail, JSON.stringify(hardening));
  check('P: required media pull failure prevents clean sync success', hardening.P_pullFail, JSON.stringify(hardening));
  check('Q: remote-only does not fail Sync; trash converges on overlapping IDs', hardening.Q_remoteOnlyOk && hardening.Q_neighborNotLocal && hardening.Q_compareDetects && hardening.Q_trashPullOk && hardening.Q_localNowTrashed && hardening.Q_postPassMismatch, JSON.stringify(hardening));
  check('R: imported native Customer File participates in sync', hardening.R_importOk && hardening.R_importCustomer, JSON.stringify(hardening));
  check('S: sequential local working-set edits update cloud', hardening.S_aPush && hardening.S_bPush && hardening.S_localMatches, JSON.stringify(hardening));
  check('T: existing remote-pull epoch helper remains for future Check Out', hardening.T_epoch, JSON.stringify(hardening));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
