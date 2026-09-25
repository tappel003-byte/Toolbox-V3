/**
 * Customer File location-status label mapping (no live Cloudflare).
 * Run: node tests/customer-file-location-status.mjs
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
    '/usr/bin/google-chrome-stable',
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

  const helper = await page.evaluate(() => {
    const label = window.ToolboxApp.customerFileLocationLabel;
    return {
      hasHelper: typeof label === 'function',
      remote: label('remoteCabinet', null),
      checkedOut: label('localWorking', { id: 'co', checkedOutFromCabinet: true }),
      unmarked: label('localWorking', { id: 'local', checkedOutFromCabinet: false }),
      missing: label('localWorking', { id: 'plain' }),
      bogus: label('unknown', null),
    };
  });

  check('Helper exported', helper.hasHelper);
  check('Remote Cabinet label', helper.remote === 'File Cabinet — Online', helper.remote);
  check(
    'Checked-out local label',
    helper.checkedOut === 'Checked out to this device — Check in when finished',
    helper.checkedOut,
  );
  check(
    'Unmarked local omits "On this device only" (legacy ambiguity)',
    helper.unmarked === '' && helper.missing === '',
    JSON.stringify({ unmarked: helper.unmarked, missing: helper.missing }),
  );
  check('Unknown kind returns empty', helper.bogus === '', helper.bogus);

  const out = await page.evaluate(async () => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;

    const state = {
      identity: { email: 'tim@example.com', sub: 'sub-tim' },
      indexes: {
        'cf-remote': {
          id: 'cf-remote',
          displayName: 'Remote Only Customer',
          propertyAddress: '100 Cabinet Way, Suite 12, Springfield, IL 62701',
          updatedAt: '2026-09-22T12:00:00.000Z',
          components: {},
        },
      },
      etags: { 'cf-remote': 'etag-1' },
    };

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const path = href.slice(base.length).replace(/^\//, '');
      const method = (opts && opts.method) || 'GET';
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
      return new Response('Not found', { status: 404 });
    };

    // Clear local DB then seed local rows.
    const all = await window.ToolboxDB.getAllCustomerFiles();
    for (const record of all) {
      await window.ToolboxDB.deleteCustomerFile(record.id);
    }

    const localOnly = window.ToolboxApp.blankCustomerFile('cf-local-only');
    localOnly.firstName = 'Local';
    localOnly.lastName = 'Only';
    localOnly.propertyAddress = '12 Quiet Lane';
    delete localOnly.checkedOutFromCabinet;
    await window.ToolboxDB.saveCustomerFile(localOnly);

    const checkedOut = window.ToolboxApp.blankCustomerFile('cf-checked-out');
    checkedOut.firstName = 'Checked';
    checkedOut.lastName = 'Out';
    checkedOut.propertyAddress =
      '999 Very Long Property Address That Should Wrap Across Multiple Lines Without Overflowing Horizontally';
    checkedOut.checkedOutFromCabinet = true;
    await window.ToolboxDB.saveCustomerFile(checkedOut);

    const longName = window.ToolboxApp.blankCustomerFile('cf-long-name');
    longName.firstName = 'Bartholomew Maximilian';
    longName.lastName = 'von Habsburg-Lorraine-Warburton-Smythe III';
    longName.propertyAddress = '1 Main St';
    longName.checkedOutFromCabinet = true;
    await window.ToolboxDB.saveCustomerFile(longName);

    window.location.hash = '#/';
    await new Promise((r) => setTimeout(r, 250));

    function locationsFor(id) {
      const shell = document.querySelector('.cabinet-row-shell[data-customer-file-id="' + id + '"]');
      if (!shell) return null;
      const loc = shell.querySelector('.cabinet-row__location');
      return loc ? loc.textContent : '';
    }

    const home = {
      localOnly: locationsFor('cf-local-only'),
      checkedOut: locationsFor('cf-checked-out'),
      longName: locationsFor('cf-long-name'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };

    window.location.hash = '#/cabinet';
    await new Promise((r) => setTimeout(r, 400));

    const cloudShell = document.querySelector('.cabinet-row-shell--cloud[data-customer-file-id="cf-remote"]');
    const cloud = {
      found: !!cloudShell,
      address: cloudShell && cloudShell.querySelector('.cabinet-index__address')
        ? cloudShell.querySelector('.cabinet-index__address').textContent
        : null,
      owner: cloudShell && cloudShell.querySelector('.cabinet-index__owner')
        ? cloudShell.querySelector('.cabinet-index__owner').textContent
        : null,
      location: cloudShell && cloudShell.querySelector('.cabinet-row__location')
        ? cloudShell.querySelector('.cabinet-row__location').textContent
        : null,
      status: cloudShell && cloudShell.querySelector('.cabinet-index__status')
        ? cloudShell.querySelector('.cabinet-index__status').textContent
        : null,
      date: cloudShell && cloudShell.querySelector('.cabinet-index__date')
        ? cloudShell.querySelector('.cabinet-index__date').textContent
        : null,
    };

    // Workspace 2×2 remains untouched — open a file and inspect grid CSS.
    window.location.hash = '#/file/cf-checked-out';
    await new Promise((r) => setTimeout(r, 300));
    const apps = document.querySelector('.cf-home__apps');
    let grid = null;
    if (apps) {
      const cs = getComputedStyle(apps);
      grid = {
        columns: cs.gridTemplateColumns,
        columnCount: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
      };
    }

    return { home, cloud, grid };
  });

  check(
    'Local unmarked has no location line',
    out.home.localOnly === '',
    JSON.stringify(out.home.localOnly),
  );
  check(
    'Checked-out shows Check-in reminder',
    out.home.checkedOut === 'Checked out to this device — Check in when finished',
    out.home.checkedOut,
  );
  check(
    'Long-name checked-out still labeled',
    out.home.longName === 'Checked out to this device — Check in when finished',
    out.home.longName,
  );
  check('Home list no horizontal overflow at default viewport', !out.home.overflow);

  check('File Cabinet remote row found', out.cloud.found);
  check(
    'File Cabinet row is address-first and does not invent a date from updatedAt',
    out.cloud.address === '100 Cabinet Way, Suite 12, Springfield, IL 62701' &&
      out.cloud.owner === 'Remote Only Customer' &&
      out.cloud.location == null &&
      out.cloud.date == null,
    JSON.stringify(out.cloud),
  );
  check(
    'File Cabinet available row needs no redundant status',
    out.cloud.status == null,
    JSON.stringify(out.cloud),
  );

  check(
    'CF workspace grid remains 2 columns',
    out.grid && out.grid.columnCount === 2,
    JSON.stringify(out.grid),
  );

  // Phone-ish viewport containment
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForFunction(() => document.querySelectorAll('.cabinet-row-shell').length >= 2);
  const phone = await page.evaluate(() => {
    const shells = Array.from(document.querySelectorAll('.cabinet-row-shell'));
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      locations: shells.map((shell) => {
        const loc = shell.querySelector('.cabinet-row__location');
        const name = shell.querySelector('.cabinet-row__name');
        return {
          id: shell.dataset.customerFileId,
          name: name ? name.textContent : '',
          location: loc ? loc.textContent : '',
          shellWidth: shell.getBoundingClientRect().width,
        };
      }),
      viewportWidth: window.innerWidth,
    };
  });
  check('Phone ~390px no horizontal overflow', !phone.overflow, JSON.stringify(phone));
  check(
    'Phone checked-out location present',
    phone.locations.some((row) => row.location === 'Checked out to this device — Check in when finished'),
    JSON.stringify(phone.locations),
  );

  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
  const ipad = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  check('iPad ~768px no horizontal overflow', !ipad.overflow);

  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
  const desktop = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  check('Desktop ~1100px no horizontal overflow', !desktop.overflow);

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
