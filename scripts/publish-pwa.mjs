/**
 * Copy the Toolbox PWA into ./publish for the toolbox-v3 static Worker.
 *
 * The set is the service-worker shell, the two documents it caches, and
 * every local HTML/CSS/manifest reference those files make. sync-worker,
 * tests, docs, and source maps are not copied.
 *
 * /icon-192.png is requested by distress-survey/survey.html and is not a
 * file at the repo root. The publish copy is distress-survey/icon-192.png,
 * so that apple-touch-icon resolves without editing the survey document.
 *
 *   node scripts/publish-pwa.mjs
 *   node scripts/publish-pwa.mjs --out /tmp/toolbox-publish
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ICON_ALIAS = {
  '/icon-192.png': 'distress-survey/icon-192.png',
};

const FORBIDDEN_PREFIXES = [
  'sync-worker/',
  'tests/',
  'docs/',
  'floor-survey/',
  'scripts/',
  '.github/',
];

export function publishFileSet(root = repoRoot) {
  const swText = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const shellMatch = swText.match(/const STATIC_SHELL = \[([\s\S]*?)\];/);
  if (!shellMatch) throw new Error('STATIC_SHELL was not found in sw.js');
  const shell = [...shellMatch[1].matchAll(/'([^']+)'/g)].map((match) => decodeURIComponent(match[1]));
  if (!shell.length) throw new Error('STATIC_SHELL is empty');

  const wanted = new Map();
  function add(urlPath, sourceRel) {
    const clean = urlPath.startsWith('/') ? urlPath : '/' + urlPath;
    if (wanted.has(clean) && wanted.get(clean) !== sourceRel) {
      throw new Error(clean + ' is already published from ' + wanted.get(clean));
    }
    wanted.set(clean, sourceRel);
  }

  add('/index.html', 'index.html');
  add('/sw.js', 'sw.js');
  for (const urlPath of shell) add(urlPath, urlPath.slice(1));
  add('/icon-192.png', ICON_ALIAS['/icon-192.png']);

  const pending = ['/index.html', '/distress-survey/survey.html', '/css/styles.css', '/css/report-builder.css', '/js/floor-survey/floor-survey.css', '/manifest.webmanifest'];
  const scanned = new Set();
  while (pending.length) {
    const urlPath = pending.pop();
    if (scanned.has(urlPath) || !wanted.has(urlPath)) continue;
    scanned.add(urlPath);
    const sourceRel = wanted.get(urlPath);
    const text = fs.readFileSync(path.join(root, sourceRel), 'utf8');
    for (const ref of localReferences(text, urlPath)) {
      if (wanted.has(ref)) continue;
      const source = ICON_ALIAS[ref] || ref.slice(1);
      if (!fs.existsSync(path.join(root, source))) {
        throw new Error('Runtime reference ' + ref + ' from ' + urlPath + ' has no source file');
      }
      add(ref, source);
      if (/\.(html|css|webmanifest)$/i.test(source)) pending.push(ref);
    }
  }

  for (const sourceRel of wanted.values()) {
    if (sourceRel.endsWith('.map')) throw new Error('Source map in publish set: ' + sourceRel);
    if (FORBIDDEN_PREFIXES.some((prefix) => sourceRel.startsWith(prefix))) {
      throw new Error('Internal path in publish set: ' + sourceRel);
    }
    if (!fs.existsSync(path.join(root, sourceRel))) throw new Error('Missing source file: ' + sourceRel);
  }

  return [...wanted.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function localReferences(text, fromUrlPath) {
  const refs = [];
  const patterns = [];
  if (fromUrlPath.endsWith('.css')) {
    patterns.push(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
  } else if (fromUrlPath.endsWith('.webmanifest')) {
    patterns.push(/"src"\s*:\s*"([^"]+)"/gi);
  } else {
    patterns.push(/<(?:link|script|img)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/gi);
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].trim();
      if (!raw || /^(?:https?:|data:|blob:|mailto:|#)/i.test(raw)) continue;
      const noQuery = raw.split('#')[0].split('?')[0];
      if (!noQuery) continue;
      const resolved = noQuery.startsWith('/')
        ? noQuery
        : path.posix.normalize(path.posix.join(path.posix.dirname(fromUrlPath), noQuery));
      refs.push(resolved.startsWith('/') ? resolved : '/' + resolved);
    }
  }
  return refs;
}

export function writePublish(outDir, root = repoRoot) {
  const entries = publishFileSet(root);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [urlPath, sourceRel] of entries) {
    const dest = path.join(outDir, urlPath.slice(1));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, sourceRel), dest);
  }
  return entries;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const outFlag = process.argv.indexOf('--out');
  const outDir = outFlag === -1 ? path.join(repoRoot, 'publish') : path.resolve(process.argv[outFlag + 1]);
  const entries = writePublish(outDir);
  const bytes = entries.reduce((sum, [urlPath]) => sum + fs.statSync(path.join(outDir, urlPath.slice(1))).size, 0);
  console.log('Published ' + entries.length + ' files (' + bytes + ' bytes) to ' + outDir);
}
