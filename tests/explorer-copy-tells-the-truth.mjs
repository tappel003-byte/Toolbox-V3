/**
 * The copy's README describes WHAT WAS PACKED, not what folder happens to exist.
 *
 * Run: node tests/explorer-copy-tells-the-truth.mjs   (static server on 8765)
 *
 * Independent review of PR #145 reproduced the hole: the missing-PDF lines
 * were decided by testing whether a folder existed.
 *
 *   - A Floor Survey FIGURE and a Floor Survey recovery PDF both land in
 *     `Floor Survey/`, so a job with a figure and no PDF was told it had one.
 *   - Whether Distress photographs exist says nothing at all about whether a
 *     Distress PDF exists -- Toolbox produces none either way -- so one gated
 *     the other and both statements vanished together.
 *   - The README pointed at `Technical/report.json`, which is not the name
 *     the copy writes, and could name `Report/` when there is no such folder.
 *
 * A recovery copy that quietly omits "there is no report PDF" reads exactly
 * like a recovery copy whose job never had one. These are the cases where
 * that silence was reachable.
 *
 * Also here: a component that is stored but will not decode must not be
 * described as a component that was never there. They lead to opposite
 * actions and only one of them is worth acting on.
 */
import { createRequire } from 'module';

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

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer &&
  window.ToolboxExplorerArchive && window.JSZip);

/**
 * One scenario, through the real Explorer and the real archive builder, to a
 * real ZIP that is then unpacked and read.
 *
 * `scenario` decides which components the mock Cabinet serves, which objects
 * it reports, and which of them decode.
 */
