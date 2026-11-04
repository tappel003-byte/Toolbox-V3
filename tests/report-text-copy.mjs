/**
 * Report Builder rich-text context menu: Copy + paste options.
 * Run: static server on 8765, then node tests/report-text-copy.mjs
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-text-copy';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1500, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});

await page.evaluate(async (id) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Text';
  rec.lastName = 'Copy';
  rec.propertyAddress = '12 Clipboard Way';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#eee'; x.fillRect(0, 0, 800, 600);
  x.fillStyle = '#444'; x.fillRect(100, 100, 400, 300);
  await window.ToolboxDB.putMedia('plan-text-copy', c.toDataURL('image/jpeg', 0.85));
  cv.plan = { id: 'plan-text-copy', width: 800, height: 600 };
  // Enough Floor Survey so an object stack menu can be checked.
  rec.floorSurvey = {
    id: 'fs-text-copy', inspectionDate: '2026-10-09',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id,
        points: [
          { id: 'p1', floorId: cv.id, index: 1, x: 200, y: 200, value: 8.1 },
          { id: 'p2', floorId: cv.id, index: 2, x: 400, y: 300, value: 8.4 },
        ],
        areas: [{ id: 'a1', name: 'Main', polygon: [
          { x: 80, y: 80 }, { x: 720, y: 80 }, { x: 720, y: 520 }, { x: 80, y: 520 },
        ], createdAt: 1 }],
        boundary: [
          { x: 80, y: 80 }, { x: 720, y: 80 }, { x: 720, y: 520 }, { x: 80, y: 520 },
        ],
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 1500));

// Discussion sheet has a large rich body — jump there if present.
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /discussion/i.test(t.querySelector('.rb-thumb__caption')?.textContent || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 1200));

const fieldSel = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const field = sheet && [...sheet.querySelectorAll('[data-rb-rich][contenteditable="true"]')]
    .find((el) => el.offsetParent !== null);
  if (!field) return null;
  return field.getAttribute('data-rb-rich');
});
check('found an editable rich-text field', !!fieldSel, String(fieldSel));

if (fieldSel) {
  // Seed distinctive text via the report model path used by paste.
  await page.evaluate((key) => {
    const field = document.querySelector(`.rb-sheet:not(.rb-sheet--thumb) [data-rb-rich="${key}"]`);
    field.focus();
    field.innerHTML = '<p>Alpha <b>BoldPhrase</b> Omega</p>';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, fieldSel);
  await new Promise((r) => setTimeout(r, 500));

  // Select "BoldPhrase" inside the field.
  const selBox = await page.evaluate((key) => {
    const field = document.querySelector(`.rb-sheet:not(.rb-sheet--thumb) [data-rb-rich="${key}"]`);
    const bold = field.querySelector('b, strong') || field;
    const textNode = bold.firstChild;
    const range = document.createRange();
    if (textNode && textNode.nodeType === 3) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.textContent.length);
    } else {
      range.selectNodeContents(bold);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: range.toString() };
  }, fieldSel);
  check('selected rich text before context menu', /BoldPhrase/i.test(selBox.text), JSON.stringify(selBox));

  await page.mouse.click(selBox.x, selBox.y, { button: 'right' });
  await new Promise((r) => setTimeout(r, 300));

  const menu = await page.evaluate(() => {
    const root = document.querySelector('[data-rb-pastemenu]');
    if (!root) return null;
    const items = [...root.querySelectorAll('.rb-stackmenu__item')].map((el) => ({
      text: el.textContent.trim(),
      disabled: !!el.disabled,
      copy: el.getAttribute('data-rb-text-copy') === '1',
      paste: el.getAttribute('data-rb-paste-as'),
    }));
    return { items };
  });
  check('context menu lists Copy and both paste options',
    !!menu && menu.items.some((i) => i.copy && !i.disabled) &&
    menu.items.some((i) => i.paste === '1') &&
    menu.items.some((i) => i.paste === '0'),
    JSON.stringify(menu));

  await page.screenshot({ path: `${OUT}/rb-text-copy-menu.png` });

  // Grant clipboard permissions for write/read in this origin.
  const ctx = page.browserContext();
  if (ctx && typeof ctx.overridePermissions === 'function') {
    await ctx.overridePermissions('http://127.0.0.1:8765', [
      'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write',
    ]);
  }

  await page.evaluate(() => {
    document.querySelector('[data-rb-text-copy]')?.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const clip = await page.evaluate(async () => {
    try {
      const text = await navigator.clipboard.readText();
      return { text, err: null };
    } catch (err) {
      return { text: '', err: String(err && err.message || err) };
    }
  });
  check('Copy writes selection to the system clipboard',
    /BoldPhrase/i.test(clip.text), JSON.stringify(clip));

  // Paste unformatted into the same field at end via menu (caret after Omega).
  await page.evaluate((key) => {
    const field = document.querySelector(`.rb-sheet:not(.rb-sheet--thumb) [data-rb-rich="${key}"]`);
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const r = range.getBoundingClientRect();
    field.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.max(r.left + 4, 8), clientY: Math.max(r.top + 4, 8),
    }));
  }, fieldSel);
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => {
    document.querySelector('[data-rb-paste-as="0"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 800));

  const afterPaste = await page.evaluate((key) => {
    const field = document.querySelector(`.rb-sheet:not(.rb-sheet--thumb) [data-rb-rich="${key}"]`);
    return { text: (field && field.innerText) || '', html: (field && field.innerHTML) || '' };
  }, fieldSel);
  check('Paste unformatted inserts clipboard text into the field',
    /BoldPhrase/i.test(afterPaste.text) && (afterPaste.text.match(/BoldPhrase/gi) || []).length >= 2,
    JSON.stringify(afterPaste));

  // Ctrl/Cmd+C native path still works (no custom key handler stealing it).
  const nativeCopy = await page.evaluate(async (key) => {
    const field = document.querySelector(`.rb-sheet:not(.rb-sheet--thumb) [data-rb-rich="${key}"]`);
    field.focus();
    const node = field.querySelector('b, strong') || field.firstChild;
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (_) {}
    return { ok, text };
  }, fieldSel);
  check('native copy command still reaches the clipboard',
    nativeCopy.ok && /BoldPhrase|Alpha|Omega/i.test(nativeCopy.text),
    JSON.stringify(nativeCopy));

  // Text Copy menu is scoped to rich fields — right-click on a Floor sheet
  // (no contenteditable under the pointer) must not open it.
  await page.evaluate(() => {
    const thumb = [...document.querySelectorAll('.rb-thumb')]
      .find((t) => /^floor-/.test(t.getAttribute('data-page-id') || ''));
    thumb?.click();
  });
  await page.waitForFunction(
    () => /^floor-/.test(
      document.querySelector('.rb-thumb.is-active')?.getAttribute('data-page-id') || ''),
    { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  const floorCtx = await page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    if (!sheet) return { ok: false, reason: 'no-sheet' };
    const r = sheet.getBoundingClientRect();
    // Aim at empty sheet chrome, not a rich field.
    sheet.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: r.left + Math.min(40, r.width / 2),
      clientY: r.top + Math.min(40, r.height / 2),
    }));
    const paste = document.querySelector('[data-rb-pastemenu]');
    const stack = document.querySelector('[data-rb-stackmenu]');
    const stackLabels = stack
      ? [...stack.querySelectorAll('.rb-stackmenu__item')].map((el) => el.textContent.trim())
      : [];
    return {
      ok: true,
      textMenu: !!paste,
      stackLabels,
      stackHasCopy: stackLabels.includes('Copy'),
    };
  });
  check('Floor sheet right-click does not open the text Copy/Paste menu',
    floorCtx.ok && floorCtx.textMenu === false && floorCtx.stackHasCopy === false,
    JSON.stringify(floorCtx));
}

await writeFile(`${OUT}/rb-text-copy-results.json`, JSON.stringify({
  dumpedAt: new Date().toISOString(),
  results,
}, null, 2));
console.log('\nSummary:', results.filter((r) => r.ok).length, 'pass /', results.length, 'total');
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
