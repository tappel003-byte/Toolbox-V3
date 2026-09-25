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
        createdAt: '2026-02-01T18:00:00.000Z',
        updatedAt: '2026-09-01T18:00:00.000Z',
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
        mailingAddress: customer.mailingAddress || '',
        companyName: customer.companyName || '',
        spouseName: customer.spouseName || '',
        email: customer.email || '',
        spouseEmail: customer.spouseEmail || '',
        cellPhone: customer.cellPhone || '',
        homePhone: customer.homePhone || '',
        spouseCellPhone: customer.spouseCellPhone || '',
        spouseHomePhone: customer.spouseHomePhone || '',
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
      index: { createdAt: '2026-09-23T18:00:00.000Z' },
    });
    seedRemote('cf-delta', {
      customer: {
        firstName: 'Nora',
        lastName: 'Quinn',
        propertyAddress: '1246 Mountain Valley Rd, Boulder, CO 80302',
        mailingAddress: 'PO Box 44, Denver, CO 80202',
        companyName: 'Pine Street Holdings',
        spouseName: 'Owen Quinn',
        email: 'nora.quinn@example.com',
        cellPhone: '555-0148',
      },
      index: {
        fieldWorkDate: '2025-03-12',
        createdAt: '2020-01-15T18:00:00.000Z',
        updatedAt: '2026-09-22T12:00:00.000Z',
      },
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

    function rowSnapshot(id) {
      const shell = document.querySelector('.cabinet-row-shell--cloud[data-customer-file-id="' + id + '"]');
      if (!shell) return null;
      const address = shell.querySelector('.cabinet-index__address');
      const owner = shell.querySelector('.cabinet-index__owner');
      const date = shell.querySelector('.cabinet-index__date');
      const status = shell.querySelector('.cabinet-index__status');
      const row = shell.querySelector('.cabinet-row--index');
      return {
        address: address ? address.textContent : '',
        owner: owner ? owner.textContent : '',
        date: date ? date.textContent : '',
        dateTime: date ? date.getAttribute('datetime') : '',
        status: status ? status.textContent : '',
        rowHeight: row ? row.getBoundingClientRect().height : 0,
        addressWeight: address ? getComputedStyle(address).fontWeight : '',
        ownerWeight: owner ? getComputedStyle(owner).fontWeight : '',
      };
    }

    // Address-first compact rows. Dates come from fieldWorkDate or createdAt, not updatedAt.
    report.rows = {
      alpha: rowSnapshot('cf-alpha'),
      beta: rowSnapshot('cf-beta'),
      gamma: rowSnapshot('cf-gamma'),
      delta: rowSnapshot('cf-delta'),
    };
    report.addressPrimary = !!(report.rows.delta &&
      report.rows.delta.address.indexOf('1246 Mountain Valley Rd') === 0 &&
      report.rows.delta.owner === 'Nora Quinn');
    report.ownerSecondary = !!(report.rows.alpha &&
      report.rows.alpha.address === '100 Alpha Ave' &&
      report.rows.alpha.owner === 'Alpha One');
    report.deltaSurveyDate = report.rows.delta && report.rows.delta.dateTime === '2025-03-12';
    report.deltaNotUpdated = report.rows.delta &&
      report.rows.delta.date.indexOf('2026') === -1 &&
      report.rows.delta.date.indexOf('2020') === -1;
    report.alphaCreatedFallback = report.rows.alpha &&
      report.rows.alpha.dateTime === '2026-02-01T18:00:00.000Z' &&
      report.rows.alpha.date.indexOf('2026') !== -1 &&
      report.rows.alpha.date.indexOf('Sep') === -1;
    report.noRedundantAvailability = !!(report.rows.alpha && !report.rows.alpha.status &&
      !/Available/i.test(document.querySelector('#file-cabinet-list').textContent));
    report.statusElsewhere = !!(report.rows.beta && /Checked out elsewhere/i.test(report.rows.beta.status));
    report.checkoutButtons = document.querySelectorAll('.cabinet-checkout-btn').length;
    report.noOnlineLocationLine = !document.querySelector('.cabinet-row--cloud .cabinet-row__location');
    const weights = report.rows.delta || {};
    report.addressBolder = Number(weights.addressWeight) > Number(weights.ownerWeight);

    // Name search
    const search = document.querySelector('#file-cabinet-search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    let owners = Array.from(document.querySelectorAll('.cabinet-row--cloud .cabinet-index__owner'))
      .map((el) => el.textContent || '');
    report.nameSearch = owners.length === 1 && owners[0] === 'Alpha One';

    // Address search
    search.value = 'beta blvd';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    owners = Array.from(document.querySelectorAll('.cabinet-row--cloud .cabinet-index__owner'))
      .map((el) => el.textContent || '');
    report.addressSearch = owners.length === 1 && owners[0] === 'Beta Two';

    async function searchHits(query) {
      search.value = query;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      return Array.from(document.querySelectorAll('.cabinet-row--cloud .cabinet-index__owner'))
        .map((el) => el.textContent || '');
    }
    report.zipSearch = (await searchHits('80302')).join('|') === 'Nora Quinn';
    report.citySearch = (await searchHits('boulder')).join('|') === 'Nora Quinn';
    report.mailingSearch = (await searchHits('80202')).join('|') === 'Nora Quinn';
    report.companySearch = (await searchHits('pine street')).join('|') === 'Nora Quinn';
    report.spouseSearch = (await searchHits('owen')).join('|') === 'Nora Quinn';
    report.emailSearch = (await searchHits('nora.quinn@')).join('|') === 'Nora Quinn';
    report.phoneSearch = (await searchHits('5550148')).join('|') === 'Nora Quinn';

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

  const layout = {};
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'ipad', width: 768, height: 1024 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.evaluate(() => { window.location.hash = '#/cabinet'; });
    await page.waitForFunction(() => document.querySelectorAll('.cabinet-row--index').length >= 4);
    layout[viewport.name] = await page.evaluate(() => {
      const doc = document.documentElement;
      const rows = Array.from(document.querySelectorAll('.cabinet-row--index'));
      const button = document.querySelector('.cabinet-checkout-btn');
      const buttonBox = button ? button.getBoundingClientRect() : null;
      const search = document.querySelector('#file-cabinet-search');
      const searchBox = search ? search.getBoundingClientRect() : null;
      const beta = document.querySelector('.cabinet-row-shell--cloud[data-customer-file-id="cf-beta"]');
      const alpha = document.querySelector('.cabinet-row-shell--cloud[data-customer-file-id="cf-alpha"]');
      const delta = document.querySelector('.cabinet-row-shell--cloud[data-customer-file-id="cf-delta"]');
      const alphaAddress = alpha && alpha.querySelector('.cabinet-index__address');
      const alphaMeta = alpha && alpha.querySelector('.cabinet-index__meta');
      const alphaButton = alpha && alpha.querySelector('.cabinet-checkout-btn');
      const deltaAddress = delta && delta.querySelector('.cabinet-index__address');
      const addrBox = alphaAddress ? alphaAddress.getBoundingClientRect() : null;
      const metaBox = alphaMeta ? alphaMeta.getBoundingClientRect() : null;
      const alphaBtnBox = alphaButton ? alphaButton.getBoundingClientRect() : null;
      function overlaps(a, b) {
        if (!a || !b) return false;
        return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
      }
      const betaRow = beta && beta.querySelector('.cabinet-row');
      return {
        overflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        rowHeights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
        buttonHeight: buttonBox ? Math.round(buttonBox.height) : 0,
        buttonWidth: buttonBox ? Math.round(buttonBox.width) : 0,
        searchWidth: searchBox ? Math.round(searchBox.width) : 0,
        searchOverflows: searchBox ? searchBox.right > window.innerWidth + 1 : true,
        betaGray: !!(beta && beta.classList.contains('is-checked-out-elsewhere')),
        betaHasAction: !!(beta && beta.querySelector('.cabinet-checkout-btn')),
        betaBackground: betaRow ? getComputedStyle(betaRow).backgroundColor : '',
        alphaButtonBelowAddress: !!(addrBox && alphaBtnBox && alphaBtnBox.top >= addrBox.bottom - 2),
        alphaButtonBesideMeta: !!(metaBox && alphaBtnBox && alphaBtnBox.top < metaBox.bottom && alphaBtnBox.bottom > metaBox.top),
        alphaAddressClearOfButton: !overlaps(addrBox, alphaBtnBox),
        alphaAddressClipped: alphaAddress ? alphaAddress.scrollWidth > alphaAddress.clientWidth + 2 : true,
        deltaAddressClipped: deltaAddress ? deltaAddress.scrollWidth > deltaAddress.clientWidth + 2 : true,
        listHasAvailable: /Available/i.test((document.querySelector('#file-cabinet-list') || {}).textContent || ''),
      };
    });
  }

  check('#/ has On this device', out.homeHasOnDevice, JSON.stringify(out));
  check('#/ eyebrow is Toolbox', /Toolbox/i.test(out.homeEyebrow) && !/file cabinet/i.test(out.homeEyebrow), out.homeEyebrow);
  check('#/ has no cloud inventory list', out.homeNoCloudList && out.homeNoCloudRows, JSON.stringify(out));
  check('#/ has closed File Cabinet entry', out.homeClosedEntry && /Open File Cabinet/i.test(out.homeCta), out.homeCta);
  check('Open File Cabinet navigates to #/cabinet', out.navHash === '#/cabinet' && out.cabinetHeading && out.cabinetBack && out.cabinetSearch, JSON.stringify(out));
  check('#/cabinet browse uses lightweight /files only', out.browseOnlyFiles && out.browseHadFilesGet, JSON.stringify(out));
  check('search causes no component/media materialization', out.searchNoMaterialize && out.searchNoExtraNetwork, JSON.stringify(out));
  check('name search filters Cabinet rows', out.nameSearch, JSON.stringify(out));
  check('address search filters Cabinet rows', out.addressSearch, JSON.stringify(out));
  check('address is the bold primary identifier', out.addressPrimary && out.ownerSecondary && out.addressBolder, JSON.stringify(out.rows));
  check('field-work date prefers stored survey date over created/updated clocks', out.deltaSurveyDate && out.deltaNotUpdated && out.alphaCreatedFallback, JSON.stringify(out.rows));
  check('search matches city, ZIP, mailing address, company, spouse, email, and phone', out.zipSearch && out.citySearch && out.mailingSearch && out.companySearch && out.spouseSearch && out.emailSearch && out.phoneSearch, JSON.stringify(out));
  check('normal availability is implied by Check Out; exceptional status remains', out.noRedundantAvailability && out.statusElsewhere && out.checkoutButtons >= 1 && out.noOnlineLocationLine, JSON.stringify(out));
  check('Check Out returns to #/ with confirmation', out.afterCheckoutHash === '#/' && /Gamma.*checked out to this device/i.test(out.afterCheckoutNotice), JSON.stringify(out));
  check('Check Out materializes and shows under On this device', out.afterCheckoutLocal && out.afterCheckoutOnDeviceVisible && out.materializeHadComponents, JSON.stringify(out));
  check('selective-local Sync leaves remote-only remote', out.syncOk && out.syncSkippedRemote && out.alphaStillRemote, JSON.stringify(out));
  check('Trash still reachable from Customer Files', out.trashHash === '#/trash' && out.trashHeading, JSON.stringify(out));
  check(
    'compact File Cabinet rows fit desktop, iPad, and phone',
    ['desktop', 'ipad', 'phone'].every((name) => {
      const shot = layout[name];
      return shot && !shot.overflow && !shot.searchOverflows &&
        shot.buttonHeight >= 44 && shot.buttonWidth >= 44 &&
        shot.rowHeights.length >= 4 &&
        shot.rowHeights.every((height) => height > 0 && height < 120) &&
        !shot.listHasAvailable;
    }),
    JSON.stringify(layout),
  );
  check(
    'phone address stays full width with Check Out beside the name and date',
    !!(layout.phone && layout.phone.alphaButtonBelowAddress && layout.phone.alphaButtonBesideMeta &&
      layout.phone.alphaAddressClearOfButton && !layout.phone.alphaAddressClipped &&
      !layout.phone.deltaAddressClipped),
    JSON.stringify(layout.phone),
  );
  check(
    'file checked out elsewhere is gray with no Check Out action',
    ['desktop', 'ipad', 'phone'].every((name) => {
      const shot = layout[name];
      return shot && shot.betaGray && !shot.betaHasAction && /228,\s*225,\s*218/.test(shot.betaBackground);
    }),
    JSON.stringify(layout),
  );
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