async function copyFor(scenario) {
  return page.evaluate(async (sc) => {
    const id = sc.id;
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;

    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFUlEQVR42mP8z8DwnwEI' +
      'GJgYgIAJAAzOAv9Pu0FDAAAAAElFTkSuQmCC';
    const png = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));

    const plans = { updatedAt: '2026-09-29T18:00:00.000Z', canvases: [
      { id: 'cv-main', name: 'Main Level', plan: { id: 'plan-main' } } ] };
    const floor = { updatedAt: '2026-09-30T18:30:00.000Z', inspectionDate: '2026-09-30',
      byCanvasId: { 'cv-main': { canvasId: 'cv-main', inspectionDate: '2026-09-30',
        points: [{ id: 'p1', index: 1, x: 10, y: 10, value: 9.0, isBasePoint: true, label: 'BP1' },
                 { id: 'p2', index: 2, x: 60, y: 10, value: 8.4 }] } } };
    const distress = { updatedAt: '2026-10-01T12:00:00.000Z', inspectionDate: '2026-10-01',
      pins: [{ id: 'pin-1', num: 1, canvasId: 'cv-main', location: 'Hall',
        description: 'Crack', photos: ['ph_one', 'ph_two'] }] };
    const customer = { firstName: 'Dale', lastName: 'Whitford',
      propertyAddress: '9 Juniper Loop', customerUpdatedAt: '2026-10-01T12:00:00.000Z' };
    const report = { updatedAt: '2026-10-19T20:45:00.000Z', pages: [{ id: 'r1', type: 'cover' }] };
    const indexDoc = { id: id, displayName: 'Dale Whitford', propertyAddress: '9 Juniper Loop',
      fieldWorkDate: '2026-09-30' };

    const objects = [
      { key: `cf/${id}/index.json`, contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
      { key: `cf/${id}/customer.json`, contentType: 'application/json', purpose: 'customer', label: 'Customer information' },
      { key: `cf/${id}/plans.json`, contentType: 'application/json', purpose: 'plans', label: 'Plans and canvases' },
      { key: `cf/${id}/floor.json`, contentType: 'application/json', purpose: 'floor', label: 'Floor Survey' },
      { key: `cf/${id}/distress.json`, contentType: 'application/json', purpose: 'distress', label: 'Distress Survey' },
      { key: 'media/plan-main', contentType: 'image/png', purpose: 'plan', label: 'Floor plan — Main Level' },
      // Two photographs on ONE pin with the SAME generated name, so the
      // collision suffix is exercised for real.
      { key: 'media/ph_one', contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
      { key: 'media/ph_two', contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
    ];
    // A Floor Survey FIGURE and no recovery PDF: the case that used to
    // suppress the missing-PDF line because the folder existed anyway.
    if (sc.floorFigure) {
      objects.push({ key: 'media/fsfig_main', contentType: 'image/png',
        purpose: 'floor-figure', label: 'Floor Survey figure — Main Level' });
    }
    if (sc.floorPdf) {
      objects.push({ key: 'media/fsrec_main', contentType: 'application/pdf',
        purpose: 'floor-pdf', label: 'Floor Survey recovery PDF — Main Level' });
    }
    if (sc.report) {
      objects.push({ key: `cf/${id}/report.json`, contentType: 'application/json',
        purpose: 'report', label: 'Report Builder' });
    }

    const stored = {
      [`cf/${id}/index.json`]: { type: 'application/json', body: JSON.stringify(indexDoc) },
      [`cf/${id}/customer.json`]: { type: 'application/json', body: JSON.stringify(customer) },
      [`cf/${id}/plans.json`]: { type: 'application/json', body: JSON.stringify(plans) },
      [`cf/${id}/distress.json`]: { type: 'application/json', body: JSON.stringify(distress) },
      [`cf/${id}/floor.json`]: sc.floorUnreadable
        // Stored, and will not decode. NOT the same as absent.
        ? { type: 'application/json', body: '{"byCanvasId": {oops' }
        : { type: 'application/json', body: JSON.stringify(floor) },
    };
    if (sc.report) {
      stored[`cf/${id}/report.json`] = { type: 'application/json', body: JSON.stringify(report) };
    }
    objects.forEach((o) => {
      if (/^media\//.test(o.key) && !stored[o.key]) {
        stored[o.key] = { type: o.contentType, body: png };
      }
    });

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const path = href.slice(base.length).replace(/^\//, '');
      if (path === 'explore/files') {
        return new Response(JSON.stringify({ files: [Object.assign({ key: `cf/${id}/index.json` }, indexDoc)] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === `explore/files/${id}`) {
        return new Response(JSON.stringify({ id: id, displayName: 'Dale Whitford',
          propertyAddress: '9 Juniper Loop', fieldWorkDate: '2026-09-30',
          prefix: `cf/${id}/`, objects: objects, referenceNotes: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const m = new RegExp(`^explore/files/${id}/object\\?key=(.+)$`).exec(path);
      if (m) {
        const key = decodeURIComponent(m[1]);
        const found = stored[key];
        if (!found) return new Response('Not stored', { status: 404 });
        const raw = typeof found.body === 'string' ? new TextEncoder().encode(found.body) : found.body;
        return new Response(raw, { status: 200, headers: { 'content-type': found.type } });
      }
      return new Response('Not found', { status: 404 });
    };

    const picked = [];
    window.showSaveFilePicker = async function (options) {
      const entry = { name: (options && options.suggestedName) || 'file', chunks: [] };
      picked.push(entry);
      return { name: entry.name, createWritable: async function () {
        return new WritableStream({ write(chunk) { entry.chunks.push(chunk); } });
      } };
    };

    window.location.hash = '#/explore';
    await new Promise((r) => setTimeout(r, 120));
    window.location.hash = '#/explore/' + encodeURIComponent(id);
    await new Promise((resolve) => {
      const until = Date.now() + 9000;
      const tick = function () {
        if (document.getElementById('explorer-zip') || Date.now() > until) return resolve();
        setTimeout(tick, 80);
      };
      tick();
    });
    await new Promise((r) => setTimeout(r, 900));

    const facts = (document.querySelector('#explorer-facts') || {}).innerText || '';
    document.getElementById('explorer-zip').click();
    await new Promise((r) => setTimeout(r, 2200));

    const entry = picked[picked.length - 1];
    const zip = await window.JSZip.loadAsync(new Blob(entry.chunks));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    const read = async function (suffix) {
      const hit = names.filter((n) => n.endsWith(suffix))[0];
      return hit ? zip.file(hit).async('string') : '';
    };
    return {
      names: names,
      readme: await read('README.txt'),
      pins: await read('Distress Survey pins.csv'),
      readings: await read('Floor Survey readings.csv'),
      facts: facts,
      notice: (document.getElementById('explorer-notice') || {}).textContent || '',
    };
  }, scenario);
}

const notHere = (readme) => readme.split('What is NOT in this folder')[1] || '';

// ============ a Floor Survey FIGURE and no recovery PDF ==================
{
  const out = await copyFor({
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    floorFigure: true, floorPdf: false, report: true,
  });
  const absent = notHere(out.readme);
  check('a Floor Survey folder full of figures does not imply a recovery PDF',
    out.names.some((n) => /Floor Survey\/Floor Survey figure/.test(n)) &&
    /A PDF of the Floor Survey\. None is stored for this job/.test(absent),
    JSON.stringify(absent.slice(0, 220)));
  check('and it says where the figures did end up, rather than only what is missing',
    /its figures are in Floor Survey\//.test(absent), JSON.stringify(absent.slice(0, 220)));
  check('the absent Distress PDF is disclosed even though photographs exist',
    out.names.some((n) => n.indexOf('Photographs/Distress Survey/') > 0) &&
    /A PDF of the Distress Survey\. Toolbox does not produce one\./.test(absent),
    JSON.stringify(absent.slice(0, 400)));
  check('the report line names the file this copy actually wrote',
    /The report Toolbox can rebuild is Technical\/Report Builder\.json\./.test(absent) &&
    absent.indexOf('Technical/report.json') < 0,
    JSON.stringify(absent.slice(absent.indexOf('A finished report PDF'),
      absent.indexOf('A finished report PDF') + 300)));
  check('and does not name a Report folder that is not in the copy',
    absent.indexOf('Report/ holds the pictures') < 0 &&
    !out.names.some((n) => /\/Report\//.test(n)),
    JSON.stringify(out.names.filter((n) => /Report/.test(n))));

  // Two photographs on one pin generate the same name; the second takes a
  // suffix, and the pin list must follow it to the file that exists.
  const row = out.pins.trim().split('\r\n')[1];
  const paths = row.split(',')[5].split(' | ');
  check('two photographs with one generated name both land, under different paths',
    paths.length === 2 && paths[0] !== paths[1] &&
    paths.every((path) => out.names.some((n) => n.endsWith('/' + path))),
    JSON.stringify(paths));
}

// ============ no report at all ===========================================
{
  const out = await copyFor({
    id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    floorFigure: false, floorPdf: true, report: false,
  });
  const absent = notHere(out.readme);
  check('with no report started, the copy says that rather than naming a record',
    /No report has been started for this job\./.test(absent) &&
    absent.indexOf('Technical/Report Builder.json') < 0,
    JSON.stringify(absent.slice(absent.indexOf('A finished report PDF'),
      absent.indexOf('A finished report PDF') + 260)));
  check('and a job that HAS a recovery PDF is not told its PDF is missing',
    absent.indexOf('A PDF of the Floor Survey') < 0 &&
    out.names.some((n) => /Floor Survey\/Floor Survey recovery PDF/.test(n)),
    JSON.stringify(out.names.filter((n) => n.indexOf('/Floor Survey/') > 0)));
}

// ============ a component that is stored but will not decode =============
{
  const out = await copyFor({
    id: 'cccccccc-3333-4333-8333-cccccccccccc',
    floorFigure: false, floorPdf: false, report: true, floorUnreadable: true,
  });
  const absent = notHere(out.readme);
  check('an unreadable Floor Survey is not reported as a job with no readings',
    /The stored Floor Survey could not be read/.test(absent) &&
    absent.indexOf('No Floor Survey readings are stored for this job') < 0,
    JSON.stringify(absent.slice(0, 300)));
  check('and the copy does not claim to know whether it had a PDF',
    /whether it has one is unknown/.test(absent), JSON.stringify(absent.slice(0, 400)));
  check('no readings file is written from a component that would not decode',
    out.readings === '' &&
    !out.names.some((n) => n.endsWith('Floor Survey readings.csv')),
    JSON.stringify(out.names));
  check('the screen says the same thing, rather than showing figures it does not have',
    /could not be read/.test(out.facts), JSON.stringify(out.facts.replace(/\n/g, ' | ')));
  check('the stored bytes are still carried out under Technical',
    out.names.some((n) => n.endsWith('/Technical/Floor Survey.json')),
    JSON.stringify(out.names.filter((n) => n.indexOf('/Technical/') > 0)));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
