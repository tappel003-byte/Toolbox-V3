// Recovered Distress photo folders.
// Pin photos stay on their observations. Quick Capture stays a separate
// collection. This browser does not place either set on the plan.

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

  function pinPhotoItems(record) {
    const pins = record && record.distress && Array.isArray(record.distress.pins)
      ? record.distress.pins.slice()
      : [];
    pins.sort(function (a, b) { return (a && a.num || 0) - (b && b.num || 0); });
    const items = [];
    pins.forEach(function (pin) {
      const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
      photos.forEach(function (id, index) {
        if (typeof id !== 'string' || !id) return;
        items.push({
          id: id,
          folder: 'pins',
          title: sourceName(record, id, 'Photo ' + (index + 1)),
          detail: 'Pin ' + (pin.num != null ? pin.num : ''),
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
      return String(a && a.sourceName || '').localeCompare(String(b && b.sourceName || ''), undefined, { numeric: true });
    });
    return quick.filter(function (item) { return item && item.id; }).map(function (item) {
      const where = [item.latitude, item.longitude].filter(Boolean).join(', ');
      const when = item.timestamp || '';
      return {
        id: item.id,
        folder: 'quick',
        title: item.sourceName || sourceName(record, item.id, 'Quick Capture'),
        detail: [when, where].filter(Boolean).join(' · '),
      };
    });
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
    return 'Photo folders · ' + tally.pins + ' pin · ' + tally.quick + ' Quick Capture';
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

  let overlay = null;
  let photoDb = null;
  let currentItems = [];
  let activeFolder = 'pins';
  let selectedId = '';

  function close() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    currentItems = [];
    selectedId = '';
    if (photoDb) {
      try { photoDb.close(); } catch (_) {}
      photoDb = null;
    }
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  function visibleItems() {
    return currentItems.filter(function (item) { return item.folder === activeFolder; });
  }

  function renderBody() {
    if (!overlay) return;
    const body = overlay.querySelector('.photo-folders__body');
    const items = visibleItems();
    const selected = items.find(function (item) { return item.id === selectedId; }) || null;
    const viewer = selected
      ? '<figure class="photo-folders__viewer"><img alt="' + escapeHtml(selected.title) + '" data-photo-id="' + escapeHtml(selected.id) + '">' +
        '<figcaption><strong>' + escapeHtml(selected.title) + '</strong>' +
        (selected.detail ? '<span>' + escapeHtml(selected.detail) + '</span>' : '') +
        '</figcaption></figure>'
      : '';
    const cards = items.length
      ? items.map(function (item) {
        const pressed = item.id === selectedId ? 'true' : 'false';
        return '<button type="button" class="photo-folders__card" data-photo-id="' + escapeHtml(item.id) + '" aria-pressed="' + pressed + '">' +
          '<img alt="" data-photo-id="' + escapeHtml(item.id) + '">' +
          '<span class="photo-folders__name">' + escapeHtml(item.title) + '</span>' +
          (item.detail ? '<span class="photo-folders__detail">' + escapeHtml(item.detail) + '</span>' : '') +
          '</button>';
      }).join('')
      : '<p class="photo-folders__empty">' +
        (activeFolder === 'pins'
          ? 'No pin photos were recovered for this Customer File.'
          : 'No Quick Capture photos were recovered for this Customer File.') +
        '</p>';
    body.innerHTML = viewer + '<div class="photo-folders__grid">' + cards + '</div>';
    body.querySelectorAll('img[data-photo-id]').forEach(function (img) {
      const id = img.getAttribute('data-photo-id');
      readPhoto(photoDb, id).then(function (value) {
        if (overlay && typeof value === 'string' && value.indexOf('data:image/') === 0) img.src = value;
      }).catch(function () {});
    });
    body.querySelectorAll('.photo-folders__card').forEach(function (card) {
      card.addEventListener('click', function () {
        selectedId = card.getAttribute('data-photo-id') || '';
        renderBody();
      });
    });
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

  async function open(customerFileId) {
    close();
    if (!window.ToolboxDB || !customerFileId) return;
    const record = await window.ToolboxDB.getCustomerFile(customerFileId);
    if (!record) return;
    const pinItems = pinPhotoItems(record);
    const quickItems = quickCaptureItems(record);
    currentItems = pinItems.concat(quickItems);
    activeFolder = pinItems.length || !quickItems.length ? 'pins' : 'quick';
    photoDb = await openPhotoDatabase();

    overlay = document.createElement('div');
    overlay.className = 'photo-folders';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'photo-folders-title');
    overlay.innerHTML =
      '<div class="photo-folders__panel">' +
      '  <header class="photo-folders__bar">' +
      '    <div><p class="eyebrow">Distress</p><h2 id="photo-folders-title">Recovered photos</h2></div>' +
      '    <button type="button" class="btn btn--secondary" id="photo-folders-close">Close</button>' +
      '  </header>' +
      '  <div class="photo-folders__tabs" role="tablist">' +
      '    <button type="button" data-photo-folder="pins" aria-pressed="' + (activeFolder === 'pins' ? 'true' : 'false') + '">Pin photos<span>' + pinItems.length + '</span></button>' +
      '    <button type="button" data-photo-folder="quick" aria-pressed="' + (activeFolder === 'quick' ? 'true' : 'false') + '">Quick Capture<span>' + quickItems.length + '</span></button>' +
      '  </div>' +
      '  <p class="photo-folders__note">Pin photos stay on their observations. Quick Capture stays in its own folder and is not placed on the plan.</p>' +
      '  <div class="photo-folders__body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#photo-folders-close').addEventListener('click', close);
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
  };
})();
