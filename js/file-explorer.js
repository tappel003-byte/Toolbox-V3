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

  /**
   * Is this one of Toolbox's own record files?
   *
   * Tim, looking at a job's folder: "if you hit open or anything other than
   * the pictures it really does not do anything, show anything to anybody
   * who doesn't read code -- see the code like Neo in the Matrix." He is
   * right. customer.json, distress.json, floor.json and the rest are how
   * Toolbox writes a Customer File down; they are not a thing anybody opens
   * on purpose, and listing them beside the photographs makes a job look
   * like a developer's folder instead of a job.
   *
   * They are not hidden -- the Cabinet is the repository, and a file in it
   * must be reachable -- they are put behind one line at the foot of the
   * job, closed.
   */
  function isRecordFile(row, id) {
    const key = String((row && row.key) || '');
    const prefix = 'cf/' + id + '/';
    if (key.indexOf(prefix) !== 0) return false;
    return /\.json$/i.test(key.slice(prefix.length));
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

  function anchorSave(blob, filename) {
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

  /**
   * Put a copy where the investigator points.
   *
   * Tim: "I could be saving it to a Google Drive, I can save it to my
   * desktop, I can save it to a flash drive, I can save it to an external
   * whatever from Explorer." The browser can offer a proper Save As dialog,
   * so it does, and what comes out of the Cabinet lands straight on the
   * office server or the drive rather than in Downloads to be moved by hand.
   *
   * Two details decide whether this works at all:
   *
   * The dialog may only be opened while the click that asked for it is still
   * fresh -- a few seconds -- so the place is chosen BEFORE the file is
   * fetched, not after. On a big job the fetch is the slow part, and asking
   * afterwards is how this fails on exactly the files worth saving.
   *
   * The file is then streamed into the chosen place instead of being handed
   * over whole, so a job of photographs is not held in memory twice.
   *
   * Save As is Chrome and Edge on a desktop. Everywhere else -- iPhone, iPad,
   * Safari, Firefox -- it falls back to the ordinary download, which is what
   * Toolbox did before, and says so plainly rather than pretending.
   */
  function canChooseWhere() {
    try {
      return typeof window.showSaveFilePicker === 'function';
    } catch (_) {
      return false;
    }
  }

  const SAVE_CANCELLED = { cancelled: true };

  async function choosePlace(filename, mimeType) {
    if (!canChooseWhere()) return null;
    const dot = filename.lastIndexOf('.');
    const ext = dot > 0 ? filename.slice(dot) : '';
    const accept = {};
    accept[mimeType || 'application/octet-stream'] = ext ? [ext] : [];
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        excludeAcceptAllOption: false,
        types: [{ description: ext === '.zip' ? 'ZIP package' : 'File', accept: accept }],
      });
      return await handle.createWritable().then(function (writable) {
        return { name: handle.name || filename, writable: writable };
      });
    } catch (err) {
      // The investigator closed the dialog: nothing was saved, and nothing
      // should be claimed. Anything else -- a browser that offers the dialog
      // and then refuses it -- falls back to the ordinary download.
      if (err && err.name === 'AbortError') return SAVE_CANCELLED;
      return null;
    }
  }

  /**
   * Ask where first, then make the file, then write it there.
   * `produce` returns the Blob; it is only called once a place is settled.
   */
  async function saveWhereChosen(filename, mimeType, produce) {
    const place = await choosePlace(filename, mimeType);
    if (place === SAVE_CANCELLED) return { cancelled: true };
    let blob;
    try {
      blob = await produce();
    } catch (err) {
      if (place && place.writable) {
        try { await place.writable.abort(); } catch (_) {}
      }
      throw err;
    }
    if (place && place.writable) {
      try {
        if (blob.stream && typeof blob.stream === 'function') {
          await blob.stream().pipeTo(place.writable);
        } else {
          await place.writable.write(blob);
          await place.writable.close();
        }
      } catch (err) {
        try { await place.writable.abort(); } catch (_) {}
        throw err;
      }
      return { chosen: true, name: place.name };
    }
    anchorSave(blob, filename);
    return { chosen: false, name: filename };
  }

  /** What to tell the investigator once it is written. */
  function savedNotice(result) {
    if (!result || result.cancelled) return '';
    if (result.chosen) return 'Saved ' + result.name + ' where you chose.';
    return 'Saved ' + result.name + ' to your downloads.';
  }

  // A picture is anything the Cabinet stored as an image: a photograph, a
  // floor plan, a diagnostics figure. Tim: "These pictures should just be in a
  // folder where you can see a thumbnail of all of them and then click on the
  // pictures to make them bigger -- not one at a time."
  //
  // What a stored item is FOR is the first answer, not what the server calls
  // it. This asked the server's content type alone, and on real jobs the
  // server does not always have one to give -- so every photograph fell out of
  // the contact sheet and into a card of its own, which is the screen Tim was
  // looking at when he asked "how does this help anybody to look at one
  // picture at a time?". A Distress photograph is a picture whatever the
  // storage says, and that never changes.
  const PICTURE_PURPOSES = {
    'plan': 1,
    'distress-photo': 1,
    'quick-capture': 1,
    'unassigned-photo': 1,
    'general-photo': 1,
    'floor-figure': 1,
    'diagnostics-figure': 1,
  };

  const PICTURE_NAME = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i;

  function isPicture(row) {
    if (!row || row.missing) return false;
    if (String(row.contentType || '').toLowerCase().indexOf('image/') === 0) return true;
    if (PICTURE_PURPOSES[String(row.purpose || '')]) return true;
    // Last, the name it was given. A stored file keeps its extension, and an
    // extension is a better answer than nothing.
    return PICTURE_NAME.test(String(row.label || '')) ||
      PICTURE_NAME.test(String(row.key || ''));
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

    const backBtn = app.querySelector('#explorer-back');
    backBtn.addEventListener('click', function () {
      // Inside a folder, Back goes up one, the way it does in Windows.
      if (inside && openFolder) {
        leaveFolder(customerId);
        backBtn.textContent = '‹ File Explorer';
        return;
      }
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

    let jobName = '';
    /** Everything the Cabinet holds for this job, and which folder is open. */
    let jobObjects = [];
    let openFolder = '';

    function showCustomerIdentity(data) {
      const name = data && data.displayName;
      if (name) {
        titleEl.textContent = name;
        jobName = name;
      }
      const bits = [];
      if (data && data.propertyAddress) bits.push(data.propertyAddress);
      const date = usefulDate(data);
      if (date) bits.push(date);
      if (data && data.deletedAt) bits.push('In File Cabinet Trash');
      if (bits.length) lead.textContent = bits.join(' · ');
    }

    // What the stored object cannot say about itself.
    //
    // The Cabinet knows a photograph's key, size and the moment it was
    // uploaded. When it was *taken* lives in distress.json, with the pin it
    // belongs to. Tim: "I want it as the date they were taken, not the date
    // that I downloaded them to the computer." So the one component that
    // knows is read once per Customer File and joined on the media id.
    let photoFacts = {};

    let photoFactsFor = '';

    /**
     * Read once, and only when a download asks for it.
     *
     * Browsing must not reach past the read-only explore route: a missing
     * object there falls back to the working sync API, which is not what a
     * back door should be doing on a page view. A download is a request the
     * investigator made, so that is where the join belongs.
     */
    function readPhotoFacts(id) {
      if (photoFactsFor === id) return Promise.resolve();
      photoFacts = {};
      const key = 'cf/' + id + '/distress.json';
      return window.ToolboxSync.exploreFetchObject(id, key)
        .then(function (response) { return response.json(); })
        .then(function (distress) {
          const facts = {};
          const pins = distress && Array.isArray(distress.pins) ? distress.pins : [];
          pins.forEach(function (pin) {
            const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
            photos.forEach(function (photoId, order) {
              if (typeof photoId !== 'string' || !photoId) return;
              facts[photoId] = {
                kind: 'pin',
                pin: pin.num != null ? String(pin.num) : '',
                // Which of that pin's photographs this is, so three shots of
                // one crack come back in the order they were taken rather
                // than as the same name with a number stuck on the end.
                seq: order + 1,
                count: photos.length,
                room: String(pin.location || ''),
                takenAt: '',
                description: String(pin.description || ''),
              };
            });
          });
          const quick = distress && Array.isArray(distress.quickCapture) ? distress.quickCapture : [];
          quick.forEach(function (item) {
            if (!item || typeof item.id !== 'string' || !item.id) return;
            facts[item.id] = {
              kind: 'quick',
              pin: '',
              takenAt: captureIso(item),
              // The set the investigator named when the run started.
              folder: String(item.folder || '').trim(),
              description: '',
            };
          });
          photoFacts = facts;
          photoFactsFor = id;
        })
        // Without it the pictures still download, under their stored keys.
        .catch(function () { photoFacts = {}; photoFactsFor = id; });
    }

    function captureIso(item) {
      if (!item) return '';
      if (item.timestamp) return String(item.timestamp);
      if (typeof item.ts === 'number' && isFinite(item.ts)) return new Date(item.ts).toISOString();
      if (item.ts) return String(item.ts);
      return '';
    }

    function factFor(row) {
      const key = String(row && row.key || '');
      const id = key.indexOf('media/') === 0 ? key.slice(6) : key;
      return photoFacts[id] || null;
    }

    /** yyyy-mm-dd in the local day the shutter was pressed. */
    function captureDay(iso) {
      const parsed = Date.parse(iso || '');
      if (!isFinite(parsed)) return '';
      const d = new Date(parsed);
      const pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function captureStamp(iso) {
      const parsed = Date.parse(iso || '');
      if (!isFinite(parsed)) return '';
      const d = new Date(parsed);
      const pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return captureDay(iso) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
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
      jobObjects = objects;
      openFolder = '';
      paintJob(id);
    }

    /** Sort a folder's contents: the things worth seeing first, then by name. */
    function sortRows(id, rows) {
      rows.sort(function (a, b) {
        const rank = purposeRank(classify(a, id).purpose) - purposeRank(classify(b, id).purpose);
        if (rank) return rank;
        const labelA = String(a._label || '');
        const labelB = String(b._label || '');
        if (labelA < labelB) return -1;
        if (labelA > labelB) return 1;
        return String(a.key || '') < String(b.key || '') ? -1 : 1;
      });
      return rows;
    }

    function sortJob(id) {
      const buckets = {};
      const records = [];
      jobObjects.forEach(function (row) {
        const info = classify(row, id);
        row._label = info.label;
        row._detail = info.detail;
        if (isRecordFile(row, id)) {
          records.push(row);
          return;
        }
        const gid = groupIdFor(info.purpose);
        if (!buckets[gid]) buckets[gid] = [];
        buckets[gid].push(row);
      });
      return { buckets: buckets, records: records };
    }

    /**
     * A job is folders you walk into, not one long page.
     *
     * Tim: "Explorer needs to kind of look and feel like an actual Microsoft
     * file explorer -- that's the whole point of this one." Every group used
     * to be stacked on the same screen, so a job with two hundred
     * photographs was two hundred thumbnails to scroll past before the floor
     * survey. Now the job opens as a short list of folders with what is in
     * each, and one of them is opened at a time.
     */
    function paintJob(id) {
      stopTileWatching();
      revokePreview();
      preview.hidden = true;
      preview.innerHTML = '';
      listEl.innerHTML = '';
      const sorted = sortJob(id);
      const buckets = sorted.buckets;
      if (!openFolder) {
        crumb.innerHTML = '';
        GROUPS.forEach(function (group) {
          const rows = buckets[group.id];
          if (!rows || !rows.length) return;
          listEl.appendChild(folderRow(id, group, rows));
        });
        if (sorted.records.length) listEl.appendChild(recordFiles(id, sorted.records));
        return;
      }
      const group = GROUPS.filter(function (item) { return item.id === openFolder; })[0];
      const rows = group ? buckets[group.id] : null;
      if (!group || !rows || !rows.length) {
        openFolder = '';
        paintJob(id);
        return;
      }
      // The path across the top is the way back up, the way it is in a file
      // explorer. One way up, not a button beside it saying the same thing.
      crumb.innerHTML = '';
      const home = document.createElement('button');
      home.type = 'button';
      home.className = 'explorer-up';
      home.textContent = jobName || 'Customer File';
      home.addEventListener('click', function () { leaveFolder(id); });
      crumb.appendChild(home);
      const sep = document.createElement('span');
      sep.className = 'explorer-crumb__sep';
      sep.textContent = ' › ';
      crumb.appendChild(sep);
      const here = document.createElement('span');
      here.className = 'explorer-crumb__here';
      here.textContent = group.title;
      crumb.appendChild(here);
      const section = document.createElement('section');
      section.className = 'explorer-group';
      section.dataset.group = group.id;
      const heading = document.createElement('h2');
      heading.textContent = group.title;
      section.appendChild(heading);
      sortRows(id, rows);
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
    }

    function enterFolder(id, groupId) {
      openFolder = groupId;
      showNotice('');
      if (backBtn) backBtn.textContent = '‹ Back';
      // What the pictures in here are called -- the pin, the room, the day
      // the shutter was pressed -- lives in distress.json, and naming a
      // download needs it in hand before the Save As dialog can be opened.
      // Walking into a folder is the investigator asking for this folder, so
      // it is read once here rather than on every page view.
      readPhotoFacts(id).catch(function () {});
      paintJob(id);
      try { listEl.scrollIntoView({ block: 'start' }); } catch (_) {}
    }

    function leaveFolder(id) {
      openFolder = '';
      showNotice('');
      if (backBtn) backBtn.textContent = '‹ File Explorer';
      paintJob(id);
    }

    /** What is in a folder, said in the words of the thing itself. */
    function folderCount(rows) {
      const pictures = rows.filter(isPicture).length;
      const rest = rows.length - pictures;
      const parts = [];
      if (pictures) parts.push(pictures + (pictures === 1 ? ' picture' : ' pictures'));
      if (rest) parts.push(rest + (rest === 1 ? ' file' : ' files'));
      return parts.join(' · ');
    }

    function folderRow(id, group, rows) {
      const article = document.createElement('article');
      article.className = 'explorer-folder';
      article.dataset.group = group.id;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'explorer-folder__open';
      open.addEventListener('click', function () { enterFolder(id, group.id); });
      const icon = document.createElement('span');
      icon.className = 'explorer-folder__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '📁';
      open.appendChild(icon);
      const text = document.createElement('span');
      text.className = 'explorer-folder__text';
      const title = document.createElement('strong');
      title.textContent = group.title;
      text.appendChild(title);
      const count = document.createElement('span');
      count.className = 'explorer-folder__count';
      count.textContent = folderCount(rows);
      text.appendChild(count);
      open.appendChild(text);
      const chev = document.createElement('span');
      chev.className = 'explorer-folder__chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '›';
      open.appendChild(chev);
      article.appendChild(open);
      return article;
    }

    /** Toolbox's own record files, at the foot of the job, closed. */
    function recordFiles(id, rows) {
      const box = document.createElement('details');
      box.className = 'explorer-records';
      const summary = document.createElement('summary');
      summary.textContent = 'Technical details';
      box.appendChild(summary);
      const note = document.createElement('p');
      note.className = 'explorer-records__note';
      note.textContent = 'How Toolbox writes this job down. Nothing in here is a ' +
        'picture, a survey or a report — those are above.';
      box.appendChild(note);
      rows.sort(function (a, b) {
        return String(a._label || '') < String(b._label || '') ? -1 : 1;
      });
      rows.forEach(function (row) {
        box.appendChild(objectRow(id, row));
      });
      return box;
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

      // Where else this picture is listed. On a row this sat under the title;
      // a tile has no room for it, so it is said here, which is where the
      // investigator is when it matters.
      const also = document.createElement('p');
      also.className = 'explorer-lightbox__also';
      also.hidden = true;
      box.appendChild(also);

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
        const sharedNote = alsoNote(row);
        also.textContent = sharedNote;
        also.hidden = !sharedNote;
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
              saveWhereChosen(downloadName(row.key), loaded.type, function () {
                return loaded.blob;
              }).then(function (result) {
                notify(savedNotice(result));
              }).catch(function () {
                notify('Could not save that picture.');
              });
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

    /**
     * What a picture is called once it leaves Toolbox.
     *
     * A Quick Capture is named for the moment it was taken, because that is
     * the only thing about it anyone will want to sort by afterwards. Tim: "I
     * want it as the date they were taken, not the date that I downloaded
     * them to the computer." The storage key -- the thing it used to be named
     * after -- says nothing to anybody.
     */
    function pictureFileName(row) {
      const fact = factFor(row);
      const ext = extensionFor(row);
      if (fact && fact.kind === 'quick') {
        const stamp = captureStamp(fact.takenAt);
        const set = safeFolder(fact.folder);
        const leaf = (stamp || downloadName(row.key)) + ext;
        return set ? set + '/' + leaf : leaf;
      }
      if (fact && fact.kind === 'pin') {
        return pinFileName(fact) + ext;
      }
      return downloadName(row.key);
    }

    /**
     * What a Distress photograph is called when it leaves the Cabinet.
     *
     * A pin photograph is stored as an id and nothing else -- everything a
     * person would call it by lives on the pin it hangs from. So the name is
     * built from what the investigator already wrote there: the pin number,
     * the room, and the start of the note. "pin-04-hall-hairline-crack.jpg"
     * instead of "pin-4-ph_8f21c0a9.jpg", which named it after a storage key
     * and told nobody anything.
     *
     * The number is padded so a folder of thirty sorts 4 before 10, and a pin
     * with more than one photograph numbers them in the order they were taken.
     */
    function pinFileName(fact) {
      const num = String(fact.pin || '').trim();
      const head = num ? 'pin-' + (num.length < 2 ? '0' + num : num) : 'pin';
      const seq = fact.count > 1 ? '-' + fact.seq : '';
      const words = [slugWords(fact.room, 24), slugWords(fact.description, 40)]
        .filter(Boolean).join('-');
      return head + seq + (words ? '-' + words : '');
    }

    /** Lower-case, hyphenated, and cut at a whole word. */
    function slugWords(text, max) {
      const clean = String(text || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (clean.length <= max) return clean;
      const cut = clean.slice(0, max);
      const at = cut.lastIndexOf('-');
      return (at > 8 ? cut.slice(0, at) : cut).replace(/-+$/, '');
    }

    function safeFolder(name) {
      return String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
    }

    function extensionFor(row) {
      const type = String(row && row.contentType || '').toLowerCase();
      if (type.indexOf('image/png') === 0) return '.png';
      if (type.indexOf('image/webp') === 0) return '.webp';
      if (type.indexOf('image/heic') === 0) return '.heic';
      return '.jpg';
    }

    /**
     * The folder the pictures land in, named for the day they were taken.
     *
     * One day of Quick Captures becomes that date. Several days keep the span,
     * so a folder never claims a date that half its contents do not share.
     * A subject -- Exterior, Interior -- is not stored against a capture yet,
     * so nothing here invents one.
     */
    function picturesZipName(rows, groupTitle) {
      const stem = String(groupTitle || 'pictures').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const days = {};
      const sets = {};
      rows.forEach(function (row) {
        const fact = factFor(row);
        if (!fact || fact.kind !== 'quick') return;
        const day = captureDay(fact.takenAt);
        if (day) days[day] = 1;
        const set = safeFolder(fact.folder);
        if (set) sets[set] = 1;
      });
      const dayList = Object.keys(days).sort();
      const setList = Object.keys(sets);
      // One named set is the best name there is. Several, and the sets are
      // folders inside, so the ZIP falls back to the span they cover.
      const head = setList.length === 1
        ? setList[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : stem;
      if (!dayList.length) return head + '.zip';
      if (dayList.length === 1) return head + '-' + dayList[0] + '.zip';
      return head + '-' + dayList[0] + '_to_' + dayList[dayList.length - 1] + '.zip';
    }

    /** Every picture in this group, as one ZIP, wherever you point it. */
    function downloadPictures(id, rows, groupTitle, button, notify) {
      if (!window.JSZip) {
        notify('ZIP download is unavailable.');
        return;
      }
      const label = button.textContent;
      button.disabled = true;
      button.textContent = canChooseWhere() ? 'Where to?' : 'Reading…';
      let done = 0;
      const zip = new window.JSZip();
      const used = {};
      const step = function (row) {
        return window.ToolboxSync.exploreFetchObject(id, row.key)
          .then(responseBlob)
          .then(function (loaded) {
            let name = pictureFileName(row);
            if (used[name]) {
              const dot = name.lastIndexOf('.');
              const stem = dot > 0 ? name.slice(0, dot) : name;
              const ext = dot > 0 ? name.slice(dot) : '';
              name = stem + '-' + (used[name] + 1) + ext;
            }
            used[pictureFileName(row)] = (used[pictureFileName(row)] || 0) + 1;
            zip.file(name, loaded.buffer);
            done += 1;
            button.textContent = 'Packing ' + done + ' of ' + rows.length + '…';
          })
          // One unreadable object should not lose the other ninety-nine.
          .catch(function () {});
      };
      saveWhereChosen(picturesZipName(rows, groupTitle), 'application/zip', function () {
        button.textContent = 'Reading…';
        return rows.reduce(function (chain, row) {
          return chain.then(function () { return step(row); });
        }, readPhotoFacts(id)).then(function () {
          if (!done) throw new Error('none');
          button.textContent = 'Packing…';
          return zip.generateAsync({ type: 'blob' });
        });
      }).then(function (result) {
        button.disabled = false;
        button.textContent = label;
        if (result.cancelled) {
          notify('');
          return;
        }
        notify(done < rows.length
          ? done + ' of ' + rows.length + ' pictures were stored and packed. ' + savedNotice(result)
          : savedNotice(result));
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
      button.textContent = canChooseWhere() ? 'Where to?' : 'Downloading…';
      saveWhereChosen(downloadName(key), '', function () {
        button.textContent = 'Downloading…';
        return window.ToolboxSync.exploreFetchObject(id, key)
          .then(responseBlob)
          .then(function (loaded) { return loaded.blob; });
      }).then(function (result) {
        notify(savedNotice(result));
      }).catch(function (err) {
        notify(errorText(err));
      }).then(function () {
        button.disabled = false;
        button.textContent = previous;
      });
    }

    /**
     * The whole job, wherever you point it.
     *
     * The name used to come from the server, in the header on the answer --
     * which cannot be read until the job has been fetched, and by then the
     * Save As dialog can no longer be opened. So the name is made here,
     * from what the Cabinet already told us about the job, before anything
     * is fetched.
     */
    function archiveFileName(id) {
      const stem = slugWords(jobName, 48);
      return (stem || ('cf-' + id)) + '.zip';
    }

    function downloadArchive(id, button, notify) {
      notify('');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = canChooseWhere() ? 'Where to?' : 'Preparing ZIP…';
      saveWhereChosen(archiveFileName(id), 'application/zip', function () {
        button.textContent = 'Preparing ZIP…';
        return window.ToolboxSync.exploreFetchArchive(id)
          .then(responseBlob)
          .then(function (loaded) { return loaded.blob; });
      }).then(function (result) {
        notify(savedNotice(result));
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
