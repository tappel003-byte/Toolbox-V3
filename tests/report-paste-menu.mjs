/**
 * Right-click in a writing area: Paste as formatted, Paste unformatted.
 *
 * Run: node tests/report-paste-menu.mjs   (static server on 8765)
 *
 * Ctrl+V already pastes formatted and Ctrl+Shift+V already pastes plain, but
 * Tim does not want to hold a shortcut in his head: "I don't want to remember
 * Control-Shift-V. I want to be able to right-click and click paste as
 * formatted, or right-click paste unformatted."
 *
 * A page cannot open the system menu, so this is the report's own. Reading
 * the clipboard from script is something Chrome asks about once; that prompt
 * is the browser's, not ours, and a refusal has to say so rather than leave
 * the menu looking broken.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-paste-menu';
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
const context = browser.defaultBrowserContext();
await context.overridePermissions('http://127.0.0.1:8765',
  ['clipboard-read', 'clipboard-write']);
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Paste'; rec.lastName = 'Menu';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /discussion/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 2500));

// A clipboard holding what a browser would put there. Headless Chrome will
// not grant clipboard WRITE, and the real clipboard API is the browser's
// anyway; what is under test is the menu and what it inserts.
await page.evaluate(() => {
  const html = '<p>Lead sentence with <b>bold inside it</b>.</p>'
    + '<ul><li>First item</li><li>Second item<ul><li>Nested item</li></ul></li></ul>';
  const plain = 'Lead sentence with bold inside it.\n\u2022\nFirst item';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      read: () => Promise.resolve([{
        types: ['text/html', 'text/plain'],
        getType: (t) => Promise.resolve(new Blob([t === 'text/html' ? html : plain],
          { type: t })),
      }]),
      readText: () => Promise.resolve(plain),
    },
  });
});

async function openMenu() {
  const box = await page.evaluate(() => {
    const f = document.querySelector('.rb-stage .rb-sheet [data-rb-rich][contenteditable="true"]');
    f.focus();
    const r = f.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 20 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await new Promise((r) => setTimeout(r, 500));
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-rb-pastemenu] .rb-stackmenu__item')]
      .map((b) => (b.textContent || '').trim()));
}

const items = await openMenu();
check('right-click in the writing area offers both pastes',
  items.includes('Paste as formatted') && items.includes('Paste unformatted'),
  items.join(' | '));

await page.evaluate(() => {
  [...document.querySelectorAll('[data-rb-pastemenu] .rb-stackmenu__item')]
    .find((b) => /formatted$/.test(b.textContent.trim())).click();
});
await new Promise((r) => setTimeout(r, 1200));
const formatted = await page.evaluate(() => {
  const f = document.querySelector('.rb-stage .rb-sheet [data-rb-rich][contenteditable="true"]');
  return { bold: !!f.querySelector('b, strong'), lists: f.querySelectorAll('ul, ol').length,
    indents: [...new Set([...f.querySelectorAll('li')]
      .map((li) => getComputedStyle(li).marginLeft))].length,
    text: (f.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) };
});
check('Paste as formatted keeps the bold', formatted.bold, JSON.stringify(formatted));
check('and keeps the list and its nesting',
  formatted.lists > 0 && formatted.indents > 1, JSON.stringify(formatted));

// And the unformatted one, into a cleared field.
await page.evaluate(() => {
  const f = document.querySelector('.rb-stage .rb-sheet [data-rb-rich][contenteditable="true"]');
  f.innerHTML = '';
  f.dispatchEvent(new Event('input', { bubbles: true }));
});
await openMenu();
await page.evaluate(() => {
  [...document.querySelectorAll('[data-rb-pastemenu] .rb-stackmenu__item')]
    .find((b) => /unformatted$/.test(b.textContent.trim())).click();
});
await new Promise((r) => setTimeout(r, 1200));
const plain = await page.evaluate(() => {
  const f = document.querySelector('.rb-stage .rb-sheet [data-rb-rich][contenteditable="true"]');
  return { styled: !!f.querySelector('b, strong, i, em, u, s'),
    lists: f.querySelectorAll('ul, ol').length,
    text: (f.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) };
});
check('Paste unformatted brings the words', /Lead sentence/.test(plain.text),
  JSON.stringify(plain));
check('and brings no styling or lists with them',
  !plain.styled && plain.lists === 0, JSON.stringify(plain));

// The menu is editor chrome: it must never reach paper or the flip chart.
const hiddenOnPaper = await page.evaluate(() => {
  const probe = document.createElement('div');
  probe.className = 'rb-print';
  const menu = document.createElement('div');
  menu.className = 'rb-stackmenu';
  menu.setAttribute('data-rb-pastemenu', '1');
  probe.appendChild(menu);
  document.body.appendChild(probe);
  const hidden = getComputedStyle(menu).display === 'none';
  probe.remove();
  return hidden;
});
check('and the menu never reaches the printed deck', hiddenOnPaper, String(hiddenOnPaper));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
