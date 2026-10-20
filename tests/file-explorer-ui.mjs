/**
 * File Explorer UI against a synthetic server. No production Customer Files.
 * Run: node tests/file-explorer-ui.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import net from 'net';
import { join } from 'path';

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
  for (const candidate of candidates) {
    try {
      require('fs').accessSync(candidate);
      return candidate;
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

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = 'plan-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const INDEX_TEXT = JSON.stringify({
  id: ID,
  displayName: 'Ada Mitchell',
  propertyAddress: '10 Oak Street',
  fieldWorkDate: '2026-03-01',
  createdAt: '2026-01-15T12:00:00.000Z',
  checkout: { email: 'tim@example.com', deviceId: 'device-a' },
});

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
// Wait for the server this run spawned to actually answer. A fixed pause is a
// coin flip when the machine is busy running the whole sweep: it passes alone
// and times out in the suite, which is how this came back red once in forty.
for (let i = 0; i < 100; i += 1) {
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/index.html`);
    if (probe.ok) break;
  } catch (_) { /* not listening yet */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer && window.ToolboxDB);

  const flow = await page.evaluate(async (fixture) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    const fetchLog = [];
    const writes = [];
    const downloads = [];
    const writeNames = [
      'saveCustomerFile', 'putMedia', 'deleteMedia', 'moveCustomerFileToTrash',
      'restoreCustomerFile', 'permanentlyDeleteCustomerFiles', 'removeLocalWorkingCopy',
      'importCustomerFileRecovery', 'commitCustomerFileRecoveryUpdate', 'purgeExpiredCustomerFiles',
    ];
    writeNames.forEach((name) => {
      const original = window.ToolboxDB[name];
      if (typeof original !== 'function') return;
      window.ToolboxDB[name] = function () {
        writes.push(name);
        return original.apply(this, arguments);
      };
    });
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      const url = originalCreate(blob);
      downloads.push({ url, size: blob.size, type: blob.type, name: '', blob });
      return url;
    };
    // Tonight's Save As, as Chrome and Edge present it on a desktop: the
    // dialog hands back a place, and the file is streamed into it. Headless
    // Chrome has the function but never answers it, so the test supplies a
    // dialog that does. `pickerMode` lets the same run cover a cancelled
    // dialog and a browser that has none.
    const picked = [];
    let pickerMode = 'accept';
    const realPicker = window.showSaveFilePicker;
    window.showSaveFilePicker = async function (options) {
      if (pickerMode === 'none') throw new Error('no picker here');
      if (pickerMode === 'cancel') {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      }
      const name = (options && options.suggestedName) || 'file';
      const entry = { name, chunks: [], types: options && options.types };
      picked.push(entry);
      return {
        name,
        createWritable: async function () {
          return new WritableStream({
            write(chunk) { entry.chunks.push(chunk); },
          });
        },
      };
    };
    function pickedBlob(entry) {
      return new Blob(entry.chunks);
    }

    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const last = downloads[downloads.length - 1];
      if (last) {
        last.name = this.download;
        last.clicked = true;
      }
      return originalClick.call(this);
    };

    const files = [{
      key: `cf/${fixture.id}/index.json`,
      id: fixture.id,
      size: fixture.indexText.length,
      uploaded: '2026-03-04T15:06:07.000Z',
      contentType: 'application/json',
      displayName: 'Ada Mitchell',
      propertyAddress: '10 Oak Street',
      fieldWorkDate: '2026-03-01',
      createdAt: '2026-01-15T12:00:00.000Z',
    }, {
      key: `cf/${fixture.other}/index.json`,
      id: fixture.other,
      displayName: 'Fred Keulen',
      propertyAddress: '5 Pine Road',
      createdAt: '2024-11-02T00:00:00.000Z',
    }];
    const objects = [
      { key: `cf/${fixture.id}/index.json`, size: fixture.indexText.length, contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
      { key: `cf/${fixture.id}/customer.json`, size: 40, contentType: 'application/json', purpose: 'customer', label: 'Customer information' },
      { key: `cf/${fixture.id}/plans.json`, size: 42, contentType: 'application/json', purpose: 'plans', label: 'Plans and canvases' },
      { key: `cf/${fixture.id}/distress.json`, size: 80, contentType: 'application/json', purpose: 'distress', label: 'Distress Survey' },
      { key: `cf/${fixture.id}/floor.json`, size: 60, contentType: 'application/json', purpose: 'floor', label: 'Floor Survey' },
      { key: `cf/${fixture.id}/diagnostics.json`, size: 30, contentType: 'application/json', purpose: 'diagnostics', label: 'Diagnostics' },
      { key: `cf/${fixture.id}/report.json`, size: 20, contentType: 'application/json', purpose: 'report', label: 'Report Builder' },
      { key: `cf/${fixture.id}/field-notes.txt`, size: 6, contentType: 'text/plain', purpose: 'other', label: 'field-notes.txt' },
      { key: `media/${fixture.planId}`, size: fixture.png.length, contentType: 'image/png', purpose: 'plan', label: 'Floor plan — Ground' },
      { key: 'media/ph_present', size: fixture.png.length, contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
      { key: 'media/ph_quick', size: fixture.png.length, contentType: 'image/jpeg', purpose: 'quick-capture', label: 'Quick Capture photo — porch.jpg' },
      // No content type, exactly as the Cabinet reports these on real jobs.
      // They are still photographs, and they still belong on the sheet.
      { key: 'media/ph_loose', size: fixture.png.length, purpose: 'unassigned-photo', label: 'Unassigned photo' },
      { key: 'media/ph_general', size: fixture.png.length, purpose: 'general-photo', label: 'General photo — Exterior overview' },
      { key: 'media/ph_general_missing', missing: true, purpose: 'general-photo', label: 'General photo' },
      { key: 'media/fsrec_canvas-ground', size: fixture.pdf.length, contentType: 'application/pdf', purpose: 'floor-pdf', label: 'Floor Survey recovery PDF — Ground' },
      { key: 'media/dxfig_ground', size: fixture.png.length, contentType: 'image/png', purpose: 'diagnostics-figure', label: 'Diagnostics figure — Ground' },
      { key: 'media/ph_missing', missing: true, purpose: 'distress-photo', label: 'Distress Survey photograph' },
      { key: 'media/fsrec_missing', missing: true, purpose: 'floor-pdf', label: 'Floor Survey recovery PDF — Empty' },
    ];
    const bytes = {
      [`cf/${fixture.id}/index.json`]: { type: 'application/json', body: fixture.indexText },
      [`cf/${fixture.id}/plans.json`]: { type: 'application/json', body: '{"canvases":[]}' },
      [`cf/${fixture.id}/customer.json`]: { type: 'application/json', body: '{"firstName":"Ada"}' },
      [`cf/${fixture.id}/field-notes.txt`]: { type: 'text/plain', body: 'a note' },
      [`media/${fixture.planId}`]: { type: 'image/png', body: fixture.png },
      'media/ph_present': { type: 'image/jpeg', body: fixture.png },
      'media/ph_quick': { type: 'image/jpeg', body: fixture.png },
      [`cf/${fixture.id}/distress.json`]: {
        type: 'application/json',
        // The shutter time, which is the only thing that can name the file
        // after the day it was taken rather than the day it was downloaded.
        body: JSON.stringify({
          pins: [{ num: 4, location: 'Hall', description: 'Hairline crack, north wall', photos: ['ph_present'] }],
          // A named run: the investigator typed "Exterior" when they started.
          quickCapture: [{ id: 'ph_quick', ts: Date.parse('2026-03-02T17:45:12.000Z'), folder: 'Exterior' }],
        }),
      },
      'media/fsrec_canvas-ground': { type: 'application/pdf', body: fixture.pdf },
      'media/dxfig_ground': { type: 'image/png', body: fixture.png },
    };

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
      const href = String(url);
      if (!href.startsWith(base)) return realFetch(url, opts);
      const method = (opts && opts.method) || 'GET';
      const path = href.slice(base.length).replace(/^\//, '');
      fetchLog.push({ method, path });
      if (path === 'explore/files' && method === 'GET') return jsonResponse({ files });
      if (path === `explore/files/${fixture.id}` && method === 'GET') {
        return jsonResponse({
          id: fixture.id,
          displayName: 'Ada Mitchell',
          propertyAddress: '10 Oak Street',
          fieldWorkDate: '2026-03-01',
          prefix: `cf/${fixture.id}/`,
          objects,
          referenceNotes: ['Referenced media id in distress.json is not a single storage key and was not fetched.'],
        });
      }
      if (path === `explore/files/${fixture.other}` && method === 'GET') {
        return jsonResponse({
          id: fixture.other,
          displayName: 'Fred Keulen',
          propertyAddress: '5 Pine Road',
          createdAt: '2024-11-02T00:00:00.000Z',
          prefix: `cf/${fixture.other}/`,
          objects: [{
            key: `cf/${fixture.other}/index.json`,
            contentType: 'application/json',
            purpose: 'technical',
            label: 'Cabinet index',
          }],
          referenceNotes: [],
        });
      }
      const objectMatch = new RegExp(`^explore/files/${fixture.id}/object\\?key=(.+)$`).exec(path);
      if (objectMatch && method === 'GET') {
        const key = decodeURIComponent(objectMatch[1]);
        const stored = bytes[key];
        if (!stored) return new Response('Not stored', { status: 404, headers: { 'content-type': 'text/plain' } });
        const raw = typeof stored.body === 'string' ? new TextEncoder().encode(stored.body) : new Uint8Array(stored.body);
        return new Response(raw, {
          status: 200,
          headers: {
            'content-type': stored.type,
            'content-disposition': `attachment; filename="${key.split('/').pop()}"`,
          },
        });
      }
      if (path === `explore/files/${fixture.id}/archive` && method === 'GET') {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="cf-${fixture.id}.zip"`,
          },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    function jsonResponse(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const beforeFiles = await window.ToolboxDB.getAllCustomerFiles();
    document.getElementById('app-explorer').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rootText = document.getElementById('explorer-list').innerText;
    const rootLead = document.getElementById('explorer-lead').textContent;
    const columnHead = document.querySelector('.explorer-columns');
    const adaCard = document.querySelector(`[data-key="cf/${fixture.id}/index.json"]`);
    const rootRawKey = adaCard.querySelector('.explorer-row__technical code').textContent;
    const search = document.getElementById('explorer-search');
    search.value = 'Keulen';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const searched = document.getElementById('explorer-list').innerText;
    const searchedCount = document.querySelectorAll('.explorer-row__key').length;
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rootKey = document.querySelector('.explorer-row__key');
    rootKey.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const detailTitle = document.getElementById('explorer-title').textContent;
    const detailLead = document.getElementById('explorer-lead').textContent;

    // A job opens as folders now, so the job's contents are walked rather
    // than read off one long page. Tim: "Explorer needs to kind of look and
    // feel like an actual Microsoft file explorer."
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folderIds = () => [...document.querySelectorAll('.explorer-folder')]
      .map((folder) => folder.dataset.group);
    const atRoot = () => !!document.querySelector('.explorer-folder');
    async function backToFolders() {
      const up = document.querySelector('#explorer-crumb .explorer-up');
      if (up) { up.click(); await pause(70); }
    }
    async function openFolderNamed(gid) {
      if (!atRoot()) await backToFolders();
      const row = document.querySelector(`.explorer-folder[data-group="${gid}"] .explorer-folder__open`);
      if (!row) return false;
      row.click();
      await pause(90);
      return true;
    }
    function openRecordsBox() {
      const box = document.querySelector('.explorer-records');
      if (box) box.open = true;
      return !!box;
    }
    /** Put whatever holds this key on the screen, wherever it lives. */
    async function ensureVisible(key) {
      if (document.querySelector(`[data-key="${key}"]`)) return true;
      await backToFolders();
      openRecordsBox();
      if (document.querySelector(`[data-key="${key}"]`)) return true;
      const ids = folderIds();
      for (let i = 0; i < ids.length; i += 1) {
        await openFolderNamed(ids[i]);
        if (document.querySelector(`[data-key="${key}"]`)) return true;
        await backToFolders();
      }
      return false;
    }

    const rowFacts = {};
    const WATCH = [
      'media/ph_missing', 'media/fsrec_missing', 'media/fsrec_canvas-ground',
      'media/ph_quick', 'media/ph_present', `cf/${fixture.id}/field-notes.txt`,
    ];
    function snapWatched() {
      WATCH.forEach((key) => {
        if (rowFacts[key]) return;
        const el = document.querySelector(`[data-key="${key}"]`);
        if (!el) return;
        rowFacts[key] = {
          text: el.innerText,
          actions: [...el.querySelectorAll('button')].map((button) => button.textContent),
          buttons: el.querySelectorAll('button').length,
        };
      });
    }

    await backToFolders();
    const groups = folderIds();
    openRecordsBox();
    const detailRawKey = document.querySelector('.explorer-row__technical code').textContent;
    let detailText = document.getElementById('explorer-list').innerText;
    let objectCount = document.querySelectorAll('.explorer-row[data-key]').length;
    let tileCount = 0;
    let sheetCount = 0;
    let otherPhotosText = '';
    let untypedOnSheet = false;
    let sawUnreferenced = !!document.querySelector('[data-key="media/ph_unreferenced"]');
    snapWatched();
    for (let i = 0; i < groups.length; i += 1) {
      await openFolderNamed(groups[i]);
      detailText += '\n' + document.getElementById('explorer-list').innerText;
      objectCount += document.querySelectorAll('.explorer-row[data-key]').length
        + document.querySelectorAll('.explorer-tile[data-key]').length;
      tileCount += document.querySelectorAll('.explorer-tile[data-key]').length;
      sheetCount += document.querySelectorAll('.explorer-sheet').length;
      if (document.querySelector('[data-key="media/ph_unreferenced"]')) sawUnreferenced = true;
      if (groups[i] === 'other-photos') {
        const box = document.querySelector('[data-group="other-photos"]');
        otherPhotosText = box ? box.innerText : '';
        // The two the Cabinet reported with no content type at all.
        untypedOnSheet = ['media/ph_loose', 'media/ph_general'].every(function (key) {
          const el = document.querySelector(`[data-key="${key}"]`);
          return !!el && el.classList.contains('explorer-tile');
        });
      }
      snapWatched();
      await backToFolders();
    }
    const fact = (key) => rowFacts[key] || { text: '', actions: [], buttons: -1 };
    const note = document.querySelector('.explorer-note');
    const unreferenced = sawUnreferenced;

    // Pictures are tiles on a contact sheet, not rows with their own buttons:
    // tapping one opens the lightbox, and Download lives in there.
    async function clickAction(key, label) {
      await ensureVisible(key);
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el && el.classList.contains('explorer-tile')) {
        el.click();
        await new Promise((resolve) => setTimeout(resolve, 260));
        if (label === 'Download') {
          const save = [...document.querySelectorAll('.explorer-lightbox__bar button')]
            .find((item) => item.textContent === 'Download');
          if (save) save.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          // Leave no overlay behind, or the next step clicks through it.
          closeLightbox();
        }
        return;
      }
      const button = [...el.querySelectorAll('button')].find((item) => item.textContent === label);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    function closeLightbox() {
      const close = [...document.querySelectorAll('.explorer-lightbox__bar button')]
        .find((item) => item.textContent === 'Close');
      if (close) close.click();
    }

    await clickAction('media/fsrec_canvas-ground', 'Download');
    await clickAction(`media/${fixture.planId}`, 'Open');
    const image = document.querySelector('.explorer-lightbox__img');
    if (image && !image.complete) {
      await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
    }
    const imageOpened = !!(image && image.complete && image.naturalWidth === 1);
    closeLightbox();
    await clickAction(`cf/${fixture.id}/index.json`, 'Open');
    const jsonText = document.querySelector('.explorer-preview__text')
      ? document.querySelector('.explorer-preview__text').textContent
      : '';
    const previewFont = (function () {
      const heading = document.querySelector('.explorer-preview__head h2');
      if (!heading) return null;
      const headingStyle = getComputedStyle(heading);
      const parentStyle = getComputedStyle(heading.parentElement);
      return {
        weight: headingStyle.fontWeight,
        size: headingStyle.fontSize,
        family: headingStyle.fontFamily,
        parentFamily: parentStyle.fontFamily,
        lineHeight: headingStyle.lineHeight,
      };
    })();
    await clickAction('media/fsrec_canvas-ground', 'Open');
    const pdf = document.querySelector('.explorer-preview__pdf');
    await clickAction(`media/${fixture.planId}`, 'Download');

    await openFolderNamed('quick-capture');
    const quickSheet = [...document.querySelectorAll('.explorer-group')]
      .find((group) => group.dataset.group === 'quick-capture');
    const quickAll = quickSheet
      && [...quickSheet.querySelectorAll('button')].find((b) => b.textContent === 'Download all');
    if (quickAll) {
      quickAll.click();
      for (let i = 0; i < 60; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (picked.some((entry) => /\.zip$/.test(entry.name) && entry.chunks.length)) break;
      }
    }
    const quickZipEntry = picked.filter((entry) => /\.zip$/.test(entry.name)).pop() || { name: '', chunks: [] };
    const quickZip = quickZipEntry.name || '';

    // The Distress sheet's own Download all, for the pin photograph's name.
    await openFolderNamed('distress');
    const distressSheet = [...document.querySelectorAll('.explorer-group')]
      .find((group) => group.dataset.group === 'distress');
    const distressAll = distressSheet
      && [...distressSheet.querySelectorAll('button')].find((b) => b.textContent === 'Download all');
    let distressEntries = [];
    if (distressAll) {
      const before = picked.filter((entry) => /\.zip$/.test(entry.name)).length;
      distressAll.click();
      for (let i = 0; i < 60; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (picked.filter((entry) => /\.zip$/.test(entry.name)).length > before) break;
      }
      const entry = picked.filter((item) => /\.zip$/.test(item.name)).pop();
      if (entry && entry.chunks.length && window.JSZip) {
        try {
          const unpacked = await window.JSZip.loadAsync(pickedBlob(entry));
          distressEntries = Object.keys(unpacked.files).filter((name) => !unpacked.files[name].dir);
        } catch (_) { distressEntries = []; }
      }
    }
    // Unpack it: the folder saying the right date is not proof that the
    // pictures inside do.
    let quickEntries = [];
    if (quickZipEntry.chunks && quickZipEntry.chunks.length && window.JSZip) {
      try {
        const unpacked = await window.JSZip.loadAsync(pickedBlob(quickZipEntry));
        // JSZip lists the folder itself; only the pictures matter here.
        quickEntries = Object.keys(unpacked.files).filter((name) => !unpacked.files[name].dir);
      } catch (_) { quickEntries = []; }
    }
    document.getElementById('explorer-zip').click();
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Closing the dialog saves nothing, and must not say it did.
    pickerMode = 'cancel';
    const beforeCancel = picked.length;
    const cancelNotices = [];
    await clickAction('media/fsrec_canvas-ground', 'Download');
    cancelNotices.push(document.getElementById('explorer-notice').textContent);
    const cancelled = { added: picked.length - beforeCancel, notices: cancelNotices };

    // iPhone, iPad, Safari, Firefox: no dialog, so it falls back to the
    // ordinary download, exactly as Toolbox did before.
    pickerMode = 'none';
    window.showSaveFilePicker = undefined;
    const beforeFallback = downloads.filter((d) => d.clicked).length;
    await clickAction('media/fsrec_canvas-ground', 'Download');
    const fallbackNotice = document.getElementById('explorer-notice').textContent;
    const fallback = {
      added: downloads.filter((d) => d.clicked).length - beforeFallback,
      notice: fallbackNotice,
      last: (downloads.filter((d) => d.clicked).pop() || {}).name || '',
    };
    window.showSaveFilePicker = realPicker;

    const afterFiles = await window.ToolboxDB.getAllCustomerFiles();

    return {
      hash: window.location.hash,
      hasExplorerButton: !!document.getElementById('app-explorer'),
      rootText,
      rootLead,
      rootRawKey,
      columnHead: !!columnHead,
      searched,
      searchedCount,
      detailText,
      detailTitle,
      detailLead,
      detailRawKey,
      groups,
      objectCount,
      tileCount,
      sheetCount,
      untypedOnSheet,
      recoveryText: fact('media/fsrec_canvas-ground').text,
      recoveryActions: fact('media/fsrec_canvas-ground').actions,
      quickText: fact('media/ph_quick').text,
      distressText: fact('media/ph_present').text,
      notesText: fact(`cf/${fixture.id}/field-notes.txt`).text,
      missingText: fact('media/ph_missing').text,
      missingDownloads: fact('media/ph_missing').buttons,
      missingPdfText: fact('media/fsrec_missing').text,
      missingPdfDownloads: fact('media/fsrec_missing').buttons,
      note: note ? note.textContent : '',
      unreferenced: !!unreferenced,
      imageOpened,
      jsonText,
      pdfSrc: pdf ? pdf.getAttribute('src') : '',
      pdfTitle: pdf ? pdf.getAttribute('title') : '',
      otherPhotos: otherPhotosText,
      previewFont,
      downloads: downloads.map((d) => ({ url: d.url, size: d.size, type: d.type, name: d.name, clicked: d.clicked })),
      picked: picked.map((entry) => ({
        name: entry.name,
        size: entry.chunks.reduce((total, chunk) => total + (chunk.byteLength || chunk.length || 0), 0),
      })),
      cancelled,
      fallback,
      quickZip,
      distressEntries,
      quickEntries,
      fetchLog,
      writes,
      beforeCount: beforeFiles.length,
      afterCount: afterFiles.length,
    };
  }, {
    id: ID,
    other: OTHER,
    planId: PLAN_ID,
    indexText: INDEX_TEXT,
    png: [...PNG],
    pdf: [...PDF],
  });

  check('app bar has a File Explorer entry', flow.hasExplorerButton);
  check('root leads with customer, address, and one useful date; raw key stays in Technical details',
    !flow.rootText.includes(`cf/${ID}/index.json`) && flow.rootRawKey === `cf/${ID}/index.json` &&
    flow.rootText.includes('Ada Mitchell') &&
    flow.rootText.includes('Fred Keulen') &&
    flow.rootText.includes('10 Oak Street') &&
    flow.rootText.includes('Mar 1, 2026') &&
    !flow.rootText.includes('Jan 15') &&
    !flow.rootText.includes('Mar 4') &&
    !flow.columnHead &&
    !/\bType\b/.test(flow.rootText) &&
    !/\bUploaded\b/.test(flow.rootText));
  check('root copy is plain language',
    flow.rootLead === 'Customer Files stored on the server. Open a file to view its stored surveys, photos, plans, and other data.');
  check('search finds one Customer File by name',
    flow.searchedCount === 1 && flow.searched.includes('Fred Keulen') && !flow.searched.includes('Ada Mitchell'));
  check('detail groups every stored piece and keeps raw keys available',
    flow.detailTitle === 'Ada Mitchell' &&
    flow.detailLead.includes('10 Oak Street') &&
    flow.detailLead.includes('Mar 1, 2026') &&
    flow.detailRawKey.startsWith(`cf/${ID}/`) &&
    flow.groups.join(',') === 'plans,distress,quick-capture,other-photos,floor,diagnostics,other' &&
    flow.objectCount === 18 &&
    flow.otherPhotos.includes('Unassigned photo') &&
    flow.otherPhotos.includes('Exterior overview') &&
    flow.otherPhotos.includes('Not stored') &&
    flow.detailText.includes('Plans and canvases') &&
    // The plan is a tile under the "Plans and canvases" heading, captioned
    // with the level it is a plan of.
    flow.detailText.includes('Ground') &&
    !flow.detailText.includes(`media/${PLAN_ID}`));
  check('Distress and Quick Capture stay distinct',
    flow.distressText.includes('Distress Survey photograph') &&
    !flow.distressText.includes('Quick Capture') &&
    // A tile names what sets this picture apart from its neighbours; the
    // group heading above it already said "Quick Capture".
    flow.quickText.includes('porch.jpg') &&
    !flow.detailText.includes('Distress or Quick Capture'));
  check('pictures are a contact sheet, not a list of identical cards',
    flow.tileCount === 6 && flow.sheetCount === 5);
  // What a stored item is FOR decides whether it is a picture, not what the
  // server calls it. The Cabinet does not always report a content type, and
  // when it did not, every photograph fell out of the sheet and into a card
  // of its own -- Tim, looking at exactly that: "how does this help anybody
  // to look at one picture at a time?"
  check('a photograph with no stored type is still on the sheet',
    flow.untypedOnSheet);
  // Tim: "I want it as the date they were taken, not the date that I
  // downloaded them to the computer." 2026-03-02 is the shutter time seeded
  // into distress.json; the download happens today.
  check('a named Quick Capture run names the download, with the day it was taken',
    /^exterior-2026-03-0[23]\.zip$/.test(flow.quickZip), flow.quickZip);
  // A pin photograph is stored as an id; everything a person would call it by
  // is on the pin it hangs from, so that is what names it.
  check('a Distress photograph is named after its pin, its room and its note',
    flow.distressEntries.length === 1 &&
    /^pin-04-hall-hairline-crack.*\.jpg$/.test(flow.distressEntries[0]),
    JSON.stringify(flow.distressEntries));
  check('and the pictures sit in that set, named for when they were taken',
    flow.quickEntries.length === 1 && /^Exterior\/2026-03-0[23]_\d{6}\.jpg$/.test(flow.quickEntries[0]),
    JSON.stringify(flow.quickEntries));
  check('Floor Survey recovery PDF can be opened and downloaded',
    flow.recoveryText.includes('Floor Survey recovery PDF — Ground') &&
    flow.recoveryActions.includes('Open') &&
    flow.recoveryActions.includes('Download'));
  check('unknown stored file is shown with its name',
    flow.notesText.includes('field-notes.txt'));
  check('missing media is visibly not stored and cannot be downloaded',
    /Not stored/.test(flow.missingText) && flow.missingDownloads === 0 && !/image\/|application\//.test(flow.missingText) &&
    /Not stored/.test(flow.missingPdfText) && flow.missingPdfDownloads === 0 &&
    flow.missingPdfText.includes('Floor Survey recovery PDF — Empty'));
  check('unsafe reference note is visible', /not a single storage key/.test(flow.note));
  check('unreferenced media is absent', flow.unreferenced === false);
  check('image preview uses the stored image', flow.imageOpened);
  check('JSON preview is the stored text', flow.jsonText === INDEX_TEXT);
  check('PDF preview uses the stored recovery PDF',
    flow.pdfSrc.startsWith('blob:') && flow.pdfTitle === 'Floor Survey recovery PDF — Ground');
  check('preview heading inherits the page font at 1rem / 600',
    flow.previewFont &&
    flow.previewFont.weight === '600' &&
    flow.previewFont.size === '16px' &&
    flow.previewFont.family === flow.previewFont.parentFamily &&
    flow.previewFont.lineHeight === '21.6px',
    JSON.stringify(flow.previewFont));
  // Tim: "I could be saving it to a Google Drive, I can save it to my
  // desktop, I can save it to a flash drive, I can save it to an external
  // whatever from Explorer." The bytes have to arrive in the place chosen,
  // not in Downloads to be carried there by hand.
  check('a saved file carries the stored bytes into the place you chose',
    flow.picked.some((item) => item.name.includes(PLAN_ID) && item.size === PNG.length) &&
    flow.picked.some((item) => item.name.includes('fsrec_canvas-ground') && item.size === PDF.length),
    JSON.stringify(flow.picked));
  check('closing the Save dialog saves nothing and claims nothing',
    flow.cancelled.added === 0 && flow.cancelled.notices.every((text) => !/saved/i.test(text || '')),
    JSON.stringify(flow.cancelled));
  check('a browser with no Save dialog still downloads, and says where it went',
    flow.fallback.added === 1 && /downloads/i.test(flow.fallback.notice) &&
    flow.fallback.last.includes('fsrec_canvas-ground'),
    JSON.stringify(flow.fallback));
  check('ZIP download uses the archive response, named after the job',
    flow.picked.some((item) => item.name === 'ada-mitchell.zip' && item.size > 0),
    JSON.stringify(flow.picked.map((item) => item.name)));
  check('browsing does not check out or write the cabinet',
    flow.fetchLog.length > 0 &&
    flow.fetchLog.every((entry) => entry.method === 'GET') &&
    flow.fetchLog.every((entry) => entry.path.startsWith('explore/') || /^media\//.test(entry.path)) &&
    !flow.fetchLog.some((entry) => entry.path.includes('checkout')),
    JSON.stringify(flow.fetchLog));
  check('browsing does not create a local working copy',
    flow.writes.length === 0 && flow.beforeCount === flow.afterCount,
    JSON.stringify({ writes: flow.writes, before: flow.beforeCount, after: flow.afterCount }));

  const shotDir = '/opt/cursor/artifacts/screenshots';
  mkdirSync(shotDir, { recursive: true });

  async function cardFit() {
    return page.evaluate(() => {
      return [...document.querySelectorAll('.explorer-row')].slice(0, 4).map((row) => {
        const main = row.querySelector('.explorer-row__main');
        const actions = row.querySelector('.explorer-row__actions');
        const mainBox = main.getBoundingClientRect();
        const actionsBox = actions.getBoundingClientRect();
        const contentBottom = [...main.children].reduce(
          (max, el) => Math.max(max, el.getBoundingClientRect().bottom),
          mainBox.top,
        );
        const open = [...actions.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Open');
        return {
          mainSlack: Math.round(mainBox.bottom - contentBottom),
          actionGap: Math.round(actionsBox.top - mainBox.bottom),
          cardHeight: Math.round(row.getBoundingClientRect().height),
          direction: getComputedStyle(row).flexDirection,
          openHeight: open ? Math.round(open.getBoundingClientRect().height) : 0,
          actionsBeside: actionsBox.left >= mainBox.right - 2,
        };
      });
    });
  }

  function cardsPacked(cards) {
    return cards.length > 0 && cards.every((card) => (
      card.direction === 'column'
      && card.mainSlack < 12
      && card.actionGap >= 0
      && card.actionGap < 20
      && card.cardHeight < 220
      && (card.openHeight === 0 || card.openHeight >= 44)
    ));
  }

  async function layoutSnapshot(width, height, name) {
    await page.setViewport({ width, height });
    await page.evaluate(() => { window.location.hash = '#/explore'; });
    await page.waitForFunction(() => document.querySelector('.explorer-row__key'));
    const listCards = await cardFit();
    const rootShot = join(shotDir, `file-explorer-${name}-list.png`);
    await page.screenshot({ path: rootShot, fullPage: true });
    await page.click('.explorer-row__key');
    // A job opens as folders; the cards live inside one.
    await page.waitForFunction(() => document.querySelector('.explorer-folder'));
    const folderShot = join(shotDir, `file-explorer-${name}-folders.png`);
    await page.screenshot({ path: folderShot, fullPage: true });
    const folderMetrics = await page.evaluate(() => {
      const folders = [...document.querySelectorAll('.explorer-folder')];
      const doc = document.documentElement;
      return {
        count: folders.length,
        overflow: folders.some((el) => el.getBoundingClientRect().right > window.innerWidth + 1),
        pageOverflow: doc.scrollWidth > doc.clientWidth + 1,
        text: folders.map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
      };
    });
    await page.click('.explorer-folder[data-group="distress"] .explorer-folder__open');
    await page.waitForFunction(() => document.querySelector('[data-key="media/ph_missing"]'));
    const detailCards = await cardFit();
    const detailShot = join(shotDir, `file-explorer-${name}-detail.png`);
    await page.screenshot({ path: detailShot, fullPage: true });
    const metrics = await page.evaluate(() => {
      function box(el) {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      }
      function overlaps(a, b) {
        return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      }
      const title = box(document.querySelector('.app-bar__title'));
      const buttons = [...document.querySelectorAll('.app-bar__actions button')].map((el) => ({
        name: el.textContent.trim(),
        ...box(el),
      }));
      const bar = box(document.querySelector('.app-bar'));
      let crowded = title.right > buttons[0].left + 1;
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        if (button.left < -1 || button.right > window.innerWidth + 1 || button.top < bar.top - 1 || button.bottom > bar.bottom + 1) {
          crowded = true;
        }
        for (let j = i + 1; j < buttons.length; j++) {
          if (overlaps(button, buttons[j])) crowded = true;
        }
      }
      const rows = [...document.querySelectorAll('.explorer-row')];
      const folders = [...document.querySelectorAll('.explorer-folder')];
      const rowOverflow = rows.concat(folders)
        .some((row) => row.getBoundingClientRect().right > window.innerWidth + 1);
      const doc = document.documentElement;
      return {
        crowded,
        rowOverflow,
        pageOverflow: doc.scrollWidth > doc.clientWidth + 1,
        buttons,
        titleWidth: Math.round(title.width),
        rowCount: rows.length,
        folderCount: folders.length,
      };
    });
    return { metrics, listCards, detailCards, rootShot, detailShot, folderShot, folderMetrics };
  }

  const desktop = await layoutSnapshot(1280, 800, 'desktop');
  const tablet = await layoutSnapshot(768, 1024, 'ipad');
  const phone = await layoutSnapshot(390, 844, 'phone');
  check('desktop layout does not crowd the app bar or rows',
    !desktop.metrics.crowded && !desktop.metrics.rowOverflow && !desktop.metrics.pageOverflow &&
    desktop.folderMetrics.count >= 4,
    JSON.stringify({ metrics: desktop.metrics, folders: desktop.folderMetrics.count }));
  // A job opens as folders, and each one says what is in it in words.
  check('a job opens as folders that say what they hold',
    [desktop, tablet, phone].every((shot) =>
      shot.folderMetrics.count >= 4 && !shot.folderMetrics.overflow && !shot.folderMetrics.pageOverflow) &&
    desktop.folderMetrics.text.some((line) => /Distress Survey .*picture/i.test(line)) &&
    desktop.folderMetrics.text.some((line) => /Floor Survey/i.test(line)),
    JSON.stringify(desktop.folderMetrics.text));
  check('iPad layout does not crowd the app bar or rows',
    !tablet.metrics.crowded && !tablet.metrics.rowOverflow && !tablet.metrics.pageOverflow,
    JSON.stringify(tablet.metrics));
  check('phone layout does not crowd the app bar or rows',
    !phone.metrics.crowded && !phone.metrics.rowOverflow && !phone.metrics.pageOverflow,
    JSON.stringify(phone.metrics));
  check('phone cards wrap their content and keep actions directly below',
    cardsPacked(phone.listCards) && cardsPacked(phone.detailCards),
    JSON.stringify({ list: phone.listCards, detail: phone.detailCards }));
  check('iPad cards wrap their content and keep actions directly below',
    cardsPacked(tablet.listCards) && cardsPacked(tablet.detailCards),
    JSON.stringify({ list: tablet.listCards, detail: tablet.detailCards }));
  check('desktop cards keep actions beside the content',
    desktop.listCards[0].direction === 'row'
      && desktop.listCards[0].actionsBeside
      && desktop.listCards[0].mainSlack < 12
      && desktop.detailCards[0].direction === 'row'
      && desktop.detailCards[0].actionsBeside
      && desktop.detailCards[0].mainSlack < 12,
    JSON.stringify({ list: desktop.listCards[0], detail: desktop.detailCards[0] }));

  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate(() => {
    const up = document.querySelector('#explorer-crumb .explorer-up');
    if (up) up.click();
  });
  await page.waitForFunction(() => document.querySelector('.explorer-folder[data-group="plans"]'));
  await page.click('.explorer-folder[data-group="plans"] .explorer-folder__open');
  await page.waitForFunction((planId) => document.querySelector(`[data-key="media/${planId}"]`), {}, PLAN_ID);
  await page.evaluate((planId) => {
    const el = document.querySelector(`[data-key="media/${planId}"]`);
    if (el.classList.contains('explorer-tile')) el.click();
    else [...el.querySelectorAll('button')].find((button) => button.textContent === 'Open').click();
  }, PLAN_ID);
  await page.waitForSelector('.explorer-lightbox__img');
  await page.screenshot({ path: join(shotDir, 'file-explorer-desktop-preview.png'), fullPage: true });
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
