// Toolbox — Sandia Geo Drop Box (the "Share files" dialog in Report Builder).
//
// Tim, Nov 14, 2026: send a client or an engineer a link instead of a big email. The link opens a plain
// Sandia Geo page with the job's files and a Download button for each. The copies are good for 14 days
// and are then deleted; the originals stay in the Customer File, so a drop is never the only copy of
// anything.
//
// What goes in: the report PDF (made with Print / PDF and chosen here, since the browser's own print
// dialog does not hand the file back), a zip of the photographs that are in the report (built here from
// the stored originals), the floor plans already in the Customer File (one image per level), and any
// other files added by hand -- dragged in, or chosen. It opens from Report Builder ("Share files") and
// from the Customer File itself, where no report is needed. Nothing here edits the Customer File.

(function () {
  'use strict';

  const LIST_KEY = 'toolbox.drops.v1';
  const TTL_DAYS = 14;

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function slug(value) {
    return trim(value).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Job';
  }

  /** The name the Worker will store a file under (mirrors sanitizeDropFileName in the Worker). */
  function safeName(name) {
    const raw = String(name == null ? '' : name).split(/[\\/]/).pop();
    let clean = raw.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '').replace(/-{2,}/g, '-').replace(/^[.-]+/, '');
    if (clean.length > 120) {
      const dot = clean.lastIndexOf('.');
      const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
      clean = clean.slice(0, 120 - ext.length) + ext;
    }
    return /[a-zA-Z0-9]/.test(clean) ? clean : 'file';
  }

  /** Two files that would be stored under one name get -2, -3 ... so neither replaces the other. */
  function uniqueNames(entries) {
    const taken = Object.create(null);
    return entries.map(function (entry) {
      let name = safeName(entry.file.name);
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let n = 1;
      while (taken[name.toLowerCase()] || name === 'index.html' || name === 'manifest.json') {
        n += 1;
        name = stem + '-' + n + ext;
      }
      taken[name.toLowerCase()] = true;
      const file = name === entry.file.name ? entry.file : new File([entry.file], name, { type: entry.file.type });
      return { file: file, label: entry.label };
    });
  }

  function humanBytes(n) {
    const bytes = Number(n) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function longDate(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /** The message to paste into an email or a text. */
  function messageFor(url, expiresAt) {
    const until = longDate(expiresAt);
    return 'Your report is ready. Download it here: ' + url +
      (until ? '\nThe link works until ' + until + '.' : '');
  }

  // ---- the links made from this device, so "Remove now" can be reached later ----

  function readList() {
    try {
      const raw = window.localStorage.getItem(LIST_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeList(map) {
    try { window.localStorage.setItem(LIST_KEY, JSON.stringify(map)); } catch (_) {}
  }

  function liveDrops(customerFileId) {
    const now = Date.now();
    const all = readList()[customerFileId || ''] || [];
    return all.filter(function (d) { return d && d.token && Date.parse(d.expiresAt) > now; });
  }

  function rememberDrop(customerFileId, drop) {
    const map = readList();
    const key = customerFileId || '';
    const now = Date.now();
    const kept = (map[key] || []).filter(function (d) { return d && Date.parse(d.expiresAt) > now && d.token !== drop.token; });
    kept.unshift(drop);
    map[key] = kept.slice(0, 10);
    writeList(map);
  }

  function forgetDrop(customerFileId, token) {
    const map = readList();
    const key = customerFileId || '';
    map[key] = (map[key] || []).filter(function (d) { return d && d.token !== token; });
    writeList(map);
  }

  // ---- the photographs in the report, as one zip ----

  function extFor(dataUrl) {
    const m = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl || '');
    const t = m ? m[1].toLowerCase() : 'jpeg';
    if (t === 'jpeg' || t === 'jpg') return 'jpg';
    if (t === 'png' || t === 'webp' || t === 'gif') return t;
    return 'jpg';
  }

  async function reportPhotos(record, pages) {
    const api = window.ToolboxReportLookbook;
    if (!api || typeof api.collectPhotoEntries !== 'function') return [];
    let list = api.collectPhotoEntries(record || {}, pages || []);
    if (typeof api.hydratePhotoBytes === 'function') list = await api.hydratePhotoBytes(list);
    return list.filter(function (p) { return p && p.dataUrl && String(p.dataUrl).indexOf('data:image/') === 0; });
  }

  /** One image per level that has a plan, as stored in the Customer File. */
  async function levelPlans(record) {
    const plan = record && record.planSetup;
    const canvases = plan && Array.isArray(plan.canvases) ? plan.canvases : [];
    const getMedia = window.ToolboxDB && typeof window.ToolboxDB.getMedia === 'function'
      ? window.ToolboxDB.getMedia.bind(window.ToolboxDB) : null;
    const out = [];
    if (!getMedia) return out;
    for (let i = 0; i < canvases.length; i += 1) {
      const canvas = canvases[i];
      const mediaId = canvas && canvas.plan && canvas.plan.id;
      if (!mediaId) continue;
      let dataUrl = '';
      try { dataUrl = await getMedia(mediaId); } catch (_) {}
      if (!dataUrl || String(dataUrl).indexOf('data:image/') !== 0) continue;
      const level = trim(canvas.name) || ('Level ' + (i + 1));
      out.push({ level: level, dataUrl: dataUrl, ext: extFor(dataUrl) });
    }
    return out;
  }

  async function buildPhotosZip(photos, name, onProgress) {
    if (typeof window.JSZip !== 'function') throw new Error('Zip support is not available in this session.');
    const zip = new window.JSZip();
    for (let i = 0; i < photos.length; i += 1) {
      const blob = await fetch(photos[i].dataUrl).then(function (res) { return res.blob(); });
      zip.file('Photo-' + pad2(i + 1) + '.' + extFor(photos[i].dataUrl), blob, { binary: true });
      if (onProgress) onProgress('Gathering photograph ' + (i + 1) + ' of ' + photos.length + '…');
    }
    // Photographs are already compressed; storing them is faster and no bigger.
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, function (meta) {
      if (onProgress) onProgress('Zipping photographs… ' + Math.round(meta.percent) + '%');
    });
    return new File([blob], name, { type: 'application/zip' });
  }

  // ---- dialog ----

  function ensureCss() {
    if (document.getElementById('db-style')) return;
    const style = document.createElement('style');
    style.id = 'db-style';
    style.textContent =
      '.db-dialog{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(7,40,61,.55)}' +
      '.db-card{width:min(560px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#fff;border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:20px;color:#111827}' +
      '.db-card h2{margin:0 0 4px;font-size:19px}' +
      '.db-card p{margin:0 0 12px;font-size:13px;line-height:1.45;color:#4b5563}' +
      '.db-row{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px}' +
      '.db-row input[type=checkbox]{margin-top:3px}' +
      '.db-row strong{display:block;font-size:14px}' +
      '.db-row span,.db-hint{font-size:12px;color:#6b7280}' +
      '.db-row input[type=file]{margin-top:6px;max-width:100%;font-size:13px}' +
      '.db-zone{display:flex;align-items:center;justify-content:center;text-align:center;min-height:64px;margin-top:6px;padding:10px;border:2px dashed #9ca3af;border-radius:8px;color:#4b5563;font-size:13px;cursor:pointer;background:#f9fafb}' +
      '.db-zone input{display:none}' +
      '.db-zone.is-over,.db-card.is-over .db-zone{border-color:#0b2233;background:#e8eef2;color:#0b2233}' +
      '.db-picked{display:flex;flex-direction:column;gap:4px;margin-top:6px}' +
      '.db-picked div{display:flex;gap:8px;align-items:center;font-size:13px}' +
      '.db-picked button{border:0;background:none;color:#b91c1c;cursor:pointer;font-size:16px;line-height:1}' +
      '.db-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}' +
      '.db-status{min-height:1.3em;margin:10px 0 0;font-size:13px;color:#374151}' +
      '.db-status[data-error]{color:#b91c1c}' +
      '.db-link{display:flex;gap:8px;margin-top:8px}' +
      '.db-link input{flex:1 1 auto;min-width:0;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font:inherit;font-size:13px}' +
      '.db-meta{margin:8px 0 0;font-size:12px;color:#6b7280}' +
      '.db-old{margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px}' +
      '.db-old h3{margin:0 0 6px;font-size:13px}' +
      '.db-old div{display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:13px;padding:4px 0}';
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function copyText(text, button) {
    function done() {
      if (button) {
        const before = button.getAttribute('data-label') || button.textContent;
        button.setAttribute('data-label', before);
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = before; }, 1600);
      }
    }
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand && document.execCommand('copy');
      ta.remove();
    } catch (_) {}
    if (ok) { done(); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    }
  }

  /**
   * options: { record, pages, title, residence, address, customerFileId }
   */
  async function open(options) {
    const opts = options || {};
    ensureCss();
    const record = opts.record || {};
    const customerFileId = trim(opts.customerFileId || record.id);
    const residence = trim(opts.residence);
    const address = trim(opts.address);
    const pageTitle = address || residence || 'Your files';
    // From Report Builder the photographs are "in the report" and on by default; from the Customer File
    // they are the Distress Survey's and start off.
    const inReport = opts.context !== 'file';

    const root = el('div', { class: 'db-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sandia Geo Drop Box', 'data-drop-box': '' });
    const card = el('div', { class: 'db-card' });
    root.appendChild(card);
    document.body.appendChild(root);
    function close() { if (root.parentNode) root.parentNode.removeChild(root); }
    root.addEventListener('click', function (e) { if (e.target === root) close(); });

    let photos = [];
    try { photos = await reportPhotos(record, opts.pages); } catch (_) { photos = []; }
    let plans = [];
    try { plans = await levelPlans(record); } catch (_) { plans = []; }

    const state = { pdf: null, extras: [], busy: false, note: '' };

    function paintForm() {
      card.innerHTML = '';
      card.appendChild(el('h2', { text: 'Sandia Geo Drop Box' }));
      card.appendChild(el('p', { text: 'Make a link that holds this job’s files. It works for ' + TTL_DAYS +
        ' days, then the link and its copies are deleted. Your originals stay in the Customer File.' }));

      // Report PDF
      const pdfInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', 'data-db-pdf': '' });
      pdfInput.addEventListener('change', function () {
        state.pdf = pdfInput.files && pdfInput.files[0] ? pdfInput.files[0] : null;
        paintPicked();
      });
      const pdfNote = el('span', { 'data-db-pdf-note': '', text: 'Make it with Print / PDF → Save as PDF, then choose the file here.' });
      card.appendChild(el('div', { class: 'db-row' }, [
        el('div', {}, [el('strong', { text: 'Report PDF' }), pdfNote, pdfInput]),
      ]));

      // Photographs
      const photosBox = el('input', { type: 'checkbox', 'data-db-photos': '' });
      photosBox.checked = inReport && photos.length > 0;
      photosBox.disabled = photos.length === 0;
      card.appendChild(el('label', { class: 'db-row' }, [
        photosBox,
        el('div', {}, [
          el('strong', { text: inReport ? 'Photographs in the report (zip)' : 'Distress Survey photographs (zip)' }),
          el('span', { text: photos.length
            ? photos.length + ' photograph' + (photos.length === 1 ? '' : 's') + ', full size, numbered ' + (inReport ? 'like the report.' : 'in order.')
            : (inReport ? 'There are no photographs in the report.' : 'There are no Distress Survey photographs on this job.') }),
        ]),
      ]));

      // Floor plans from the Customer File
      const plansBox = el('input', { type: 'checkbox', 'data-db-plans': '' });
      plansBox.checked = false;
      plansBox.disabled = plans.length === 0;
      card.appendChild(el('label', { class: 'db-row' }, [
        plansBox,
        el('div', {}, [
          el('strong', { text: 'Floor plans from this Customer File' }),
          el('span', { text: plans.length
            ? plans.length + ' level' + (plans.length === 1 ? '' : 's') + ': ' + plans.map(function (p) { return p.level; }).join(', ') + '. One image per level.'
            : 'There are no floor plans on this Customer File.' }),
        ]),
      ]));

      // Other files
      function addFiles(list) {
        const skipped = [];
        Array.prototype.forEach.call(list || [], function (f) {
          // A folder arrives as an empty "file"; it cannot be sent as it is.
          if (!f || !f.size) { skipped.push(f && f.name ? f.name : 'a folder'); return; }
          state.extras.push(f);
        });
        state.note = skipped.length
          ? 'Not added (empty, or a folder \u2014 zip a folder first): ' + skipped.join(', ')
          : '';
        paintPicked();
      }
      const extraInput = el('input', { type: 'file', multiple: '', 'data-db-extra': '' });
      extraInput.addEventListener('change', function () {
        addFiles(extraInput.files);
        extraInput.value = '';
      });
      const zone = el('label', { class: 'db-zone', 'data-db-zone': '' }, [
        document.createTextNode('Drop files here, or click to choose'),
        extraInput,
      ]);
      const picked = el('div', { class: 'db-picked', 'data-db-picked': '' });
      card.appendChild(el('div', { class: 'db-row' }, [
        el('div', { style: 'flex:1;min-width:0' }, [el('strong', { text: 'Other files' }),
          el('span', { text: 'A floor plan, a drawing, anything else for this job.' }), zone, picked]),
      ]));
      // Dropping anywhere on the dialog works; the browser must not open the file instead.
      function hasFiles(e) {
        const types = e.dataTransfer && e.dataTransfer.types;
        return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
      }
      card.ondragenter = card.ondragover = function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        card.classList.add('is-over');
      };
      card.ondragleave = function (e) {
        if (e.relatedTarget && card.contains(e.relatedTarget)) return;
        card.classList.remove('is-over');
      };
      card.ondrop = function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        card.classList.remove('is-over');
        if (!state.busy) addFiles(e.dataTransfer.files);
      };

      function paintPicked() {
        picked.innerHTML = '';
        state.extras.forEach(function (file, i) {
          const remove = el('button', { type: 'button', 'aria-label': 'Remove ' + file.name, text: '×' });
          remove.addEventListener('click', function () { state.extras.splice(i, 1); paintPicked(); });
          picked.appendChild(el('div', {}, [el('span', { text: file.name + ' · ' + humanBytes(file.size) }), remove]));
        });
        if (state.note) picked.appendChild(el('div', { 'data-db-note': '' }, [el('span', { text: state.note })]));
        pdfNote.textContent = state.pdf
          ? state.pdf.name + ' · ' + humanBytes(state.pdf.size)
          : 'Make it with Print / PDF → Save as PDF, then choose the file here.';
      }
      paintPicked();

      const status = el('p', { class: 'db-status', 'data-db-status': '' });
      const create = el('button', { type: 'button', class: 'btn', 'data-db-create': '', text: 'Create link' });
      const cancel = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Close' });
      cancel.addEventListener('click', close);
      card.appendChild(status);
      card.appendChild(el('div', { class: 'db-actions' }, [create, cancel]));

      create.addEventListener('click', function () {
        if (state.busy) return;
        const wantsPhotos = photosBox.checked && photos.length > 0;
        const wantsPlans = plansBox.checked && plans.length > 0;
        if (!state.pdf && !wantsPhotos && !wantsPlans && !state.extras.length) {
          status.setAttribute('data-error', '');
          status.textContent = 'Choose at least one file.';
          return;
        }
        status.removeAttribute('data-error');
        state.busy = true;
        create.disabled = true;
        cancel.disabled = true;
        run(wantsPhotos, wantsPlans, function (msg) { status.textContent = msg; }).catch(function (err) {
          state.busy = false;
          create.disabled = false;
          cancel.disabled = false;
          status.setAttribute('data-error', '');
          status.textContent = (err && err.message) || 'Could not create the link.';
        });
      });

      paintOld(card);
    }

    function paintOld(into) {
      const old = liveDrops(customerFileId);
      if (!old.length) return;
      const box = el('div', { class: 'db-old', 'data-db-old': '' }, [el('h3', { text: 'Links already made for this job' })]);
      old.forEach(function (d) {
        const copy = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Copy link' });
        copy.addEventListener('click', function () { copyText(d.url, copy); });
        const remove = el('button', { type: 'button', class: 'btn btn--secondary', 'data-db-remove': d.token, text: 'Remove now' });
        remove.addEventListener('click', function () { removeNow(d, remove); });
        box.appendChild(el('div', {}, [
          el('span', { text: (d.label || 'Files') + ' · until ' + longDate(d.expiresAt) }),
          el('span', {}, [copy, document.createTextNode(' '), remove]),
        ]));
      });
      into.appendChild(box);
    }

    async function removeNow(d, button) {
      button.disabled = true;
      button.textContent = 'Removing…';
      try {
        await window.ToolboxSync.dropRemove(d.token);
        forgetDrop(customerFileId, d.token);
        paintForm();
      } catch (err) {
        button.disabled = false;
        button.textContent = 'Remove now';
        window.alert((err && err.message) || 'Could not remove the link.');
      }
    }

    async function run(wantsPhotos, wantsPlans, say) {
      const sync = window.ToolboxSync;
      if (!sync || typeof sync.dropCreate !== 'function') throw new Error('Sync is not available in this session.');
      if (!sync.syncApiBase || !sync.syncApiBase()) throw new Error('Sync is not configured yet.');

      let files = [];
      if (state.pdf) files.push({ file: state.pdf, label: 'Report (PDF)' });
      if (wantsPhotos) {
        const zipFile = await buildPhotosZip(photos, 'Photos-' + slug(address || residence) + '.zip', say);
        files.push({ file: zipFile, label: inReport ? 'Photographs in the report (ZIP)' : 'Distress Survey photographs (ZIP)' });
      }
      if (wantsPlans) {
        for (let i = 0; i < plans.length; i += 1) {
          const blob = await fetch(plans[i].dataUrl).then(function (res) { return res.blob(); });
          files.push({
            file: new File([blob], slug(plans[i].level) + '-plan.' + plans[i].ext, { type: blob.type || 'image/' + plans[i].ext }),
            label: 'Floor plan \u2014 ' + plans[i].level,
          });
        }
      }
      state.extras.forEach(function (f) { files.push({ file: f, label: f.name }); });
      if (files.length > 40) throw new Error('That is ' + files.length + ' files; a link holds up to 40. Zip some of them together.');
      // Two files with one name would replace each other: number the second.
      files = uniqueNames(files);

      say('Creating the link…');
      const created = await sync.dropCreate({
        customerFileId: customerFileId,
        title: pageTitle,
        residence: residence,
        address: address,
      });
      const token = created && created.token;
      if (!token) throw new Error('Could not create the link.');

      const listed = [];
      try {
        for (let i = 0; i < files.length; i += 1) {
          const f = files[i];
          say('Uploading ' + (i + 1) + ' of ' + files.length + ' — ' + f.file.name + '…');
          const sent = await sync.dropUploadFile(token, f.file.name, f.file, f.file.type, function (done, total) {
            say('Uploading ' + (i + 1) + ' of ' + files.length + ' — ' + f.file.name + ' · ' + Math.round(done / total * 100) + '%');
          });
          listed.push({ name: sent.name, label: f.label, size: f.file.size });
        }
        say('Finishing…');
        const done = await sync.dropFinalize(token, { title: pageTitle, residence: residence, address: address, files: listed });
        const url = (done && done.url) || (created && created.url) || '';
        const expiresAt = (done && done.expiresAt) || (created && created.expiresAt) || '';
        rememberDrop(customerFileId, { token: token, url: url, expiresAt: expiresAt, label: pageTitle, files: listed.length });
        paintResult(url, expiresAt, listed);
      } catch (err) {
        // A half-made drop is of no use to anyone: take it down, then say what went wrong.
        try { await sync.dropRemove(token); } catch (_) {}
        throw err;
      }
    }

    function paintResult(url, expiresAt, listed) {
      card.innerHTML = '';
      card.appendChild(el('h2', { text: 'Your link is ready' }));
      card.appendChild(el('p', { text: 'It works until ' + longDate(expiresAt) + ', then it and its copies are deleted.' }));
      const input = el('input', { type: 'text', readonly: '', value: url, 'data-db-url': '', 'aria-label': 'Drop box link' });
      input.addEventListener('focus', function () { input.select(); });
      const copyLink = el('button', { type: 'button', class: 'btn', text: 'Copy link' });
      copyLink.addEventListener('click', function () { copyText(url, copyLink); });
      card.appendChild(el('div', { class: 'db-link' }, [input, copyLink]));
      const copyMsg = el('button', { type: 'button', class: 'btn btn--secondary', 'data-db-copy-message': '', text: 'Copy message' });
      copyMsg.addEventListener('click', function () { copyText(messageFor(url, expiresAt), copyMsg); });
      const list = el('p', { class: 'db-meta', text: listed.map(function (f) { return f.label; }).join(' · ') });
      card.appendChild(list);
      const remove = el('button', { type: 'button', class: 'btn btn--secondary', 'data-db-remove-now': '', text: 'Remove now' });
      remove.addEventListener('click', function () {
        removeNow({ token: token(), url: url }, remove);
      });
      function token() {
        const m = /lookbook\/([a-f0-9]{36})/.exec(url);
        return m ? m[1] : '';
      }
      const closeBtn = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Close' });
      closeBtn.addEventListener('click', close);
      card.appendChild(el('div', { class: 'db-actions' }, [copyMsg, remove, closeBtn]));
      state.busy = false;
    }

    paintForm();
    return { close: close, root: root };
  }

  window.ToolboxDropBox = {
    open: open,
    messageFor: messageFor,
    liveDrops: liveDrops,
    ttlDays: TTL_DAYS,
  };
})();
