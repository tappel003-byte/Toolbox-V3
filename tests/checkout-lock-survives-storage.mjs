/**
 * The mark on the copy is what makes a foreign Check Out survive.
 *
 * A lease lives in the Cabinet, and a device in a crawlspace cannot read it.
 * That is why the fact is written onto the Customer File itself: "it survives
 * a reload, cleared site data, and having no network at all."
 *
 * The screen honours that mark. The route gate and the database guard were
 * asking a different question -- this device's lock map in localStorage,
 * which is only written while listing the Cabinet and which iOS evicts from
 * a site that has not been opened in a week. So a phone whose storage had
 * been cleared could open Distress Survey on a job its iPad was working on,
 * draw on it, and have the writes land.
 *
 * Run: node tests/checkout-lock-survives-storage.mjs
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
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
    try { require('fs').accessSync(c); return c; } catch (_) {}
  }
  return '/usr/bin/google-chrome';
}

const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
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

const ID = 'cf-held-elsewhere';

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxDB && window.ToolboxSync);

  // A local safety copy that already knows another device holds the lease,
  // on a device whose lock map is gone.
  await page.evaluate(async (id) => {
    const prior = await ToolboxDB.getAllCustomerFiles();
    if (prior.length) await ToolboxDB.permanentlyDeleteCustomerFiles(prior);
    const record = window.ToolboxApp.blankCustomerFile(id);
    record.firstName = 'Rhonda';
    record.lastName = 'Sorenson';
    record.propertyAddress = '4925 Edwards Dr NE';
    record.planSetup = {
      id: 'ps', updatedAt: '2026-10-07T00:00:00.000Z', buildingType: 'residential',
      activeCanvasId: 'c1',
      canvases: [{
        id: 'c1', name: 'Main Level',
        plan: { id: 'plan-1', width: 100, height: 80 },
        rooms: [], frontDoorFacing: 'S', frontDoor: null,
      }],
    };
    await ToolboxDB.saveCustomerFile(record);
    // The mark is written the way sync writes it, through the save the guard
    // hands down for exactly this.
    await ToolboxSync.persistForeignCheckoutMarks([record], {
      [id]: { deviceId: 'device-ipad-mini', deviceLabel: 'iPad mini', checkedAt: '2026-10-21T18:00:00.000Z' },
    });
  }, ID);

  // Cleared site data: the lock map this device kept is gone, the mark is not.
  const mapGone = await page.evaluate((id) => {
    try { localStorage.removeItem('toolboxForeignCheckouts'); } catch (_) {}
    return { mapSaysLocked: ToolboxSync.isCheckedOutElsewhere(id) };
  }, ID);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxDB && window.ToolboxSync);

  // 1. The route gate.
  await page.evaluate((id) => { window.location.hash = '#/file/' + id + '/distress'; }, ID);
  await new Promise((r) => setTimeout(r, 900));
  const route = await page.evaluate(() => ({
    hash: window.location.hash,
    readOnlyShown: !!document.querySelector('.checked-out-readonly, [data-checked-out-readonly]') ||
      /checked out on/i.test(document.getElementById('app-view').innerText || ''),
    text: (document.getElementById('app-view').innerText || '').slice(0, 160),
  }));
  check('a mutating route on a copy held elsewhere does not open the survey',
    route.readOnlyShown, route.text.replace(/\n/g, ' / '));

  // 2. The database guard: a write must not land on a copy held elsewhere.
  const write = await page.evaluate(async (id) => {
    const record = await ToolboxDB.getCustomerFile(id);
    record.notes = 'drawn on a copy this device does not own';
    let refused = null;
    try { await ToolboxDB.saveCustomerFile(record); }
    catch (err) { refused = (err && err.code) || 'error'; }
    const after = await ToolboxDB.getCustomerFile(id);
    return { refused: refused, landed: (after && after.notes) === record.notes };
  }, ID);
  check('a save to a copy held elsewhere is refused', write.refused === 'checkout', String(write.refused));
  check('and nothing was written', !write.landed);

  // 3. The mark is still the one thing that says so.
  const marked = await page.evaluate(async (id) => {
    const record = await ToolboxDB.getCustomerFile(id);
    return {
      stillMarked: !!(record && record.heldByOtherDevice),
      heldElsewhere: ToolboxSync.heldElsewhere(record),
    };
  }, ID);
  check('the mark on the copy is intact', marked.stillMarked && marked.heldElsewhere);
  check('the lock map really had been cleared', mapGone.mapSaysLocked === false,
    'map said ' + mapGone.mapSaysLocked);
  // And the copy put it back, so every gate that reads the map now agrees
  // with the copy instead of contradicting it.
  const repaired = await page.evaluate((id) => ToolboxSync.isCheckedOutElsewhere(id), ID);
  check('the copy repaired this device\'s lock map', repaired === true);
} finally {
  await browser.close();
  server.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
