/**
 * The Rooms screen always has a way out: a Done button at the bottom beside FD, on a phone-sized screen
 * (Tim, Nov 27, 2026: "No way out of this screen").
 * Run: node tests/room-verify-done.mjs   (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
const openIt = () => page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1452; c.height = 1195; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1452, 1195);
  const url = c.toDataURL('image/jpeg', 0.9); let rooms = [], fd = null;
  window.ToolboxRoomVerify.open({ getPlan: () => ({ dataUrl: url, width: 1452, height: 1195 }), getRooms: () => rooms, setRooms: (l) => { rooms = l; }, getFrontDoor: () => fd, setFrontDoor: (f) => { fd = f; }, getBuildingType: () => 'residential', onChange: () => {} });
  await new Promise((r) => setTimeout(r, 600));
});
await openIt();
const hit = (sel) => page.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { onScreen: r.y >= 0 && r.y + r.height <= window.innerHeight && r.x >= 0 && r.x + r.width <= window.innerWidth, reachable: t === el }; }, sel);
const b = await hit('#rvDoneBtn');
check('A Done button sits at the bottom of the Rooms screen, on screen', b.onScreen, JSON.stringify(b));
check('and nothing is on top of it', b.reachable);
const t = await hit('#rvCloseBtn');
check('The Done button at the top is still there and reachable', t.onScreen && t.reachable, JSON.stringify(t));
await page.tap('#rvDoneBtn'); await wait(300);
check('Tapping the bottom Done closes the Rooms screen', !(await page.evaluate(() => document.getElementById('roomVerifyOverlay').classList.contains('open'))));
await openIt(); await page.tap('#rvCloseBtn'); await wait(300);
check('Tapping the top Done still closes it', !(await page.evaluate(() => document.getElementById('roomVerifyOverlay').classList.contains('open'))));
check('No JavaScript errors', errs.length === 0, errs.join(' | '));
const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close(); if (failed.length) process.exit(1);
