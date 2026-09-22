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

  const syncBtn = await page.$('#app-sync');
  check('Sync Now control is present', !!syncBtn);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
