/**
 * Quick Capture + Job Walk video live in the File Cabinet (Tim, Nov 9, 2026).
 * App-side: Photo folders cabinet state / tag UI, Report Evidence lists only
 * localFull QC, Job Walk Upload videos + size limit copy.
 *
 * Run: node tests/qc-cabinet-media.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';
import { mkdir } from 'fs/promises';

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

const OUT = '/opt/cursor/artifacts';
await mkdir(OUT, { recursive: true });

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
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() =>
    window.ToolboxDB && window.ToolboxApp && window.ToolboxReportEvidence &&
    window.ToolboxRecoveredPhotos && window.ToolboxSync
  );

  const helpers = await page.evaluate(() => {
    const pull = ToolboxSync.distressMediaIdsForPull({
      distress: {
        pins: [{ photos: ['ph_pin'] }],
        quickCapture: [{ id: 'ph_qc' }],
        jobWalk: {
          notes: [{ audioId: 'vm_a' }],
          videos: [{ id: 'vid_1' }],
        },
      },
    }).sort();
    const push = ToolboxSync.distressMediaIdsForPush({
      distress: {
        pins: [{ photos: ['ph_pin'] }],
        quickCapture: [{ id: 'ph_qc' }],
        jobWalk: {
          notes: [{ audioId: 'vm_a' }],
          videos: [{ id: 'vid_1' }],
        },
      },
    }).sort();
    return {
      pull,
      push,
      thumbKey: ToolboxSync.thumbMediaKey('ph_qc'),
    };
  });
  check('distressMediaIdsForPull is travel-only',
    JSON.stringify(helpers.pull) === JSON.stringify(['ph_pin', 'vm_a']),
    JSON.stringify(helpers.pull));
  check('distressMediaIdsForPush includes QC but not video',
    JSON.stringify(helpers.push) === JSON.stringify(['ph_pin', 'ph_qc', 'vm_a']),
    JSON.stringify(helpers.push));
  check('thumbMediaKey prefixes Quick Capture thumbs',
    helpers.thumbKey === 'thumb:ph_qc', helpers.thumbKey);

  // Seed a Customer File with cabinet-only QC (thumb) + downloaded QC + pin.
  await page.evaluate(async () => {
    const tiny =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';
    const record = ToolboxApp.blankCustomerFile('qc-cabinet-1');
    record.firstName = 'Cabinet';
    record.lastName = 'Media';
    record.propertyAddress = '9 Capture Way';
    ToolboxPlanSetup.ensurePlanSetup(record);
    const canvasId = record.planSetup.canvases[0].id;
    record.distress = {
      mode: 'internal',
      startNum: 1,
      nextNum: 2,
      activeCanvasId: canvasId,
      pins: [{
        id: 'pin-1',
        num: 1,
        x: 0.4,
        y: 0.5,
        canvasId,
        location: 'Hall',
        description: 'Hairline',
        photos: [{ id: 'ph_pin_local' }],
      }],
      quickCapture: [
        {
          id: 'ph_qc_cabinet',
          ts: Date.now(),
          folder: 'Exterior',
          description: 'Cabinet only porch',
          sourceName: 'porch.jpg',
          localFull: false,
        },
        {
          id: 'ph_qc_local',
          ts: Date.now(),
          folder: 'Interior',
          description: 'Downloaded kitchen',
          sourceName: 'kitchen.jpg',
          localFull: true,
          tagged: true,
        },
      ],
      jobWalk: { notes: [], videos: [] },
      updatedAt: new Date().toISOString(),
    };
    await ToolboxDB.saveCustomerFile(record);
    // Pin + downloaded QC full bytes in distress photo store.
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('pgg_photos_v1', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('photos')) {
          req.result.createObjectStore('photos');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const put = async (id, value) => {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(value, id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    };
    await put('ph_pin_local', tiny);
    await put('ph_qc_local', tiny);
    await put(ToolboxSync.thumbMediaKey('ph_qc_cabinet'), tiny);
  });

  const evidence = await page.evaluate(() => {
    return ToolboxDB.getCustomerFile('qc-cabinet-1').then((record) => {
      const distress = ToolboxReportEvidence.listDistressPhotos(record);
      const qc = ToolboxReportEvidence.listLocalQuickCapturePhotos(record);
      return {
        distressCount: distress.length,
        qcIds: qc.map((p) => p.id),
        qcKeys: qc.map((p) => p.key),
      };
    });
  });
  check('Report Evidence lists Distress pin photos',
    evidence.distressCount === 1, JSON.stringify(evidence));
  check('Report Evidence lists only localFull Quick Capture for Pictures',
    evidence.qcIds.length === 1 && evidence.qcIds[0] === 'ph_qc_local' &&
    evidence.qcKeys[0] === 'qc:ph_qc_local',
    JSON.stringify(evidence));

  // Open Photo folders and confirm cabinet badge + tag + download tagged.
  await page.evaluate(async () => {
    await ToolboxRecoveredPhotos.open('qc-cabinet-1');
  });
  await page.waitForSelector('.photo-folders__panel');
  await page.click('.photo-folders__tabs button[data-photo-folder="quick"]');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.photo-folders__cabinet-state'))
      .some((el) => /File Cabinet/i.test(el.textContent || ''))
  );
  const folderUi = await page.evaluate(() => {
    const states = Array.from(document.querySelectorAll('.photo-folders__cabinet-state'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    const note = document.querySelector('.photo-folders__note');
    const downloadTagged = document.querySelector('#photo-folders-download-tagged');
    const tag = document.querySelector('#photo-folders-tag');
    const openExplorer = document.querySelector('#photo-folders-open-explorer');
    return {
      states,
      note: note ? note.textContent : '',
      hasDownloadTagged: !!downloadTagged,
      hasTag: !!tag,
      hasOpenExplorer: !!openExplorer,
    };
  });
  check('Photo folders show In the File Cabinet for thumb-only QC',
    folderUi.states.some((s) => /File Cabinet/i.test(s)),
    JSON.stringify(folderUi.states));
  check('Photo folders explain Cabinet + tag-and-download',
    /File Cabinet/i.test(folderUi.note) && /Tag/i.test(folderUi.note),
    folderUi.note.slice(0, 120));
  check('Photo folders offer Tag and Download tagged',
    folderUi.hasDownloadTagged && folderUi.hasTag && folderUi.hasOpenExplorer,
    JSON.stringify(folderUi));

  await page.screenshot({ path: `${OUT}/qc-photo-folders-cabinet.png`, fullPage: true });

  // Tag the cabinet photo (select first cabinet card if needed).
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.photo-folders__card'));
    const cabinet = cards.find((card) =>
      /File Cabinet/i.test(card.textContent || '')
    );
    if (cabinet) cabinet.click();
  });
  await page.waitForSelector('#photo-folders-tag');
  const tagged = await page.evaluate(async () => {
    const input = document.querySelector('#photo-folders-tag');
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // toggleTag is async — give it a beat.
    await new Promise((r) => setTimeout(r, 80));
    const record = await ToolboxDB.getCustomerFile('qc-cabinet-1');
    const item = (record.distress.quickCapture || [])
      .find((q) => q.id === 'ph_qc_cabinet');
    return !!(item && item.tagged);
  });
  check('Tagging a Quick Capture persists tagged on the Customer File', tagged);

  await page.screenshot({ path: `${OUT}/qc-tag-download-flow.png`, fullPage: true });

  // Pictures page placement uses downloaded QC key via ensurePictures path.
  const pictures = await page.evaluate(async () => {
    const record = await ToolboxDB.getCustomerFile('qc-cabinet-1');
    const photoList = ToolboxReportEvidence.listDistressPhotos(record)
      .concat(ToolboxReportEvidence.listLocalQuickCapturePhotos(record));
    const qc = photoList.filter((p) => p.quickCapture);
    // Simulate attachEvidence key presence for downloaded QC.
    return {
      total: photoList.length,
      qc: qc.map((p) => ({ key: p.key, id: p.id, seed: p.seedText })),
    };
  });
  check('Downloaded Quick Capture can sit beside Distress photos for Pictures',
    pictures.total === 2 && pictures.qc.length === 1 &&
    pictures.qc[0].key === 'qc:ph_qc_local',
    JSON.stringify(pictures));

  // Job Walk: Upload videos + waiting count + size limit.
  await page.evaluate(() => {
    const close = document.querySelector('#photo-folders-close');
    if (close) close.click();
  });
  const jw = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'qc-jw-host';
    document.body.appendChild(host);
    if (!window.ToolboxJobWalk || typeof window.ToolboxJobWalk.mount !== 'function') {
      return { mounted: false };
    }
    await window.ToolboxJobWalk.mount(host, {
      customerFileId: 'qc-cabinet-1',
      onBack: function () {},
    });
    const hints = Array.from(host.querySelectorAll('.jw-panel__hint'));
    const videoHint = hints.find((el) => /100 MB|walk-around|File Cabinet/i.test(el.textContent || ''));
    const upload = host.querySelector('#jw-upload-videos');
    const wait = host.querySelector('#jw-video-wait');
    return {
      mounted: true,
      hint: videoHint ? videoHint.textContent : '',
      hasUpload: !!upload,
      waitHidden: wait ? !!wait.hidden : true,
      uploadDisabled: upload ? !!upload.disabled : true,
    };
  });
  check('Job Walk mounts Upload videos control',
    jw.mounted && jw.hasUpload, JSON.stringify(jw));
  check('Job Walk size limit message is 100 MB',
    jw.mounted && /100 MB/.test(jw.hint || ''), jw.hint || '');
  check('Upload videos disabled when none waiting',
    jw.mounted && jw.uploadDisabled && jw.waitHidden, JSON.stringify(jw));

  await page.screenshot({ path: `${OUT}/qc-job-walk-upload-videos.png`, fullPage: true });

  // Seed a waiting video and confirm badge.
  const waiting = await page.evaluate(async () => {
    const host = document.querySelector('#qc-jw-host');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const id = 'vid_qc_wait';
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('pgg_photos_v1', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(new Blob([bytes], { type: 'video/webm' }), id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    const record = await ToolboxDB.getCustomerFile('qc-cabinet-1');
    record.distress.jobWalk.videos.push({
      id: id,
      ts: new Date().toISOString(),
      description: 'Waiting clip',
      sourceName: 'wait.webm',
      byteLength: bytes.length,
      mimeType: 'video/webm',
    });
    await ToolboxDB.saveCustomerFile(record);
    host.innerHTML = '';
    await ToolboxJobWalk.mount(host, {
      customerFileId: 'qc-cabinet-1',
      onBack: function () {},
    });
    const wait = host.querySelector('#jw-video-wait');
    const upload = host.querySelector('#jw-upload-videos');
    return {
      text: wait ? wait.textContent : '',
      hidden: wait ? !!wait.hidden : true,
      disabled: upload ? !!upload.disabled : true,
    };
  });
  check('Job Walk shows waiting count for unuploaded video',
    !waiting.hidden && /1 video waiting/.test(waiting.text) && !waiting.disabled,
    JSON.stringify(waiting));

  await page.screenshot({
    path: `${OUT}/qc-job-walk-waiting-count.png`,
    fullPage: true,
  });
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

