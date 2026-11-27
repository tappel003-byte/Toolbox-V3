/**
 * Closed Distress sheets cast no shadow up onto the bottom of the plan (Tim, Nov 27, 2026: "why is it fuzzy near
 * the top of the bottom"). Four sheets parked below the screen, each throwing a 30px shadow upward, left a grey
 * smudge along the bottom edge.
 * Run: node tests/distress-sheet-no-shadow.mjs   (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
await page.goto('http://127.0.0.1:8765/distress-survey/survey.html', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
const closed = await page.evaluate(() => [...document.querySelectorAll('.sheet')].filter((s) => !s.classList.contains('open')).map((s) => getComputedStyle(s).boxShadow));
check('Every closed sheet has no shadow', closed.length >= 1 && closed.every((s) => s === 'none'), JSON.stringify(closed));
const shot = await page.screenshot({ clip: { x: 0, y: 794, width: 390, height: 50 }, encoding: 'base64' });
const px = await page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; let lo = 255, hi = 0;
  for (let y = 0; y < c.height; y += 4) { const i = (y * c.width + 20 * 2) * 4; const v = d[i]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { lo, hi };
}, shot);
check('The bottom edge of the screen is plain, with no grey fade', px.hi - px.lo <= 3, JSON.stringify(px));
const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close(); if (failed.length) process.exit(1);
