/**
 * Report lookbook packager helpers (no DOM capture).
 * Run: node tests/report-lookbook.mjs
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import vm from 'vm';
import { pathToFileURL } from 'url';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const source = readFileSync(new URL('../js/report-lookbook.js', import.meta.url), 'utf8');
const sandbox = {
  window: {},
  document: {
    getElementById: () => null,
    createElement: () => ({ style: {}, appendChild: () => {}, remove: () => {} }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    querySelector: () => null,
  },
  console,
  fetch: async () => ({ ok: true, text: async () => '', blob: async () => new Blob() }),
  URL,
  Blob: globalThis.Blob,
  FileReader: globalThis.FileReader,
  Image: function Image() {},
  XMLSerializer: function XMLSerializer() {
    this.serializeToString = () => '';
  },
  navigator: {},
  setTimeout,
  clearTimeout,
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);

const api = sandbox.window.ToolboxReportLookbook;
check('ToolboxReportLookbook is exported', !!(api && api.lookbookIndexHtml));

const hosted = api.lookbookIndexHtml({
  title: 'Mitchell lookbook',
  residence: 'Mitchell',
  address: '59 Lodge Trail',
  expiresAt: '2026-12-05T00:00:00.000Z',
  pages: [{ title: 'Cover', still: 'sheets/sheet-01.jpg' }],
  photos: [{ title: 'Photo 1', src: 'photos/photo-01.jpg' }],
});
check('hosted HTML names Save as PDF and 30-day availability',
  hosted.includes('Save as PDF') && hosted.includes('Available until 2026-12-05'));

const local = api.lookbookIndexHtml({
  title: 'Mitchell lookbook',
  residence: 'Mitchell',
  address: '59 Lodge Trail',
  expiresAt: '',
  pages: [{ title: 'Cover', still: 'sheets/sheet-01.jpg' }],
  photos: [{ title: 'Photo 1', src: 'photos/photo-01.jpg' }],
});
check('downloaded HTML says it works offline on this computer',
  local.includes('Saved lookbook — works offline on this computer') &&
  local.includes('Save as PDF'));

const photos = api.collectPhotoEntries({}, [
  {
    type: 'pictures',
    evidence: {
      photos: [
        { key: 'ph1', id: 'ph1', displayNumber: 1, dataUrl: 'data:image/jpeg;base64,abc' },
        { key: 'ph2', id: 'ph2', displayNumber: 2, dataUrl: 'data:image/jpeg;base64,def' },
      ],
    },
    reportText: { captions: { ph1: 'Crack at corner' } },
  },
]);
check('collects pictures-page photographs with captions',
  photos.length === 2 && photos[0].title === 'Crack at corner' &&
  photos[0].dataUrl.indexOf('data:image/') === 0);

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
