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

  /**
   * The street and the town out of one stored address.
   *
   * The Customer File keeps the property as one line -- "4925 Edwards Dr NE,
   * Albuquerque, NM 87111, United States of America" when it came from the
   * address search -- and there is no separate city field to read. The town
   * is the part just before the state; without a state it is the second
   * part. An address that does not split that way gives no town, and the
   * row shows the address as it was typed rather than a guess.
   */
  const STATE_PART = /^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$|^[A-Za-z][A-Za-z .]+\s+\d{5}(-\d{4})?$/;

  function addressParts(address) {
    const parts = String(address || '').split(/[,\n]/).map(function (part) {
      return part.trim();
    }).filter(Boolean);
    if (parts.length < 2) return { street: parts[0] || '', town: '' };
    let town = '';
    for (let i = 1; i < parts.length; i++) {
      if (STATE_PART.test(parts[i])) {
        if (i > 1) town = parts[i - 1];
        break;
      }
    }
    if (!town && !STATE_PART.test(parts[1]) && !/^\d/.test(parts[1])) town = parts[1];
    return { street: parts[0], town: town };
  }

  function townOf(address) {
    return addressParts(address).town;
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
    if (purpose === 'report-overview' || purpose === 'report-picture') return 'report';
    const known = GROUPS.some(function (group) { return group.id === purpose; });
    return known ? purpose : 'other';
  }

  function purposeRank(purpose) {
    if (purpose === 'floor-pdf' || purpose === 'distress-photo' || purpose === 'plan' || purpose === 'diagnostics-figure') return 0;
    if (purpose === 'floor-figure' || purpose === 'quick-capture' || purpose === 'report-overview') return 1;
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

  /** A served answer, as opposed to a file already in hand. */
  function isResponse(value) {
    return !!value && typeof value.arrayBuffer === 'function' && !!value.headers;
  }

  /**
   * Ask where first, then make the file, then write it there.
   *
   * `produce` returns either the Blob or the answer the server is still
   * sending. An answer is poured straight into the chosen place as it
   * arrives: a whole job's ZIP can be gigabytes, and the browser has no
   * business holding one in memory to hand it over in a single piece --
   * which is exactly the kind of thing that put a desktop on the floor.
   * It is only called once a place is settled.
   */
  async function saveWhereChosen(filename, mimeType, produce) {
    const place = await choosePlace(filename, mimeType);
    if (place === SAVE_CANCELLED) return { cancelled: true };
    let made;
    try {
      made = await produce();
    } catch (err) {
      if (place && place.writable) {
        try { await place.writable.abort(); } catch (_) {}
      }
      throw err;
    }
    if (place && place.writable) {
      try {
        if (isResponse(made) && made.body && typeof made.body.pipeTo === 'function') {
          await made.body.pipeTo(place.writable);
        } else {
          const blob = isResponse(made) ? await made.blob() : made;
          if (blob.stream && typeof blob.stream === 'function') {
            await blob.stream().pipeTo(place.writable);
          } else {
            await place.writable.write(blob);
            await place.writable.close();
          }
        }
      } catch (err) {
        try { await place.writable.abort(); } catch (_) {}
        throw err;
      }
      return { chosen: true, name: place.name };
    }
    // No dialog: the ordinary download, which needs the file in hand.
    const blob = isResponse(made) ? await made.blob() : made;
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
        ? '<button type="button" id="explorer-zip" class="btn btn--secondary">Download job copy</button>'
        : '') +
      '    </header>' +
      (inside
        ? ''
        : '<label class="explorer-search">' +
          '  <span class="sr-only">Search Customer Files</span>' +
          '  <input type="search" id="explorer-search" placeholder="Search name, address or town" autocomplete="off" />' +
          '</label>' +
          '<div class="explorer-mode" role="group" aria-label="Show jobs as">' +
          '  <button type="button" class="explorer-mode__btn is-on" data-mode="list" aria-pressed="true">List</button>' +
          '  <button type="button" class="explorer-mode__btn" data-mode="map" aria-pressed="false">Map</button>' +
          '</div>') +
      '    <p class="cabinet-notice" id="explorer-notice" hidden></p>' +
      // Three columns on a desktop, one on a phone: the drawings' tree down
      // the left, the list in the middle, and the details beside it. On a
      // phone the tree and the details chrome are simply not there and the
      // list is the screen, exactly as before -- "each workspace should fit
      // its actual use context", not one identical UI everywhere.
      '    <div class="explorer-panes' + (inside ? ' explorer-panes--inside' : '') + '">' +
      '      <nav class="explorer-tree" id="explorer-tree" hidden aria-label="File Cabinet"></nav>' +
      '      <div class="explorer-main">' +
      '        <p class="explorer-crumb" id="explorer-crumb"></p>' +
      '        <div id="explorer-notes"></div>' +
      '        <div class="explorer-list" id="explorer-list">' +
      '          <p class="cabinet-empty">Loading Customer Files…</p>' +
      '        </div>' +
      '        <section class="explorer-textsearch" id="explorer-textsearch" hidden></section>' +
      '        <div class="explorer-mapview" id="explorer-mapview" hidden></div>' +
      '      </div>' +
      '      <aside class="explorer-details" id="explorer-details">' +
      '        <div class="explorer-details__body" id="explorer-details-body" hidden></div>' +
      '        <section class="explorer-preview" id="explorer-preview" hidden></section>' +
      '      </aside>' +
      '    </div>' +
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
    const treeEl = app.querySelector('#explorer-tree');
    const detailsEl = app.querySelector('#explorer-details-body');
    const searchInput = app.querySelector('#explorer-search');

    lead.textContent = inside
      ? 'Stored surveys, photos, plans, and other data.'
      : 'Jobs on the server, filed by field work date.';
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

    // The three columns are a function of the room there is, so they have to
    // follow the window rather than be decided once at load.
    if (typeof window.matchMedia === 'function') {
      const wide = window.matchMedia('(min-width: 1100px)');
      const onWidth = function () {
        if (!document.body.contains(app)) return;
        paintTree();
        paintDetails();
        if (!inside && rootFiles.length) paintRoot();
      };
      if (typeof wide.addEventListener === 'function') wide.addEventListener('change', onWidth);
      else if (typeof wide.addListener === 'function') wide.addListener(onWidth);
    }

    if (inside) {
      app.querySelector('#explorer-zip').addEventListener('click', function () {
        downloadArchive(customerId, app.querySelector('#explorer-zip'), showNotice);
      });
      loadCustomer(customerId);
    } else {
      loadRoot();
    }

    /**
     * Is this job held by some other device?
     *
     * The lease rides on the listing itself, so browsing the back door stays
     * on the back door's own read-only route and asks the Cabinet nothing
     * else. A lease this device holds is not "elsewhere" and needs no
     * recovery.
     */
    function heldByAnotherDevice(row) {
      const checkout = row && row.checkout;
      if (!checkout || !checkout.deviceId || !checkout.email) return false;
      const sync = window.ToolboxSync;
      if (!sync || typeof sync.getDeviceId !== 'function') return true;
      return String(checkout.deviceId) !== String(sync.getDeviceId());
    }

    function loadRoot() {
      if (!requireSync()) return;
      // The listing is drawn as soon as it arrives; who holds what follows
      // and repaints, so a slow or failed lease read never holds up the list.
      return window.ToolboxSync.exploreListFiles().then(function (data) {
        rootFiles = data && Array.isArray(data.files) ? data.files : [];
        // A job deleted or taken over from under the map must not stay on it.
        if (mapJobs) {
          mapJobs = null;
          if (mode === 'map') openMap();
        }
        paintTree();
        paintRoot();
      }).catch(function (err) {
        listEl.innerHTML = '';
        showNotice(errorText(err));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        paintRoot();
        scheduleTextSearch(false);
      });
      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') scheduleTextSearch(true);
      });
    }

    /**
     * Search the words inside the jobs, not just the card.
     *
     * The card catalogue above answers names, addresses and towns instantly,
     * on the device. "Half inch drywall crack" is not on any card: it is in
     * a pin description or a report paragraph. Those words live in each
     * job's text file on the server, and the server scans them. Each hit
     * says which section it came from -- a field observation, a measurement,
     * or a conclusion in the report -- because those are not the same kind
     * of statement.
     */
    const textSearchEl = app.querySelector('#explorer-textsearch');
    let textSearchTimer = 0;
    let textSearchSeq = 0;

    function scheduleTextSearch(now) {
      if (!textSearchEl) return;
      clearTimeout(textSearchTimer);
      const query = String(searchInput.value || '').trim();
      if (query.length < 3) {
        textSearchSeq += 1;
        textSearchEl.hidden = true;
        textSearchEl.innerHTML = '';
        return;
      }
      textSearchTimer = setTimeout(function () { runTextSearch(query); }, now ? 0 : 650);
    }

    function runTextSearch(query) {
      const sync = window.ToolboxSync || {};
      if (typeof sync.exploreSearchText !== 'function') return;
      const seq = ++textSearchSeq;
      textSearchEl.hidden = false;
      textSearchEl.innerHTML = '';
      const head = document.createElement('h2');
      head.className = 'explorer-textsearch__head';
      head.textContent = 'In the job text';
      textSearchEl.appendChild(head);
      const status = document.createElement('p');
      status.className = 'explorer-textsearch__status';
      status.textContent = 'Reading the job text…';
      textSearchEl.appendChild(status);
      sync.exploreSearchText(query).then(function (data) {
        if (seq !== textSearchSeq) return;
        paintTextResults(data, status);
      }).catch(function (err) {
        if (seq !== textSearchSeq) return;
        status.textContent = errorText(err);
      });
    }

    function paintTextResults(data, status) {
      if (!data) {
        status.textContent = 'Searching the job text needs the newer File Cabinet server.';
        return;
      }
      const results = Array.isArray(data.results) ? data.results : [];
      const parts = [];
      parts.push(results.length
        ? (results.length === 1 ? '1 job says this' : results.length + ' jobs say this')
        : 'No job says this');
      parts.push('searched ' + data.searched + ' of ' + data.total);
      status.textContent = parts.join(' · ') + '.';
      if (data.notYetRead) {
        const more = document.createElement('p');
        more.className = 'explorer-textsearch__status';
        more.textContent = data.notYetRead + (data.notYetRead === 1 ? ' job has' : ' jobs have') +
          ' not been read into the search yet. Each search reads more of them.';
        textSearchEl.appendChild(more);
      }
      // Read, but not all of it: a record the job names could not be read.
      // Said here so "no job says this" is never taken as the whole answer.
      const partial = Array.isArray(data.incomplete) ? data.incomplete : [];
      if (partial.length) {
        const part = document.createElement('p');
        part.className = 'explorer-textsearch__status explorer-textsearch__partial';
        part.textContent = (partial.length === 1 ? '1 job' : partial.length + ' jobs') +
          ' could only be partly read: ' + partial.map(function (job) {
            return (job.displayName || 'Customer File') + ' (' + (job.components || []).join(', ') + ')';
          }).join('; ') + '. They are read again on the next search.';
        textSearchEl.appendChild(part);
      }
      const words = Array.isArray(data.words) ? data.words : [];
      results.forEach(function (result) {
        const card = document.createElement('article');
        card.className = 'explorer-hit';
        card.dataset.id = result.id;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'explorer-row__key';
        open.textContent = result.displayName || result.propertyAddress || 'Customer File';
        open.addEventListener('click', function () {
          window.location.hash = '#/explore/' + encodeURIComponent(result.id);
        });
        card.appendChild(open);
        const where = [];
        if (result.inTrash) where.push('In File Cabinet Trash');
        if (result.propertyAddress) where.push(result.propertyAddress);
        if (result.fieldWorkDate) where.push(formatFieldDate(result.fieldWorkDate));
        if (where.length) {
          const meta = document.createElement('p');
          meta.className = 'explorer-row__label';
          meta.textContent = where.join(' · ');
          card.appendChild(meta);
        }
        (result.hits || []).forEach(function (hit) {
          const box = document.createElement('div');
          box.className = 'explorer-hit__line';
          const from = document.createElement('span');
          from.className = 'explorer-hit__from';
          from.textContent = hit.section;
          box.appendChild(from);
          const said = document.createElement('span');
          said.className = 'explorer-hit__text';
          said.innerHTML = markWords(hit.text, words);
          box.appendChild(said);
          card.appendChild(box);
        });
        textSearchEl.appendChild(card);
      });
    }

    function markWords(text, words) {
      let html = escapeHtml(text);
      words.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (word) {
        const safe = escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!safe) return;
        html = html.replace(new RegExp('(' + safe + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
      });
      return html;
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

    /** The month the tree has open, if any. */
    function inOpenMonth(row) {
      if (!openMonth) return true;
      const when = yearMonthOf(row);
      if (openMonth === 'undated') return !when;
      return !!when && when.monthKey === openMonth;
    }

    function filteredRoot() {
      const query = searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
      const files = rootFiles.filter(inOpenMonth).slice().sort(function (a, b) {
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

    /**
     * DESKTOP ONLY, decided by the room there is rather than by sniffing a
     * device. A phone keeps the list it already had.
     */
    function wideEnoughForPanes() {
      try {
        return window.matchMedia('(min-width: 1100px)').matches;
      } catch (_) {
        return false;
      }
    }

    /** Which job the details pane is describing, at the root. */
    let selectedId = '';
    const figureCache = Object.create(null);

    /**
     * The tree: the drawers and the years, as the drawings have it.
     *
     * Grouped by the field work date, which is the DECIDED filing rule --
     * the floor survey date, else the distress survey date, and no third
     * fallback (Tim, Oct 18, 2026). js/sync.js already computes it onto the
     * Cabinet index, so nothing new is derived here.
     *
     * WORKING AND FILED ARE NOT SPLIT. The drawings show two drawers and
     * Tim decided them, but what moves a job from one to the other is a
     * completed mark at Check In that nothing writes yet. Inventing one here
     * would be inventing a lifecycle, so the tree groups every job it can
     * see and the split is a filter waiting for that mark.
     */
    function yearMonthOf(row) {
      const text = String((row && row.fieldWorkDate) || '').trim();
      const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (day) {
        const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
        return {
          year: day[1],
          month: date.toLocaleDateString(undefined, { month: 'long' }),
          monthKey: day[1] + '-' + day[2],
        };
      }
      return null;
    }

    function treeGroups(files) {
      const years = Object.create(null);
      const order = [];
      const undated = [];
      files.forEach(function (row) {
        const when = yearMonthOf(row);
        if (!when) { undated.push(row); return; }
        if (!years[when.year]) {
          years[when.year] = { year: when.year, months: Object.create(null), order: [], count: 0 };
          order.push(when.year);
        }
        const year = years[when.year];
        if (!year.months[when.monthKey]) {
          year.months[when.monthKey] = { key: when.monthKey, label: when.month, rows: [] };
          year.order.push(when.monthKey);
        }
        year.months[when.monthKey].rows.push(row);
        year.count += 1;
      });
      order.sort(function (a, b) { return a < b ? 1 : -1; });
      order.forEach(function (key) {
        years[key].order.sort(function (a, b) { return a < b ? 1 : -1; });
      });
      return { years: order.map(function (key) { return years[key]; }), undated: undated };
    }

    /** Which month the list is narrowed to, or '' for everything. */
    let openMonth = '';
    const shutYears = Object.create(null);

    function paintTree() {
      if (!treeEl) return;
      if (inside || !wideEnoughForPanes() || !rootFiles.length) {
        treeEl.hidden = true;
        treeEl.innerHTML = '';
        return;
      }
      treeEl.hidden = false;
      treeEl.innerHTML = '';
      const head = document.createElement('p');
      head.className = 'explorer-tree__head';
      head.textContent = 'File Cabinet';
      treeEl.appendChild(head);

      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'explorer-tree__row' + (openMonth ? '' : ' is-on');
      all.innerHTML = '<span class="explorer-tree__label">All jobs</span>' +
        '<span class="explorer-tree__n">' + rootFiles.length + '</span>';
      all.addEventListener('click', function () {
        openMonth = '';
        paintTree();
        paintRoot();
      });
      treeEl.appendChild(all);

      const groups = treeGroups(rootFiles);
      groups.years.forEach(function (year) {
        const shut = !!shutYears[year.year];
        const yearRow = document.createElement('button');
        yearRow.type = 'button';
        yearRow.className = 'explorer-tree__row explorer-tree__row--l2';
        yearRow.innerHTML = '<span class="explorer-tree__car">' + (shut ? '▸' : '▾') + '</span>' +
          '<span class="explorer-tree__label">' + escapeHtml(year.year) + '</span>' +
          '<span class="explorer-tree__n">' + year.count + '</span>';
        yearRow.addEventListener('click', function () {
          shutYears[year.year] = !shutYears[year.year];
          paintTree();
        });
        treeEl.appendChild(yearRow);
        if (shut) return;
        year.order.forEach(function (key) {
          const month = year.months[key];
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'explorer-tree__row explorer-tree__row--l3' +
            (openMonth === key ? ' is-on' : '');
          row.innerHTML = '<span class="explorer-tree__label">' + escapeHtml(month.label) + '</span>' +
            '<span class="explorer-tree__n">' + month.rows.length + '</span>';
          row.addEventListener('click', function () {
            openMonth = openMonth === key ? '' : key;
            paintTree();
            paintRoot();
          });
          treeEl.appendChild(row);
        });
      });

      if (groups.undated.length) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'explorer-tree__row explorer-tree__row--l2' +
          (openMonth === 'undated' ? ' is-on' : '');
        // Said plainly rather than filed under a date it does not have.
        row.innerHTML = '<span class="explorer-tree__label">No survey date</span>' +
          '<span class="explorer-tree__n">' + groups.undated.length + '</span>';
        row.addEventListener('click', function () {
          openMonth = openMonth === 'undated' ? '' : 'undated';
          paintTree();
          paintRoot();
        });
        treeEl.appendChild(row);
      }
    }

    /**
     * The details pane: the figures the survey already knows, so a job can be
     * judged without opening it. Computed, never typed.
     */
    function paintDetails() {
      if (!detailsEl) return;
      if (inside || !wideEnoughForPanes() || !selectedId) {
        detailsEl.hidden = true;
        detailsEl.innerHTML = '';
        return;
      }
      const row = rootFiles.filter(function (item) { return item && item.id === selectedId; })[0];
      if (!row) {
        detailsEl.hidden = true;
        detailsEl.innerHTML = '';
        return;
      }
      detailsEl.hidden = false;
      detailsEl.innerHTML = '';
      const name = document.createElement('h2');
      name.className = 'explorer-details__name';
      name.textContent = row.displayName || row.propertyAddress || 'Customer File';
      detailsEl.appendChild(name);
      if (row.propertyAddress) {
        const addr = document.createElement('p');
        addr.className = 'explorer-details__addr';
        addr.textContent = row.propertyAddress;
        detailsEl.appendChild(addr);
      }
      const when = usefulDate(row);
      if (when) {
        const date = document.createElement('p');
        date.className = 'explorer-details__addr';
        date.textContent = 'Field work ' + when;
        detailsEl.appendChild(date);
      }
      if (row.deletedAt) {
        const trashed = document.createElement('p');
        trashed.className = 'explorer-details__addr';
        trashed.textContent = 'In File Cabinet Trash';
        detailsEl.appendChild(trashed);
      }

      const figures = figureCache[selectedId];
      if (figures === undefined) {
        const wait = document.createElement('p');
        wait.className = 'explorer-details__wait';
        wait.textContent = 'Reading the survey…';
        detailsEl.appendChild(wait);
        loadFigures(selectedId);
      } else if (figures === null) {
        const none = document.createElement('p');
        none.className = 'explorer-details__wait';
        none.textContent = 'The stored surveys for this job could not be read.';
        detailsEl.appendChild(none);
      } else if (!figures.length) {
        const none = document.createElement('p');
        none.className = 'explorer-details__wait';
        none.textContent = 'No surveys are stored for this job yet.';
        detailsEl.appendChild(none);
      } else {
        const dl = document.createElement('dl');
        dl.className = 'explorer-facts__list';
        figures.forEach(function (figure) {
          const dt = document.createElement('dt');
          dt.textContent = figure.label;
          const dd = document.createElement('dd');
          dd.textContent = figure.value;
          dl.appendChild(dt);
          dl.appendChild(dd);
        });
        detailsEl.appendChild(dl);
      }

      const acts = document.createElement('div');
      acts.className = 'explorer-details__acts';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--secondary';
      open.textContent = 'Open';
      open.addEventListener('click', function () {
        window.location.hash = '#/explore/' + encodeURIComponent(selectedId);
      });
      acts.appendChild(open);
      detailsEl.appendChild(acts);
    }

    /**
     * Read one job's components for the pane, once, on a deliberate
     * selection. Through the back door's own route only.
     */
    function loadFigures(id) {
      const sync = window.ToolboxSync || {};
      const Summary = window.ToolboxExplorerSummary;
      if (typeof sync.exploreReadComponent !== 'function' || !Summary) {
        figureCache[id] = null;
        return;
      }
      figureCache[id] = undefined;
      const found = {};
      let read = 0;
      COMPONENT_READS.reduce(function (chain, name) {
        return chain.then(function () {
          return sync.exploreReadComponent(id, name).then(function (result) {
            if (result && result.ok) { found[name] = result.payload; read += 1; }
          }).catch(function () {});
        });
      }, Promise.resolve()).then(function () {
        figureCache[id] = read ? Summary.jobFigures(found) : [];
        if (selectedId === id) paintDetails();
      }).catch(function () {
        figureCache[id] = null;
        if (selectedId === id) paintDetails();
      });
    }

    function selectRoot(id) {
      if (!wideEnoughForPanes()) return;
      selectedId = id;
      listEl.querySelectorAll('.explorer-row').forEach(function (node) {
        node.classList.toggle('is-selected', node.dataset.id === id);
      });
      paintDetails();
    }

    // ---------------------------------------------------------------- map

    /**
     * The same jobs on a map. Pan or zoom to an area and the jobs in it are
     * listed underneath; a year filter narrows them by the filing date.
     *
     * A job is placed only where it carries coordinates. One without them is
     * not put anywhere near where it might be: it is counted and listed
     * under the map as having no location.
     */
    let mode = 'list';
    let mapView = null;
    let mapJobs = null;
    let mapPartial = false;
    let mapYear = 'all';
    let mapPicked = null;
    const mapEl = app.querySelector('#explorer-mapview');

    app.querySelectorAll('.explorer-mode__btn').forEach(function (button) {
      button.addEventListener('click', function () { setMode(button.dataset.mode); });
    });

    function setMode(next) {
      if (next === mode || !mapEl) return;
      mode = next;
      app.querySelectorAll('.explorer-mode__btn').forEach(function (button) {
        const on = button.dataset.mode === mode;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      listEl.hidden = mode === 'map';
      mapEl.hidden = mode !== 'map';
      if (mode === 'map') openMap();
    }

    function openMap() {
      if (mapJobs) { paintMap(true); return; }
      if (!mapView) mapEl.innerHTML = '<p class="cabinet-empty">Finding where the jobs are…</p>';
      const sync = window.ToolboxSync || {};
      if (typeof sync.exploreMapJobs !== 'function' || !window.ToolboxExplorerMap) {
        mapEl.innerHTML = '<p class="cabinet-empty">The map is unavailable.</p>';
        return;
      }
      sync.exploreMapJobs().then(function (data) {
        mapJobs = data && Array.isArray(data.jobs) ? data.jobs : [];
        mapPartial = !!(data && data.partial);
        if (mode === 'map') paintMap(!mapView);
      }).catch(function (err) {
        mapEl.innerHTML = '';
        showNotice(errorText(err));
      });
    }

    function yearOfJob(job) {
      const match = /^(\d{4})-/.exec(String(job && job.fieldWorkDate || ''));
      return match ? match[1] : '';
    }

    /** The map's jobs, narrowed by the search box, the tree and the year. */
    function mapCandidates() {
      const allowed = Object.create(null);
      filteredRoot().forEach(function (row) { if (row && row.id) allowed[row.id] = row; });
      return (mapJobs || []).filter(function (job) {
        if (!allowed[job.id]) return false;
        if (mapYear !== 'all' && yearOfJob(job) !== mapYear) return false;
        return true;
      });
    }

    /** The full listing row for a job when we have it, so Take Over and Delete stay. */
    function rowForJob(job) {
      const row = rootFiles.filter(function (item) { return item && item.id === job.id; })[0];
      return row || Object.assign({ key: 'cf/' + job.id + '/index.json' }, job);
    }

    function paintMap(refit) {
      if (!mapEl) return;
      const MapApi = window.ToolboxExplorerMap;
      if (!mapView) {
        mapEl.innerHTML = '';
        const years = document.createElement('div');
        years.className = 'explorer-mapyears';
        years.id = 'explorer-mapyears';
        mapEl.appendChild(years);
        const host = document.createElement('div');
        host.className = 'explorer-maphost';
        mapEl.appendChild(host);
        const below = document.createElement('div');
        below.className = 'explorer-mapbelow';
        below.id = 'explorer-mapbelow';
        mapEl.appendChild(below);
        mapView = MapApi.create(host, {
          onView: function (inView) {
            if (!mapPicked) paintMapList(inView, false);
          },
          onPick: function (picked) {
            mapPicked = picked;
            paintMapList(picked, true);
          },
        });
      }
      paintYears();
      mapPicked = null;
      mapView.setJobs(mapCandidates(), refit);
    }

    function paintYears() {
      const box = mapEl.querySelector('#explorer-mapyears');
      if (!box) return;
      box.innerHTML = '';
      const years = Object.create(null);
      (mapJobs || []).forEach(function (job) {
        const year = yearOfJob(job);
        if (year) years[year] = 1;
      });
      const order = ['all'].concat(Object.keys(years).sort().reverse());
      if (mapYear !== 'all' && !years[mapYear]) mapYear = 'all';
      order.forEach(function (year) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'explorer-mapyears__chip' + (year === mapYear ? ' is-on' : '');
        chip.dataset.year = year;
        chip.textContent = year === 'all' ? 'All years' : year;
        chip.setAttribute('aria-pressed', year === mapYear ? 'true' : 'false');
        chip.addEventListener('click', function () {
          mapYear = year;
          paintMap(true);
        });
        box.appendChild(chip);
      });
    }

    function paintMapList(jobs, picked) {
      const below = mapEl.querySelector('#explorer-mapbelow');
      if (!below) return;
      below.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'explorer-mapbelow__head';
      const title = document.createElement('h2');
      title.className = 'explorer-mapbelow__title';
      const count = jobs.length === 1 ? '1 job' : jobs.length + ' jobs';
      title.textContent = picked ? count + ' at this spot' : count + ' in this view';
      head.appendChild(title);
      if (picked) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'btn btn--ghost';
        back.textContent = 'Everything in view';
        back.addEventListener('click', function () {
          mapPicked = null;
          paintMapList(mapView.jobsInView(), false);
        });
        head.appendChild(back);
      }
      below.appendChild(head);
      const shown = jobs.slice().sort(function (a, b) {
        const da = String(a.fieldWorkDate || '');
        const db = String(b.fieldWorkDate || '');
        if (da !== db) return da < db ? 1 : -1;
        return String(a.displayName || '') < String(b.displayName || '') ? -1 : 1;
      });
      const LIMIT = 40;
      shown.slice(0, LIMIT).forEach(function (job) {
        below.appendChild(rootRow(rowForJob(job)));
      });
      if (shown.length > LIMIT) {
        const more = document.createElement('p');
        more.className = 'explorer-mapbelow__note';
        more.textContent = 'And ' + (shown.length - LIMIT) + ' more in this view. Zooming in narrows the list.';
        below.appendChild(more);
      }

      // Said, not hidden, and not guessed onto the map.
      const unplaced = mapCandidates().filter(function (job) {
        return !window.ToolboxExplorerMap.hasPlace(job);
      });
      if (unplaced.length) {
        const box = document.createElement('details');
        box.className = 'explorer-mapbelow__unplaced';
        const summary = document.createElement('summary');
        summary.textContent = (unplaced.length === 1 ? '1 job has' : unplaced.length + ' jobs have') +
          ' no location on file and ' + (unplaced.length === 1 ? 'is' : 'are') + ' not on the map';
        box.appendChild(summary);
        if (mapPartial) {
          const why = document.createElement('p');
          why.className = 'explorer-mapbelow__note';
          why.textContent = 'This File Cabinet server places only jobs synced since locations were added to the index.';
          box.appendChild(why);
        }
        unplaced.forEach(function (job) {
          box.appendChild(rootRow(rowForJob(job)));
        });
        below.appendChild(box);
      }
    }

    function paintRoot() {
      if (mode === 'map' && mapView) paintMap(false);
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
      // A phone has no tree, so the list carries the years and months
      // itself, newest first -- the same filing the desktop tree shows.
      if (!wideEnoughForPanes()) {
        paintRootByMonth(files);
        return;
      }
      files.forEach(function (row) {
        listEl.appendChild(rootRow(row));
      });
      if (selectedId) selectRoot(selectedId);
    }

    function paintRootByMonth(files) {
      const groups = treeGroups(files);
      groups.years.forEach(function (year) {
        const head = document.createElement('h2');
        head.className = 'explorer-year';
        const label = document.createElement('span');
        label.className = 'explorer-year__label';
        label.textContent = year.year;
        const count = document.createElement('span');
        count.className = 'explorer-year__n';
        count.textContent = year.count === 1 ? '1 job' : year.count + ' jobs';
        head.appendChild(label);
        head.appendChild(count);
        listEl.appendChild(head);
        year.order.forEach(function (key) {
          const month = year.months[key];
          const title = document.createElement('h3');
          title.className = 'explorer-month';
          title.textContent = month.label;
          listEl.appendChild(title);
          newestFirst(month.rows).forEach(function (row) {
            listEl.appendChild(rootRow(row));
          });
        });
      });
      if (groups.undated.length) {
        const head = document.createElement('h2');
        head.className = 'explorer-year';
        const label = document.createElement('span');
        label.className = 'explorer-year__label';
        // Said plainly rather than filed under a date it does not have.
        label.textContent = 'No survey date';
        const count = document.createElement('span');
        count.className = 'explorer-year__n';
        count.textContent = groups.undated.length === 1 ? '1 job' : groups.undated.length + ' jobs';
        head.appendChild(label);
        head.appendChild(count);
        listEl.appendChild(head);
        groups.undated.forEach(function (row) {
          listEl.appendChild(rootRow(row));
        });
      }
    }

    /** Within a month, the latest field work first; a tie keeps name order. */
    function newestFirst(rows) {
      return rows.slice().sort(function (a, b) {
        const da = String(a && a.fieldWorkDate || '');
        const db = String(b && b.fieldWorkDate || '');
        if (da !== db) return da < db ? 1 : -1;
        return 0;
      });
    }

    function rootRow(row) {
      const article = document.createElement('article');
      article.className = 'explorer-row';
      const key = row && row.key ? row.key : '';
      article.dataset.key = key;
      if (row && row.id) article.dataset.id = row.id;
      // On a desktop, picking a row shows it on the right the way a file
      // explorer does; Open still opens it. On a phone there is no pane to
      // fill, so this does nothing and the tap opens as it always did.
      if (row && row.id) {
        article.addEventListener('click', function () { selectRoot(row.id); });
      }
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
      // "4925 Edwards Dr NE, Albuquerque" -- the street and the town, which
      // is how a job is remembered. The whole address is in the details.
      const where = addressParts(row && row.propertyAddress);
      if (named && row.propertyAddress) {
        secondary.push(where.town ? where.street + ', ' + where.town : row.propertyAddress);
      } else if (where.town) {
        secondary.push(where.town);
      }
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

      // The person-arranged copy, from the list, without walking in first.
      if (row && row.id) {
        const take = document.createElement('button');
        take.type = 'button';
        take.className = 'btn btn--secondary explorer-download-job';
        take.textContent = 'Download job';
        take.addEventListener('click', function (event) {
          event.stopPropagation();
          downloadJobFromList(row, take);
        });
        actions.appendChild(take);
      }

      const id = row && row.id;
      const sync = window.ToolboxSync || {};
      const confirmAction = (window.ToolboxApp && window.ToolboxApp.confirmAction) || null;
      const name = (row && row.displayName) || (row && row.propertyAddress) || 'Customer File';

      // Take Over lives here and nowhere else (Tim, Oct 22, 2026: "take over
      // should only work from explorer"). It is the back-door recovery for a
      // job whose holder cannot hand it back -- a device lost, broken, or
      // wiped -- so it belongs with the other back-door tools, not beside
      // Check Out where it could be pressed in the ordinary run of work.
      if (id && heldByAnotherDevice(row) &&
          typeof sync.takeOverCustomerFile === 'function' && confirmAction) {
        const take = document.createElement('button');
        take.type = 'button';
        take.className = 'btn btn--secondary explorer-take-over';
        take.textContent = 'Take Over';
        take.addEventListener('click', function () {
          const who = (row.checkout && row.checkout.email) ? row.checkout.email : 'another device';
          confirmAction({
            title: 'Take over this Customer File?',
            message: name + ' is checked out by ' + who + '. Taking it over moves the working copy ' +
              'to this device. If that device holds work it never synced, the work stays on it but ' +
              'can no longer be sent — its copy becomes read-only.',
            cancelLabel: 'Cancel',
            confirmLabel: 'Take Over',
          }).then(function (confirmed) {
            if (!confirmed) return;
            take.disabled = true;
            take.textContent = 'Taking over…';
            return sync.takeOverCustomerFile(id).then(function () {
              showNotice(name + ' was taken over and is now on this device.');
              return loadRoot();
            }).catch(function (err) {
              take.disabled = false;
              take.textContent = 'Take Over';
              showNotice((err && err.message) || 'Take Over failed.');
            });
          });
        });
        actions.appendChild(take);
      }

      // Delete, from here. Tim: "you do not get to decide whether or not I
      // can delete something from Explorer ... this is my app."
      if (id && typeof sync.destroyCabinetCustomerFile === 'function' && confirmAction) {
        const kill = document.createElement('button');
        kill.type = 'button';
        kill.className = 'btn btn--danger explorer-delete';
        kill.textContent = 'Delete';
        kill.addEventListener('click', function () {
          confirmAction({
            title: 'Permanently delete this Customer File?',
            message: name + ' will be destroyed on the server, including its plans and ' +
              'photographs. This cannot be undone.',
            cancelLabel: 'Cancel',
            confirmLabel: 'Delete permanently',
          }).then(function (confirmed) {
            if (!confirmed) return;
            kill.disabled = true;
            kill.textContent = 'Deleting…';
            return sync.destroyCabinetCustomerFile(id).then(function () {
              showNotice(name + ' was permanently deleted.');
              return loadRoot();
            }).catch(function (err) {
              kill.disabled = false;
              kill.textContent = 'Delete';
              showNotice((err && err.message) || 'Could not delete that Customer File.');
            });
          });
        });
        actions.appendChild(kill);
      }

      article.appendChild(actions);
      return article;
    }

    let jobName = '';
    let jobAddress = '';
    let jobFieldDate = '';
    /** Everything the Cabinet holds for this job, and which folder is open. */
    let jobObjects = [];
    let jobObjectsFor = '';
    let openFolder = '';
    /**
     * The parsed records, read once per job so the screen can say what the
     * job HOLDS instead of printing how it is written down. Read through the
     * back door's own route only -- exploreReadComponent does not fall back
     * to the working sync API the way a download does.
     */
    let jobComponents = {};
    let jobComponentsFor = '';
    let jobComponentsUnread = [];

    const COMPONENT_READS = ['customer', 'plans', 'floor', 'distress', 'report', 'diagnostics'];

    function readJobComponents(id) {
      if (jobComponentsFor === id) return Promise.resolve(jobComponents);
      const sync = window.ToolboxSync || {};
      if (typeof sync.exploreReadComponent !== 'function') {
        jobComponents = {};
        jobComponentsFor = id;
        return Promise.resolve(jobComponents);
      }
      const found = {};
      const unread = [];
      return COMPONENT_READS.reduce(function (chain, name) {
        return chain.then(function () {
          return sync.exploreReadComponent(id, name).then(function (result) {
            if (result && result.ok) { found[name] = result.payload; return; }
            // Stored but unreadable is worth saying; absent is not. They are
            // opposite facts and the copy must not print one for the other.
            if (result && result.reason === 'unreadable') unread.push(name);
          }).catch(function () {
            unread.push(name);
          });
        });
      }, Promise.resolve()).then(function () {
        jobComponents = found;
        jobComponentsUnread = unread;
        jobComponentsFor = id;
        return found;
      });
    }

    function showCustomerIdentity(data) {
      const name = data && data.displayName;
      if (name) {
        titleEl.textContent = name;
        jobName = name;
      }
      const bits = [];
      if (data && data.propertyAddress) {
        bits.push(data.propertyAddress);
        jobAddress = data.propertyAddress;
      }
      const date = usefulDate(data);
      if (date) bits.push(date);
      // The Cabinet index already carries the decided filing date, so the
      // copy can be named for it even before the components are read.
      if (data && data.fieldWorkDate) jobFieldDate = data.fieldWorkDate;
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

    /**
     * What this job records, as figures: levels, readings, pins,
     * photographs, the survey date, the elevation range. The drawings' details
     * pane, computed from the survey rather than typed anywhere.
     */
    function jobSummaryPanel(id) {
      const Summary = window.ToolboxExplorerSummary;
      if (!Summary) return null;
      const figures = Summary.jobFigures(jobComponents);
      if (!figures.length && !jobComponentsUnread.length) return null;
      const box = document.createElement('section');
      box.className = 'explorer-facts';
      box.id = 'explorer-facts';
      const heading = document.createElement('h2');
      heading.className = 'explorer-facts__head';
      heading.textContent = 'What this job records';
      box.appendChild(heading);
      if (figures.length) {
        const dl = document.createElement('dl');
        dl.className = 'explorer-facts__list';
        figures.forEach(function (figure) {
          const dt = document.createElement('dt');
          dt.textContent = figure.label;
          const dd = document.createElement('dd');
          dd.textContent = figure.value;
          dl.appendChild(dt);
          dl.appendChild(dd);
        });
        box.appendChild(dl);
      }
      if (jobComponentsUnread.length) {
        const note = document.createElement('p');
        note.className = 'explorer-facts__note';
        note.textContent = 'Stored but could not be read: ' +
          jobComponentsUnread.join(', ') + '. The figures above leave them out.';
        box.appendChild(note);
      }
      return box;
    }

    /** What a component says about itself, under its folder. */
    function folderSummaryFor(groupId) {
      const Summary = window.ToolboxExplorerSummary;
      if (!Summary) return null;
      const byGroup = {
        customer: 'customer',
        plans: 'plans',
        floor: 'floor',
        distress: 'distress',
        report: 'report',
        diagnostics: 'diagnostics',
      };
      const name = byGroup[groupId];
      if (!name) return null;
      const payload = jobComponents[name];
      if (!payload) return null;
      return Summary.componentSummary(name, payload, jobComponents);
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
      // The job text is derived from the records; it has its own row below,
      // built fresh when asked for, rather than sitting among the files as
      // though it were one of them.
      const objects = (Array.isArray(data.objects) ? data.objects : []).filter(function (row) {
        return String(row && row.key || '') !== 'cf/' + id + '/search.txt';
      });
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
      jobObjectsFor = id;
      openFolder = '';
      paintJob(id);
      // The listing is drawn at once; what the job HOLDS follows and
      // repaints, so a slow component read never holds up the folders.
      readJobComponents(id).then(function () {
        if (jobComponentsFor === id) paintJob(id);
      }).catch(function () {});
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
        const facts = jobSummaryPanel(id);
        if (facts) listEl.appendChild(facts);
        let folders = 0;
        GROUPS.forEach(function (group) {
          const rows = buckets[group.id];
          if (!rows || !rows.length) return;
          folders += 1;
          listEl.appendChild(folderRow(id, group, rows));
        });
        // A job the Cabinet holds nothing for but its own record files: say
        // so, rather than showing one closed line and no explanation.
        if (!folders) {
          const empty = document.createElement('p');
          empty.className = 'cabinet-empty';
          empty.textContent = 'No pictures, plans or surveys are stored for this ' +
            'Customer File yet.';
          listEl.appendChild(empty);
        }
        const words = jobTextRow(id);
        if (words) listEl.appendChild(words);
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
      // Tim, on Open printing the stored record: "who in the world is this
      // helpful?" So the folder leads with what its component holds --
      // levels, readings, pins, dates -- and the record itself stays below,
      // downloadable, behind Technical details.
      const told = folderSummaryFor(group.id);
      if (told) section.appendChild(summaryBlock(told));
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

    /** A headline, its figures and its honest notes, as one block. */
    function summaryBlock(told) {
      const box = document.createElement('div');
      box.className = 'explorer-told';
      const head = document.createElement('p');
      head.className = 'explorer-told__head';
      head.textContent = told.headline;
      box.appendChild(head);
      if (told.figures && told.figures.length) {
        const dl = document.createElement('dl');
        dl.className = 'explorer-told__list';
        told.figures.forEach(function (figure) {
          const dt = document.createElement('dt');
          dt.textContent = figure.label;
          const dd = document.createElement('dd');
          dd.textContent = figure.value;
          dl.appendChild(dt);
          dl.appendChild(dd);
        });
        box.appendChild(dl);
      }
      (told.notes || []).forEach(function (note) {
        const p = document.createElement('p');
        p.className = 'explorer-told__note';
        p.textContent = note;
        box.appendChild(p);
      });
      return box;
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
      // "Floor Survey · 2 levels · Main Level 48, Basement 31" tells him
      // whether to walk in. "3 files" does not.
      const told = folderSummaryFor(group.id);
      if (told && told.headline) {
        const says = document.createElement('span');
        says.className = 'explorer-folder__says';
        says.textContent = told.headline;
        text.appendChild(says);
      }
      open.appendChild(text);
      const chev = document.createElement('span');
      chev.className = 'explorer-folder__chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '›';
      open.appendChild(chev);
      article.appendChild(open);
      return article;
    }

    /**
     * The job's words as plain text -- the customer, the pins, the photographs,
     * the report -- under headings that say what kind of statement each is.
     * Built on the server from the records when asked for; it is not one of
     * the records and nothing reads it back.
     */
    function jobTextRow(id) {
      const sync = window.ToolboxSync || {};
      if (typeof sync.exploreFetchJobText !== 'function') return null;
      const article = document.createElement('article');
      article.className = 'explorer-row explorer-row--text';
      article.dataset.purpose = 'job-text';
      const main = document.createElement('div');
      main.className = 'explorer-row__main';
      const title = document.createElement('strong');
      title.className = 'explorer-row__title';
      title.textContent = 'Job text';
      main.appendChild(title);
      const note = document.createElement('p');
      note.className = 'explorer-row__label';
      note.textContent = 'Everything this job says, as plain text: the customer, pins, ' +
        'photographs and the report, each under its own heading.';
      main.appendChild(note);
      article.appendChild(main);
      const actions = document.createElement('div');
      actions.className = 'explorer-row__actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--secondary';
      open.textContent = 'Open';
      open.addEventListener('click', function () {
        openJobText(id, open);
      });
      actions.appendChild(open);
      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'btn btn--secondary';
      download.textContent = 'Download';
      download.addEventListener('click', function () {
        showNotice('');
        const previous = download.textContent;
        download.disabled = true;
        const stem = slugWords(jobName, 48) || ('cf-' + id);
        saveWhereChosen(stem + '-job-text.txt', 'text/plain', function () {
          return sync.exploreFetchJobText(id).then(function (response) {
            if (!response) throw new Error('unavailable');
            return response;
          });
        }).then(function (result) {
          showNotice(savedNotice(result));
        }).catch(function (err) {
          showNotice(err && err.message === 'unavailable'
            ? 'The job text needs the newer File Cabinet server.'
            : errorText(err));
        }).then(function () {
          download.disabled = false;
          download.textContent = previous;
        });
      });
      actions.appendChild(download);
      article.appendChild(actions);
      return article;
    }

    function openJobText(id, button) {
      showNotice('');
      revokePreview();
      preview.hidden = false;
      preview.innerHTML = '<p class="explorer-preview__status">Opening Job text…</p>';
      button.disabled = true;
      window.ToolboxSync.exploreFetchJobText(id).then(function (response) {
        if (!response) throw new Error('unavailable');
        return response.text();
      }).then(function (text) {
        preview.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'explorer-preview__head';
        const title = document.createElement('h2');
        title.textContent = 'Job text';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn btn--ghost';
        close.textContent = 'Close';
        close.addEventListener('click', function () {
          preview.hidden = true;
          preview.innerHTML = '';
        });
        head.appendChild(title);
        head.appendChild(close);
        preview.appendChild(head);
        const pre = document.createElement('pre');
        pre.className = 'explorer-preview__text';
        pre.textContent = text;
        preview.appendChild(pre);
        preview.scrollIntoView({ block: 'nearest' });
      }).catch(function (err) {
        preview.hidden = true;
        preview.innerHTML = '';
        showNotice(err && err.message === 'unavailable'
          ? 'The job text needs the newer File Cabinet server.'
          : errorText(err));
      }).then(function () {
        button.disabled = false;
      });
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
      // The server's byte-for-byte copy: every object under the key it is
      // actually stored at. Download job copy above is the one arranged for
      // a person; this one is the one that reproduces the bucket.
      if (window.ToolboxSync && typeof window.ToolboxSync.exploreFetchArchive === 'function') {
        const rawRow = document.createElement('div');
        rawRow.className = 'explorer-records__raw';
        const rawText = document.createElement('p');
        rawText.className = 'explorer-records__note';
        rawText.textContent = 'A copy with every object under its real storage key, ' +
          'arranged the way the server holds it rather than the way a person reads it.';
        rawRow.appendChild(rawText);
        const rawBtn = document.createElement('button');
        rawBtn.type = 'button';
        rawBtn.className = 'btn btn--secondary explorer-raw-zip';
        rawBtn.textContent = 'Download raw server copy';
        rawBtn.addEventListener('click', function () {
          downloadRawArchive(id, rawBtn, showNotice);
        });
        rawRow.appendChild(rawBtn);
        box.appendChild(rawRow);
      }
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

    /**
     * What a tile is drawn from: the server's small copy when it has one,
     * the stored original when it does not. A folder of 38 photographs was
     * 70-100 MB of originals to draw tiles 320 pixels across; the small copy
     * is a few KB each. The original stays the fallback, so a Worker without
     * the route or without Images still draws every tile.
     */
    function tileSource(id, row) {
      const sync = window.ToolboxSync;
      const key = String(row && row.key || '');
      const mediaId = key.indexOf('media/') === 0 ? key.slice(6) : '';
      if (!mediaId || typeof sync.exploreFetchThumb !== 'function') {
        return sync.exploreFetchObject(id, key);
      }
      return sync.exploreFetchThumb(mediaId, THUMB_EDGE).then(function (small) {
        return small || sync.exploreFetchObject(id, key);
      });
    }

    function watchTile(id, row, img, tile) {
      let started = false;
      const load = function () {
        if (started) return;
        started = true;
        tileSource(id, row)
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
     * The extension for anything, not just a picture.
     *
     * Media keys carry none -- `media/fsrec_main` is a PDF and says so only
     * in its content type -- so a copy named from the Cabinet's own label
     * came out as "Floor Survey recovery PDF — Main Level" with nothing on
     * the end, which no operating system will open on a double click. The
     * stored content type is what knows, and the key's own extension is the
     * fallback for a `cf/` file that has one.
     */
    function anyExtensionFor(row) {
      const type = String((row && row.contentType) || '').toLowerCase().split(';')[0].trim();
      const known = {
        'application/pdf': '.pdf',
        'application/json': '.json',
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/heic': '.heic',
        'image/heif': '.heif',
        'image/bmp': '.bmp',
        'image/svg+xml': '.svg',
        'text/plain': '.txt',
        'text/csv': '.csv',
      };
      if (known[type]) return known[type];
      const leaf = downloadName(row && row.key);
      const dot = leaf.lastIndexOf('.');
      return dot > 0 ? leaf.slice(dot) : '';
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

    /** Which component a stored record key is, or '' when it is not one. */
    function componentNameFor(id, key) {
      const prefix = 'cf/' + id + '/';
      const text = String(key || '');
      if (text.indexOf(prefix) !== 0) return '';
      const leaf = text.slice(prefix.length);
      if (!/\.json$/i.test(leaf)) return '';
      const name = leaf.slice(0, -'.json'.length);
      if (name === 'index') return 'index';
      if (name === 'trash') return 'trash';
      return COMPONENT_READS.indexOf(name) !== -1 ? name : '';
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
          const text = new TextDecoder().decode(loaded.buffer);
          /**
           * One of Toolbox's own records opens as what it HOLDS.
           *
           * Tim, after pressing Open on a Floor Survey and getting the stored
           * record: "who in the world is this helpful?" So the summary leads,
           * and the record syntax goes behind one closed line below it. The
           * bytes are not hidden and Download is untouched -- the Cabinet is
           * the repository and everything in it stays reachable.
           */
          const component = componentNameFor(id, key);
          const Summary = window.ToolboxExplorerSummary;
          let told = null;
          if (component && Summary) {
            try {
              told = Summary.componentSummary(component, JSON.parse(text), jobComponents);
            } catch (_) { told = null; }
          }
          if (told) panel.appendChild(summaryBlock(told));
          const limit = 512 * 1024;
          const shown = text.length > limit ? text.slice(0, limit) : text;
          const pre = document.createElement('pre');
          pre.className = 'explorer-preview__text';
          pre.textContent = shown;
          if (told) {
            const raw = document.createElement('details');
            raw.className = 'explorer-preview__raw';
            const summaryEl = document.createElement('summary');
            summaryEl.textContent = 'Technical details';
            raw.appendChild(summaryEl);
            raw.appendChild(pre);
            panel.appendChild(raw);
          } else {
            panel.appendChild(pre);
          }
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
        return window.ToolboxSync.exploreFetchObject(id, key);
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

    /**
     * THE RECOVERY COPY, arranged for a person.
     *
     * Built here rather than on the Worker, for two reasons that both matter.
     * It can say how far it has got -- "Packing 34 of 118" -- where one
     * server request can only sit there; and a job with seventy photographs
     * is tens of megabytes, which is a Worker's memory rather than a
     * browser's.
     *
     * The server's own ZIP is NOT removed. It stays as the raw copy, under
     * Technical details, because it is the one that reproduces the bucket key
     * for key and that is what some kinds of recovery need.
     */
    function downloadArchive(id, button, notify, whenDone) {
      notify('');
      const previous = button.textContent;
      const Archive = window.ToolboxExplorerArchive;
      const finished = typeof whenDone === 'function' ? whenDone : function () {};
      if (!Archive || !window.JSZip) {
        // Rather than fail, fall back to the route that does not need either.
        downloadRawArchive(id, button, notify);
        finished();
        return;
      }
      button.disabled = true;
      button.textContent = canChooseWhere() ? 'Where to?' : 'Reading…';
      let built = null;
      saveWhereChosen(plannedArchiveName(id), 'application/zip', function () {
        button.textContent = 'Reading…';
        // The pin, the room and the day the shutter was pressed live in
        // distress.json, and naming a photograph needs them in hand. Walking
        // into a folder loads them; taking the whole job copy may not have,
        // so it is asked for here -- without it every picture came out named
        // "media_ph_one", which is the storage key the copy exists to get
        // away from.
        return Promise.all([ensureJobObjects(id), readJobComponents(id), readPhotoFacts(id)]).then(function () {
          return Archive.buildJobArchive({
            id: id,
            name: jobName,
            address: jobAddress,
            objects: jobObjects,
            components: jobComponents,
            unreadable: jobComponentsUnread.slice(),
            fallbackDate: jobFieldDate,
            fetchObject: function (fileId, key) {
              return window.ToolboxSync.exploreFetchObject(fileId, key).then(responseBlob);
            },
            nameFor: archiveNameFor,
            isRecord: function (row) { return isRecordFile(row, id); },
            onProgress: function (step) {
              button.textContent = step.total
                ? 'Packing ' + step.done + ' of ' + step.total + '…'
                : 'Packing…';
            },
          });
        }).then(function (result) {
          built = result;
          button.textContent = 'Saving…';
          return result.blob;
        });
      }).then(function (result) {
        button.disabled = false;
        button.textContent = previous;
        finished();
        if (result.cancelled) {
          notify('');
          return;
        }
        // Truthfully: what went in, and what could not be read.
        const parts = [];
        if (built) {
          parts.push(built.written + ' of ' + built.total +
            (built.total === 1 ? ' stored file' : ' stored files') + ' packed');
          if (built.failed.length) {
            parts.push(built.failed.length +
              (built.failed.length === 1 ? ' could not be read: ' : ' could not be read: ') +
              built.failed.slice(0, 3).join(', ') +
              (built.failed.length > 3 ? '…' : ''));
          }
        }
        parts.push(savedNotice(result));
        notify(parts.join('. '));
      }).catch(function (err) {
        button.disabled = false;
        button.textContent = previous;
        finished();
        notify(errorText(err));
      });
    }

    /**
     * What the Cabinet holds for a job, for a copy asked for from the list.
     * Inside a job this is already in hand; from the list it is read once,
     * through the back door's own listing, and labelled the same way.
     */
    function ensureJobObjects(id) {
      if (jobObjectsFor === id) return Promise.resolve(jobObjects);
      return window.ToolboxSync.exploreListCustomerFile(id).then(function (data) {
        jobObjects = data && Array.isArray(data.objects) ? data.objects : [];
        jobObjectsFor = id;
        sortJob(id);
        return jobObjects;
      });
    }

    let listDownloadBusy = false;

    /** Download job, from a row in the list. One copy is packed at a time. */
    function downloadJobFromList(row, button) {
      if (listDownloadBusy) {
        showNotice('Another job copy is still being packed.');
        return;
      }
      listDownloadBusy = true;
      jobName = row.displayName || row.propertyAddress || '';
      jobAddress = row.propertyAddress || '';
      jobFieldDate = row.fieldWorkDate || '';
      downloadArchive(row.id, button, showNotice, function () {
        listDownloadBusy = false;
      });
    }

    /** What the copy will be called, before it is built. */
    function plannedArchiveName(id) {
      const Summary = window.ToolboxExplorerSummary;
      if (!Summary) return archiveFileName(id);
      return Summary.archiveFolderName({
        name: jobName,
        address: jobAddress,
        components: jobComponentsFor === id ? jobComponents : {},
        fallbackDate: jobFieldDate,
      }) + '.zip';
    }

    /**
     * What a stored object is called inside the copy.
     *
     * Pictures reuse the Explorer's own naming, so a photograph saved on its
     * own and the same photograph inside the job copy are called the same
     * thing. Everything else takes the name the Cabinet already gives it,
     * with its real extension kept.
     */
    function archiveNameFor(row) {
      // A photograph the investigator named something -- a pin and a room, or
      // the moment the shutter went -- is called that.
      //
      // Only a photograph. A plan and a contour layer are pictures too by
      // content type, and they have no pin and no shutter time, so sending
      // them down this path produced "media_plan-main": the storage key the
      // copy exists to get away from. They take the labelled path below,
      // which is where their real name lives.
      if (isPicture(row) && factFor(row)) {
        const named = pictureFileName(row);
        // The pictures ZIP puts a Quick Capture run in its own subfolder;
        // inside the job copy that folder is already Photographs/Quick
        // Capture, so only the leaf is wanted here.
        const slash = named.lastIndexOf('/');
        return slash >= 0 ? named.slice(slash + 1) : named;
      }
      const label = String((row && row._label) || '').trim();
      const leaf = downloadName(row && row.key);
      const ext = anyExtensionFor(row);
      if (!label) return ext && leaf.indexOf('.') < 0 ? leaf + ext : leaf;
      const stem = String(label).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!stem) return leaf;
      // A label that already ends in the extension (a stored filename that
      // the listing simply echoes) must not gain a second one.
      if (ext && stem.toLowerCase().slice(-ext.length) === ext.toLowerCase()) return stem;
      return stem + ext;
    }

    /** The server's byte-for-byte copy, kept for recovery. */
    function downloadRawArchive(id, button, notify) {
      notify('');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = canChooseWhere() ? 'Where to?' : 'Preparing ZIP…';
      saveWhereChosen(archiveFileName(id), 'application/zip', function () {
        button.textContent = 'Preparing ZIP…';
        return window.ToolboxSync.exploreFetchArchive(id);
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
