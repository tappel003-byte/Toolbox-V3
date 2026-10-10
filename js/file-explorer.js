// Toolbox — File Explorer.
//
// Read-only view of server Customer Files and their stored content.
// Raw storage keys remain available under Technical details.

(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function previewKind(contentType) {
    const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
    if (!ct || ct === 'application/octet-stream') return '';
    if (ct.indexOf('image/') === 0) return 'image';
    if (ct === 'application/pdf') return 'pdf';
    if (ct === 'application/json' || ct.slice(-5) === '+json' || ct.indexOf('text/') === 0) return 'text';
    return '';
  }

  function typeLabel(contentType) {
    const type = String(contentType || '').toLowerCase().split(';')[0].trim();
    if (type === 'application/pdf') return 'PDF';
    if (type.indexOf('image/') === 0) return 'Image';
    if (type === 'application/json' || type.slice(-5) === '+json') return 'File data';
    if (type.indexOf('text/') === 0) return 'Text';
    return type ? 'File' : '';
  }

  function formatBytes(size) {
    if (typeof size !== 'number' || !isFinite(size) || size < 0) return '';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) {
      const value = size / 1024;
      return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' KB';
    }
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function downloadName(key) {
    return String(key || 'object').replace(/[^A-Za-z0-9._-]+/g, '_') || 'object';
  }

  const GROUPS = [
    { id: 'customer', title: 'Customer information' },
    { id: 'plans', title: 'Plans and canvases' },
    { id: 'distress', title: 'Distress Survey' },
    { id: 'quick-capture', title: 'Quick Capture' },
    { id: 'other-photos', title: 'Other photos' },
    { id: 'floor', title: 'Floor Survey' },
    { id: 'diagnostics', title: 'Diagnostics' },
    { id: 'report', title: 'Report Builder' },
    { id: 'other', title: 'Other stored files' },
    { id: 'technical', title: 'Technical details' },
  ];

  const KNOWN_FILE = {
    'index.json': { purpose: 'technical', label: 'Cabinet index' },
    'customer.json': { purpose: 'customer', label: 'Customer information' },
    'plans.json': { purpose: 'plans', label: 'Plans and canvases' },
    'distress.json': { purpose: 'distress', label: 'Distress Survey' },
    'floor.json': { purpose: 'floor', label: 'Floor Survey' },
    'diagnostics.json': { purpose: 'diagnostics', label: 'Diagnostics' },
    'report.json': { purpose: 'report', label: 'Report Builder' },
    'trash.json': { purpose: 'technical', label: 'Trash record' },
  };

  function formatFieldDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    let date;
    if (day) date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    else {
      const parsed = Date.parse(text);
      if (!isFinite(parsed)) return '';
      date = new Date(parsed);
    }
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function usefulDate(row) {
    if (!row) return '';
    return formatFieldDate(row.fieldWorkDate || row.createdAt);
  }

  // A filename prefix is not ownership. Without a manifest purpose, media
  // stays in Other stored files.
  function classify(row, id) {
    if (row && row.purpose && row.label) {
      return { purpose: row.purpose, label: row.label, detail: row.detail || '' };
    }
    const key = String(row && row.key || '');
    const prefix = 'cf/' + id + '/';
    if (key.indexOf(prefix) === 0) {
      const filename = key.slice(prefix.length);
      const known = KNOWN_FILE[filename];
      if (known) return { purpose: known.purpose, label: known.label, detail: '' };
      return { purpose: 'other', label: filename || 'Stored file', detail: '' };
    }
    if (key.indexOf('media/') === 0) {
      return { purpose: 'other', label: 'Stored media', detail: '' };
    }
    return { purpose: 'other', label: 'Stored file', detail: '' };
  }

  function groupIdFor(purpose) {
    if (purpose === 'plan') return 'plans';
    if (purpose === 'distress-photo') return 'distress';
    if (purpose === 'unassigned-photo' || purpose === 'general-photo') return 'other-photos';
    if (purpose === 'floor-pdf' || purpose === 'floor-figure') return 'floor';
    if (purpose === 'diagnostics-figure') return 'diagnostics';
    const known = GROUPS.some(function (group) { return group.id === purpose; });
    return known ? purpose : 'other';
  }

  function purposeRank(purpose) {
    if (purpose === 'floor-pdf' || purpose === 'distress-photo' || purpose === 'plan' || purpose === 'diagnostics-figure') return 0;
    if (purpose === 'floor-figure' || purpose === 'quick-capture') return 1;
    return 2;
  }

  function alsoNote(row) {
    const also = row && Array.isArray(row.also) ? row.also : [];
    const names = [];
    if (also.indexOf('distress-photo') !== -1) names.push('Distress Survey');
    if (also.indexOf('quick-capture') !== -1) names.push('Quick Capture');
    if (also.indexOf('unassigned-photo') !== -1) names.push('Unassigned photos');
    if (also.indexOf('general-photo') !== -1) names.push('General photos');
    if (!names.length) return '';
    return 'Also listed in ' + names.join(' and ') + '.';
  }

  function metaLine(row) {
    if (row && row.missing) return 'Not stored';
    if (!row || String(row.key || '').indexOf('media/') !== 0) return '';
    const parts = [];
    const type = typeLabel(row.contentType);
    const size = formatBytes(row.size);
    if (type) parts.push(type);
    if (size) parts.push(size);
    return parts.join(' · ');
  }

  function technicalKey(key) {
    const details = document.createElement('details');
    details.className = 'explorer-row__technical';
    const summary = document.createElement('summary');
    summary.textContent = 'Technical details';
    const code = document.createElement('code');
    code.textContent = key;
    details.appendChild(summary);
    details.appendChild(code);
    return details;
  }

  function errorText(err) {
    if (!err) return 'Could not read the server File Cabinet.';
    if (err.code === 'offline') return 'File Explorer reads the server and needs a network connection.';
    if (err.code === 'auth') return 'Sign in required to browse the server File Cabinet.';
    if (err.code === 'config') return 'Sync is not configured yet.';
    if (err.code === 'network') return 'Network error while reading the server File Cabinet.';
    return (err && err.message) || 'Could not read the server File Cabinet.';
  }

  let previewUrl = '';
  // Tiles stop watching when the view is rebuilt, or a replaced grid keeps
  // fetching photographs for a screen that is no longer there.
  let tileObservers = [];

  function stopTileWatching() {
    tileObservers.forEach(function (io) {
      try { io.disconnect(); } catch (_) {}
    });
    tileObservers = [];
  }

  function revokePreview() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch (_) {}
      previewUrl = '';
    }
  }

  let lightboxUrl = '';

  function revokeLightbox() {
    if (lightboxUrl) {
      try { URL.revokeObjectURL(lightboxUrl); } catch (_) {}
      lightboxUrl = '';
    }
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 1500);
  }

  // A picture is anything the Cabinet stored as an image: a photograph, a
  // floor plan, a diagnostics figure. Tim: "These pictures should just be in a
  // folder where you can see a thumbnail of all of them and then click on the
  // pictures to make them bigger -- not one at a time."
  function isPicture(row) {
    if (!row || row.missing) return false;
    return String(row.contentType || '').toLowerCase().indexOf('image/') === 0;
  }

  const THUMB_EDGE = 320;

  /**
   * Shrink a stored photograph to a tile.
   *
   * A survey can hold a hundred full-size photographs. Holding a hundred
   * object URLs to 4 MB originals is how a phone runs out of memory, so each
   * one is drawn down to a small canvas and the original is released
   * immediately. What the grid keeps is the tile, not the photograph.
   */
  async function thumbnailFrom(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise(function (resolve, reject) {
        const el = new Image();
        el.onload = function () { resolve(el); };
        el.onerror = function () { reject(new Error('image')); };
        el.src = url;
      });
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      const scale = Math.min(1, THUMB_EDGE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch (_) {
      return '';
    } finally {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  }

  async function responseBlob(response) {
    const type = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();
    return { blob: new Blob([buffer], { type: type }), type: type, buffer: buffer };
  }

  function renderShell(app, inner) {
    app.innerHTML = inner;
  }

  function renderExplore(app, customerId) {
    if (window.ToolboxApp && typeof window.ToolboxApp.registerActiveFlush === 'function') {
      window.ToolboxApp.registerActiveFlush(null);
    }
    revokePreview();
    revokeLightbox();
    stopTileWatching();
    const inside = !!customerId;
    renderShell(
      app,
      '<div class="explorer">' +
      '  <div class="view-bar view-bar--file">' +
      '    <button type="button" id="explorer-back" class="btn btn--ghost">' +
             (inside ? '‹ File Explorer' : '‹ Customer Files') +
      '    </button>' +
      '    <div class="file-identity"><span class="file-identity__name">File Explorer</span></div>' +
      '  </div>' +
      '  <section class="explorer-view">' +
      '    <header class="explorer-head">' +
      '      <div class="explorer-head__copy">' +
      '        <p class="eyebrow">File Cabinet</p>' +
      '        <h1 id="explorer-title">File Explorer</h1>' +
      '        <p id="explorer-lead"></p>' +
      '        <p id="explorer-sub" class="explorer-sub"></p>' +
      '      </div>' +
      (inside
        ? '<button type="button" id="explorer-zip" class="btn btn--secondary">Download ZIP</button>'
        : '') +
      '    </header>' +
      (inside
        ? ''
        : '<label class="explorer-search">' +
          '  <span class="sr-only">Search Customer Files</span>' +
          '  <input type="search" id="explorer-search" placeholder="Search name or address" autocomplete="off" />' +
          '</label>') +
      '    <p class="explorer-crumb" id="explorer-crumb"></p>' +
      '    <p class="cabinet-notice" id="explorer-notice" hidden></p>' +
      '    <div id="explorer-notes"></div>' +
      '    <div class="explorer-list" id="explorer-list">' +
      '      <p class="cabinet-empty">Loading Customer Files…</p>' +
      '    </div>' +
      '    <section class="explorer-preview" id="explorer-preview" hidden></section>' +
      '  </section>' +
      '</div>',
    );

    const titleEl = app.querySelector('#explorer-title');
    const lead = app.querySelector('#explorer-lead');
    const sub = app.querySelector('#explorer-sub');
    const crumb = app.querySelector('#explorer-crumb');
    const listEl = app.querySelector('#explorer-list');
    const notesEl = app.querySelector('#explorer-notes');
    const notice = app.querySelector('#explorer-notice');
    const preview = app.querySelector('#explorer-preview');
    const searchInput = app.querySelector('#explorer-search');

    lead.textContent = inside
      ? 'Stored surveys, photos, plans, and other data.'
      : 'Customer Files stored on the server. Open a file to view its stored surveys, photos, plans, and other data.';
    sub.textContent = inside ? 'Missing items are marked not stored.' : '';
    crumb.textContent = '';

    app.querySelector('#explorer-back').addEventListener('click', function () {
      window.location.hash = inside ? '#/explore' : '#/';
    });

    function showNotice(message) {
      notice.hidden = !message;
      notice.textContent = message || '';
    }

    function requireSync() {
      if (!window.ToolboxSync || typeof window.ToolboxSync.exploreListFiles !== 'function') {
        showNotice('File Explorer is unavailable.');
        listEl.innerHTML = '';
        return false;
      }
      return true;
    }

    let rootFiles = [];

    if (inside) {
      app.querySelector('#explorer-zip').addEventListener('click', function () {
        downloadArchive(customerId, app.querySelector('#explorer-zip'), showNotice);
      });
      loadCustomer(customerId);
    } else {
      loadRoot();
    }

    function loadRoot() {
      if (!requireSync()) return;
      window.ToolboxSync.exploreListFiles().then(function (data) {
        rootFiles = data && Array.isArray(data.files) ? data.files : [];
        paintRoot();
      }).catch(function (err) {
        listEl.innerHTML = '';
        showNotice(errorText(err));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        paintRoot();
      });
    }

    function loadCustomer(id) {
      if (!requireSync()) return;
      window.ToolboxSync.exploreListCustomerFile(id).then(function (data) {
        paintCustomer(id, data || {});
      }).catch(function (err) {
        listEl.innerHTML = '';
        showNotice(errorText(err));
      });
    }

    function filteredRoot() {
      const query = searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
      const files = rootFiles.slice().sort(function (a, b) {
        const nameA = String(a && a.displayName || a && a.propertyAddress || '').toLowerCase();
        const nameB = String(b && b.displayName || b && b.propertyAddress || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return String(a && a.key || '') < String(b && b.key || '') ? -1 : 1;
      });
      if (!query) return files;
      return files.filter(function (row) {
        const hay = [
          row && row.displayName,
          row && row.propertyAddress,
          usefulDate(row),
        ].join('\n').toLowerCase();
        return hay.indexOf(query) !== -1;
      });
    }

    function paintRoot() {
      const files = filteredRoot();
      listEl.innerHTML = '';
      if (!rootFiles.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No Customer Files are stored.';
        listEl.appendChild(empty);
        return;
      }
      if (!files.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No Customer Files match that search.';
        listEl.appendChild(empty);
        return;
      }
      files.forEach(function (row) {
        listEl.appendChild(rootRow(row));
      });
    }

    function rootRow(row) {
      const article = document.createElement('article');
      article.className = 'explorer-row';
      const key = row && row.key ? row.key : '';
      article.dataset.key = key;
      const main = document.createElement('div');
      main.className = 'explorer-row__main';
      const keyBtn = document.createElement('button');
      keyBtn.type = 'button';
      keyBtn.className = 'explorer-row__key';
      const named = !!(row && row.displayName);
      keyBtn.textContent = (row && row.displayName) || (row && row.propertyAddress) || 'Customer File';
      keyBtn.addEventListener('click', function () {
        if (row && row.id) window.location.hash = '#/explore/' + encodeURIComponent(row.id);
      });
      main.appendChild(keyBtn);
      const secondary = [];
      if (row && row.deletedAt) secondary.push('In File Cabinet Trash');
      if (named && row.propertyAddress) secondary.push(row.propertyAddress);
      const date = usefulDate(row);
      if (date) secondary.push(date);
      if (secondary.length) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = secondary.join(' · ');
        main.appendChild(p);
      } else if (row && row.unreadable) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = 'Stored object could not be read as JSON.';
        main.appendChild(p);
      }
      main.appendChild(technicalKey(key));
      article.appendChild(main);
      const actions = document.createElement('div');
      actions.className = 'explorer-row__actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--secondary';
      open.textContent = 'Open';
      open.addEventListener('click', function () {
        if (row && row.id) window.location.hash = '#/explore/' + encodeURIComponent(row.id);
      });
      actions.appendChild(open);
      article.appendChild(actions);
      return article;
    }

    function showCustomerIdentity(data) {
      const name = data && data.displayName;
      if (name) titleEl.textContent = name;
      const bits = [];
      if (data && data.propertyAddress) bits.push(data.propertyAddress);
      const date = usefulDate(data);
      if (date) bits.push(date);
      if (data && data.deletedAt) bits.push('In File Cabinet Trash');
      if (bits.length) lead.textContent = bits.join(' · ');
    }

    function paintCustomer(id, data) {
      showCustomerIdentity(data || {});
      notesEl.innerHTML = '';
      const notes = Array.isArray(data.referenceNotes) ? data.referenceNotes : [];
      notes.forEach(function (note) {
        const p = document.createElement('p');
        p.className = 'explorer-note';
        p.textContent = note;
        notesEl.appendChild(p);
      });
      const objects = Array.isArray(data.objects) ? data.objects : [];
      stopTileWatching();
      listEl.innerHTML = '';
      if (!objects.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No objects are stored for this Customer File.';
        listEl.appendChild(empty);
        return;
      }
      const buckets = {};
      objects.forEach(function (row) {
        const info = classify(row, id);
        row._label = info.label;
        row._detail = info.detail;
        const gid = groupIdFor(info.purpose);
        if (!buckets[gid]) buckets[gid] = [];
        buckets[gid].push(row);
      });
      GROUPS.forEach(function (group) {
        const rows = buckets[group.id];
        if (!rows || !rows.length) return;
        rows.sort(function (a, b) {
          const rank = purposeRank(classify(a, id).purpose) - purposeRank(classify(b, id).purpose);
          if (rank) return rank;
          const labelA = String(a._label || '');
          const labelB = String(b._label || '');
          if (labelA < labelB) return -1;
          if (labelA > labelB) return 1;
          return String(a.key || '') < String(b.key || '') ? -1 : 1;
        });
        const section = document.createElement('section');
        section.className = 'explorer-group';
        section.dataset.group = group.id;
        const heading = document.createElement('h2');
        heading.textContent = group.title;
        section.appendChild(heading);
        // Pictures become a contact sheet; everything else stays a row. A
        // hundred photographs listed as a hundred identical cards is a list of
        // photographs, not a way to look at them.
        const pictures = rows.filter(isPicture);
        const rest = rows.filter(function (row) { return !isPicture(row); });
        if (pictures.length) {
          section.appendChild(pictureSheet(id, pictures, group.title, preview, showNotice));
        }
        rest.forEach(function (row) {
          section.appendChild(objectRow(id, row));
        });
        listEl.appendChild(section);
      });
    }

    /** A grid of thumbnails, with one action to take the whole set. */
    function pictureSheet(id, rows, groupTitle, preview, notify) {
      const wrap = document.createElement('div');
      wrap.className = 'explorer-sheet';

      const bar = document.createElement('div');
      bar.className = 'explorer-sheet__bar';
      const count = document.createElement('p');
      count.className = 'explorer-sheet__count';
      count.textContent = rows.length + (rows.length === 1 ? ' picture' : ' pictures');
      bar.appendChild(count);
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'btn btn--secondary';
      all.textContent = 'Download all';
      all.addEventListener('click', function () {
        downloadPictures(id, rows, groupTitle, all, notify);
      });
      bar.appendChild(all);
      wrap.appendChild(bar);

      const grid = document.createElement('div');
      grid.className = 'explorer-sheet__grid';
      const captions = sheetCaptions(rows);
      rows.forEach(function (row, index) {
        grid.appendChild(pictureTile(id, row, rows, index, captions[index], notify));
      });
      wrap.appendChild(grid);
      return wrap;
    }

    function pictureTile(id, row, siblings, index, caption, notify) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'explorer-tile';
      tile.dataset.key = row.key || '';
      const frame = document.createElement('span');
      frame.className = 'explorer-tile__frame';
      const img = document.createElement('img');
      img.className = 'explorer-tile__img';
      img.alt = row._label || 'Photograph';
      img.loading = 'lazy';
      frame.appendChild(img);
      tile.appendChild(frame);
      const cap = document.createElement('span');
      cap.className = 'explorer-tile__caption';
      cap.textContent = caption || '';
      tile.appendChild(cap);
      tile.addEventListener('click', function () {
        openLightbox(id, siblings, index, notify);
      });
      // Fetched only when it comes into view, so opening a job with a hundred
      // photographs over a phone connection does not pull all hundred at once.
      watchTile(id, row, img, tile);
      return tile;
    }

    /**
     * Say what makes this picture different from the one beside it.
     *
     * "porch.jpg" earns its place under a tile. "Distress Survey photograph"
     * under all eight does not -- a caption repeated across the whole sheet
     * carries no information, and the group heading already said it. So a
     * caption that is identical for every tile in the group is dropped, which
     * is decided per sheet rather than per tile.
     */
    function tileCaption(row) {
      const detail = String(row._detail || '').trim();
      if (detail) return detail;
      const label = String(row._label || '').trim();
      const dash = label.indexOf('\u2014');
      if (dash >= 0) {
        const tail = label.slice(dash + 1).trim();
        if (tail) return tail;
      }
      return label;
    }

    function sheetCaptions(rows) {
      const captions = rows.map(tileCaption);
      const distinct = {};
      captions.forEach(function (text) { distinct[text] = 1; });
      // All the same? Then it says nothing. Fall back to the date, which at
      // least differs, and to nothing when even that is absent.
      // One picture has nothing to be repetitive against, so its name stays.
      if (rows.length < 2 || Object.keys(distinct).length > 1) return captions;
      return rows.map(function (row) { return formatFieldDate(row.uploaded) || ''; });
    }

    function watchTile(id, row, img, tile) {
      let started = false;
      const load = function () {
        if (started) return;
        started = true;
        window.ToolboxSync.exploreFetchObject(id, row.key)
          .then(responseBlob)
          .then(function (loaded) { return thumbnailFrom(loaded.blob); })
          .then(function (src) {
            if (src) {
              img.src = src;
              tile.classList.add('is-loaded');
            } else {
              tile.classList.add('is-failed');
            }
          })
          .catch(function () { tile.classList.add('is-failed'); });
      };
      if (typeof IntersectionObserver !== 'function') { load(); return; }
      const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.disconnect();
          load();
        });
      }, { rootMargin: '300px' });
      io.observe(tile);
      tileObservers.push(io);
    }

    /**
     * One picture, full size, with the rest of the set a tap away.
     *
     * The old preview opened at the foot of the page, so looking at the
     * second photograph meant scrolling down to it, back up to the list, and
     * down again. Over a set of a hundred that is the whole job.
     */
    function openLightbox(id, rows, startIndex, notify) {
      let index = Math.max(0, Math.min(rows.length - 1, startIndex));
      const box = document.createElement('div');
      box.className = 'explorer-lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      const bar = document.createElement('div');
      bar.className = 'explorer-lightbox__bar';
      const title = document.createElement('p');
      title.className = 'explorer-lightbox__title';
      bar.appendChild(title);
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn--secondary';
      save.textContent = 'Download';
      bar.appendChild(save);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn btn--ghost';
      close.textContent = 'Close';
      bar.appendChild(close);
      box.appendChild(bar);

      const stage = document.createElement('div');
      stage.className = 'explorer-lightbox__stage';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'explorer-lightbox__step';
      prev.setAttribute('aria-label', 'Previous picture');
      prev.textContent = '\u2039';
      const img = document.createElement('img');
      img.className = 'explorer-lightbox__img';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'explorer-lightbox__step';
      next.setAttribute('aria-label', 'Next picture');
      next.textContent = '\u203a';
      stage.appendChild(prev);
      stage.appendChild(img);
      stage.appendChild(next);
      box.appendChild(stage);

      function teardown() {
        revokeLightbox();
        document.removeEventListener('keydown', onKey);
        box.remove();
      }
      function onKey(event) {
        if (event.key === 'Escape') teardown();
        else if (event.key === 'ArrowLeft') show(index - 1);
        else if (event.key === 'ArrowRight') show(index + 1);
      }
      function show(nextIndex) {
        if (nextIndex < 0 || nextIndex >= rows.length) return;
        index = nextIndex;
        const row = rows[index];
        title.textContent = (row._label || 'Picture') + '  ' + (index + 1) + ' of ' + rows.length;
        prev.disabled = index === 0;
        next.disabled = index === rows.length - 1;
        img.removeAttribute('src');
        box.classList.add('is-loading');
        window.ToolboxSync.exploreFetchObject(id, row.key)
          .then(responseBlob)
          .then(function (loaded) {
            if (!box.isConnected || rows[index] !== row) return;
            revokeLightbox();
            lightboxUrl = URL.createObjectURL(loaded.blob);
            img.src = lightboxUrl;
            img.alt = row._label || 'Picture';
            box.classList.remove('is-loading');
            save.onclick = function () {
              saveBlob(loaded.blob, downloadName(row.key));
            };
          })
          .catch(function () {
            box.classList.remove('is-loading');
            notify('Could not open that picture.');
          });
      }

      prev.addEventListener('click', function () { show(index - 1); });
      next.addEventListener('click', function () { show(index + 1); });
      close.addEventListener('click', teardown);
      box.addEventListener('click', function (event) {
        if (event.target === box || event.target === stage) teardown();
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(box);
      show(index);
    }

    /** Every picture in this group, as one ZIP. */
    function downloadPictures(id, rows, groupTitle, button, notify) {
      if (!window.JSZip) {
        notify('ZIP download is unavailable.');
        return;
      }
      const label = button.textContent;
      button.disabled = true;
      let done = 0;
      const zip = new window.JSZip();
      const used = {};
      const step = function (row) {
        return window.ToolboxSync.exploreFetchObject(id, row.key)
          .then(responseBlob)
          .then(function (loaded) {
            let name = downloadName(row.key);
            if (used[name]) {
              const dot = name.lastIndexOf('.');
              const stem = dot > 0 ? name.slice(0, dot) : name;
              const ext = dot > 0 ? name.slice(dot) : '';
              name = stem + '-' + (used[name] + 1) + ext;
            }
            used[downloadName(row.key)] = (used[downloadName(row.key)] || 0) + 1;
            zip.file(name, loaded.buffer);
            done += 1;
            button.textContent = 'Packing ' + done + ' of ' + rows.length + '…';
          })
          // One unreadable object should not lose the other ninety-nine.
          .catch(function () {});
      };
      rows.reduce(function (chain, row) {
        return chain.then(function () { return step(row); });
      }, Promise.resolve()).then(function () {
        if (!done) throw new Error('none');
        return zip.generateAsync({ type: 'blob' });
      }).then(function (blob) {
        const stem = String(groupTitle || 'pictures').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        saveBlob(blob, stem + '.zip');
        button.disabled = false;
        button.textContent = label;
        if (done < rows.length) {
          notify(done + ' of ' + rows.length + ' pictures were stored and packed.');
        }
      }).catch(function () {
        button.disabled = false;
        button.textContent = label;
        notify('Could not package those pictures.');
      });
    }

    function objectRow(id, row) {
      const info = classify(row, id);
      const article = document.createElement('article');
      let className = 'explorer-row';
      if (row && row.missing) className += ' explorer-row--missing';
      if (info.purpose === 'floor-pdf') className += ' explorer-row--pdf';
      article.className = className;
      const key = row && row.key ? row.key : '';
      article.dataset.key = key;
      article.dataset.purpose = info.purpose;
      const main = document.createElement('div');
      main.className = 'explorer-row__main';
      const title = document.createElement('strong');
      title.className = 'explorer-row__title';
      title.textContent = info.label;
      main.appendChild(title);
      const note = alsoNote(row) || info.detail;
      const meta = metaLine(row);
      if (note) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = note;
        main.appendChild(p);
      }
      if (meta) {
        const p = document.createElement('p');
        p.className = row && row.missing ? 'explorer-row__missing' : 'explorer-row__label';
        p.textContent = meta;
        main.appendChild(p);
      }
      main.appendChild(technicalKey(key));
      article.appendChild(main);
      const actions = document.createElement('div');
      actions.className = 'explorer-row__actions';
      if (row && !row.missing) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn btn--secondary';
        open.textContent = 'Open';
        open.addEventListener('click', function () {
          openObject(id, key, info.label, preview, showNotice);
        });
        actions.appendChild(open);
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'btn btn--secondary';
        download.textContent = 'Download';
        download.addEventListener('click', function () {
          downloadObject(id, key, download, showNotice);
        });
        actions.appendChild(download);
      }
      article.appendChild(actions);
      return article;
    }

    function openObject(id, key, label, panel, notify) {
      notify('');
      revokePreview();
      panel.hidden = false;
      panel.innerHTML = '<p class="explorer-preview__status">Opening ' + escapeHtml(label) + '…</p>';
      window.ToolboxSync.exploreFetchObject(id, key).then(function (response) {
        return responseBlob(response);
      }).then(function (loaded) {
        const kind = previewKind(loaded.type);
        panel.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'explorer-preview__head';
        const title = document.createElement('h2');
        title.textContent = label;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn btn--ghost';
        close.textContent = 'Close';
        close.addEventListener('click', function () {
          revokePreview();
          panel.hidden = true;
          panel.innerHTML = '';
        });
        head.appendChild(title);
        head.appendChild(close);
        panel.appendChild(head);
        const meta = document.createElement('p');
        meta.className = 'explorer-preview__meta';
        meta.textContent = loaded.type || 'No content type stored';
        panel.appendChild(meta);
        if (kind === 'image') {
          previewUrl = URL.createObjectURL(loaded.blob);
          const img = document.createElement('img');
          img.className = 'explorer-preview__image';
          img.alt = label;
          img.src = previewUrl;
          panel.appendChild(img);
        } else if (kind === 'pdf') {
          previewUrl = URL.createObjectURL(loaded.blob);
          const frame = document.createElement('iframe');
          frame.className = 'explorer-preview__pdf';
          frame.title = label;
          frame.src = previewUrl;
          panel.appendChild(frame);
        } else if (kind === 'text') {
          const pre = document.createElement('pre');
          pre.className = 'explorer-preview__text';
          const text = new TextDecoder().decode(loaded.buffer);
          const limit = 512 * 1024;
          pre.textContent = text.length > limit ? text.slice(0, limit) : text;
          panel.appendChild(pre);
          if (text.length > limit) {
            const more = document.createElement('p');
            more.className = 'explorer-preview__meta';
            more.textContent = 'Preview shows the first 512 KB. Download for the full object.';
            panel.appendChild(more);
          }
        } else {
          const p = document.createElement('p');
          p.className = 'explorer-preview__meta';
          p.textContent = loaded.type && loaded.type !== 'application/octet-stream'
            ? 'This content type is not previewed. Download the object to keep the original bytes.'
            : 'No previewable content type is stored on this object. Download keeps the original bytes.';
          panel.appendChild(p);
        }
        panel.scrollIntoView({ block: 'nearest' });
      }).catch(function (err) {
        panel.hidden = true;
        panel.innerHTML = '';
        notify(errorText(err));
      });
    }

    function downloadObject(id, key, button, notify) {
      notify('');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Downloading…';
      window.ToolboxSync.exploreFetchObject(id, key).then(function (response) {
        return responseBlob(response);
      }).then(function (loaded) {
        saveBlob(loaded.blob, downloadName(key));
      }).catch(function (err) {
        notify(errorText(err));
      }).then(function () {
        button.disabled = false;
        button.textContent = previous;
      });
    }

    function downloadArchive(id, button, notify) {
      notify('');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Preparing ZIP…';
      window.ToolboxSync.exploreFetchArchive(id).then(function (response) {
        const disposition = response.headers.get('content-disposition') || '';
        const named = /filename="([^"]+)"/.exec(disposition);
        const filename = (named && named[1]) || ('cf-' + id + '.zip');
        return responseBlob(response).then(function (loaded) {
          saveBlob(loaded.blob, filename);
        });
      }).catch(function (err) {
        notify(errorText(err));
      }).then(function () {
        button.disabled = false;
        button.textContent = previous;
      });
    }
  }

  const explorerBtn = document.getElementById('app-explorer');
  if (explorerBtn) {
    explorerBtn.addEventListener('click', function () {
      if ((window.location.hash || '') === '#/explore') {
        try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {
          window.location.hash = '#/explore';
        }
      } else {
        window.location.hash = '#/explore';
      }
    });
  }

  window.ToolboxFileExplorer = {
    render: renderExplore,
    previewKind: previewKind,
  };
})();
