// Customer File photo folders.
// Distress pin photos stay on their observations. Quick Capture stays a
// separate collection. Neither set is placed on the plan. Download copies
// the stored bytes and does not rewrite them.

(function () {
  'use strict';

  const DISTRESS_DB = 'pgg_photos_v1';
  const DISTRESS_STORE = 'photos';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sourceName(record, id, fallback) {
    const sources = record && record.distress && record.distress.photoSources;
    if (sources && typeof sources[id] === 'string' && sources[id]) return sources[id];
    return fallback;
  }

  function safeFileName(name, fallback) {
    const base = String(name || '').replace(/\\/g, '/').split('/').pop().trim();
    const cleaned = base.replace(/[^\w.\- ()]+/g, '_');
    if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
    return cleaned;
  }

  function uniqueFileName(used, name) {
    const clean = name || 'photo.jpg';
    if (!used[clean]) {
      used[clean] = true;
      return clean;
    }
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let n = 2;
    let candidate = stem + '-' + n + ext;
    while (used[candidate]) {
      n += 1;
      candidate = stem + '-' + n + ext;
    }
    used[candidate] = true;
    return candidate;
  }

  function quickTime(item) {
    if (!item) return '';
    if (item.timestamp) return String(item.timestamp);
    if (typeof item.ts === 'number' && isFinite(item.ts)) return new Date(item.ts).toISOString();
    if (item.ts) return String(item.ts);
    return '';
  }

  // The moment the shutter was pressed, as a sortable name.
  function captureStampFor(item) {
    const parsed = Date.parse(quickTime(item) || '');
    if (!isFinite(parsed)) return '';
    const d = new Date(parsed);
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function quickCoord(item, textKey, numberKey) {
    if (!item) return '';
    if (item[textKey]) return String(item[textKey]);
    if (item[numberKey] != null && item[numberKey] !== '') return String(item[numberKey]);
    return '';
  }

  function pinPhotoItems(record) {
    const pins = record && record.distress && Array.isArray(record.distress.pins)
      ? record.distress.pins.slice()
      : [];
    pins.sort(function (a, b) { return (a && a.num || 0) - (b && b.num || 0); });
    const items = [];
    const used = {};
    pins.forEach(function (pin) {
      const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
      photos.forEach(function (entry, index) {
        // Distress stores photo ids as strings; some report/test paths use { id }.
        const id = typeof entry === 'string' ? entry
          : (entry && typeof entry.id === 'string' ? entry.id : '');
        if (!id) return;
        const pinLabel = pin.num != null ? String(pin.num) : '';
        const fallback = 'pin-' + (pinLabel || 'photo') + '-photo-' + (index + 1) + '.jpg';
        const fileName = uniqueFileName(used, safeFileName(sourceName(record, id, ''), fallback));
        items.push({
          id: id,
          folder: 'pins',
          folderPath: 'distress-photos',
          path: 'distress-photos/' + fileName,
          folderLabel: 'Distress photos',
          title: sourceName(record, id, 'Photo ' + (index + 1)),
          fileName: fileName,
          detail: 'Pin ' + pinLabel,
          pin: pinLabel,
          description: pin && pin.description ? String(pin.description) : '',
          timestamp: '',
          latitude: '',
          longitude: '',
        });
      });
    });
    return items;
  }

  function quickCaptureItems(record) {
    const quick = record && record.distress && Array.isArray(record.distress.quickCapture)
      ? record.distress.quickCapture.slice()
      : [];
    quick.sort(function (a, b) {
      const aName = String(a && (a.sourceName || a.timestamp || a.ts) || '');
      const bName = String(b && (b.sourceName || b.timestamp || b.ts) || '');
      return aName.localeCompare(bName, undefined, { numeric: true });
    });
    const used = {};
    return quick.filter(function (item) { return item && item.id; }).map(function (item, index) {
      const when = quickTime(item);
      const latitude = quickCoord(item, 'latitude', 'lat');
      const longitude = quickCoord(item, 'longitude', 'lng');
      const named = item.sourceName || sourceName(record, item.id, '');
      // A run of Quick Captures is a named set, so it travels as its own
      // folder: start a run, name it, shoot, press Done; start another later
      // and it lands somewhere else.
      const set = String(item.folder || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
      const stamp = captureStampFor(item);
      const fallback = (stamp || ('quick-' + (index + 1))) + '.jpg';
      const fileName = uniqueFileName(used, safeFileName(named, fallback));
      const folderPath = set ? 'quick-capture/' + set : 'quick-capture';
      return {
        id: item.id,
        folder: 'quick',
        folderPath: folderPath,
        path: folderPath + '/' + fileName,
        folderLabel: 'Quick Capture',
        title: named || ('Quick Capture ' + (index + 1)),
        fileName: fileName,
        detail: [when, [latitude, longitude].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
        pin: '',
        description: item.description ? String(item.description) : '',
        timestamp: when,
        latitude: latitude,
        longitude: longitude,
        tagged: !!(item.tagged || item.reportTag),
        localFull: !!item.localFull,
        raw: item,
      };
    });
  }

  function thumbKey(id) {
    return window.ToolboxSync && typeof window.ToolboxSync.thumbMediaKey === 'function'
      ? window.ToolboxSync.thumbMediaKey(id)
      : ('thumb:' + id);
  }

  async function resolvePhotoSrc(db, id) {
    const full = await readPhoto(db, id);
    // Full local bytes win — including legacy captures that predate localFull.
    if (typeof full === 'string' && full.indexOf('data:image/') === 0) {
      return { src: full, cabinetOnly: false };
    }
    const thumb = await readPhoto(db, thumbKey(id));
    if (typeof thumb === 'string' && thumb.indexOf('data:image/') === 0) {
      return { src: thumb, cabinetOnly: true };
    }
    return { src: '', cabinetOnly: true };
  }

  function allItems(record) {
    return pinPhotoItems(record).concat(quickCaptureItems(record));
  }

  function counts(record) {
    return {
      pins: pinPhotoItems(record).length,
      quick: quickCaptureItems(record).length,
    };
  }

  function hasAny(record) {
    const tally = counts(record);
    return tally.pins > 0 || tally.quick > 0;
  }

  function label(record) {
    const tally = counts(record);
    return 'Photo folders · ' + tally.pins + ' Distress · ' + tally.quick + ' Quick Capture';
  }

  function csvField(value) {
    const text = String(value == null ? '' : value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function manifestCsv(items) {
    const lines = ['Folder,File,Pin,Description,Timestamp,Latitude,Longitude'];
    items.forEach(function (item) {
      lines.push([
        item.folderLabel,
        item.fileName,
        item.pin,
        item.description,
        item.timestamp,
        item.latitude,
        item.longitude,
      ].map(csvField).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  function openPhotoDatabase() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DISTRESS_DB, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(DISTRESS_STORE)) {
          request.result.createObjectStore(DISTRESS_STORE);
        }
      };
      request.onerror = function () { reject(request.error || new Error('Photo storage could not be opened.')); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }

  function readPhoto(db, id) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(DISTRESS_STORE, 'readonly');
      const request = tx.objectStore(DISTRESS_STORE).get(id);
      request.onsuccess = function () { resolve(request.result || ''); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function bytesFromStored(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value !== 'string' || value.indexOf('data:') !== 0) return null;
    const comma = value.indexOf(',');
    if (comma < 0) return null;
    const meta = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    let binary = '';
    try {
      binary = /;base64/i.test(meta) ? atob(payload) : decodeURIComponent(payload);
    } catch (_) {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 255;
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function storedPayload(value) {
    if (typeof value !== 'string') return '';
    const comma = value.indexOf(',');
    if (comma < 0) return '';
    return value.slice(comma + 1).replace(/\s/g, '');
  }

  function mimeFromStored(value) {
    if (typeof value !== 'string') return 'application/octet-stream';
    const match = /^data:([^;,]+)/.exec(value);
    return match ? match[1] : 'application/octet-stream';
  }

  async function collectFiles(items, read) {
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const stored = await read(item.id);
      const bytes = bytesFromStored(stored);
      if (!bytes) continue;
      const encoded = bytesToBase64(bytes);
      files.push({
        item: item,
        bytes: bytes,
        base64: encoded,
        mime: mimeFromStored(stored),
        matchesStored: typeof stored === 'string' && encoded === storedPayload(stored),
      });
    }
    return files;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function zipFiles(files) {
    if (!window.JSZip) throw new Error('ZIP download is unavailable.');
    const zip = new window.JSZip();
    files.forEach(function (file) {
      zip.file(file.item.path, file.bytes, { compression: 'STORE' });
    });
    const csv = manifestCsv(files.map(function (file) { return file.item; }));
    zip.file('photo-folders.csv', csv, { compression: 'STORE' });
    const zipped = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    return { csv: csv, zipped: zipped };
  }

  async function buildDownload(record) {
    const db = await openPhotoDatabase();
    try {
      const items = allItems(record);
      const files = await collectFiles(items, function (id) { return readPhoto(db, id); });
      const packed = await zipFiles(files);
      const roundTrip = await window.JSZip.loadAsync(packed.zipped);
      const zipRoundTrip = [];
      for (let i = 0; i < files.length; i++) {
        const out = await roundTrip.file(files[i].item.path).async('uint8array');
        zipRoundTrip.push(bytesToBase64(out) === files[i].base64);
      }
      const csvOut = await roundTrip.file('photo-folders.csv').async('string');
      return {
        zipName: 'photo-folders.zip',
        csv: packed.csv,
        csvStored: csvOut === packed.csv,
        entries: files.map(function (file) {
          return {
            path: file.item.path,
            fileName: file.item.fileName,
            pin: file.item.pin,
            base64: file.base64,
            matchesStored: file.matchesStored,
          };
        }),
        zipRoundTrip: zipRoundTrip.every(Boolean),
      };
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  let overlay = null;
  let photoDb = null;
  let currentItems = [];
  let activeFolder = 'pins';
  let selectedId = '';
  let ownerFileId = '';

  function close() {
    // Folders own any viewer they opened; leave must not leak overlay/listener.
    if (window.ToolboxPhotoViewer && typeof window.ToolboxPhotoViewer.close === 'function') {
      try { window.ToolboxPhotoViewer.close({ discard: true }); } catch (_) {}
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    currentItems = [];
    selectedId = '';
    ownerFileId = '';
    if (photoDb) {
      try { photoDb.close(); } catch (_) {}
      photoDb = null;
    }
    document.removeEventListener('keydown', onKeydown);
  }

  /** Close when navigating to a different Customer File (or none). */
  function closeUnlessFile(customerFileId) {
    if (!overlay) return;
    if (ownerFileId && customerFileId && ownerFileId === customerFileId) return;
    close();
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    // Shared photo viewer owns Escape while it is open.
    if (window.ToolboxPhotoViewer && window.ToolboxPhotoViewer.isOpen()) return;
    close();
  }

  function visibleItems() {
    return currentItems.filter(function (item) { return item.folder === activeFolder; });
  }

  function setStatus(message) {
    if (!overlay) return;
    const status = overlay.querySelector('#photo-folders-status');
    if (status) status.textContent = message || '';
  }

  function renderBody() {
    if (!overlay) return;
    const body = overlay.querySelector('.photo-folders__body');
    const items = visibleItems();
    if (!selectedId || !items.some(function (item) { return item.id === selectedId; })) {
      selectedId = items.length ? items[0].id : '';
    }
    const selected = items.find(function (item) { return item.id === selectedId; }) || null;
    const isQuick = activeFolder === 'quick';
    const viewer = selected
      ? '<figure class="photo-folders__viewer"><img alt="' + escapeHtml(selected.title) + '" data-photo-id="' + escapeHtml(selected.id) + '">' +
        '<figcaption><strong>' + escapeHtml(selected.title) + '</strong>' +
        (selected.detail ? '<span>' + escapeHtml(selected.detail) + '</span>' : '') +
        '<span class="photo-folders__cabinet-state" data-cabinet-state="' + escapeHtml(selected.id) + '"></span>' +
        '<div class="photo-folders__viewer-actions">' +
        (isQuick
          ? '<label class="photo-folders__tag"><input type="checkbox" id="photo-folders-tag"' +
            (selected.tagged ? ' checked' : '') + '> Tag for download / report</label>'
          : '') +
        '<button type="button" class="btn btn--secondary" id="photo-folders-view-one">View</button>' +
        '<button type="button" class="btn btn--secondary" id="photo-folders-download-one">Download</button>' +
        (isQuick
          ? '<button type="button" class="btn btn--secondary" id="photo-folders-open-explorer">Open in File Explorer</button>'
          : '') +
        '</div>' +
        '</figcaption></figure>'
      : '';
    const cards = items.length
      ? items.map(function (item) {
        const pressed = item.id === selectedId ? 'true' : 'false';
        return '<button type="button" class="photo-folders__card" data-photo-id="' + escapeHtml(item.id) + '" aria-pressed="' + pressed + '">' +
          '<img alt="" data-photo-id="' + escapeHtml(item.id) + '">' +
          '<span class="photo-folders__name">' + escapeHtml(item.title) + '</span>' +
          (item.detail ? '<span class="photo-folders__detail">' + escapeHtml(item.detail) + '</span>' : '') +
          '<span class="photo-folders__cabinet-state" data-cabinet-state="' + escapeHtml(item.id) + '"></span>' +
          (item.tagged ? '<span class="photo-folders__tagged">Tagged</span>' : '') +
          '</button>';
      }).join('')
      : '<p class="photo-folders__empty">' +
        (activeFolder === 'pins'
          ? 'No Distress photos in this Customer File.'
          : 'No Quick Capture photos in this Customer File.') +
        '</p>';
    body.innerHTML = viewer + '<div class="photo-folders__grid">' + cards + '</div>';
    body.querySelectorAll('img[data-photo-id]').forEach(function (img) {
      const id = img.getAttribute('data-photo-id');
      resolvePhotoSrc(photoDb, id).then(function (resolved) {
        if (!overlay) return;
        if (resolved.src) img.src = resolved.src;
        body.querySelectorAll('[data-cabinet-state="' + id + '"]').forEach(function (el) {
          el.textContent = resolved.cabinetOnly ? 'In the File Cabinet' : '';
        });
      }).catch(function () {});
    });
    body.querySelectorAll('.photo-folders__card').forEach(function (card) {
      card.addEventListener('click', function () {
        selectedId = card.getAttribute('data-photo-id') || '';
        renderBody();
      });
    });
    const one = body.querySelector('#photo-folders-download-one');
    if (one) one.addEventListener('click', function () { downloadOne(selectedId); });
    const viewOne = body.querySelector('#photo-folders-view-one');
    if (viewOne) {
      viewOne.addEventListener('click', function () {
        const item = items.find(function (entry) { return entry.id === selectedId; });
        if (item && item.folder === 'quick') {
          resolvePhotoSrc(photoDb, selectedId).then(function (resolved) {
            if (resolved.cabinetOnly) {
              openInExplorer(selectedId);
              return;
            }
            openFolderViewer(selectedId);
          });
          return;
        }
        openFolderViewer(selectedId);
      });
    }
    const tag = body.querySelector('#photo-folders-tag');
    if (tag) {
      tag.addEventListener('change', function () {
        toggleTag(selectedId, tag.checked);
      });
    }
    const explorerBtn = body.querySelector('#photo-folders-open-explorer');
    if (explorerBtn) {
      explorerBtn.addEventListener('click', function () {
        openInExplorer(selectedId);
      });
    }
  }

  async function toggleTag(id, on) {
    if (!ownerFileId || !id) return;
    const record = await window.ToolboxDB.getCustomerFile(ownerFileId);
    const quick = record && record.distress && Array.isArray(record.distress.quickCapture)
      ? record.distress.quickCapture
      : [];
    const item = quick.find(function (entry) { return entry && entry.id === id; });
    if (!item) return;
    item.tagged = !!on;
    item.reportTag = !!on;
    record.distress.updatedAt = new Date().toISOString();
    record.updatedAt = record.distress.updatedAt;
    await window.ToolboxDB.saveCustomerFile(record);
    currentItems = allItems(record);
    renderBody();
  }

  async function downloadTagged() {
    if (!ownerFileId || !window.ToolboxSync ||
        typeof window.ToolboxSync.downloadTaggedQuickCapture !== 'function') {
      setStatus('Download tagged is not available.');
      return;
    }
    setStatus('Downloading tagged Quick Capture photos…');
    try {
      const result = await window.ToolboxSync.downloadTaggedQuickCapture(ownerFileId);
      if (result && result.record) currentItems = allItems(result.record);
      setStatus(result && result.downloaded
        ? ('Downloaded ' + result.downloaded + ' tagged photo' +
          (result.downloaded === 1 ? '' : 's') + ' at full size.')
        : (result && result.tagged
          ? 'Tagged photos are already on this device.'
          : 'No tagged Quick Capture photos.'));
      renderBody();
    } catch (err) {
      setStatus((err && err.message) || 'Could not download tagged photos.');
    }
  }

  function openInExplorer(mediaId) {
    close();
    if (typeof location !== 'undefined') {
      location.hash = '#/explorer' + (ownerFileId ? '/' + ownerFileId : '');
    }
    setStatus(mediaId
      ? 'Open File Explorer — Quick Capture stays in the Cabinet until tagged and downloaded.'
      : '');
  }

  function openFolderViewer(startId) {
    const api = window.ToolboxPhotoViewer;
    if (!api || typeof api.open !== 'function' || !photoDb) return;
    const items = visibleItems();
    if (!items.length) return;
    let index = 0;
    if (startId) {
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].id === startId) { index = i; break; }
      }
    }
    const viewerItems = items.map(function (item) {
      return {
        id: item.id,
        title: item.title || 'Photograph',
        caption: item.detail || '',
        getSrc: function () {
          // Same local resolve order as Report Builder evidence: Distress
          // photo store first, then Toolbox media. Never fetches remotely.
          return readPhoto(photoDb, item.id).then(function (value) {
            if (typeof value === 'string' && value.indexOf('data:image/') === 0) return value;
            if (window.ToolboxDB && typeof window.ToolboxDB.getMedia === 'function') {
              return window.ToolboxDB.getMedia(item.id).then(function (media) {
                return (typeof media === 'string' && media.indexOf('data:image/') === 0)
                  ? media
                  : null;
              });
            }
            return null;
          }).catch(function () {
            if (window.ToolboxDB && typeof window.ToolboxDB.getMedia === 'function') {
              return window.ToolboxDB.getMedia(item.id).then(function (media) {
                return (typeof media === 'string' && media.indexOf('data:image/') === 0)
                  ? media
                  : null;
              }).catch(function () { return null; });
            }
            return null;
          });
        },
      };
    });
    api.open(viewerItems, { index: index });
  }

  function setFolder(folder) {
    activeFolder = folder === 'quick' ? 'quick' : 'pins';
    selectedId = '';
    if (!overlay) return;
    overlay.querySelectorAll('[data-photo-folder]').forEach(function (button) {
      const on = button.getAttribute('data-photo-folder') === activeFolder;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderBody();
  }

  async function downloadOne(id) {
    const item = currentItems.find(function (entry) { return entry.id === id; });
    if (!item || !photoDb) return;
    setStatus('');
    try {
      const stored = await readPhoto(photoDb, item.id);
      const bytes = bytesFromStored(stored);
      if (!bytes) {
        setStatus('That photo could not be read.');
        return;
      }
      saveBlob(new Blob([bytes], { type: mimeFromStored(stored) }), item.fileName);
    } catch (_) {
      setStatus('That photo could not be downloaded.');
    }
  }

  async function downloadAll() {
    if (!photoDb || !currentItems.length) return;
    setStatus('');
    try {
      const files = await collectFiles(currentItems, function (id) { return readPhoto(photoDb, id); });
      if (!files.length) {
        setStatus('No stored photos could be read.');
        return;
      }
      const packed = await zipFiles(files);
      saveBlob(new Blob([packed.zipped], { type: 'application/zip' }), 'photo-folders.zip');
    } catch (_) {
      setStatus('The photo folder could not be downloaded.');
    }
  }

  async function open(customerFileId) {
    close();
    if (!window.ToolboxDB || !customerFileId) return;
    const record = await window.ToolboxDB.getCustomerFile(customerFileId);
    if (!record) return;
    ownerFileId = customerFileId;
    currentItems = allItems(record);
    const pinCount = currentItems.filter(function (item) { return item.folder === 'pins'; }).length;
    const quickCount = currentItems.length - pinCount;
    activeFolder = pinCount || !quickCount ? 'pins' : 'quick';
    photoDb = await openPhotoDatabase();

    overlay = document.createElement('div');
    overlay.className = 'photo-folders';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'photo-folders-title');
    overlay.innerHTML =
      '<div class="photo-folders__panel">' +
      '  <header class="photo-folders__bar">' +
      '    <div><p class="eyebrow">Customer File</p><h2 id="photo-folders-title">Photo folders</h2></div>' +
      '    <div class="photo-folders__actions">' +
      '      <button type="button" class="btn btn--secondary" id="photo-folders-download-all">Download all</button>' +
      '      <button type="button" class="btn btn--secondary" id="photo-folders-close">Close</button>' +
      '    </div>' +
      '  </header>' +
      '  <div class="photo-folders__tabs" role="tablist">' +
      '    <button type="button" data-photo-folder="pins" aria-pressed="' + (activeFolder === 'pins' ? 'true' : 'false') + '">Distress photos<span>' + pinCount + '</span></button>' +
      '    <button type="button" data-photo-folder="quick" aria-pressed="' + (activeFolder === 'quick' ? 'true' : 'false') + '">Quick Capture<span>' + quickCount + '</span></button>' +
      '  </div>' +
      '  <p class="photo-folders__note">Distress photos stay linked to their pins and travel with Check Out. Quick Capture lives in the File Cabinet — this device may show a thumbnail only. Tag photos and use Download tagged for full-size local copies (e.g. for a report). Tapping a Cabinet-only photo opens File Explorer.</p>' +
      '  <p class="photo-folders__status" id="photo-folders-status" role="status"></p>' +
      '  <div class="photo-folders__body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#photo-folders-close').addEventListener('click', close);
    const actions = overlay.querySelector('.photo-folders__actions');
    if (actions) {
      const taggedBtn = document.createElement('button');
      taggedBtn.type = 'button';
      taggedBtn.className = 'btn btn--secondary';
      taggedBtn.id = 'photo-folders-download-tagged';
      taggedBtn.textContent = 'Download tagged';
      actions.insertBefore(taggedBtn, actions.firstChild);
      taggedBtn.addEventListener('click', function () { downloadTagged(); });
    }
    overlay.querySelector('#photo-folders-download-all').addEventListener('click', function () {
      downloadAll();
    });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll('[data-photo-folder]').forEach(function (button) {
      button.addEventListener('click', function () {
        setFolder(button.getAttribute('data-photo-folder'));
      });
    });
    document.addEventListener('keydown', onKeydown);
    renderBody();
    overlay.querySelector('#photo-folders-close').focus();
  }

  window.ToolboxRecoveredPhotos = {
    hasAny: hasAny,
    counts: counts,
    label: label,
    open: open,
    close: close,
    closeUnlessFile: closeUnlessFile,
    buildDownload: buildDownload,
  };
})();
