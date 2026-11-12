// Toolbox — Milestone 1: Customer File.
//
// Cabinet (list) <-> Customer File (create/open/edit) using hash routing so
// reload/offline navigation stays inside the single cached document. All
// data lives in IndexedDB via ToolboxDB (js/db.js) — local, offline, and
// durable across reload/close-reopen, with no server or sync involved.

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;

  // Registered by whichever view is currently mounted so a single listener
  // can flush pending edits when the tab is hidden or closed.
  let activeFileFlush = null;
  function registerActiveFlush(fn) {
    activeFileFlush = fn;
  }

  const FIELD_DEFS = {
    primary: [
      { id: 'firstName', label: 'First name', type: 'text' },
      { id: 'lastName', label: 'Last name', type: 'text' },
      { id: 'propertyAddress', label: 'Property / site address', type: 'text', placeholder: 'Street address, city, state, ZIP', full: true },
      { id: 'cellPhone', label: 'Cell phone', type: 'tel' },
      { id: 'homePhone', label: 'Home phone', type: 'tel' },
      { id: 'email', label: 'Email', type: 'email', full: true },
      { id: 'notes', label: 'Notes', type: 'textarea', placeholder: 'General notes about this customer or property…', rows: 4, full: true },
    ],
    additional: [
      { id: 'companyName', label: 'Company / organization', type: 'text', full: true },
      { id: 'spouseName', label: 'Spouse / partner name', type: 'text', full: true },
      { id: 'spouseCellPhone', label: 'Spouse / partner cell phone', type: 'tel' },
      { id: 'spouseHomePhone', label: 'Spouse / partner home phone', type: 'tel' },
      { id: 'spouseEmail', label: 'Spouse / partner email', type: 'email', full: true },
    ],
  };

  // ---- Customer File model -------------------------------------------

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'cf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function blankCustomerFile(id) {
    // trashUpdatedAt uses the sync epoch sentinel so ordinary create/edit clocks
    // cannot manufacture trash authority that beats a legitimate Trash event.
    const now = new Date().toISOString();
    const trashEpoch = '1970-01-01T00:00:00.001Z';
    return {
      id: id,
      createdAt: now,
      updatedAt: now,
      customerUpdatedAt: now,
      trashUpdatedAt: trashEpoch,
      firstName: '',
      lastName: '',
      propertyAddress: '',
      cellPhone: '',
      homePhone: '',
      email: '',
      notes: '',
      companyName: '',
      spouseName: '',
      spouseCellPhone: '',
      spouseHomePhone: '',
      spouseEmail: '',
      mailingSameAsProperty: false,
      mailingAddress: '',
      propertyAddressLat: null,
      propertyAddressLon: null,
    };
  }

  /** Initial Visit mark. Absent on ordinary Customer Files (must stay as today). */
  function isVisitRecord(record) {
    return !!(record && record.status === 'visit');
  }

  function todayIsoDate() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function blankInitialVisit(id) {
    const record = blankCustomerFile(id);
    record.status = 'visit';
    record.distress = {
      updatedAt: new Date().toISOString(),
      pins: [],
      quickCapture: [],
      jobWalk: {
        updatedAt: '',
        notes: [],
        videos: [],
        visitDate: todayIsoDate(),
        visitTime: '',
        followUpDate: '',
        outcomes: {
          noProblems: false,
          recommendFloor: false,
          recommendDistress: false,
          wantsQuote: false,
          callBack: false,
        },
      },
    };
    return record;
  }

  /** Scheduled appointment on an Initial Visit (date + optional time of day). */
  function visitSchedule(record) {
    const walk = record && record.distress && record.distress.jobWalk &&
      typeof record.distress.jobWalk === 'object'
      ? record.distress.jobWalk
      : null;
    return {
      date: walk && typeof walk.visitDate === 'string' ? walk.visitDate : '',
      time: walk && typeof walk.visitTime === 'string' ? walk.visitTime : '',
    };
  }

  function formatVisitScheduleDate(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
    const d = new Date(isoDate + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatVisitScheduleTime(hhmm) {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return '';
    const parts = hhmm.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function visitScheduleSortKey(record) {
    const s = visitSchedule(record);
    const date = s.date || '9999-12-31';
    const time = s.time || '99:99';
    return date + 'T' + time;
  }

  function fillVisitScheduleMeta(metaEl, record) {
    metaEl.textContent = '';
    metaEl.classList.add('cabinet-row__schedule');
    const s = visitSchedule(record);
    const dateLabel = formatVisitScheduleDate(s.date);
    const timeLabel = formatVisitScheduleTime(s.time);
    if (dateLabel) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'cabinet-row__when cabinet-row__when--date';
      dateSpan.innerHTML =
        '<span class="cabinet-row__when-ico" aria-hidden="true">' +
        '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="2" y="3.5" width="12" height="10.5" rx="1.5"/>' +
        '<path d="M5 2v2.5M11 2v2.5M2 7h12"/></svg></span>';
      const dateText = document.createElement('span');
      dateText.textContent = dateLabel;
      dateSpan.appendChild(dateText);
      metaEl.appendChild(dateSpan);
    }
    if (timeLabel) {
      if (dateLabel) metaEl.appendChild(document.createTextNode(' · '));
      const timeSpan = document.createElement('span');
      timeSpan.className = 'cabinet-row__when cabinet-row__when--time';
      timeSpan.innerHTML =
        '<span class="cabinet-row__when-ico" aria-hidden="true">' +
        '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2L10.2 10"/></svg></span>';
      const timeText = document.createElement('span');
      timeText.textContent = timeLabel;
      timeSpan.appendChild(timeText);
      metaEl.appendChild(timeSpan);
    }
    if (!dateLabel && !timeLabel) {
      metaEl.textContent = 'Set schedule';
      metaEl.classList.add('is-unset');
    }
  }

  function displayName(record) {
    const name = ((record.firstName || '') + ' ' + (record.lastName || '')).trim();
    if (name) return name;
    return isVisitRecord(record) ? 'New Initial Visit' : 'New Customer File';
  }

  function displayAddress(record) {
    const addr = (record.propertyAddress || '').trim();
    if (!addr) return 'No property address yet';
    return addr.split('\n')[0].trim() || 'No property address yet';
  }

  /**
   * The address as it is written on an envelope: the street, then the city,
   * state and ZIP on the line below. Tim, Nov 7, 2026: "if we need to go to
   * two lines ... then it needs to be formatted like a proper address." An
   * address typed on two lines keeps its own break; one written on one line
   * breaks at its first comma, which is where the street ends.
   */
  function addressLines(record) {
    const addr = String((record && record.propertyAddress) || '').trim();
    if (!addr) return null;
    const lines = addr.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
    if (lines.length > 1) return { street: lines[0], locality: lines.slice(1).join(', ') };
    const comma = addr.indexOf(',');
    if (comma <= 0) return { street: addr, locality: '' };
    return { street: addr.slice(0, comma).trim(), locality: addr.slice(comma + 1).trim() };
  }

  function fillAddress(el, record) {
    const parts = addressLines(record);
    el.textContent = '';
    if (!parts) {
      el.textContent = 'No property address yet';
      return;
    }
    [parts.street, parts.locality].forEach(function (text) {
      if (!text) return;
      const line = document.createElement('span');
      line.className = 'address-line';
      line.textContent = text;
      el.appendChild(line);
    });
  }

  function formatUpdated(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function planReadiness(record) {
    const canvases = record && record.planSetup && Array.isArray(record.planSetup.canvases)
      ? record.planSetup.canvases
      : [];
    const ready = canvases.filter(function (canvas) {
      return window.ToolboxPlanSetup && window.ToolboxPlanSetup.hasUsablePlan(canvas);
    });
    return {
      canvases: canvases,
      ready: ready,
      hasPlan: ready.length > 0,
    };
  }

  function hasInvestigationData(record) {
    if (!record) return false;
    const distress = record.distress || {};
    if ((Array.isArray(distress.pins) && distress.pins.length) ||
        (Array.isArray(distress.drawings) && distress.drawings.length) ||
        (Array.isArray(distress.quickCapture) && distress.quickCapture.length) ||
        (distress.photoSources && typeof distress.photoSources === 'object' &&
          Object.keys(distress.photoSources).length)) {
      return true;
    }

    const floor = record.floorSurvey || {};
    if ((typeof floor.inspectionDate === 'string' && floor.inspectionDate.trim()) ||
        (typeof floor.surveyNotes === 'string' && floor.surveyNotes.trim()) ||
        (Array.isArray(floor.customSurfaces) && floor.customSurfaces.length) ||
        floor.lastExportedAt) {
      return true;
    }
    const floorLayers = floor.byCanvasId && typeof floor.byCanvasId === 'object'
      ? Object.values(floor.byCanvasId)
      : [];
    if (floorLayers.some(function (layer) {
      if (!layer || typeof layer !== 'object') return false;
      return (
        (Array.isArray(layer.points) && layer.points.length) ||
        (Array.isArray(layer.boundary) && layer.boundary.length) ||
        (Array.isArray(layer.areas) && layer.areas.length) ||
        (Array.isArray(layer.notes) && layer.notes.length) ||
        (Array.isArray(layer.transitions) && layer.transitions.length) ||
        (Array.isArray(layer.exclusions) && layer.exclusions.length) ||
        (layer.transitionGroupAverages && Object.keys(layer.transitionGroupAverages).length) ||
        !!layer.scale ||
        !!layer.bp1Gps ||
        !!layer.planTransform
      );
    })) {
      return true;
    }

    return ['diagnostics', 'report', 'reportBuilder'].some(function (key) {
      const container = record[key];
      return !!(container && typeof container === 'object' && Object.keys(container).length);
    });
  }

  /**
   * Field capture that gates list-row Delete (Tim, Nov 7, 2026).
   * Distress pin locations with pictures, or Floor Survey points.
   * A floor plan alone is not this bar — plans may still delete locally
   * from the On-this-device ••• menu.
   */
  function hasFieldCaptureCustomerData(record) {
    if (!record) return false;
    const distress = record.distress || {};
    const pins = Array.isArray(distress.pins) ? distress.pins : [];
    for (let i = 0; i < pins.length; i++) {
      const photos = pins[i] && Array.isArray(pins[i].photos) ? pins[i].photos : [];
      if (photos.length) return true;
    }
    if (Array.isArray(distress.quickCapture) && distress.quickCapture.length) return true;
    if (distress.photoSources && typeof distress.photoSources === 'object' &&
        Object.keys(distress.photoSources).length) {
      return true;
    }
    const walk = distress.jobWalk && typeof distress.jobWalk === 'object' ? distress.jobWalk : null;
    if (walk && Array.isArray(walk.videos) && walk.videos.length) return true;
    if (walk && Array.isArray(walk.notes) && walk.notes.some(function (note) {
      return !!(note && (note.audioId || (typeof note.text === 'string' && note.text.trim())));
    })) {
      return true;
    }
    const floor = record.floorSurvey || {};
    const layers = floor.byCanvasId && typeof floor.byCanvasId === 'object'
      ? Object.values(floor.byCanvasId)
      : [];
    return layers.some(function (layer) {
      return !!(layer && Array.isArray(layer.points) && layer.points.length);
    });
  }

  /**
   * A positive no-remote result may delete on this device.
   * An empty stub asks once. A file with customer or survey information
   * asks once, then deletes locally. Unknown cabinet status is not this path.
   */
  function isEmptyCustomerFileStub(record) {
    if (!record) return true;
    if (hasInvestigationData(record)) return false;
    if (planReadiness(record).hasPlan) return false;
    const textKeys = [
      'firstName', 'lastName', 'propertyAddress', 'mailingAddress',
      'cellPhone', 'homePhone', 'email', 'notes', 'companyName',
      'spouseName', 'spouseCellPhone', 'spouseHomePhone', 'spouseEmail',
    ];
    for (let i = 0; i < textKeys.length; i++) {
      if ((record[textKeys[i]] || '').trim()) return false;
    }
    if (record.mailingSameAsProperty) return false;
    if (record.propertyAddressLat != null || record.propertyAddressLon != null) return false;
    return true;
  }

  function cabinetTrashPending(record) {
    return !!(record && record.cabinetTrashRequestedAt);
  }

  function isLegacyLocalTrash(record) {
    return !!(record && record.deletedAt && !cabinetTrashPending(record));
  }

  function confirmAction(options) {
    let overlay = document.getElementById('toolbox-confirm');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'toolbox-confirm';
      overlay.className = 'confirm-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<section class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">' +
        '  <h2 id="confirm-title"></h2>' +
        '  <p id="confirm-message"></p>' +
        '  <label class="confirm-card__phrase" id="confirm-phrase" hidden>' +
        '    <span id="confirm-phrase-label"></span>' +
        '    <input type="text" id="confirm-phrase-input" autocomplete="off" autocapitalize="characters" spellcheck="false" />' +
        '  </label>' +
        '  <div class="confirm-card__actions">' +
        '    <button type="button" id="confirm-no" class="btn btn--secondary">No, keep it</button>' +
        '    <button type="button" id="confirm-yes" class="btn btn--danger">Yes</button>' +
        '  </div>' +
        '</section>';
      document.body.appendChild(overlay);
    }

    const title = overlay.querySelector('#confirm-title');
    const message = overlay.querySelector('#confirm-message');
    const phrase = overlay.querySelector('#confirm-phrase');
    const phraseLabel = overlay.querySelector('#confirm-phrase-label');
    const phraseInput = overlay.querySelector('#confirm-phrase-input');
    const noBtn = overlay.querySelector('#confirm-no');
    const yesBtn = overlay.querySelector('#confirm-yes');
    const requiredText = typeof options.requireText === 'string' ? options.requireText : '';
    title.textContent = options.title;
    message.textContent = options.message;
    noBtn.textContent = options.cancelLabel || 'No, keep it';
    yesBtn.textContent = options.confirmLabel || 'Yes';
    yesBtn.disabled = false;
    if (phrase && phraseInput) {
      phraseInput.value = '';
      if (requiredText) {
        phrase.hidden = false;
        if (phraseLabel) phraseLabel.textContent = 'Type ' + requiredText + ' to confirm';
        yesBtn.disabled = true;
      } else {
        phrase.hidden = true;
      }
    }
    overlay.hidden = false;
    if (requiredText && phraseInput) phraseInput.focus();
    else noBtn.focus();

    return new Promise(function (resolve) {
      function onPhraseInput() {
        yesBtn.disabled = !phraseInput || phraseInput.value !== requiredText;
      }
      function finish(result) {
        overlay.hidden = true;
        yesBtn.disabled = false;
        if (phraseInput) phraseInput.removeEventListener('input', onPhraseInput);
        noBtn.removeEventListener('click', cancel);
        yesBtn.removeEventListener('click', confirm);
        overlay.removeEventListener('click', outside);
        document.removeEventListener('keydown', escape);
        resolve(result);
      }
      function cancel() { finish(false); }
      function confirm() {
        if (yesBtn.disabled) return;
        if (requiredText && (!phraseInput || phraseInput.value !== requiredText)) return;
        finish(true);
      }
      function outside(event) { if (event.target === overlay) cancel(); }
      function escape(event) { if (event.key === 'Escape') cancel(); }
      if (requiredText && phraseInput) phraseInput.addEventListener('input', onPhraseInput);
      noBtn.addEventListener('click', cancel);
      yesBtn.addEventListener('click', confirm);
      overlay.addEventListener('click', outside);
      document.addEventListener('keydown', escape);
    });
  }

  // ---- Routing ----------------------------------------------------------
  //
  // #/file/:id          → Customer File home (hub; Sandia Geo or TLS side)
  // #/file/:id/tls      → TLS side of the same Customer File
  // #/file/:id/job-walk → Job Walk (TLS)
  // #/file/:id/edit     → edit contact + plans
  // #/file/:id/plan     → redirect to edit (legacy)
  // #/file/:id/report   → Report Builder workspace shell
  // #/file/:id/repair   → Plan of Repair worksheet
  // #/file/:id/diagnostics → existing Floor Survey 3D view
  // #/file/:id/<app>    → connected workspace, or a not-yet-connected stub

  function fileSideKey(id) {
    return 'toolbox.cf.side.' + String(id || '');
  }

  function getFileSide(id) {
    try {
      return sessionStorage.getItem(fileSideKey(id)) === 'tls' ? 'tls' : 'geo';
    } catch (err) {
      return 'geo';
    }
  }

  function setFileSide(id, side) {
    try {
      sessionStorage.setItem(fileSideKey(id), side === 'tls' ? 'tls' : 'geo');
    } catch (err) { /* ignore */ }
  }

  function mapsPreferenceSync() {
    try {
      const v = localStorage.getItem('toolbox.mapsPreference');
      return v === 'apple' || v === 'google' ? v : null;
    } catch (err) {
      return null;
    }
  }

  function rememberMapsPreference(value) {
    try {
      localStorage.setItem('toolbox.mapsPreference', value);
    } catch (err) { /* ignore */ }
    if (window.ToolboxDB && typeof window.ToolboxDB.putSetting === 'function') {
      window.ToolboxDB.putSetting('mapsPreference', value).catch(function () {});
    }
  }

  function openMapsUrl(kind, address) {
    const encoded = encodeURIComponent(String(address || '').trim());
    if (!encoded) return;
    if (kind === 'apple') {
      window.open('https://maps.apple.com/?daddr=' + encoded, '_blank', 'noopener');
      return;
    }
    window.open('https://www.google.com/maps/dir/?api=1&destination=' + encoded, '_blank', 'noopener');
  }

  function openVisitNotesReader(record) {
    const notes = record && record.distress && record.distress.jobWalk &&
      Array.isArray(record.distress.jobWalk.notes)
      ? record.distress.jobWalk.notes.slice().reverse()
      : [];
    const existing = document.getElementById('visit-notes-reader');
    if (existing) existing.parentNode.removeChild(existing);
    const overlay = document.createElement('div');
    overlay.id = 'visit-notes-reader';
    overlay.className = 'maps-choice';
    const card = document.createElement('div');
    card.className = 'maps-choice__card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Visit notes');
    const title = document.createElement('p');
    title.className = 'maps-choice__title';
    title.textContent = 'Visit notes';
    card.appendChild(title);
    const list = document.createElement('div');
    list.className = 'jw-notes';
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'jw-empty';
      empty.textContent = 'No visit notes on this Customer File.';
      list.appendChild(empty);
    } else {
      notes.forEach(function (note) {
        const article = document.createElement('article');
        article.className = 'jw-note';
        const head = document.createElement('header');
        head.className = 'jw-note__head';
        const who = note.speaker === 'homeowner' ? 'Homeowner' : 'Investigator';
        const when = note.at ? new Date(note.at).toLocaleString() : '';
        head.textContent = who + (when ? ' · ' + when : '');
        article.appendChild(head);
        if (note.text) {
          const text = document.createElement('p');
          text.className = 'jw-note__text';
          text.textContent = note.text;
          article.appendChild(text);
        }
        if (note.audioId) {
          const audio = document.createElement('audio');
          audio.controls = true;
          audio.preload = 'none';
          audio.className = 'jw-note__audio';
          var getAudio = window.ToolboxJobWalk &&
            typeof window.ToolboxJobWalk.getStoredMedia === 'function'
            ? window.ToolboxJobWalk.getStoredMedia
            : null;
          if (getAudio) {
            getAudio(note.audioId).then(function (value) {
              if (typeof value === 'string' && value.indexOf('data:') === 0) {
                audio.src = value;
              } else if (value instanceof Blob) {
                audio.src = URL.createObjectURL(value);
              }
            }).catch(function () {});
          }
          article.appendChild(audio);
        }
        list.appendChild(article);
      });
    }
    card.appendChild(list);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--secondary';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    card.appendChild(closeBtn);
    overlay.appendChild(card);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    });
    document.body.appendChild(overlay);
  }

  /** Must run inside the user tap — no async before window.open (iPhone Safari). */
  function openPropertyDirections(address) {
    const dest = String(address || '').trim();
    if (!dest) return;
    const pref = mapsPreferenceSync();
    if (pref === 'apple' || pref === 'google') {
      openMapsUrl(pref, dest);
      return;
    }
    const existing = document.getElementById('maps-choice');
    if (existing) existing.parentNode.removeChild(existing);
    const overlay = document.createElement('div');
    overlay.id = 'maps-choice';
    overlay.className = 'maps-choice';
    overlay.innerHTML =
      '<div class="maps-choice__card" role="dialog" aria-label="Directions app">' +
      '  <p class="maps-choice__title">Open directions with</p>' +
      '  <button type="button" class="btn btn--accent" data-maps="apple">Apple Maps</button>' +
      '  <button type="button" class="btn btn--secondary" data-maps="google">Google Maps</button>' +
      '  <button type="button" class="btn btn--quiet" data-maps="cancel">Cancel</button>' +
      '</div>';
    overlay.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-maps]');
      if (!btn) return;
      const kind = btn.getAttribute('data-maps');
      if (kind === 'apple' || kind === 'google') {
        rememberMapsPreference(kind);
        openMapsUrl(kind, dest);
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

  function changeMapsPreference() {
    try { localStorage.removeItem('toolbox.mapsPreference'); } catch (err) { /* ignore */ }
    if (window.ToolboxDB && typeof window.ToolboxDB.putSetting === 'function') {
      window.ToolboxDB.putSetting('mapsPreference', '').catch(function () {});
    }
  }

  function parseRoute() {
    const hash = window.location.hash || '#/';
    if (hash === '#/cabinet/trash') return { view: 'file-cabinet-trash' };
    if (hash === '#/trash') return { view: 'local-trash' };
    if (hash === '#/cabinet') return { view: 'file-cabinet' };
    if (hash === '#/explore' || hash === '#/explore/') return { view: 'explore', id: null };
    const exploreMatch = hash.match(/^#\/explore\/([^/]+)$/);
    if (exploreMatch) return { view: 'explore', id: decodeURIComponent(exploreMatch[1]) };
    if (hash === '#/import') return { view: 'import', id: null, allowDestinationChoice: true };
    const match = hash.match(/^#\/file\/([^/]+)(?:\/(edit|plan|import|distress|floor|diagnostics|report|repair|tls|job-walk))?(?:\/(customer|contacts|plans))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const sub = match[2] || null;
      const section = match[3] || null;
      if (sub === 'plan') return { view: 'edit', id: id, section: 'plans', legacyPlan: true };
      if (sub === 'edit') return { view: 'edit', id: id, section: section };
      if (sub === 'floor') {
        return { view: 'floor', id: id };
      }
      if (sub === 'distress') {
        return { view: 'distress', id: id };
      }
      if (sub === 'import') {
        return { view: 'import', id: id, allowDestinationChoice: false };
      }
      if (sub === 'report') {
        return { view: 'report', id: id };
      }
      if (sub === 'repair') {
        return { view: 'repair', id: id, side: 'tls' };
      }
      if (sub === 'job-walk') {
        return { view: 'job-walk', id: id, side: 'tls' };
      }
      if (sub === 'tls') {
        return { view: 'home', id: id, side: 'tls' };
      }
      if (sub === 'diagnostics') {
        return { view: 'diagnostics', id: id };
      }
      // Normal open is always Sandia Geo. TLS is only via /tls or Open in TLS.
      return { view: 'home', id: id, side: 'geo' };
    }
    return { view: 'cabinet' };
  }

  function render() {
    const app = document.getElementById('app-view');
    if (!app) return;
    const route = parseRoute();
    if (route.id && isMutatingRoute(route.view) &&
        window.ToolboxSync && typeof window.ToolboxSync.isCheckedOutElsewhere === 'function' &&
        window.ToolboxSync.isCheckedOutElsewhere(route.id)) {
      route.view = 'checked-out-readonly';
    }
    if (route.view !== 'floor' && route.view !== 'diagnostics') {
      document.body.classList.remove('floor-survey-open', 'diagnostics-open');
      app.classList.remove('canvas--floor-survey');
      if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
        window.ToolboxFloorSurvey.unmount();
      }
    } else if (route.view === 'floor') {
      document.body.classList.remove('diagnostics-open');
    }
    if (route.view !== 'distress') {
      document.body.classList.remove('distress-survey-open');
      app.classList.remove('canvas--distress-survey');
      if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
        window.ToolboxDistress.unmount();
      }
    }
    if (route.view !== 'report') {
      document.body.classList.remove('report-builder-open');
      if (window.ToolboxReportBuilder && typeof window.ToolboxReportBuilder.unmount === 'function') {
        window.ToolboxReportBuilder.unmount();
      }
    }
    if (route.view !== 'repair') {
      document.body.classList.remove('plan-of-repair-open');
      if (window.ToolboxPlanOfRepair && typeof window.ToolboxPlanOfRepair.unmount === 'function') {
        window.ToolboxPlanOfRepair.unmount();
      }
    }
    if (route.view !== 'job-walk') {
      document.body.classList.remove('job-walk-open');
      if (window.ToolboxJobWalk && typeof window.ToolboxJobWalk.unmount === 'function') {
        window.ToolboxJobWalk.unmount();
      }
    }
    const onTlsSide = route.side === 'tls' ||
      route.view === 'repair' ||
      route.view === 'job-walk' ||
      (route.view === 'home' && route.side === 'tls');
    document.body.classList.toggle('tls-side', !!onTlsSide);
    // Photo folders / shared photo viewer are visit chrome. Close when leaving
    // the owning Customer File hub or switching files — not on same-hub redraw.
    if (window.ToolboxRecoveredPhotos) {
      try {
        if (route.view !== 'home' || !route.id) {
          if (typeof window.ToolboxRecoveredPhotos.close === 'function') {
            window.ToolboxRecoveredPhotos.close();
          }
        } else if (typeof window.ToolboxRecoveredPhotos.closeUnlessFile === 'function') {
          window.ToolboxRecoveredPhotos.closeUnlessFile(route.id);
        }
      } catch (_) {}
    }
    if (route.legacyPlan) {
      window.location.replace('#/file/' + encodeURIComponent(route.id) + '/edit/plans');
      return;
    }
    if (route.view === 'checked-out-readonly') {
      renderCheckedOutReadOnly(app, route.id);
    } else if (route.view === 'edit') {
      renderFileEdit(app, route.id, route.section);
    } else if (route.view === 'home') {
      // Visits open the visit card, not Sandia Geo / TLS home.
      window.ToolboxDB.getCustomerFile(route.id).then(function (rec) {
        if (rec && isVisitRecord(rec) && route.side !== 'tls') {
          window.location.replace('#/file/' + encodeURIComponent(route.id) + '/job-walk');
          return;
        }
        const side = route.side === 'tls' ? 'tls' : 'geo';
        setFileSide(route.id, side);
        renderFileHome(app, route.id, side);
      }).catch(function () {
        const side = route.side === 'tls' ? 'tls' : 'geo';
        setFileSide(route.id, side);
        renderFileHome(app, route.id, side);
      });
    } else if (route.view === 'job-walk') {
      setFileSide(route.id, 'tls');
      renderJobWalk(app, route.id);
    } else if (route.view === 'floor') {
      renderFloorSurvey(app, route.id);
    } else if (route.view === 'distress') {
      renderDistressSurvey(app, route.id);
    } else if (route.view === 'import') {
      renderCustomerFileImport(app, route.id, { allowDestinationChoice: !!route.allowDestinationChoice });
    } else if (route.view === 'report') {
      renderReportBuilder(app, route.id);
    } else if (route.view === 'repair') {
      setFileSide(route.id, 'tls');
      renderPlanOfRepair(app, route.id);
    } else if (route.view === 'diagnostics') {
      renderDiagnostics(app, route.id);
    } else if (route.view === 'app-stub') {
      renderAppStub(app, route.id, route.app);
    } else if (route.view === 'local-trash') {
      renderLocalTrashRecovery(app);
    } else if (route.view === 'file-cabinet-trash') {
      renderFileCabinetTrash(app);
    } else if (route.view === 'file-cabinet') {
      renderFileCabinet(app);
    } else if (route.view === 'explore') {
      if (window.ToolboxFileExplorer && typeof window.ToolboxFileExplorer.render === 'function') {
        window.ToolboxFileExplorer.render(app, route.id || null);
      } else {
        app.innerHTML = '<p class="cabinet-empty">File Explorer is unavailable.</p>';
      }
    } else {
      renderCabinet(app);
    }
  }

  // ---- Customer Files (working area) + dedicated File Cabinet ----------

  let cabinetNotice = '';

  function renderCabinet(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="customer-files">' +
      '<section class="cabinet-hero">' +
      '  <div class="cabinet-hero__heading">' +
      '    <p class="eyebrow">Toolbox</p>' +
      '    <h1>Customer Files</h1>' +
      '  </div>' +
      '  <div class="cabinet-hero__actions">' +
      '    <button type="button" id="cabinet-new" class="btn btn--accent cabinet-new">+ New Customer File</button>' +
      '    <button type="button" id="cabinet-visit" class="btn btn--secondary cabinet-visit">+ Initial Visit</button>' +
      '    <button type="button" id="cabinet-import" class="btn btn--secondary">Import standalone export</button>' +
      '  </div>' +
      '  <p class="cabinet-hero__lead">Open a job or create a file. Customer details and plans stay together.</p>' +
      '</section>' +
      '<p class="cabinet-notice" id="cabinet-notice" hidden></p>' +
      '<h2 class="cabinet-section-title" id="cabinet-jobs-title">Customer Files</h2>' +
      '<div class="cabinet-list" id="cabinet-list"></div>' +
      '<h2 class="cabinet-section-title" id="cabinet-visits-title" hidden>Visits</h2>' +
      '<div class="cabinet-list" id="cabinet-visits-list" hidden></div>' +
      '<button type="button" id="local-trash-recovery" class="local-trash-recovery" hidden>Recover files saved only on this device</button>' +
      '<button type="button" class="file-cabinet-entry" id="open-file-cabinet" aria-label="Open File Cabinet">' +
      '  <div class="file-cabinet-entry__main">' +
      '    <div class="file-cabinet-entry__title">File Cabinet</div>' +
      '    <div class="file-cabinet-entry__note">Browse cloud Customer Files. Check Out brings one onto this device.</div>' +
      '  </div>' +
      '  <span class="file-cabinet-entry__cta">Open File Cabinet ›</span>' +
      '</button>' +
      '</div>';

    const listEl = app.querySelector('#cabinet-list');
    const visitsEl = app.querySelector('#cabinet-visits-list');
    const visitsTitle = app.querySelector('#cabinet-visits-title');
    const newBtn = app.querySelector('#cabinet-new');
    const visitBtn = app.querySelector('#cabinet-visit');
    const importBtn = app.querySelector('#cabinet-import');
    const localTrashLink = app.querySelector('#local-trash-recovery');
    const notice = app.querySelector('#cabinet-notice');
    const openCabinetBtn = app.querySelector('#open-file-cabinet');

    if (cabinetNotice) {
      notice.textContent = cabinetNotice;
      notice.hidden = false;
      cabinetNotice = '';
    }

    newBtn.addEventListener('click', function () {
      window.location.hash = '#/file/' + generateId() + '/edit';
    });
    if (visitBtn) {
      visitBtn.addEventListener('click', function () {
        openInitialVisitDialog();
      });
    }
    importBtn.addEventListener('click', function () {
      window.location.hash = '#/import';
    });
    localTrashLink.addEventListener('click', function () {
      window.location.hash = '#/trash';
    });
    openCabinetBtn.addEventListener('click', function () {
      window.location.hash = '#/cabinet';
    });

    listEl.innerHTML = '<p class="cabinet-empty">Loading Customer Files…</p>';

    window.ToolboxDB.purgeExpiredCustomerFiles().catch(function (err) {
      console.warn('Could not purge expired Customer Files:', err);
    }).then(function () {
      return window.ToolboxDB.getAllCustomerFiles();
    }).then(function (allRecords) {
      const trashed = allRecords.filter(isLegacyLocalTrash);
      const records = allRecords.filter(function (record) {
        return record && (!record.deletedAt || cabinetTrashPending(record));
      });
      refreshLocalTrashRecoveryLink(localTrashLink, trashed);
      records.sort(function (a, b) {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });

      function paintRows() {
        listEl.innerHTML = '';
        if (visitsEl) visitsEl.innerHTML = '';
        const jobs = records.filter(function (r) { return !isVisitRecord(r); });
        const visits = records.filter(isVisitRecord).sort(function (a, b) {
          return visitScheduleSortKey(a).localeCompare(visitScheduleSortKey(b));
        });
        if (jobs.length === 0) {
          const p = document.createElement('p');
          p.className = 'cabinet-empty';
          p.textContent = 'No Customer Files on this device yet.';
          listEl.appendChild(p);
        } else {
          jobs.forEach(function (record) {
            listEl.appendChild(cabinetRowNode(record));
          });
        }
        if (visitsTitle && visitsEl) {
          if (visits.length) {
            visitsTitle.hidden = false;
            visitsEl.hidden = false;
            visits.forEach(function (record) {
              visitsEl.appendChild(cabinetRowNode(record));
            });
          } else {
            visitsTitle.hidden = true;
            visitsEl.hidden = true;
          }
        }
      }

      paintRows();
      if (window.ToolboxSync && typeof window.ToolboxSync.refreshLocalCheckoutLocks === 'function') {
        window.ToolboxSync.refreshLocalCheckoutLocks().then(function (result) {
          if (!result || !result.ok || !listEl.isConnected) return;
          paintRows();
        }).catch(function () {});
      }
    }).catch(function (err) {
      console.error('Failed to load Customer Files:', err);
      listEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'cabinet-empty';
      p.textContent = 'Unable to load Customer Files right now.';
      listEl.appendChild(p);
    });

    app.onclick = function (event) {
      if (event.target.closest('.cabinet-row-menu')) return;
      app.querySelectorAll('.cabinet-row-menu.is-open').forEach(function (menu) {
        menu.classList.remove('is-open');
      });
    };
  }

  /**
   * Quiet file-location helper for Customer File cards.
   * Uses only authoritative state already available to the row — never guesses.
   *
   * - remoteCabinet: entry came from File Cabinet remote inventory (browseCabinet).
   * - localWorking: local Customer Files list row; checkedOutFromCabinet is durable
   *   checkout provenance. Unmarked locals are ambiguous (true local-only vs legacy
   *   local + same-id remote) without remote presence already loaded on this screen,
   *   so no "On this device only" label is emitted until that can be decided safely.
   */
  function isMutatingRoute(view) {
    return view === 'edit' || view === 'floor' || view === 'distress' ||
      view === 'import' || view === 'report' || view === 'repair' ||
      view === 'diagnostics' || view === 'app-stub' || view === 'job-walk';
  }

  function customerFileLocationLabel(kind, record) {
    if (kind === 'remoteCabinet') return 'File Cabinet — Online';
    if (kind === 'localWorking') {
      if (cabinetTrashPending(record)) return 'Waiting to move to File Cabinet Trash';
      if (record && window.ToolboxSync &&
          typeof window.ToolboxSync.foreignCheckoutLabel === 'function') {
        const locked = window.ToolboxSync.foreignCheckoutLabel(record.id);
        if (locked) return locked;
      }
      if (record && window.ToolboxSync &&
          typeof window.ToolboxSync.isCheckedOutFromCabinet === 'function' &&
          window.ToolboxSync.isCheckedOutFromCabinet(record)) {
        return 'Checked out to this device — Check in when finished';
      }
      return '';
    }
    return '';
  }

  function appendLocationStatus(parent, label) {
    if (!parent || !label) return;
    const location = document.createElement(parent.tagName === 'SPAN' ? 'span' : 'div');
    location.className = 'cabinet-row__location';
    location.textContent = label;
    parent.appendChild(location);
  }

  function filterCabinetEntries(entries, query) {
    const list = Array.isArray(entries) ? entries : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list.slice();
    const digits = q.replace(/\D/g, '');
    return list.filter(function (entry) {
      if (!entry) return false;
      const hay = cabinetSearchHaystack(entry);
      if (hay.indexOf(q) !== -1) return true;
      // Phone numbers are stored with punctuation. A digit query still matches.
      return digits.length >= 3 && hay.replace(/\D/g, '').indexOf(digits) !== -1;
    });
  }

  function cabinetSearchHaystack(entry) {
    const keys = [
      'displayName', 'displayNameSearch',
      'propertyAddress', 'propertyAddressSearch',
      'mailingAddress', 'companyName', 'spouseName',
      'email', 'spouseEmail',
      'cellPhone', 'homePhone', 'spouseCellPhone', 'spouseHomePhone',
      'firstName', 'lastName',
    ];
    return keys.map(function (key) {
      return String(entry[key] || '');
    }).join('\n').toLowerCase();
  }

  function cabinetIndexAddress(entry) {
    const address = String(entry && entry.propertyAddress || '').split('\n')[0].trim();
    return address || 'No property address';
  }

  function cabinetIndexOwner(entry) {
    return String(entry && entry.displayName || '').trim() || 'Customer File';
  }

  /** Is the lease ours while the file itself never arrived? */
  function heldButNotHere(entry) {
    return !!entry && entry.availability === 'checked-out-here' && entry.presence !== 'local';
  }

  function cabinetIndexStatus(entry) {
    if (!entry) return '';
    // "On this device" used to be said on the strength of the lease alone.
    // A Check Out takes the lease first and brings the file down after, so a
    // download that did not finish left the row claiming the job was here
    // while the device held nothing -- and the Check Out button is only drawn
    // for a row marked available, so there was no way back in. Tim, looking
    // at exactly that: "it says it's on this device and it's clearly not --
    // where the hell did it go?" Nothing was lost; the Cabinet copy is whole.
    // The row says what is true, and offers the action that finishes it.
    if (heldButNotHere(entry)) return 'Checked out here · not downloaded yet';
    if (entry.availability === 'checked-out-here') return 'On this device';
    if (entry.availability === 'checked-out-elsewhere') {
      const who = entry.checkout && entry.checkout.email ? entry.checkout.email : '';
      return who ? 'Checked out elsewhere (' + who + ')' : 'Checked out elsewhere';
    }
    if (entry.presence === 'local') return 'On this device';
    return '';
  }

  /**
   * Field-work date for a browse row. Survey date wins. Customer File
   * createdAt is the only fallback. updatedAt and checkout times are not dates.
   */
  function cabinetIndexDateValue(entry) {
    if (!entry) return '';
    const survey = String(entry.fieldWorkDate || '').trim();
    if (survey) return survey;
    return String(entry.createdAt || '').trim();
  }

  function formatFieldWorkDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    let date;
    if (day) {
      date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    } else {
      const parsed = Date.parse(text);
      if (!Number.isFinite(parsed)) return '';
      date = new Date(parsed);
    }
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cabinetInventoryEntries(browse) {
    const entries = ((browse && browse.entries) || []).filter(function (entry) {
      return entry && !entry.deletedAt;
    });
    // Dedicated Cabinet focuses on cloud inventory; local-only drafts stay on Customer Files.
    return entries.filter(function (entry) {
      return entry.presence !== 'local' || entry.availability === 'checked-out-elsewhere' ||
        entry.availability === 'checked-out-here';
    });
  }

  function renderFileCabinet(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="file-cabinet-back" class="btn btn--ghost">‹ Customer Files</button>' +
      '  <div class="file-identity"><span class="file-identity__name">File Cabinet</span></div>' +
      '</div>' +
      '<section class="file-cabinet-view">' +
      '  <header class="file-cabinet-head">' +
      '    <div>' +
      '      <p class="eyebrow">Cloud file management</p>' +
      '      <h1>File Cabinet</h1>' +
      '      <p>Browse cloud Customer Files. Check Out brings one onto this device. Move to Trash removes one you do not want, and Trash holds it until you restore or permanently delete it.</p>' +
      '      <p class="file-cabinet-cleanup" id="file-cabinet-cleanup" hidden>Deleted files are old enough to clean up.</p>' +
      '    </div>' +
      '    <button type="button" id="file-cabinet-trash" class="btn btn--secondary file-cabinet-trash">Trash</button>' +
      '  </header>' +
      '  <label class="file-cabinet-search">' +
      '    <span class="sr-only">Search File Cabinet</span>' +
      '    <input type="search" id="file-cabinet-search" placeholder="Search name, address, or contact" autocomplete="off" />' +
      '  </label>' +
      '  <p class="cabinet-notice" id="file-cabinet-notice" hidden></p>' +
      '  <div class="cabinet-list cabinet-list--cloud" id="file-cabinet-list">' +
      '    <p class="cabinet-empty">Loading File Cabinet…</p>' +
      '  </div>' +
      '</section>';

    const listEl = app.querySelector('#file-cabinet-list');
    const searchInput = app.querySelector('#file-cabinet-search');
    let inventory = [];

    app.querySelector('#file-cabinet-back').addEventListener('click', function () {
      window.location.hash = '#/';
    });
    const cabinetTrashBtn = app.querySelector('#file-cabinet-trash');
    if (cabinetTrashBtn) {
      cabinetTrashBtn.addEventListener('click', function () {
        window.location.hash = '#/cabinet/trash';
      });
    }
    function compareCabinetEntries(a, b) {
      const addressA = String(a.propertyAddress || '').trim().toLocaleLowerCase();
      const addressB = String(b.propertyAddress || '').trim().toLocaleLowerCase();
      if (!addressA && addressB) return 1;
      if (addressA && !addressB) return -1;
      const byAddress = addressA.localeCompare(addressB);
      if (byAddress) return byAddress;
      return String(a.displayName || '').trim().toLocaleLowerCase()
        .localeCompare(String(b.displayName || '').trim().toLocaleLowerCase());
    }

    function applyCabinetBrowse(browse) {
      const cleanup = app.querySelector('#file-cabinet-cleanup');
      if (cleanup) {
        const eligibleCleanup = ((browse && browse.entries) || []).some(function (entry) {
          if (!entry || !entry.deletedAt) return false;
          const at = Date.parse(entry.purgeAfter);
          return Number.isFinite(at) && at <= Date.now();
        });
        cleanup.hidden = !eligibleCleanup;
      }
      inventory = cabinetInventoryEntries(browse);
      paintList();
      return browse;
    }

    function paintList() {
      const filtered = filterCabinetEntries(inventory, searchInput.value);
      listEl.innerHTML = '';
      if (!filtered.length) {
        const p = document.createElement('p');
        p.className = 'cabinet-empty';
        p.textContent = inventory.length
          ? 'No Customer Files match that search.'
          : 'No cloud Customer Files in the File Cabinet yet.';
        listEl.appendChild(p);
        return;
      }
      const jobs = filtered.filter(function (entry) { return entry.status !== 'visit'; });
      const visits = filtered.filter(function (entry) { return entry.status === 'visit'; });
      jobs.sort(compareCabinetEntries);
      visits.sort(compareCabinetEntries);
      if (jobs.length) {
        const h = document.createElement('h2');
        h.className = 'cabinet-section-title';
        h.textContent = 'Customer Files';
        listEl.appendChild(h);
        jobs.forEach(function (entry) {
          listEl.appendChild(cabinetCloudRowNode(entry, app));
        });
      }
      if (visits.length) {
        const h = document.createElement('h2');
        h.className = 'cabinet-section-title';
        h.textContent = 'Visits';
        listEl.appendChild(h);
        visits.forEach(function (entry) {
          listEl.appendChild(cabinetCloudRowNode(entry, app));
        });
      }
      if (!jobs.length && !visits.length) {
        const p = document.createElement('p');
        p.className = 'cabinet-empty';
        p.textContent = 'No Customer Files match that search.';
        listEl.appendChild(p);
      }
    }

    searchInput.addEventListener('input', paintList);

    if (!window.ToolboxSync || typeof window.ToolboxSync.browseCabinet !== 'function' ||
        !window.ToolboxSync.syncApiBase || !window.ToolboxSync.syncApiBase()) {
      listEl.innerHTML = '<p class="cabinet-empty">Sign in / Sync not configured — File Cabinet browse unavailable.</p>';
      return;
    }

    window.ToolboxSync.browseCabinet().then(applyCabinetBrowse).catch(function (err) {
      const code = err && err.code;
      listEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'cabinet-empty';
      if (code === 'auth') p.textContent = 'Sign in to browse the File Cabinet.';
      else if (code === 'offline' || code === 'network') p.textContent = 'Offline — File Cabinet browse needs a network connection.';
      else if (code === 'config') p.textContent = 'Sync is not configured yet.';
      else p.textContent = 'Unable to load File Cabinet right now.';
      listEl.appendChild(p);
      console.warn('File Cabinet browse failed:', err);
    });
  }

  function cabinetCloudRowNode(entry, app) {
    const shell = document.createElement('div');
    shell.className = 'cabinet-row-shell cabinet-row-shell--cloud' +
      (entry.availability === 'checked-out-elsewhere' ? ' is-checked-out-elsewhere' : '');
    shell.dataset.customerFileId = entry.id;

    const row = document.createElement('div');
    row.className = 'cabinet-row cabinet-row--cloud';

    const main = document.createElement('div');
    main.className = 'cabinet-row__main';

    const index = document.createElement('div');
    index.className = 'cabinet-index';

    const address = document.createElement('span');
    address.className = 'cabinet-index__address';
    address.textContent = cabinetIndexAddress(entry);

    const meta = document.createElement('span');
    meta.className = 'cabinet-index__meta';

    const owner = document.createElement('span');
    owner.className = 'cabinet-index__owner';
    owner.textContent = cabinetIndexOwner(entry);
    meta.appendChild(owner);

    const dateValue = cabinetIndexDateValue(entry);
    const dateLabel = formatFieldWorkDate(dateValue);
    if (dateLabel) {
      meta.appendChild(document.createTextNode(' · '));
      const date = document.createElement('time');
      date.className = 'cabinet-index__date';
      date.dateTime = dateValue;
      date.textContent = dateLabel;
      meta.appendChild(date);
    }

    const statusLabel = cabinetIndexStatus(entry);
    if (statusLabel) {
      meta.appendChild(document.createTextNode(' · '));
      const status = document.createElement('span');
      status.className = 'cabinet-index__status';
      status.textContent = statusLabel;
      meta.appendChild(status);
    }

    index.appendChild(address);
    index.appendChild(meta);
    main.appendChild(index);
    row.classList.add('cabinet-row--index');
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'cabinet-row__actions';
    const unfinished = heldButNotHere(entry);
    if (unfinished || (entry.availability === 'available' && entry.presence !== 'local')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--secondary cabinet-checkout-btn';
      // Taking the lease again is the same call: the server hands this device
      // back the lease it already holds, and the file comes down this time.
      btn.textContent = unfinished ? 'Finish Check Out' : 'Check Out';
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        btn.disabled = true;
        btn.textContent = unfinished ? 'Downloading…' : 'Checking out…';
        const stop = watchSyncProgress(function (where) { btn.textContent = where; });
        window.ToolboxSync.checkOutCustomerFile(entry.id).then(function (result) {
          stop();
          // A report picture the Cabinet could not hand over no longer takes
          // the whole job down with it, so the job arrives and the picture
          // that did not is said here rather than found as an empty frame
          // later on.
          const leftBehind = typeof window.ToolboxSync.describeMissingMedia === 'function'
            ? window.ToolboxSync.describeMissingMedia(result && result.missingMedia)
            : '';
          cabinetNotice = (entry.displayName || 'Customer File') + ' checked out to this device.' +
            (leftBehind ? ' ' + leftBehind : '');
          window.location.hash = '#/';
        }).catch(function (err) {
          stop();
          console.warn('Check Out failed:', err);
          cabinetNotice = (err && err.message) || 'Check Out failed.';
          // Stay on File Cabinet so the failure notice is visible after re-render.
          renderFileCabinet(app);
          showFileCabinetNotice(app);
        });
      });
      actions.appendChild(btn);
    } else if (entry.presence === 'local') {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn--secondary cabinet-checkout-btn';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', function () {
        window.location.hash = '#/file/' + encodeURIComponent(entry.id);
      });
      actions.appendChild(openBtn);
    }

    // A cloud-only job had no way out of the Cabinet. The only route to
    // Trash ran through a device's own working copy, so a job you did not
    // want on the device -- an empty one, a mistake -- could not be deleted
    // at all: Check Out first, then delete, and an empty job may not even
    // check out. Tim, looking at two of them: "there's a couple jobs in
    // Explorer right now but have nothing and I can't delete them."
    //
    // This is the Trash the Cabinet already has, not a permanent delete.
    // Restore and Delete permanently both live in that Trash, and the
    // 120-day retention stands. The button is drawn only where the move is
    // actually allowed -- no copy on this device, no lease on it, not
    // already trashed -- so it never offers something that will be refused.
    const trashable = !entry.deletedAt &&
      entry.presence !== 'local' &&
      entry.availability === 'available' &&
      window.ToolboxSync && typeof window.ToolboxSync.trashCabinetCustomerFile === 'function';
    let rowMenu = null;
    if (trashable) {
      // Behind the row's own menu, not beside Check Out. Two buttons on one
      // row squeezed the address and the date into wrapping on a phone, and
      // the working surface comes before the chrome. This is the same menu
      // the Customer Files rows already use, so the row keeps one action and
      // the rarer one is a press away.
      rowMenu = document.createElement('div');
      // Inline, inside the row's actions. The plain cabinet-row-menu is
      // absolutely positioned against the right edge of the shell, which is
      // free on a Customer Files row but is exactly where this row's own
      // button sits -- the two landed on top of each other.
      rowMenu.className = 'cabinet-row-menu cabinet-row-menu--inline';

      const menuToggle = document.createElement('button');
      menuToggle.type = 'button';
      menuToggle.className = 'cabinet-row-menu__toggle';
      menuToggle.setAttribute('aria-label', 'More options for ' + (entry.displayName || 'Customer File'));
      menuToggle.textContent = '•••';
      menuToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        const open = rowMenu.classList.contains('is-open');
        document.querySelectorAll('.cabinet-row-menu.is-open').forEach(function (other) {
          other.classList.remove('is-open');
        });
        rowMenu.classList.toggle('is-open', !open);
      });

      const trashBtn = document.createElement('button');
      trashBtn.type = 'button';
      trashBtn.className = 'cabinet-row-menu__action cabinet-trash-btn';
      trashBtn.textContent = 'Move to Trash';
      trashBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        rowMenu.classList.remove('is-open');
        const name = entry.displayName || 'Customer File';
        confirmAction({
          title: 'Move this Customer File to Trash?',
          message: name + ' moves to File Cabinet Trash, including any plans and photographs. ' +
            'It stays there until it is restored or permanently deleted.',
          cancelLabel: 'Cancel',
          confirmLabel: 'Move to Trash',
        }).then(function (confirmed) {
          if (!confirmed) return;
          trashBtn.disabled = true;
          trashBtn.textContent = 'Moving…';
          return window.ToolboxSync.trashCabinetCustomerFile(entry.id).then(function () {
            cabinetNotice = name + ' was moved to File Cabinet Trash.';
            renderFileCabinet(app);
            showFileCabinetNotice(app);
          }).catch(function (err) {
            console.warn('Cabinet Trash move failed:', err);
            cabinetNotice = (err && err.message) || 'Could not move that Customer File to Trash.';
            renderFileCabinet(app);
            showFileCabinetNotice(app);
          });
        });
      });
      // And the way out for a job that is simply dead. Tim, on two of them:
      // "I want to delete I don't need them to go to a trashcan." One press
      // and one confirmation that says it cannot be undone.
      const killBtn = document.createElement('button');
      killBtn.type = 'button';
      killBtn.className = 'cabinet-row-menu__action cabinet-row-menu__action--danger cabinet-destroy-btn';
      killBtn.textContent = 'Delete permanently';
      killBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        rowMenu.classList.remove('is-open');
        const name = entry.displayName || 'Customer File';
        confirmAction({
          title: 'Permanently delete this Customer File?',
          message: name + ' will be destroyed in the File Cabinet, including its plans and ' +
            'photographs. This cannot be undone.',
          cancelLabel: 'Cancel',
          confirmLabel: 'Delete permanently',
        }).then(function (confirmed) {
          if (!confirmed) return;
          if (typeof window.ToolboxSync.destroyCabinetCustomerFile !== 'function') {
            cabinetNotice = 'Permanent delete is unavailable.';
            renderFileCabinet(app);
            showFileCabinetNotice(app);
            return;
          }
          return window.ToolboxSync.destroyCabinetCustomerFile(entry.id).then(function () {
            cabinetNotice = name + ' was permanently deleted.';
            renderFileCabinet(app);
            showFileCabinetNotice(app);
          }).catch(function (err) {
            console.warn('Permanent delete failed:', err);
            cabinetNotice = (err && err.message) || 'Could not delete that Customer File.';
            renderFileCabinet(app);
            showFileCabinetNotice(app);
          });
        });
      });

      rowMenu.appendChild(menuToggle);
      rowMenu.appendChild(trashBtn);
      rowMenu.appendChild(killBtn);
    }
    if (rowMenu) actions.appendChild(rowMenu);
    if (actions.childNodes.length) row.appendChild(actions);

    shell.appendChild(row);
    return shell;
  }

  function showFileCabinetNotice(app) {
    const notice = app.querySelector('#file-cabinet-notice');
    if (!notice) return;
    if (!cabinetNotice) {
      notice.hidden = true;
      return;
    }
    notice.textContent = cabinetNotice;
    notice.hidden = false;
    cabinetNotice = '';
  }

  function deleteLocalCustomerFile(record, name) {
    return window.ToolboxDB.permanentlyDeleteCustomerFiles([record]).then(function () {
      return name + ' was deleted from this device.';
    });
  }

  function confirmCabinetTrashDelete(name) {
    return confirmAction({
      title: 'Delete from the File Cabinet?',
      message: name + ' will move to File Cabinet Trash, including its plans and photographs. This device\'s copy is removed only after the File Cabinet confirms that. If the File Cabinet cannot be reached, the file stays on this device until Sync Now finishes the move.',
      cancelLabel: 'No, keep file',
      confirmLabel: 'Yes, delete',
    });
  }

  function finishCabinetTrashDelete(id, name) {
    if (!window.ToolboxSync || typeof window.ToolboxSync.moveWorkingFileToCabinetTrash !== 'function') {
      return Promise.resolve('File Cabinet delete is unavailable.');
    }
    return window.ToolboxSync.moveWorkingFileToCabinetTrash(id).then(function (result) {
      if (result && result.action === 'local-only') {
        return window.ToolboxDB.getCustomerFile(id).then(function (fresh) {
          if (!fresh) return name + ' was deleted from this device.';
          return deleteLocalCustomerFile(fresh, name);
        });
      }
      return name + ' was moved to File Cabinet Trash.';
    }).catch(function (err) {
      console.warn('File Cabinet Trash move failed:', err);
      if (err && err.code === 'checkout') {
        return name + ' is checked out on another device. It was not deleted.';
      }
      return name + ' is still on this device. It will move to File Cabinet Trash when Sync Now can reach the File Cabinet.';
    });
  }

  function confirmLocalCustomerFileDelete(record, name) {
    const empty = isEmptyCustomerFileStub(record);
    return confirmAction({
      title: empty ? 'Delete empty file?' : 'Delete this Customer File?',
      message: empty
        ? name + ' has no customer details or survey evidence. This deletes it from this device.'
        : name + ' contains customer or survey information. Delete it from this device?',
      cancelLabel: 'No, keep file',
      confirmLabel: empty ? 'Yes, delete permanently' : 'Yes, delete',
    }).then(function (confirmed) {
      if (!confirmed) return null;
      if (!window.ToolboxSync || typeof window.ToolboxSync.resolveWorkingFileDelete !== 'function') {
        return name + ' was not deleted.';
      }
      return window.ToolboxSync.resolveWorkingFileDelete(record.id).then(function (again) {
        if (again && again.action === 'foreign-checkout') {
          return name + ' is checked out on another device. It was not deleted.';
        }
        if (again && (again.action === 'cabinet' || again.action === 'pending-offline')) {
          return finishCabinetTrashDelete(record.id, name);
        }
        return deleteLocalCustomerFile(record, name);
      });
    });
  }

  function requestCustomerFileRemoval(record) {
    const name = displayName(record);
    if (!window.ToolboxSync || typeof window.ToolboxSync.resolveWorkingFileDelete !== 'function') {
      return Promise.resolve(name + ' was not deleted.');
    }
    return window.ToolboxSync.resolveWorkingFileDelete(record.id).then(function (decision) {
      const action = decision && decision.action;
      if (action === 'foreign-checkout') {
        return name + ' is checked out on another device. It was not deleted.';
      }
      if (action === 'cabinet' || action === 'pending-offline') {
        return confirmCabinetTrashDelete(name).then(function (confirmed) {
          if (!confirmed) return null;
          return finishCabinetTrashDelete(record.id, name);
        });
      }
      return confirmLocalCustomerFileDelete(record, name);
    });
  }

  function openInitialVisitDialog() {
    const existing = document.getElementById('initial-visit-dialog');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'initial-visit-dialog';
    overlay.className = 'iv-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'New Initial Visit');
    overlay.innerHTML =
      '<form class="iv-dialog__panel" id="iv-form">' +
      '  <h2 class="iv-dialog__title">Initial Visit</h2>' +
      '  <p class="iv-dialog__lead">Name, phone, address, and when you are going. No plan required.</p>' +
      '  <label class="iv-field"><span>First name</span><input type="text" id="iv-first" autocomplete="given-name"></label>' +
      '  <label class="iv-field"><span>Last name</span><input type="text" id="iv-last" autocomplete="family-name"></label>' +
      '  <label class="iv-field"><span>Phone</span><input type="tel" id="iv-phone" autocomplete="tel"></label>' +
      '  <label class="iv-field"><span>Address</span>' +
      '    <textarea id="iv-address" rows="2" placeholder="Street address, city, state, ZIP" autocomplete="street-address"></textarea>' +
      '  </label>' +
      '  <div class="iv-schedule-fields">' +
      '    <label class="iv-field"><span>Date</span><input type="date" id="iv-date"></label>' +
      '    <label class="iv-field"><span>Time</span><input type="time" id="iv-time" step="300"></label>' +
      '  </div>' +
      '  <div class="iv-dialog__actions">' +
      '    <button type="button" class="btn btn--quiet" id="iv-cancel">Cancel</button>' +
      '    <button type="submit" class="btn btn--accent" id="iv-start">Start visit</button>' +
      '  </div>' +
      '</form>';
    const dateInput = overlay.querySelector('#iv-date');
    if (dateInput) dateInput.value = todayIsoDate();
    document.body.appendChild(overlay);
    const first = overlay.querySelector('#iv-first');
    if (first) first.focus();
    function close() { overlay.remove(); }
    overlay.querySelector('#iv-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    overlay.querySelector('#iv-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const id = generateId();
      const record = blankInitialVisit(id);
      record.firstName = (overlay.querySelector('#iv-first').value || '').trim();
      record.lastName = (overlay.querySelector('#iv-last').value || '').trim();
      record.cellPhone = (overlay.querySelector('#iv-phone').value || '').trim();
      record.propertyAddress = (overlay.querySelector('#iv-address').value || '').trim();
      const schedDate = (overlay.querySelector('#iv-date').value || '').trim() || todayIsoDate();
      const schedTime = (overlay.querySelector('#iv-time').value || '').trim();
      record.distress.jobWalk.visitDate = schedDate;
      record.distress.jobWalk.visitTime = schedTime;
      record.customerUpdatedAt = new Date().toISOString();
      record.updatedAt = record.customerUpdatedAt;
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
      const startBtn = overlay.querySelector('#iv-start');
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Saving…';
      }
      window.ToolboxDB.saveCustomerFile(record).then(function () {
        close();
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/job-walk';
      }).catch(function (err) {
        console.error(err);
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = 'Start visit';
        }
        window.alert('Could not save Initial Visit offline — try again.');
      });
    });
  }

  function cabinetRowNode(record) {
    const lockedLabel = window.ToolboxSync &&
      typeof window.ToolboxSync.foreignCheckoutLabel === 'function'
      ? window.ToolboxSync.foreignCheckoutLabel(record.id)
      : '';
    const shell = document.createElement('div');
    shell.className = 'cabinet-row-shell' + (lockedLabel ? ' is-checked-out-elsewhere' : '') +
      (isVisitRecord(record) ? ' cabinet-row-shell--visit' : '');
    shell.dataset.customerFileId = record.id;
    if (lockedLabel) shell.dataset.checkoutLock = lockedLabel;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cabinet-row';
    row.addEventListener('click', function () {
      if (isVisitRecord(record)) {
        window.location.hash = '#/file/' + encodeURIComponent(record.id) + '/job-walk';
        return;
      }
      window.location.hash = '#/file/' + encodeURIComponent(record.id);
    });

    const main = document.createElement('span');
    main.className = 'cabinet-row__main';

    const name = document.createElement('span');
    name.className = 'cabinet-row__name';
    name.textContent = displayName(record);

    const addr = document.createElement('span');
    addr.className = 'cabinet-row__address';
    fillAddress(addr, record);

    main.appendChild(name);
    main.appendChild(addr);
    // Visit schedule lives in main (not meta): phone CSS hides .cabinet-row__meta,
    // and Tim needs the date/time reminder visible on the Visits list.
    if (isVisitRecord(record)) {
      const schedule = document.createElement('span');
      fillVisitScheduleMeta(schedule, record);
      main.appendChild(schedule);
    }
    appendLocationStatus(main, customerFileLocationLabel('localWorking', record));

    const meta = document.createElement('span');
    meta.className = 'cabinet-row__meta';
    const readiness = planReadiness(record);
    const planState = document.createElement('span');
    planState.className = 'cabinet-row__plan-state' + (readiness.hasPlan ? ' is-ready' : '');
    if (isVisitRecord(record)) {
      planState.textContent = 'Initial Visit';
      planState.classList.add('is-visit');
    } else {
      planState.textContent = readiness.hasPlan
        ? readiness.ready.length + (readiness.ready.length === 1 ? ' plan ready' : ' plans ready')
        : 'Plan needed';
    }
    const updated = document.createElement('span');
    if (!isVisitRecord(record)) {
      updated.textContent = formatUpdated(record.updatedAt);
      meta.appendChild(planState);
      meta.appendChild(updated);
    } else {
      meta.appendChild(planState);
    }

    const chevron = document.createElement('span');
    chevron.className = 'cabinet-row__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';

    row.appendChild(main);
    row.appendChild(meta);
    row.appendChild(chevron);

    const menu = document.createElement('div');
    menu.className = 'cabinet-row-menu';

    const menuToggle = document.createElement('button');
    menuToggle.type = 'button';
    menuToggle.className = 'cabinet-row-menu__toggle';
    menuToggle.setAttribute('aria-label', 'More options for ' + displayName(record));
    menuToggle.textContent = '•••';
    menuToggle.addEventListener('click', function (event) {
      event.stopPropagation();
      const open = menu.classList.contains('is-open');
      document.querySelectorAll('.cabinet-row-menu.is-open').forEach(function (other) {
        other.classList.remove('is-open');
      });
      menu.classList.toggle('is-open', !open);
    });

    if (lockedLabel) {
      shell.appendChild(row);
      return shell;
    }

    const cabinetBacked = !!(window.ToolboxSync &&
      typeof window.ToolboxSync.isCheckedOutFromCabinet === 'function' &&
      window.ToolboxSync.isCheckedOutFromCabinet(record));

    if (cabinetTrashPending(record)) {
      shell.appendChild(row);
      return shell;
    }

    // Check In stays on every local file (Tim: checkout/checkin are the list
    // actions). Nov 7, 2026: the same ••• also gatekeeps Delete — local delete
    // when there are no Distress pin photos and no Floor Survey points; otherwise
    // a note that deletion goes through Explorer because the file has customer data.
    // A floor plan alone does not count as that bar.
    void cabinetBacked;
    const panel = document.createElement('div');
    panel.className = 'cabinet-row-menu__panel';

    const checkInBtn = document.createElement('button');
    checkInBtn.type = 'button';
    checkInBtn.className = 'cabinet-row-menu__action';
    checkInBtn.textContent = 'Check In';
    checkInBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.classList.remove('is-open');
      requestCheckInCustomerFile(record);
    });
    panel.appendChild(checkInBtn);

    const openTlsBtn = document.createElement('button');
    openTlsBtn.type = 'button';
    openTlsBtn.className = 'cabinet-row-menu__action';
    openTlsBtn.textContent = 'Open in TLS';
    openTlsBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.classList.remove('is-open');
      setFileSide(record.id, 'tls');
      window.location.hash = '#/file/' + encodeURIComponent(record.id) + '/tls';
    });
    panel.appendChild(openTlsBtn);

    if (hasFieldCaptureCustomerData(record)) {
      const note = document.createElement('p');
      note.className = 'cabinet-row-menu__note';
      note.textContent =
        'This file can only be deleted from Explorer because it has customer data.';
      panel.appendChild(note);
    } else {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'cabinet-row-menu__action cabinet-row-menu__action--danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        menu.classList.remove('is-open');
        requestCustomerFileRemoval(record).then(function (result) {
          if (!result) return;
          cabinetNotice = result;
          render();
        }).catch(function (err) {
          console.error('Could not remove Customer File:', err);
          cabinetNotice = 'Could not remove that Customer File. Try again.';
          render();
        });
      });
      panel.appendChild(deleteBtn);
    }

    menu.appendChild(menuToggle);
    menu.appendChild(panel);

    shell.appendChild(row);
    shell.appendChild(menu);
    return shell;
  }

  /**
   * Say where a long operation has got to, while it runs.
   *
   * Check In and Check Out move every photograph on the job and used to show
   * nothing until they finished. Tim, waiting on one: "there's no way to know
   * that you're waiting on nothing to happen."
   */
  function watchSyncProgress(show) {
    if (!window.ToolboxSync || typeof window.ToolboxSync.onSyncProgress !== 'function') {
      return function () {};
    }
    return window.ToolboxSync.onSyncProgress(function (info) {
      if (!info || !info.total) return;
      show(info.label + ' ' + info.done + ' of ' + info.total);
    });
  }

  /** The notice line on the Customer Files screen, written to directly. */
  function liveNotice(app) {
    const notice = app ? app.querySelector('#cabinet-notice') : null;
    return function (text) {
      if (!notice) return;
      notice.textContent = text;
      notice.hidden = !text;
    };
  }

  function requestCheckInCustomerFile(record) {
    const name = displayName(record);
    if (!window.ToolboxSync || typeof window.ToolboxSync.checkInCustomerFile !== 'function') {
      cabinetNotice = 'Check In is unavailable.';
      window.location.hash = '#/';
      render();
      return;
    }
    confirmAction({
      title: 'Check In Customer File?',
      message: name + ' will be put in the File Cabinet, released so another device can work on it, ' +
        'and removed from this device.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Check In',
    }).then(function (confirmed) {
      if (!confirmed) return;
      const show = liveNotice(document.getElementById('app') || document);
      show('Checking in ' + name + '…');
      const stop = watchSyncProgress(function (where) {
        show('Checking in ' + name + ' — ' + where);
      });
      return window.ToolboxSync.checkInCustomerFile(record.id).then(function (result) {
        stop();
        const leftBehind = typeof window.ToolboxSync.describeMissingMedia === 'function'
          ? window.ToolboxSync.describeMissingMedia(result && result.missingMedia)
          : '';
        cabinetNotice = name + ' was checked in.' + (leftBehind ? ' ' + leftBehind : '');
        window.location.hash = '#/';
        render();
      }).catch(function (err) {
        stop();
        console.warn('Check In failed:', err);
        cabinetNotice = (err && err.message) || 'Check In failed.';
        window.location.hash = '#/';
        render();
      });
    });
  }

  // ---- Local recovery and File Cabinet Trash ---------------------------

  function refreshLocalTrashRecoveryLink(link, trashed) {
    if (!link) return;
    link.hidden = true;
    link.textContent = 'Recover files saved only on this device';
    if (!trashed || !trashed.length) return;
    const probe = window.ToolboxSync && typeof window.ToolboxSync.probeCabinetForLocalTrash === 'function'
      ? window.ToolboxSync.probeCabinetForLocalTrash()
      : Promise.resolve(null);
    Promise.resolve(probe).then(function (browse) {
      const current = document.getElementById('local-trash-recovery');
      if (!current || current !== link) return;
      const rows = window.ToolboxSync && typeof window.ToolboxSync.filterUnsyncedLocalTrash === 'function'
        ? window.ToolboxSync.filterUnsyncedLocalTrash(trashed, browse)
        : trashed;
      current.hidden = !rows.length;
      current.textContent = 'Recover files saved only on this device';
    }).catch(function () {
      const current = document.getElementById('local-trash-recovery');
      if (!current || current !== link) return;
      current.hidden = false;
      current.textContent = 'Recover files saved only on this device';
    });
  }

  function loadUnsyncedLocalTrash() {
    return window.ToolboxDB.purgeExpiredCustomerFiles().catch(function (err) {
      console.warn('Could not review expired Customer Files:', err);
    }).then(function () {
      return window.ToolboxDB.getAllCustomerFiles();
    }).then(function (records) {
      const trashed = (records || []).filter(function (record) { return record && record.deletedAt; });
      if (!trashed.length) return [];
      const probe = window.ToolboxSync && typeof window.ToolboxSync.probeCabinetForLocalTrash === 'function'
        ? window.ToolboxSync.probeCabinetForLocalTrash()
        : Promise.resolve(null);
      return Promise.resolve(probe).then(function (browse) {
        if (window.ToolboxSync && typeof window.ToolboxSync.filterUnsyncedLocalTrash === 'function') {
          return window.ToolboxSync.filterUnsyncedLocalTrash(trashed, browse);
        }
        return trashed;
      }).catch(function () {
        return trashed;
      });
    });
  }

  function renderLocalTrashRecovery(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="trash-back" class="btn btn--ghost">‹ Customer Files</button>' +
      '  <div class="file-identity"><span class="file-identity__name">On this device</span></div>' +
      '</div>' +
      '<section class="trash-view">' +
      '  <header class="trash-head">' +
      '    <div><p class="eyebrow">Saved only on this device</p><h1>Recover files</h1><p>These older Customer Files are still on this device. Restore puts one back in Customer Files. File Cabinet Trash is separate.</p></div>' +
      '  </header>' +
      '  <p class="cabinet-notice" id="trash-notice" hidden></p>' +
      '  <div class="trash-list" id="trash-list"><p class="cabinet-empty">Loading…</p></div>' +
      '</section>';

    const list = app.querySelector('#trash-list');
    const notice = app.querySelector('#trash-notice');

    app.querySelector('#trash-back').addEventListener('click', function () {
      window.location.hash = '#/';
    });

    function loadTrash(message) {
      if (message) {
        notice.textContent = message;
        notice.hidden = false;
      } else {
        notice.hidden = true;
      }
      loadUnsyncedLocalTrash().then(function (trashed) {
        trashed.sort(function (a, b) {
          return (b.deletedAt || '').localeCompare(a.deletedAt || '');
        });
        list.innerHTML = '';
        if (!trashed.length) {
          const p = document.createElement('p');
          p.className = 'cabinet-empty trash-empty-state';
          p.textContent = 'Nothing on this device needs recovery.';
          list.appendChild(p);
          return;
        }
        trashed.forEach(function (record) {
          list.appendChild(trashRowNode(record, function () {
            window.ToolboxDB.restoreCustomerFile(record.id).then(function () {
              loadTrash(displayName(record) + ' was restored to Customer Files.');
            }).catch(function (err) {
              console.error('Could not restore Customer File:', err);
              loadTrash('Could not restore that Customer File. Try again.');
            });
          }));
        });
      }).catch(function (err) {
        console.error('Could not load local recovery:', err);
        list.innerHTML = '<p class="cabinet-empty">Unable to load recoverable files right now.</p>';
      });
    }

    loadTrash('');
  }

  function renderFileCabinetTrash(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="trash-back" class="btn btn--ghost">‹ File Cabinet</button>' +
      '  <div class="file-identity"><span class="file-identity__name">File Cabinet</span></div>' +
      '</div>' +
      '<section class="trash-view">' +
      '  <header class="trash-head">' +
      '    <div><p class="eyebrow">File Cabinet</p><h1>Trash</h1><p>Deleted File Cabinet Customer Files stay here until you permanently delete them. After 120 days they are eligible for cleanup. Nothing is deleted automatically.</p></div>' +
      '    <button type="button" id="trash-empty" class="btn btn--danger" disabled>Empty Trash</button>' +
      '  </header>' +
      '  <p class="cabinet-notice" id="trash-notice" hidden></p>' +
      '  <div class="trash-list" id="trash-list"><p class="cabinet-empty">Loading Trash…</p></div>' +
      '</section>';

    const list = app.querySelector('#trash-list');
    const emptyBtn = app.querySelector('#trash-empty');
    const notice = app.querySelector('#trash-notice');

    app.querySelector('#trash-back').addEventListener('click', function () {
      window.location.hash = '#/cabinet';
    });

    function showNotice(message) {
      if (!notice) return;
      if (!message) {
        notice.hidden = true;
        return;
      }
      notice.textContent = message;
      notice.hidden = false;
    }

    function paint(entries, message) {
      showNotice(message);
      const trashed = (entries || []).filter(function (entry) { return entry && entry.deletedAt; });
      trashed.sort(function (a, b) {
        return String(b.deletedAt || '').localeCompare(String(a.deletedAt || ''));
      });
      emptyBtn.disabled = trashed.length === 0;
      list.innerHTML = '';
      if (!trashed.length) {
        const p = document.createElement('p');
        p.className = 'cabinet-empty trash-empty-state';
        p.textContent = 'File Cabinet Trash is empty.';
        list.appendChild(p);
        return;
      }
      trashed.forEach(function (entry) {
        list.appendChild(trashRowNode(entry, {
          restore: function () {
            if (!window.ToolboxSync || typeof window.ToolboxSync.restoreCabinetCustomerFile !== 'function') {
              showNotice('Restore is unavailable.');
              return;
            }
            window.ToolboxSync.restoreCabinetCustomerFile(entry.id).then(function () {
              return loadCabinetTrash((entry.displayName || 'Customer File') + ' was restored to the File Cabinet.');
            }).catch(function (err) {
              console.warn('File Cabinet restore failed:', err);
              showNotice((err && err.message) || 'Could not restore that Customer File.');
            });
          },
          permanent: function () {
            const label = entry.displayName || 'Customer File';
            confirmAction({
              title: 'Permanently delete this Customer File?',
              message: label + ' will be destroyed in the File Cabinet, including its plans and photographs. This cannot be undone.',
              cancelLabel: 'Cancel',
              confirmLabel: 'Delete permanently',
            }).then(function (confirmed) {
              if (!confirmed) return;
              if (!window.ToolboxSync || typeof window.ToolboxSync.permanentlyDeleteCabinetCustomerFile !== 'function') {
                showNotice('Permanent delete is unavailable.');
                return;
              }
              window.ToolboxSync.permanentlyDeleteCabinetCustomerFile(entry.id).then(function () {
                return loadCabinetTrash(label + ' was permanently deleted.');
              }).catch(function (err) {
                console.warn('Permanent delete failed:', err);
                showNotice((err && err.message) || 'Could not permanently delete that Customer File.');
              });
            });
          },
        }));
      });
      emptyBtn.onclick = function () {
        confirmAction({
          title: 'Permanently empty File Cabinet Trash?',
          message: 'This permanently deletes ' + trashed.length + ' Customer File' + (trashed.length === 1 ? '' : 's') + ' from the File Cabinet, including plans and photographs. Checked-out files are left in Trash. This cannot be undone.',
          cancelLabel: 'Cancel',
          confirmLabel: 'Empty Trash',
        }).then(function (confirmed) {
          if (!confirmed) return;
          if (!window.ToolboxSync || typeof window.ToolboxSync.emptyCabinetTrash !== 'function') {
            showNotice('Empty Trash is unavailable.');
            return;
          }
          emptyBtn.disabled = true;
          window.ToolboxSync.emptyCabinetTrash().then(function (result) {
            const removed = result && result.deleted ? result.deleted.length : 0;
            const held = result && result.skipped ? result.skipped.length : 0;
            let text = removed
              ? 'Emptied ' + removed + ' Customer File' + (removed === 1 ? '' : 's') + ' from the File Cabinet.'
              : 'Nothing was permanently deleted.';
            if (held) {
              text += ' ' + held + ' stayed in Trash because ' + (held === 1 ? 'it is' : 'they are') + ' checked out or no longer in Trash.';
            }
            return loadCabinetTrash(text);
          }).catch(function (err) {
            console.error('Could not empty File Cabinet Trash:', err);
            showNotice((err && err.message) || 'Could not empty Trash. Try again.');
            emptyBtn.disabled = false;
          });
        });
      };
    }

    function loadCabinetTrash(message) {
      if (!window.ToolboxSync || typeof window.ToolboxSync.browseCabinet !== 'function' ||
          !window.ToolboxSync.syncApiBase || !window.ToolboxSync.syncApiBase()) {
        list.innerHTML = '<p class="cabinet-empty">Sign in / Sync not configured — File Cabinet Trash is unavailable.</p>';
        emptyBtn.disabled = true;
        return Promise.resolve();
      }
      return window.ToolboxSync.browseCabinet().then(function (browse) {
        paint((browse && browse.entries) || [], message);
      }).catch(function (err) {
        const code = err && err.code;
        list.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'cabinet-empty';
        if (code === 'auth') p.textContent = 'Sign in to open File Cabinet Trash.';
        else if (code === 'offline' || code === 'network') p.textContent = 'Offline — File Cabinet Trash needs a network connection.';
        else if (code === 'config') p.textContent = 'Sync is not configured yet.';
        else p.textContent = 'Unable to load File Cabinet Trash right now.';
        list.appendChild(p);
        emptyBtn.disabled = true;
        console.warn('File Cabinet Trash failed:', err);
      });
    }

    loadCabinetTrash('');
  }

  function trashRetentionLine(record) {
    const purgeAt = record && Date.parse(record.purgeAfter);
    if (Number.isFinite(purgeAt) && purgeAt <= Date.now()) return 'Eligible for cleanup';
    return 'In Trash';
  }

  function trashRowNode(record, actions) {
    const onRestore = typeof actions === 'function' ? actions : actions && actions.restore;
    const onPermanent = actions && actions.permanent;
    const row = document.createElement('article');
    row.className = 'trash-row';
    if (record && record.id) row.dataset.customerFileId = record.id;

    const main = document.createElement('div');
    main.className = 'trash-row__main';
    const name = document.createElement('strong');
    name.textContent = (record && record.displayName) || displayName(record);
    const address = document.createElement('span');
    address.textContent = (record && record.propertyAddress) || displayAddress(record);
    const retention = document.createElement('small');
    retention.textContent = trashRetentionLine(record);
    main.appendChild(name);
    main.appendChild(address);
    main.appendChild(retention);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn btn--secondary';
    restore.textContent = 'Restore';
    restore.addEventListener('click', onRestore);

    if (typeof onPermanent === 'function') {
      const permanent = document.createElement('button');
      permanent.type = 'button';
      permanent.className = 'btn btn--danger';
      permanent.textContent = 'Delete permanently';
      permanent.addEventListener('click', onPermanent);
      const group = document.createElement('div');
      group.className = 'trash-row__actions';
      group.appendChild(restore);
      group.appendChild(permanent);
      row.appendChild(main);
      row.appendChild(group);
      return row;
    }

    row.appendChild(main);
    row.appendChild(restore);
    return row;
  }

  function renderCheckedOutReadOnly(app, id) {
    registerActiveFlush(null);
    const label = (window.ToolboxSync &&
      typeof window.ToolboxSync.foreignCheckoutLabel === 'function' &&
      window.ToolboxSync.foreignCheckoutLabel(id)) || 'Checked out on another device';
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="locked-back" class="btn btn--ghost">‹ Customer File</button>' +
      '  <div class="file-identity"><span class="file-identity__name">View only</span></div>' +
      '</div>' +
      '<section class="cf-readonly">' +
      '  <h1 class="cf-readonly__name" id="locked-name">Customer File</h1>' +
      '  <p class="cf-readonly__address" id="locked-address"></p>' +
      '  <p class="cf-readonly__status" id="locked-status"></p>' +
      '</section>';
    app.querySelector('#locked-status').textContent =
      label + '. This copy stays on this device. Changes are paused until the checkout is released.';
    app.querySelector('#locked-back').addEventListener('click', function () {
      window.location.hash = '#/file/' + encodeURIComponent(id);
    });
    window.ToolboxDB.getCustomerFile(id).then(function (record) {
      if (!record) return;
      const name = app.querySelector('#locked-name');
      const address = app.querySelector('#locked-address');
      if (name) name.textContent = displayName(record);
      if (address) address.textContent = displayAddress(record);
    }).catch(function () {});
  }

  // ---- Customer File home (hub) -----------------------------------------

  const APP_LABELS = {
    distress: 'Distress Survey',
    floor: 'Floor Survey',
    diagnostics: 'Diagnostics',
    report: 'Report Builder',
  };

  const APP_META = {
    distress: {
      label: 'Distress Survey',
      detail: 'Observation and photo capture',
      icon: 'icons/Distress%20Survey.png',
    },
    floor: {
      label: 'Floor Survey',
      detail: 'Elevation capture and mapping',
      icon: 'icons/Floor%20Survey.png',
    },
    diagnostics: {
      label: 'Diagnostics',
      detail: 'Interpret evidence and patterns',
      icon: 'icons/Diagnostics.png',
    },
    report: {
      label: 'Report Builder',
      detail: 'Assemble the professional deliverable',
      icon: 'icons/report-builder.png',
    },
  };

  function appTileHtml(key) {
    const meta = APP_META[key];
    return (
      '<button type="button" class="cf-app-btn" data-app="' + key + '" aria-label="' + meta.label + '">' +
      '  <span class="cf-app-btn__art"><img src="' + meta.icon + '" alt="" loading="eager"></span>' +
      '  <span class="cf-app-btn__copy">' +
      '    <span class="cf-app-btn__name">' + meta.label + '</span>' +
      '    <span class="cf-app-btn__sub">' + meta.detail + '</span>' +
      '    <span class="cf-app-btn__state">Loading…</span>' +
      '  </span>' +
      '</button>'
    );
  }

  function planSummaryText(record) {
    if (!record.planSetup || !Array.isArray(record.planSetup.canvases)) {
      return 'No floor plan yet';
    }
    const canvases = record.planSetup.canvases;
    const withPlan = canvases.filter(function (c) {
      return window.ToolboxPlanSetup && window.ToolboxPlanSetup.hasUsablePlan(c);
    });
    if (!withPlan.length) return 'No floor plan yet';
    if (canvases.length === 1) {
      const rooms = (canvases[0].rooms && canvases[0].rooms.length) || 0;
      return '1 plan' + (rooms ? ' · ' + rooms + ' room' + (rooms === 1 ? '' : 's') : '');
    }
    return canvases.length + ' levels · ' + withPlan.length + ' with plans';
  }

  function tlsAppTileHtml(key, label, detail) {
    return (
      '<button type="button" class="cf-app-btn" data-tls-app="' + key + '" aria-label="' + label + '">' +
      '  <span class="cf-app-btn__art"><img src="brand/tls-foundations.jpg" alt="" loading="eager"></span>' +
      '  <span class="cf-app-btn__copy">' +
      '    <span class="cf-app-btn__name">' + label + '</span>' +
      '    <span class="cf-app-btn__sub">' + detail + '</span>' +
      '    <span class="cf-app-btn__state"></span>' +
      '  </span>' +
      '</button>'
    );
  }

  function renderFileHome(app, id, side) {
    registerActiveFlush(null);
    const tls = side === 'tls';
    setFileSide(id, tls ? 'tls' : 'geo');
    document.body.classList.toggle('tls-side', tls);
    app.innerHTML =
      '<div class="view-bar view-bar--file view-bar--cf-home">' +
      '  <button type="button" id="home-back" class="btn btn--ghost">‹ Cabinet</button>' +
      '  <div class="cf-side-switch" role="group" aria-label="Company side">' +
      '    <button type="button" class="cf-side-switch__btn' + (tls ? '' : ' is-active') + '" id="home-side-geo">Sandia Geo</button>' +
      '    <button type="button" class="cf-side-switch__btn' + (tls ? ' is-active' : '') + '" id="home-side-tls">TLS</button>' +
      '  </div>' +
      '  <span class="file-status" id="home-status"></span>' +
      (tls
        ? '  <button type="button" id="home-repair-top" class="btn btn--accent por-open-btn">Plan of Repair</button>'
        : '  <button type="button" id="home-repair-top" class="btn btn--accent por-open-btn" hidden>Plan of Repair</button>') +
      '  <button type="button" id="home-edit-top" class="btn btn--quiet">Edit customer</button>' +
      '</div>' +
      '<div class="cf-home' + (tls ? ' cf-home--tls' : '') + '" id="cf-home">' +
      '  <section class="cf-home__hero">' +
      '    <div class="cf-home__summary">' +
      (tls ? '      <img class="cf-home__brandmark" src="brand/tls-foundations.jpg" alt="TLS Foundations">' : '') +
      '      <h1 class="cf-home__name" id="home-card-name"></h1>' +
      '      <p class="cf-home__address" id="home-card-address"></p>' +
      '      <div class="cf-home__dir-row">' +
      '        <button type="button" class="cf-directions" id="home-directions" hidden>Directions</button>' +
      '        <button type="button" class="cf-directions-change" id="home-directions-pref" hidden>Change maps app</button>' +
      '        <button type="button" class="cf-visit-notes-btn" id="home-visit-notes" hidden>Visit notes</button>' +
      '      </div>' +
      '      <div class="cf-home__badges">' +
      '        <span class="status-badge" id="home-contact-badge">Customer details</span>' +
      '        <span class="status-badge" id="home-plan-badge">Checking plans…</span>' +
      '      </div>' +
      '    </div>' +
      '  </section>' +
      '  <section class="cf-setup-callout" id="home-plan-callout" hidden>' +
      '    <div class="cf-setup-callout__icon" aria-hidden="true">⌂</div>' +
      '    <div class="cf-setup-callout__copy">' +
      '      <strong>Add a floor plan to begin field work</strong>' +
      '      <span>The applications share the plan stored on this Customer File.</span>' +
      '    </div>' +
      '    <button type="button" id="home-plan-cta" class="btn btn--accent">Add floor plan</button>' +
      '  </section>' +
      '  <div class="cf-home__section-head">' +
      '    <div>' +
      '      <p class="eyebrow">' + (tls ? 'TLS workspaces' : 'Workspaces') + '</p>' +
      '      <h2>' + (tls ? 'Plan of Repair' : 'Choose where to work') + '</h2>' +
      '    </div>' +
      '    <span class="cf-home__meta" id="home-card-meta"></span>' +
      '  </div>' +
      '  <div class="cf-home__apps" id="home-apps">' +
      (tls
        ? tlsAppTileHtml('repair', 'Plan of Repair', 'Flexible desktop drawing for preliminary repair sheets')
        : (
          appTileHtml('distress') +
          appTileHtml('floor') +
          appTileHtml('diagnostics') +
          appTileHtml('report')
        )) +
      '  </div>' +
      '  <p class="cf-home__hint">' +
      (tls
        ? 'TLS tools use this Customer File. Initial Visit lives on the Toolbox home Visits list — not here.'
        : 'Each workspace opens with this Customer File. They are independent—not required steps.') +
      '</p>' +
      '  <div class="cf-home__file-actions">' +
      '    <button type="button" id="home-import" class="btn btn--secondary">Import standalone export</button>' +
      '    <button type="button" id="home-delete" class="btn btn--secondary cf-home__delete" hidden>Delete this Customer File</button>' +
      '  </div>' +
      '  <p class="cabinet-notice" id="home-notice" hidden></p>' +
      '</div>';

    const backBtn = app.querySelector('#home-back');
    const importBtn = app.querySelector('#home-import');
    const deleteBtn = app.querySelector('#home-delete');
    const editTopBtn = app.querySelector('#home-edit-top');
    const repairTopBtn = app.querySelector('#home-repair-top');
    const planCta = app.querySelector('#home-plan-cta');
    const planCallout = app.querySelector('#home-plan-callout');
    const statusEl = app.querySelector('#home-status');
    const cardName = app.querySelector('#home-card-name');
    const cardAddress = app.querySelector('#home-card-address');
    const directionsBtn = app.querySelector('#home-directions');
    const directionsPrefBtn = app.querySelector('#home-directions-pref');
    const visitNotesBtn = app.querySelector('#home-visit-notes');
    const cardMeta = app.querySelector('#home-card-meta');
    const contactBadge = app.querySelector('#home-contact-badge');
    const planBadge = app.querySelector('#home-plan-badge');
    const sideGeoBtn = app.querySelector('#home-side-geo');
    const sideTlsBtn = app.querySelector('#home-side-tls');
    let currentRecord = null;
    let homeLocked = false;

    function applyHomeLock(record) {
      // Ask the copy in hand, not just this device's lock cache. The cache
      // is only written while listing the Cabinet, so a device that has not
      // listed since the lease was taken -- or has no signal to list with --
      // knows nothing, and used to present the job as ordinary and editable.
      homeLocked = !!(record && window.ToolboxSync &&
        typeof window.ToolboxSync.heldElsewhere === 'function' &&
        window.ToolboxSync.heldElsewhere(record));
      const home = app.querySelector('#cf-home');
      if (home) home.classList.toggle('is-checked-out-elsewhere', homeLocked);
      if (deleteBtn) deleteBtn.hidden = homeLocked || cabinetTrashPending(record);
      if (!homeLocked) return;
      const label = (typeof window.ToolboxSync.heldElsewhereLabel === 'function'
        ? window.ToolboxSync.heldElsewhereLabel(record)
        : '') || 'Checked out on another device';
      statusEl.textContent = label;
      editTopBtn.hidden = true;
      if (repairTopBtn) repairTopBtn.hidden = true;
      importBtn.disabled = true;
      planCta.disabled = true;
      planCallout.hidden = true;
      app.querySelectorAll('.cf-app-btn').forEach(function (btn) {
        btn.classList.add('is-locked');
        const state = btn.querySelector('.cf-app-btn__state');
        if (state) state.textContent = 'View only';
      });
    }

    backBtn.addEventListener('click', function () {
      window.location.hash = '#/';
    });
    if (sideGeoBtn) {
      sideGeoBtn.addEventListener('click', function () {
        setFileSide(id, 'geo');
        window.location.hash = '#/file/' + encodeURIComponent(id);
      });
    }
    if (sideTlsBtn) {
      sideTlsBtn.addEventListener('click', function () {
        setFileSide(id, 'tls');
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/tls';
      });
    }
    if (directionsBtn) {
      directionsBtn.addEventListener('click', function () {
        if (!currentRecord) return;
        openPropertyDirections(currentRecord.propertyAddress);
      });
    }
    if (directionsPrefBtn) {
      directionsPrefBtn.addEventListener('click', function () {
        changeMapsPreference();
        if (currentRecord) openPropertyDirections(currentRecord.propertyAddress);
      });
    }
    if (visitNotesBtn) {
      visitNotesBtn.addEventListener('click', function () {
        if (!currentRecord) return;
        openVisitNotesReader(currentRecord);
      });
    }
    function editFile(section) {
      if (homeLocked) return;
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/edit' + (section ? '/' + section : '');
    }
    importBtn.addEventListener('click', function () {
      if (homeLocked) return;
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/import';
    });
    editTopBtn.addEventListener('click', function () { editFile('customer'); });
    if (repairTopBtn) {
      repairTopBtn.addEventListener('click', function () {
        if (homeLocked) return;
        if (!currentRecord) return;
        // TLS Plan of Repair works without a plan; Geo shortcut still nudges setup.
        if (!tls && !planReadiness(currentRecord).hasPlan) {
          editFile('plans');
          return;
        }
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/repair';
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (homeLocked || !currentRecord || cabinetTrashPending(currentRecord)) return;
        const fileId = currentRecord.id;
        requestCustomerFileRemoval(currentRecord).then(function (result) {
          if (!result) return;
          return window.ToolboxDB.getCustomerFile(fileId).then(function (still) {
            if (!still || still.deletedAt) {
              cabinetNotice = result;
              window.location.hash = '#/';
              return;
            }
            currentRecord = still;
            const notice = app.querySelector('#home-notice');
            if (notice) {
              notice.textContent = result;
              notice.hidden = false;
            }
            applyHomeLock(still);
          });
        }).catch(function (err) {
          console.error('Could not remove Customer File:', err);
          const notice = app.querySelector('#home-notice');
          if (notice) {
            notice.textContent = 'Could not remove that Customer File. Try again.';
            notice.hidden = false;
          }
        });
      });
    }
    planCta.addEventListener('click', function () { editFile('plans'); });
    app.querySelectorAll('.cf-app-btn[data-app]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (homeLocked) return;
        if (!currentRecord) return;
        if (!planReadiness(currentRecord).hasPlan) {
          editFile('plans');
          return;
        }
        const appKey = btn.getAttribute('data-app');
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/' + appKey;
      });
    });
    // Delegate: Initial Visit tile is injected after the record loads.
    const homeApps = app.querySelector('#home-apps');
    if (homeApps) {
      homeApps.addEventListener('click', function (event) {
        const btn = event.target.closest && event.target.closest('.cf-app-btn[data-tls-app]');
        if (!btn || !homeApps.contains(btn)) return;
        if (homeLocked) return;
        const appKey = btn.getAttribute('data-tls-app');
        if (!appKey) return;
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/' + appKey;
      });
    }

    statusEl.textContent = 'Loading…';
    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      if (isLegacyLocalTrash(existing)) {
        window.location.replace('#/trash');
        return null;
      }
      if (!existing) {
        // Brand-new id opened as home → send to edit
        window.location.replace('#/file/' + encodeURIComponent(id) + '/edit');
        return;
      }
      if (window.ToolboxPlanSetup &&
          ((existing.distress && Array.isArray(existing.distress.surfaces) && existing.distress.surfaces.length) ||
           (existing.planSetup && Array.isArray(existing.planSetup.canvases)))) {
        if (window.ToolboxPlanSetup.ensurePlanSetup(existing)) {
          if (window.ToolboxSync && typeof window.ToolboxSync.heldElsewhere === 'function' &&
              window.ToolboxSync.heldElsewhere(existing)) {
            return existing;
          }
          return window.ToolboxDB.saveCustomerFile(existing).then(function () {
            return existing;
          });
        }
      }
      return existing;
    }).then(function (record) {
      if (!record) return;
      currentRecord = record;
      const readiness = planReadiness(record);
      const hasName = !!((record.firstName || '').trim() || (record.lastName || '').trim());
      const hasAddress = !!(record.propertyAddress || '').trim();
      cardName.textContent = displayName(record);
      fillAddress(cardAddress, record);
      if (directionsBtn) {
        directionsBtn.hidden = !hasAddress;
        directionsBtn.disabled = !hasAddress;
      }
      if (directionsPrefBtn) {
        directionsPrefBtn.hidden = !hasAddress;
      }
      if (visitNotesBtn) {
        const notes = record.distress && record.distress.jobWalk &&
          Array.isArray(record.distress.jobWalk.notes)
          ? record.distress.jobWalk.notes
          : [];
        visitNotesBtn.hidden = !notes.length;
        if (notes.length) {
          visitNotesBtn.textContent = 'Visit notes (' + notes.length + ')';
        }
      }
      contactBadge.textContent = hasName && hasAddress ? 'Customer details ready' : 'Customer details started';
      contactBadge.classList.toggle('is-ready', hasName && hasAddress);
      planBadge.textContent = readiness.hasPlan
        ? planSummaryText(record)
        : (tls ? 'No floor plan yet — Plan of Repair still works' : 'Floor plan required');
      planBadge.classList.toggle('is-ready', readiness.hasPlan);
      // Geo field apps need a plan; TLS Plan of Repair does not.
      planCallout.hidden = tls || readiness.hasPlan;
      cardMeta.textContent = record.updatedAt ? 'Updated ' + formatUpdated(record.updatedAt) : '';
      app.querySelectorAll('.cf-app-btn[data-app]').forEach(function (btn) {
        const state = btn.querySelector('.cf-app-btn__state');
        btn.classList.toggle('is-locked', !readiness.hasPlan);
        // Ready tiles stay quiet; locked tiles still say why they need a plan.
        state.textContent = readiness.hasPlan ? '' : 'Add a floor plan first';
      });
      app.querySelectorAll('.cf-app-btn[data-tls-app]').forEach(function (btn) {
        btn.classList.remove('is-locked');
        const state = btn.querySelector('.cf-app-btn__state');
        if (state) state.textContent = '';
      });
      if (window.ToolboxRecoveredPhotos && window.ToolboxRecoveredPhotos.hasAny(record)) {
        const actions = app.querySelector('.cf-home__file-actions');
        const tally = window.ToolboxRecoveredPhotos.counts(record);
        const photoBtn = document.createElement('button');
        photoBtn.type = 'button';
        photoBtn.className = 'btn btn--secondary cf-home__photo-folders';
        photoBtn.id = 'home-photo-folders';
        photoBtn.innerHTML = '<span>Photo folders</span><small>' +
          tally.pins + ' Distress photo' + (tally.pins === 1 ? '' : 's') +
          ' · ' + tally.quick + ' Quick Capture</small>';
        photoBtn.addEventListener('click', function () {
          if (homeLocked) return;
          window.ToolboxRecoveredPhotos.open(id);
        });
        actions.appendChild(photoBtn);
      }
      applyHomeLock(record);
      if (!homeLocked) statusEl.textContent = '';
      if (window.ToolboxSync && typeof window.ToolboxSync.refreshLocalCheckoutLocks === 'function') {
        window.ToolboxSync.refreshLocalCheckoutLocks().then(function () {
          if (!app.querySelector('#cf-home')) return;
          applyHomeLock(record);
        }).catch(function () {});
      }
    }).catch(function (err) {
      console.error('Failed to load Customer File home:', err);
      statusEl.textContent = 'Unable to load';
    });
  }

  function renderCustomerFileImport(app, id, options) {
    options = options || {};
    const allowDestinationChoice = !!options.allowDestinationChoice || !id;
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="import-back" class="btn btn--ghost">‹ Back</button>' +
      '  <div class="file-identity"><span class="file-identity__name">Customer File Import</span></div>' +
      '</div>' +
      '<div id="customer-file-import"></div>';

    app.querySelector('#import-back').addEventListener('click', function () {
      if (!id) {
        window.location.hash = '#/';
        return;
      }
      window.ToolboxDB.getCustomerFile(id).then(function (record) {
        window.location.hash = record ? '#/file/' + encodeURIComponent(id) : '#/';
      });
    });

    if (!window.ToolboxCustomerFileImport) {
      app.querySelector('#customer-file-import').innerHTML =
        '<p class="cabinet-empty">Customer File import is unavailable.</p>';
      return;
    }
    window.ToolboxCustomerFileImport.mount(app.querySelector('#customer-file-import'), {
      customerFileId: id || null,
      allowDestinationChoice: allowDestinationChoice,
      onDone: function (kind, destinationId) {
        const dest = destinationId || id;
        window.location.hash = '#/file/' + encodeURIComponent(dest) + '/' + (kind === 'floor' ? 'floor' : 'distress');
      },
    });
  }

  function clearReportReturn() {
    if (window.ToolboxReportSession && typeof window.ToolboxReportSession.clear === 'function') {
      window.ToolboxReportSession.clear();
    }
  }

  function reportReturnContext(customerFileId) {
    if (!window.ToolboxReportSession || typeof window.ToolboxReportSession.forFile !== 'function') {
      return null;
    }
    return window.ToolboxReportSession.forFile(customerFileId);
  }

  function goCustomerFileHome(id) {
    clearReportReturn();
    window.location.hash = '#/file/' + encodeURIComponent(id);
  }

  function goReportBuilder(id) {
    window.location.hash = '#/file/' + encodeURIComponent(id) + '/report';
  }

  function renderDistressSurvey(app, id) {
    registerActiveFlush(null);
    if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
      window.ToolboxFloorSurvey.unmount();
    }
    document.body.classList.remove('floor-survey-open');
    app.classList.remove('canvas--floor-survey');
    document.body.classList.add('distress-survey-open');
    app.innerHTML = '';
    app.classList.add('canvas--distress-survey');

    function leave() {
      if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
        window.ToolboxDistress.unmount();
      }
      document.body.classList.remove('distress-survey-open');
      app.classList.remove('canvas--distress-survey');
      goCustomerFileHome(id);
    }

    var returnToReport = reportReturnContext(id)
      ? function () {
          if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
            window.ToolboxDistress.unmount();
          }
          document.body.classList.remove('distress-survey-open');
          app.classList.remove('canvas--distress-survey');
          goReportBuilder(id);
        }
      : null;

    if (!window.ToolboxDistress || typeof window.ToolboxDistress.mount !== 'function') {
      app.innerHTML =
        '<div class="cf-stub">' +
        '  <h2 class="cf-stub__title">Distress Survey</h2>' +
        '  <p class="cf-stub__msg">Distress Survey failed to load.</p>' +
        '  <button type="button" id="ds-fail-back" class="btn btn--accent">Back to Customer File</button>' +
        '</div>';
      app.querySelector('#ds-fail-back').addEventListener('click', leave);
      return;
    }

    window.ToolboxDistress.mount(app, {
      customerFileId: id,
      onBack: leave,
      onReturnToReport: returnToReport,
    });
  }

  function renderFloorSurvey(app, id) {
    registerActiveFlush(null);
    if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
      window.ToolboxDistress.unmount();
    }
    document.body.classList.remove('distress-survey-open');
    app.classList.remove('canvas--distress-survey');
    if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
      window.ToolboxFloorSurvey.unmount();
    }
    document.body.classList.add('floor-survey-open');
    app.innerHTML = '';
    app.classList.add('canvas--floor-survey');

    function leave() {
      if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
        window.ToolboxFloorSurvey.unmount();
      }
      document.body.classList.remove('floor-survey-open', 'diagnostics-open');
      app.classList.remove('canvas--floor-survey');
      goCustomerFileHome(id);
    }

    var returnToReport = reportReturnContext(id)
      ? function () {
          if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
            window.ToolboxFloorSurvey.unmount();
          }
          document.body.classList.remove('floor-survey-open', 'diagnostics-open');
          app.classList.remove('canvas--floor-survey');
          goReportBuilder(id);
        }
      : null;

    if (!window.ToolboxFloorSurvey || typeof window.ToolboxFloorSurvey.mount !== 'function') {
      app.innerHTML =
        '<div class="cf-stub">' +
        '  <h2 class="cf-stub__title">Floor Survey</h2>' +
        '  <p class="cf-stub__msg">Floor Survey bundle failed to load.</p>' +
        '  <button type="button" id="fs-fail-back" class="btn btn--accent">Back to Customer File</button>' +
        '</div>';
      app.querySelector('#fs-fail-back').addEventListener('click', leave);
      return;
    }

    window.ToolboxFloorSurvey.mount(app, {
      customerFileId: id,
      workspace: 'survey',
      onBack: leave,
      onReturnToReport: returnToReport,
    });
  }

  function renderDiagnostics(app, id) {
    registerActiveFlush(null);
    if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
      window.ToolboxDistress.unmount();
    }
    document.body.classList.remove('distress-survey-open', 'report-builder-open');
    app.classList.remove('canvas--distress-survey');
    if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
      window.ToolboxFloorSurvey.unmount();
    }
    document.body.classList.add('floor-survey-open', 'diagnostics-open');
    app.innerHTML = '';
    app.classList.add('canvas--floor-survey');

    function leave() {
      if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
        window.ToolboxFloorSurvey.unmount();
      }
      document.body.classList.remove('floor-survey-open', 'diagnostics-open');
      app.classList.remove('canvas--floor-survey');
      goCustomerFileHome(id);
    }

    var returnToReport = reportReturnContext(id)
      ? function () {
          if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
            window.ToolboxFloorSurvey.unmount();
          }
          document.body.classList.remove('floor-survey-open', 'diagnostics-open');
          app.classList.remove('canvas--floor-survey');
          goReportBuilder(id);
        }
      : null;

    if (!window.ToolboxFloorSurvey || typeof window.ToolboxFloorSurvey.mount !== 'function') {
      document.body.classList.remove('floor-survey-open', 'diagnostics-open');
      app.classList.remove('canvas--floor-survey');
      app.innerHTML =
        '<div class="cf-stub">' +
        '  <h2 class="cf-stub__title">Diagnostics</h2>' +
        '  <p class="cf-stub__msg">Diagnostics failed to load.</p>' +
        '  <button type="button" id="dx-fail-back" class="btn btn--accent">Back to Customer File</button>' +
        '</div>';
      app.querySelector('#dx-fail-back').addEventListener('click', leave);
      return;
    }

    window.ToolboxFloorSurvey.mount(app, {
      customerFileId: id,
      workspace: 'diagnostics',
      onBack: leave,
      onReturnToReport: returnToReport,
    });
  }

  // Report Builder is a desk tool: an 11 x 17 tabloid sheet, used landscape,
  // beside a page rail and a
  // formatting bar, placed with a pointer. Below this width the page and the
  // rail cannot both be on screen without it becoming a different product.
  // An iPad mini in landscape clears it; in portrait it does not, which is why
  // this is a notice and not a lock -- nothing is blocked, it just says so
  // once per session and gets out of the way.
  var REPORT_DESKTOP_MIN_WIDTH = 900;
  var reportNoticeSeen = false;

  function reportDesktopNotice(app, id) {
    if (reportNoticeSeen) return false;
    if (window.innerWidth >= REPORT_DESKTOP_MIN_WIDTH) return false;
    // Marked seen only when Continue is pressed, below. Setting it here meant
    // saying no still silenced it: go back, open Distress, return, and Report
    // Builder let you straight in without asking.

    var wrap = document.createElement('div');
    wrap.className = 'rb-smallscreen';
    wrap.setAttribute('data-rb-smallscreen', '1');
    var card = document.createElement('div');
    card.className = 'rb-smallscreen__card';
    var head = document.createElement('h2');
    head.className = 'rb-smallscreen__title';
    head.textContent = 'Report Builder is intended for desktop';
    var body = document.createElement('p');
    body.className = 'rb-smallscreen__body';
    body.textContent =
      'It lays out an 11 by 17 inch sheet, so it wants a wide screen and a pointer. ' +
      'You can carry on here if you need to.';
    var row = document.createElement('div');
    row.className = 'rb-smallscreen__row';
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'rb-smallscreen__go';
    go.textContent = 'Continue anyway';
    go.addEventListener('click', function () {
      // Only now: the choice to carry on is what is remembered, so it does not
      // nag every time this session. Declining is not a choice to remember.
      reportNoticeSeen = true;
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'rb-smallscreen__back';
    back.textContent = 'Back to the Customer File';
    back.addEventListener('click', function () { goCustomerFileHome(id); });
    row.appendChild(go);
    row.appendChild(back);
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(row);
    wrap.appendChild(card);
    app.appendChild(wrap);
    return true;
  }

  function renderReportBuilder(app, id) {
    registerActiveFlush(null);
    document.body.classList.remove('floor-survey-open', 'distress-survey-open', 'diagnostics-open', 'plan-of-repair-open');
    document.body.classList.add('report-builder-open');
    app.classList.remove('canvas--floor-survey', 'canvas--distress-survey');
    if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
      window.ToolboxFloorSurvey.unmount();
    }
    if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
      window.ToolboxDistress.unmount();
    }
    if (window.ToolboxPlanOfRepair && typeof window.ToolboxPlanOfRepair.unmount === 'function') {
      window.ToolboxPlanOfRepair.unmount();
    }
    app.innerHTML = '';

    function leave() {
      clearReportReturn();
      window.location.hash = '#/file/' + encodeURIComponent(id);
    }

    if (!window.ToolboxReportBuilder || typeof window.ToolboxReportBuilder.mount !== 'function') {
      document.body.classList.remove('report-builder-open');
      app.innerHTML =
        '<div class="cf-stub">' +
        '  <h2 class="cf-stub__title">Report Builder</h2>' +
        '  <p class="cf-stub__msg">Report Builder failed to load.</p>' +
        '  <button type="button" id="rb-fail-back" class="btn btn--accent">Back to Customer File</button>' +
        '</div>';
      app.querySelector('#rb-fail-back').addEventListener('click', leave);
      return;
    }

    // Mount first, then lay the notice over the top: Report Builder is fully
    // working underneath, so dismissing it leaves a live page rather than
    // needing a second load.
    window.ToolboxReportBuilder.mount(app, {
      customerFileId: id,
      onBack: leave,
      onOpenSource: function (appKey) {
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/' + appKey;
      },
    });
    reportDesktopNotice(app, id);
  }

  function renderPlanOfRepair(app, id) {
    registerActiveFlush(null);
    document.body.classList.remove('floor-survey-open', 'distress-survey-open', 'diagnostics-open', 'report-builder-open');
    document.body.classList.add('plan-of-repair-open');
    app.classList.remove('canvas--floor-survey', 'canvas--distress-survey');
    if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
      window.ToolboxFloorSurvey.unmount();
    }
    if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
      window.ToolboxDistress.unmount();
    }
    if (window.ToolboxReportBuilder && typeof window.ToolboxReportBuilder.unmount === 'function') {
      window.ToolboxReportBuilder.unmount();
    }
    app.innerHTML = '';

    function leave() {
      setFileSide(id, 'tls');
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/tls';
    }

    if (!window.ToolboxPlanOfRepair || typeof window.ToolboxPlanOfRepair.mount !== 'function') {
      document.body.classList.remove('plan-of-repair-open');
      app.innerHTML =
        '<div class="cf-stub">' +
        '  <h2 class="cf-stub__title">Plan of Repair</h2>' +
        '  <p class="cf-stub__msg">Plan of Repair failed to load.</p>' +
        '  <button type="button" id="por-fail-back" class="btn btn--accent">Back to TLS</button>' +
        '</div>';
      app.querySelector('#por-fail-back').addEventListener('click', leave);
      return;
    }

    window.ToolboxPlanOfRepair.mount(app, {
      customerFileId: id,
      onBack: leave,
    });
  }

  function renderJobWalk(app, id) {
    registerActiveFlush(null);
    document.body.classList.remove(
      'floor-survey-open', 'distress-survey-open', 'diagnostics-open',
      'report-builder-open', 'plan-of-repair-open'
    );
    if (window.ToolboxJobWalk && typeof window.ToolboxJobWalk.unmount === 'function') {
      window.ToolboxJobWalk.unmount();
    }
    app.innerHTML = '';

    function leave() {
      setFileSide(id, 'tls');
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/tls';
    }

    if (!window.ToolboxJobWalk || typeof window.ToolboxJobWalk.mount !== 'function') {
      app.innerHTML =
        '<div class="cf-stub">' +
        '  <h2 class="cf-stub__title">Initial Visit</h2>' +
        '  <p class="cf-stub__msg">Initial Visit failed to load. Reopen Toolbox while online once so the offline shell can install.</p>' +
        '  <button type="button" id="jw-fail-back" class="btn btn--accent">Back to TLS</button>' +
        '</div>';
      app.querySelector('#jw-fail-back').addEventListener('click', leave);
      return;
    }

    window.ToolboxJobWalk.mount(app, {
      customerFileId: id,
      onBack: leave,
    });
  }

  function renderAppStub(app, id, appKey) {
    registerActiveFlush(null);
    document.body.classList.remove('floor-survey-open', 'diagnostics-open');
    app.classList.remove('canvas--floor-survey');
    document.body.classList.remove('distress-survey-open');
    app.classList.remove('canvas--distress-survey');
    if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
      window.ToolboxFloorSurvey.unmount();
    }
    if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
      window.ToolboxDistress.unmount();
    }
    const label = APP_LABELS[appKey] || 'Application';
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="stub-back" class="btn btn--ghost">‹ Customer File</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name">' + label + '</span>' +
      '  </div>' +
      '  <span class="file-status"></span>' +
      '</div>' +
      '<div class="cf-stub">' +
      '  <h2 class="cf-stub__title">' + label + '</h2>' +
      '  <p class="cf-stub__msg">Not connected in Toolbox yet. The Customer File is ready; this application will use it in a later slice. Proven field apps are not redesigned here.</p>' +
      '  <button type="button" id="stub-home" class="btn btn--accent">Back to Customer File</button>' +
      '</div>';
    function goHome() {
      window.location.hash = '#/file/' + encodeURIComponent(id);
    }
    app.querySelector('#stub-back').addEventListener('click', goHome);
    app.querySelector('#stub-home').addEventListener('click', goHome);
  }

  // ---- Customer File edit (contact + plans) -----------------------------

  function fieldRowHtml(field) {
    if (field.id === 'propertyAddress') return propertyAddressFieldHtml();

    const widthClass = field.full ? ' field--full' : '';
    const inputHtml = field.type === 'textarea'
      ? '<textarea id="field-' + field.id + '" rows="' + (field.rows || 3) + '" placeholder="' + (field.placeholder || '') + '"></textarea>'
      : '<input type="' + field.type + '" id="field-' + field.id + '" placeholder="' + (field.placeholder || field.label) + '" autocomplete="off">';

    return '<div class="field' + widthClass + '">' +
      '<label for="field-' + field.id + '">' + field.label + '</label>' +
      inputHtml +
      '</div>';
  }

  // Property address gets the same underlying #field-propertyAddress
  // control (populateForm/collectFormIntoRecord bind to it exactly like any
  // other field) plus a Geoapify autocomplete suggestion list and a "Use
  // Current Location" convenience. Both are optional layers: the field is
  // directly typable with or without them.
  //
  // Use a compact two-row textarea so a complete standardized address can
  // wrap naturally on narrow screens while preserving the full address text.
  // "Use Current Location" lives in the label row and feedback only occupies
  // space while it has something to say.
  function propertyAddressFieldHtml() {
    return (
      '<div class="field field--full field--address">' +
      '  <label for="field-propertyAddress">Property / site address</label>' +
      '  <div class="address-autocomplete-wrap">' +
      '    <textarea id="field-propertyAddress" rows="2" placeholder="Street address, city, state, ZIP" autocomplete="off" ' +
      '      role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="address-suggestions" aria-haspopup="listbox"></textarea>' +
      '    <ul class="address-suggestions" id="address-suggestions" role="listbox" aria-label="Address suggestions" hidden></ul>' +
      '  </div>' +
      '  <button type="button" id="use-current-location" class="address-location-link address-location-link--below">Use Current Location</button>' +
      '  <p class="address-feedback" id="address-feedback" aria-live="polite" hidden></p>' +
      '</div>'
    );
  }

  function fieldsById(list, ids) {
    return ids.map(function (id) {
      return list.find(function (field) { return field.id === id; });
    }).filter(Boolean);
  }

  function renderFileEdit(app, id, requestedSection) {
    const customerFields = fieldsById(FIELD_DEFS.primary, ['firstName', 'lastName', 'propertyAddress', 'notes']);
    const contactFields = fieldsById(FIELD_DEFS.primary, ['cellPhone', 'homePhone', 'email']);
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="file-back" class="btn btn--ghost">‹ Customer File</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="file-identity-name"></span>' +
      '    <span class="file-identity__address" id="file-identity-address"></span>' +
      '  </div>' +
      '  <span class="file-status" id="file-status"></span>' +
      '</div>' +
      '<div class="cf-editor">' +
      '  <nav class="cf-editor__nav" aria-label="Customer File sections">' +
      '    <div class="cf-editor__nav-head">' +
      '      <p class="eyebrow">Customer File</p>' +
      '      <strong>Setup and details</strong>' +
      '    </div>' +
      '    <button type="button" class="cf-editor-tab" data-edit-section="customer">' +
      '      <span class="cf-editor-tab__number">1</span>' +
      '      <span class="cf-editor-tab__copy"><strong>Customer &amp; property</strong><small id="customer-section-status">Add customer details</small></span>' +
      '      <span class="cf-editor-tab__check" aria-hidden="true">✓</span>' +
      '    </button>' +
      '    <button type="button" class="cf-editor-tab" data-edit-section="contacts">' +
      '      <span class="cf-editor-tab__number">2</span>' +
      '      <span class="cf-editor-tab__copy"><strong>Contacts</strong><small id="contacts-section-status">Optional details</small></span>' +
      '      <span class="cf-editor-tab__check" aria-hidden="true">✓</span>' +
      '    </button>' +
      '    <button type="button" class="cf-editor-tab" data-edit-section="plans">' +
      '      <span class="cf-editor-tab__number">3</span>' +
      '      <span class="cf-editor-tab__copy"><strong>Plans &amp; levels</strong><small id="plans-section-status">Floor plan required</small></span>' +
      '      <span class="cf-editor-tab__check" aria-hidden="true">✓</span>' +
      '    </button>' +
      '    <p class="cf-editor__nav-note">Changes save automatically and remain available offline.</p>' +
      '  </nav>' +
      '  <div class="file-form-wrap">' +
      '    <section class="cf-editor-panel" data-edit-panel="customer">' +
      '      <div class="customer-form" id="customer-form">' +
      customerFields.map(fieldRowHtml).join('') +
      '      </div>' +
      '    </section>' +
      '    <section class="cf-editor-panel" data-edit-panel="contacts" hidden>' +
      '      <div class="customer-form">' +
      contactFields.map(fieldRowHtml).join('') +
      '      </div>' +
      '      <details class="additional-info" id="additional-info">' +
      '        <summary>Additional contact information</summary>' +
      '        <div class="customer-form">' +
      FIELD_DEFS.additional.map(fieldRowHtml).join('') +
      '          <div class="field field--full field--checkbox">' +
      '            <label class="checkbox-label"><input type="checkbox" id="field-mailingSameAsProperty"> Mailing / billing address same as property address</label>' +
      '          </div>' +
      '          <div class="field field--full" id="mailing-address-field">' +
      '            <label for="field-mailingAddress">Mailing / billing address</label>' +
      '            <textarea id="field-mailingAddress" rows="2" placeholder="Street address, city, state, ZIP"></textarea>' +
      '          </div>' +
      '        </div>' +
      '      </details>' +
      '    </section>' +
      '    <section class="cf-editor-panel cf-editor-panel--plans" data-edit-panel="plans" hidden>' +
      '      <div id="cf-plans-panel" class="cf-plans-panel"></div>' +
      '    </section>' +
      '    <div class="file-actions file-actions--edit">' +
      '      <button type="button" id="file-save" class="btn btn--secondary">Save now</button>' +
      '      <button type="button" id="file-done" class="btn btn--accent">Done</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    const backBtn = app.querySelector('#file-back');
    const saveBtn = app.querySelector('#file-save');
    const doneBtn = app.querySelector('#file-done');
    const statusEl = app.querySelector('#file-status');
    const identityName = app.querySelector('#file-identity-name');
    const identityAddress = app.querySelector('#file-identity-address');
    const sameAddressCheckbox = app.querySelector('#field-mailingSameAsProperty');
    const mailingTextarea = app.querySelector('#field-mailingAddress');
    const propertyTextarea = app.querySelector('#field-propertyAddress');
    const addressSuggestionsEl = app.querySelector('#address-suggestions');
    const addressFeedbackEl = app.querySelector('#address-feedback');
    const useLocationBtn = app.querySelector('#use-current-location');
    const plansPanel = app.querySelector('#cf-plans-panel');
    const editorTabs = app.querySelectorAll('[data-edit-section]');
    const editorPanels = app.querySelectorAll('[data-edit-panel]');
    const customerSectionStatus = app.querySelector('#customer-section-status');
    const contactsSectionStatus = app.querySelector('#contacts-section-status');
    const plansSectionStatus = app.querySelector('#plans-section-status');

    let record = null;
    let saveTimer = null;
    let dirty = false;
    // Which edit the record in hand is. A save takes its copy of the form,
    // then waits on IndexedDB; anything typed in that window is not in that
    // copy, and clearing `dirty` on completion threw it away while the
    // status said "Saved". Same shape as Report Builder's, same cure: a save
    // may only report itself done if this has not moved since it collected.
    let editSeq = 0;
    let pendingCustomerBump = false;
    let pendingPlansBump = false;
    let isNewFile = false;
    let plansApi = null;

    const ADDRESS_MIN_CHARS = 3;
    const ADDRESS_DEBOUNCE_MS = 150;
    let lastGeocodedAddressText = null;
    let currentSuggestions = [];
    let activeSuggestionIndex = -1;
    let addressDebounceTimer = null;
    let addressFeedbackTimer = null;

    function switchEditorSection(section) {
      const next = ['customer', 'contacts', 'plans'].indexOf(section) !== -1 ? section : 'customer';
      editorTabs.forEach(function (tab) {
        const active = tab.getAttribute('data-edit-section') === next;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-current', active ? 'step' : 'false');
      });
      editorPanels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-edit-panel') !== next;
      });
    }

    editorTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchEditorSection(tab.getAttribute('data-edit-section'));
      });
    });
    switchEditorSection(requestedSection || 'customer');

    function fieldEl(fieldId) {
      return app.querySelector('#field-' + fieldId);
    }

    function populateForm(rec) {
      FIELD_DEFS.primary.concat(FIELD_DEFS.additional).forEach(function (f) {
        const el = fieldEl(f.id);
        if (el) el.value = rec[f.id] || '';
      });
      sameAddressCheckbox.checked = !!rec.mailingSameAsProperty;
      mailingTextarea.value = rec.mailingAddress || '';
      updateMailingVisibility();
      lastGeocodedAddressText = (rec.propertyAddressLat != null && rec.propertyAddressLon != null)
        ? (rec.propertyAddress || null)
        : null;
      closeSuggestions();
    }

    function updateMailingVisibility() {
      const same = sameAddressCheckbox.checked;
      mailingTextarea.disabled = same;
      mailingTextarea.classList.toggle('is-mirrored', same);
      if (same) mailingTextarea.value = propertyTextarea.value;
    }

    function syncMailingIfSame() {
      if (sameAddressCheckbox.checked) mailingTextarea.value = propertyTextarea.value;
    }

    function setAddressFeedback(text) {
      addressFeedbackEl.textContent = text || '';
      addressFeedbackEl.hidden = !text;
      if (addressFeedbackTimer) {
        clearTimeout(addressFeedbackTimer);
        addressFeedbackTimer = null;
      }
      if (text) {
        addressFeedbackTimer = setTimeout(function () {
          addressFeedbackEl.textContent = '';
          addressFeedbackEl.hidden = true;
        }, 6000);
      }
    }

    function closeSuggestions() {
      currentSuggestions = [];
      activeSuggestionIndex = -1;
      addressSuggestionsEl.innerHTML = '';
      addressSuggestionsEl.hidden = true;
      propertyTextarea.setAttribute('aria-expanded', 'false');
      propertyTextarea.removeAttribute('aria-activedescendant');
    }

    function selectSuggestion(index) {
      const s = currentSuggestions[index];
      if (!s || !record) return;
      propertyTextarea.value = s.label;
      syncMailingIfSame();
      record.propertyAddressLat = s.lat;
      record.propertyAddressLon = s.lon;
      lastGeocodedAddressText = s.label;
      closeSuggestions();
      scheduleSave();
      propertyTextarea.focus();
    }

    function updateActiveSuggestion() {
      const items = addressSuggestionsEl.querySelectorAll('.address-suggestion');
      items.forEach(function (li, i) {
        li.classList.toggle('is-active', i === activeSuggestionIndex);
      });
      if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
        propertyTextarea.setAttribute('aria-activedescendant', items[activeSuggestionIndex].id);
        items[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
      } else {
        propertyTextarea.removeAttribute('aria-activedescendant');
      }
    }

    function renderSuggestions(list) {
      currentSuggestions = list || [];
      activeSuggestionIndex = -1;
      addressSuggestionsEl.innerHTML = '';
      if (currentSuggestions.length === 0) {
        closeSuggestions();
        return;
      }
      currentSuggestions.forEach(function (s, i) {
        const li = document.createElement('li');
        li.className = 'address-suggestion';
        li.id = 'address-suggestion-' + i;
        li.setAttribute('role', 'option');
        li.textContent = s.label;
        li.addEventListener('click', function () { selectSuggestion(i); });
        addressSuggestionsEl.appendChild(li);
      });
      addressSuggestionsEl.hidden = false;
      propertyTextarea.setAttribute('aria-expanded', 'true');
    }

    addressSuggestionsEl.addEventListener('mousedown', function (e) { e.preventDefault(); });

    function invalidateStaleCoordinatesIfNeeded() {
      if (lastGeocodedAddressText != null && propertyTextarea.value !== lastGeocodedAddressText) {
        if (record) {
          record.propertyAddressLat = null;
          record.propertyAddressLon = null;
        }
        lastGeocodedAddressText = null;
      }
    }

    function scheduleAddressAutocomplete() {
      if (addressDebounceTimer) clearTimeout(addressDebounceTimer);
      const text = propertyTextarea.value.trim();
      if (text.length < ADDRESS_MIN_CHARS || !window.ToolboxGeo || !window.ToolboxGeo.isAvailable() || navigator.onLine === false) {
        closeSuggestions();
        return;
      }
      addressDebounceTimer = setTimeout(function () {
        window.ToolboxGeo.fetchAutocomplete(text).then(function (results) {
          if (results === null) return;
          if (propertyTextarea.value.trim() !== text) return;
          if (results.length === 0) {
            const reason = window.ToolboxGeo.getLastAutocompleteError();
            if (reason) setAddressFeedback('Address suggestions unavailable (' + reason + ').');
            closeSuggestions();
            return;
          }
          renderSuggestions(results);
        });
      }, ADDRESS_DEBOUNCE_MS);
    }

    propertyTextarea.addEventListener('input', function () {
      invalidateStaleCoordinatesIfNeeded();
      scheduleAddressAutocomplete();
    });

    propertyTextarea.addEventListener('keydown', function (e) {
      if (addressSuggestionsEl.hidden) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, currentSuggestions.length - 1);
        updateActiveSuggestion();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
        updateActiveSuggestion();
      } else if (e.key === 'Enter') {
        if (activeSuggestionIndex >= 0) {
          e.preventDefault();
          selectSuggestion(activeSuggestionIndex);
        }
      } else if (e.key === 'Escape') {
        closeSuggestions();
      }
    });

    propertyTextarea.addEventListener('blur', function () { closeSuggestions(); });

    useLocationBtn.addEventListener('click', function () {
      if (!('geolocation' in navigator)) {
        setAddressFeedback("This device doesn't support location.");
        return;
      }
      useLocationBtn.disabled = true;
      setAddressFeedback('Getting your location…');
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          useLocationBtn.disabled = false;
          if (!record) return;
          record.propertyAddressLat = pos.coords.latitude;
          record.propertyAddressLon = pos.coords.longitude;
          lastGeocodedAddressText = propertyTextarea.value;
          scheduleSave();
          if (!window.ToolboxGeo || !window.ToolboxGeo.isAvailable()) {
            setAddressFeedback('Location captured. Enter the address manually.');
            return;
          }
          setAddressFeedback('Location captured — looking up the address…');
          window.ToolboxGeo.reverseGeocode(pos.coords.latitude, pos.coords.longitude).then(function (result) {
            if (!record) return;
            if (result && result.label) {
              propertyTextarea.value = result.label;
              syncMailingIfSame();
              record.propertyAddressLat = result.lat;
              record.propertyAddressLon = result.lon;
              lastGeocodedAddressText = result.label;
              scheduleSave();
              setAddressFeedback('Address filled from your location — review and edit if needed.');
            } else {
              const reason = window.ToolboxGeo.getLastReverseError();
              setAddressFeedback(reason
                ? 'Location captured, but the address lookup failed (' + reason + '). Enter it manually.'
                : 'Location captured. Enter the address manually.');
            }
          });
        },
        function () {
          useLocationBtn.disabled = false;
          setAddressFeedback("Couldn't get your location. Enter the address manually.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });

    function updateIdentityBar() {
      identityName.textContent = displayName(record);
      identityAddress.textContent = displayAddress(record);
    }

    function collectFormIntoRecord() {
      FIELD_DEFS.primary.concat(FIELD_DEFS.additional).forEach(function (f) {
        const el = fieldEl(f.id);
        if (el) record[f.id] = el.value;
      });
      record.mailingSameAsProperty = sameAddressCheckbox.checked;
      record.mailingAddress = mailingTextarea.value;
    }

    function setStatus(text) { statusEl.textContent = text; }

    function refreshEditorProgress() {
      if (!record) return;
      const hasName = !!((fieldEl('firstName').value || '').trim() || (fieldEl('lastName').value || '').trim());
      const hasAddress = !!(propertyTextarea.value || '').trim();
      const hasContact = !!(
        (fieldEl('cellPhone').value || '').trim() ||
        (fieldEl('homePhone').value || '').trim() ||
        (fieldEl('email').value || '').trim()
      );
      const readiness = planReadiness(record);
      const customerReady = hasName && hasAddress;
      customerSectionStatus.textContent = customerReady ? 'Name and address ready' : 'Add name and address';
      contactsSectionStatus.textContent = hasContact ? 'Contact details added' : 'Optional details';
      plansSectionStatus.textContent = readiness.hasPlan ? planSummaryText(record) : 'Floor plan required';
      editorTabs.forEach(function (tab) {
        const section = tab.getAttribute('data-edit-section');
        const ready = section === 'customer' ? customerReady : section === 'contacts' ? hasContact : readiness.hasPlan;
        tab.classList.toggle('is-complete', ready);
      });
    }

    // One place that says "something changed", so nothing can set `dirty`
    // without also moving the counter a save is checked against.
    function noteEdit() {
      editSeq += 1;
      dirty = true;
    }

    function scheduleSave() {
      noteEdit();
      setStatus('Unsaved changes…');
      refreshEditorProgress();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        flushSave().catch(function () {});
      }, AUTOSAVE_DELAY_MS);
    }

    function flushSave(opts) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!dirty || !record) return Promise.resolve();
      if (plansApi) plansApi.commitPending();
      collectFormIntoRecord();
      // Taken AFTER the form is read, because reading it is this save's
      // snapshot: an edit made before here is in the record, one made after
      // is not.
      const savedSeq = editSeq;
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
      const now = new Date().toISOString();
      record.updatedAt = now;
      if (pendingCustomerBump || !record.customerUpdatedAt) {
        record.customerUpdatedAt = now;
      }
      if (pendingPlansBump && record.planSetup) {
        record.planSetup.updatedAt = now;
      }
      pendingCustomerBump = false;
      pendingPlansBump = false;
      const drain = !!(opts && opts.drain);
      const drainPass = drain ? ((opts && opts._drainPass) || 0) + 1 : 0;
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        isNewFile = false;
        updateIdentityBar();
        backBtn.textContent = '‹ Customer File';
        if (editSeq !== savedSeq) {
          // Edited while this was in flight. The record on disk is already
          // behind the form, so it stays dirty and the status does not say
          // otherwise. Re-arm if nothing else did, so the newer edit lands.
          setStatus('Unsaved changes…');
          // GPT-035: a deliberate Refresh/finish drain must write the newer
          // snapshot before reload is allowed — not wait on the debounce.
          if (drain) {
            if (drainPass > 20) {
              throw new Error('Save could not finish before refresh');
            }
            return flushSave({ drain: true, _drainPass: drainPass });
          }
          if (!saveTimer) {
            saveTimer = setTimeout(function () {
              flushSave().catch(function () {});
            }, AUTOSAVE_DELAY_MS);
          }
          return;
        }
        dirty = false;
        setStatus('Saved ' + formatUpdated(record.updatedAt));
      }).catch(function (err) {
        console.error('Failed to save Customer File:', err);
        if (err && err.code === 'checkout') {
          dirty = false;
          setStatus(err.message || 'Checked out on another device');
          return;
        }
        setStatus('Save failed — will retry');
        throw err;
      });
    }

    function leaveEdit() {
      noteEdit();
      setStatus('Finishing…');
      const idle = plansApi && plansApi.whenIdle ? plansApi.whenIdle() : Promise.resolve();
      idle.then(function () {
        return flushSave();
      }).then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(id);
      }).catch(function () {});
    }

    backBtn.addEventListener('click', function () {
      if (isNewFile) {
        noteEdit();
        flushSave().then(function () {
          window.location.hash = '#/';
        }).catch(function () {});
        return;
      }
      leaveEdit();
    });

    saveBtn.addEventListener('click', function () {
      noteEdit();
      flushSave().catch(function () {});
    });

    doneBtn.addEventListener('click', leaveEdit);

    sameAddressCheckbox.addEventListener('change', function () {
      updateMailingVisibility();
      pendingCustomerBump = true;
      scheduleSave();
    });
    propertyTextarea.addEventListener('input', function () {
      pendingCustomerBump = true;
      syncMailingIfSame();
    });
    app.addEventListener('input', function (e) {
      if (e.target && e.target.id && e.target.id.indexOf('field-') === 0) {
        pendingCustomerBump = true;
        scheduleSave();
      }
    });

    registerActiveFlush(flushSave);

    plansApi = window.ToolboxPlanSetup.mountPlansPanel(plansPanel, {
      getRecord: function () { return record; },
      setDirty: function (v) {
        if (v) noteEdit(); else dirty = false;
        refreshEditorProgress();
      },
      scheduleSave: function () {
        pendingPlansBump = true;
        if (record && record.planSetup) {
          record.planSetup.updatedAt = new Date().toISOString();
        }
        scheduleSave();
      },
      flushSave: function () {
        pendingPlansBump = true;
        if (record && record.planSetup) {
          record.planSetup.updatedAt = new Date().toISOString();
        }
        return flushSave();
      },
      setStatus: setStatus,
      setFeedback: function () {},
    });

    setStatus('Loading…');
    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      if (isLegacyLocalTrash(existing)) {
        window.location.replace('#/trash');
        return null;
      }
      isNewFile = !existing;
      record = existing || blankCustomerFile(id);
      if (window.ToolboxPlanSetup && window.ToolboxPlanSetup.ensurePlanSetup(record) && existing) {
        noteEdit();
      } else if (!existing && window.ToolboxPlanSetup) {
        window.ToolboxPlanSetup.ensurePlanSetup(record);
      }
      if (!record) return null;
      populateForm(record);
      updateIdentityBar();
      backBtn.textContent = isNewFile ? '‹ Cabinet' : '‹ Customer File';
      return plansApi.syncFromRecord().then(function () {
        refreshEditorProgress();
        if (!existing) noteEdit();
        if (dirty) return flushSave();
        setStatus('Saved ' + formatUpdated(record.updatedAt));
      });
    }).catch(function (err) {
      console.error('Failed to load Customer File:', err);
      record = blankCustomerFile(id);
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
      populateForm(record);
      updateIdentityBar();
      plansApi.syncFromRecord();
      setStatus('New — not yet saved');
    });
  }

  function flushActiveFile() {
    if (!activeFileFlush) return Promise.resolve();
    return Promise.resolve(activeFileFlush()).catch(function () {
      // Status already set by the active view's flushSave.
    });
  }
  document.addEventListener('visibilitychange', flushActiveFile);
  window.addEventListener('pagehide', flushActiveFile);

  // App-level Refresh control: reloads the current view (hash preserved)
  // to pick up a newly deployed shell. Flushes any pending autosave first
  // so a refresh never discards an in-progress edit.
  const refreshBtn = document.getElementById('app-refresh');
  if (refreshBtn) {
    // GPT-035: inert on the editing surface blocks focus + keyboard, not just
    // pointer-events. Do not silently ignore edits in a still-editable control.
    function setRefreshFinishLock(on) {
      document.documentElement.classList.toggle('tb-refresh-locked', !!on);
      const surface = document.getElementById('app-view');
      if (!surface) return;
      if (on) {
        surface.inert = true;
        const ae = document.activeElement;
        if (ae && surface.contains(ae) && typeof ae.blur === 'function') ae.blur();
      } else {
        surface.inert = false;
      }
    }

    function paintRefreshIdle() {
      const ready = window.ToolboxUpdate
        && typeof window.ToolboxUpdate.isAvailable === 'function'
        && window.ToolboxUpdate.isAvailable();
      refreshBtn.disabled = false;
      setRefreshFinishLock(false);
      if (ready) {
        refreshBtn.classList.add('is-update-ready');
        // GPT-035: shorter phone label so the red control fits the app bar.
        const narrow = window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
        refreshBtn.textContent = narrow ? '↻ Update' : '↻ Update ready';
        refreshBtn.title = 'A new version of Toolbox is ready. Click to load it.';
        refreshBtn.setAttribute('aria-label', 'Update ready — load new Toolbox version');
      } else {
        refreshBtn.classList.remove('is-update-ready');
        refreshBtn.textContent = '↻ Refresh';
        refreshBtn.title = '';
        refreshBtn.setAttribute('aria-label', 'Refresh Toolbox');
      }
    }

    // A plain reload fetches a fresh document that then loads the OLD scripts
    // and styles from the installed shell, so the app comes back on the
    // previous version. Refresh asks the service worker to take the new one
    // first, then reloads. GPT-034/035: lock the canvas so mid-refresh typing
    // cannot land, drain the active save until the latest snapshot is durable,
    // then update; a failed flush keeps the page and does not claim a safe update.
    refreshBtn.addEventListener('click', function () {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Updating…';
      setRefreshFinishLock(true);
      Promise.resolve(activeFileFlush ? activeFileFlush({ drain: true }) : null).then(function () {
        if (window.ToolboxUpdate && typeof window.ToolboxUpdate.refresh === 'function') {
          return window.ToolboxUpdate.refresh();
        }
        window.location.reload();
        return null;
      }).catch(function () {
        // Status already set by the active view's flushSave.
        // Never time out a failed/slow save into a destructive reload.
        paintRefreshIdle();
      });
    });

    // Say so when a deploy lands while the app is open, rather than leaving
    // the investigator to guess whether they are looking at the new version.
    if (window.ToolboxUpdate && typeof window.ToolboxUpdate.onAvailable === 'function') {
      window.ToolboxUpdate.onAvailable(function () {
        if (refreshBtn.disabled) return;
        paintRefreshIdle();
      });
    }
  }

  function installSafetyGuards() {
    const db = window.ToolboxDB;
    if (!db || db.__checkoutGuard) return;
    db.__checkoutGuard = true;
    // This device's lock map is the live answer, and the stored copies keep
    // it honest: reading one re-seeds the map from the mark it carries, so a
    // phone whose storage was cleared still refuses. The record handed in
    // here is deliberately NOT consulted -- it can be a snapshot taken
    // before the other device let go, and refusing on that would block work
    // on a file nobody holds any more.
    function lockedError(id) {
      if (!id || !window.ToolboxSync || typeof window.ToolboxSync.isCheckedOutElsewhere !== 'function') return null;
      if (!window.ToolboxSync.isCheckedOutElsewhere(id)) return null;
      const err = new Error(window.ToolboxSync.foreignCheckoutLabel(id) || 'Checked out on another device.');
      err.code = 'checkout';
      return err;
    }
    function note(id) {
      if (id && window.ToolboxSync && typeof window.ToolboxSync.noteLocalSave === 'function') {
        window.ToolboxSync.noteLocalSave(id);
      }
    }
    function recordsLocked(records) {
      const list = records || [];
      for (let i = 0; i < list.length; i++) {
        const err = lockedError(list[i] && list[i].id);
        if (err) return err;
      }
      return null;
    }
    // Reading a copy repairs what this device knows about it, so the route
    // gate and every later write get the same answer the record gives.
    const read = db.getCustomerFile.bind(db);
    db.getCustomerFile = function (id) {
      return read(id).then(function (record) {
        if (record && record.heldByOtherDevice && window.ToolboxSync &&
            typeof window.ToolboxSync.noteForeignMarks === 'function') {
          window.ToolboxSync.noteForeignMarks(record);
        }
        return record;
      });
    };
    const save = db.saveCustomerFile.bind(db);
    db.saveCustomerFile = function (record) {
      const err = lockedError(record && record.id);
      if (err) return Promise.reject(err);
      return save(record).then(function (saved) {
        note(saved && saved.id);
        return saved;
      });
    };
    const trash = db.moveCustomerFileToTrash.bind(db);
    db.moveCustomerFileToTrash = function (id) {
      const err = lockedError(id);
      if (err) return Promise.reject(err);
      return trash(id).then(function (saved) {
        note(id);
        return saved;
      });
    };
    const restore = db.restoreCustomerFile.bind(db);
    db.restoreCustomerFile = function (id) {
      const err = lockedError(id);
      if (err) return Promise.reject(err);
      return restore(id).then(function (saved) {
        note(id);
        return saved;
      });
    };
    const remove = db.removeLocalWorkingCopy.bind(db);
    db.removeLocalWorkingCopy = function (records) {
      const err = recordsLocked(records);
      if (err) return Promise.reject(err);
      return remove(records);
    };
    const hardDelete = db.permanentlyDeleteCustomerFiles.bind(db);
    db.permanentlyDeleteCustomerFiles = function (records) {
      const err = recordsLocked(records);
      if (err) return Promise.reject(err);
      return hardDelete(records);
    };
    // Sync writes the "another device holds this" mark onto the copy itself.
    // That write is the lock being applied and must not be refused by the
    // guard that enforces it.
    if (window.ToolboxSync && typeof window.ToolboxSync.useDirectSave === 'function') {
      window.ToolboxSync.useDirectSave(save);
    }
    const importRecovery = db.importCustomerFileRecovery.bind(db);
    db.importCustomerFileRecovery = function (record) {
      const err = lockedError(record && record.id);
      if (err) return Promise.reject(err);
      const args = arguments;
      return importRecovery.apply(db, args).then(function (saved) {
        note(record && record.id);
        return saved;
      });
    };
    const commitRecovery = db.commitCustomerFileRecoveryUpdate.bind(db);
    db.commitCustomerFileRecoveryUpdate = function (record) {
      const err = lockedError(record && record.id);
      if (err) return Promise.reject(err);
      const args = arguments;
      return commitRecovery.apply(db, args).then(function (saved) {
        note(record && record.id);
        return saved;
      });
    };
  }
  installSafetyGuards();

  function showSyncResult(text, ok) {
    const el = document.getElementById('app-sync-result');
    if (!el) return;
    const successText = text === 'Sync complete.' || text === 'Everything is already synced.';
    const showOk = !!ok && successText;
    const message = showOk ? text : (successText ? 'Sync failed.' : (text || 'Sync failed.'));
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle('is-ok', showOk);
    el.classList.toggle('is-failure', !showOk);
  }

  function clearSyncResult() {
    const el = document.getElementById('app-sync-result');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-ok', 'is-failure');
  }

  // Sync Now: exchange changed Customer File components with the cloud cabinet.
  // Save remains local; this control never blocks offline use of local files.
  const syncBtn = document.getElementById('app-sync');
  if (syncBtn) {
    let syncing = false;
    function setSyncLabel(text) {
      syncBtn.textContent = text;
    }
    function runSyncNow() {
      if (syncing) return;
      if (!window.ToolboxSync || typeof window.ToolboxSync.syncNow !== 'function') {
        setSyncLabel('Sync unavailable');
        return;
      }
      if (!window.ToolboxSync.syncApiBase()) {
        setSyncLabel('Sync not configured');
        setTimeout(function () { setSyncLabel('Sync Now'); }, 2500);
        return;
      }
      syncing = true;
      syncBtn.disabled = true;
      setSyncLabel('Syncing…');
      clearSyncResult();
      Promise.resolve(flushActiveFile())
        .then(function () {
          return window.ToolboxSync.syncNow();
        })
        .then(function (result) {
          const message = (result && result.message) ||
            (window.ToolboxSync.syncNowMessage && window.ToolboxSync.syncNowMessage(result)) ||
            'Sync complete.';
          if (result && result.ok === false) {
            showSyncResult(result.message || 'Sync failed.', false);
            setSyncLabel('Sync failed');
            console.warn('Sync Now incomplete:', result);
            return;
          }
          showSyncResult(message, true);
          setSyncLabel('Sync Now');
          try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {
            window.location.hash = window.location.hash;
          }
        })
        .catch(function (err) {
          const code = err && err.code;
          const detail = (err && err.message) || 'Sync failed.';
          showSyncResult(detail, false);
          if (code === 'offline' || code === 'network') setSyncLabel('Offline');
          else if (code === 'auth') setSyncLabel('Sign in to sync');
          else if (code === 'config') setSyncLabel('Sync not configured');
          else setSyncLabel('Sync failed');
          console.warn('Sync Now failed:', err);
        })
        .then(function () {
          syncing = false;
          syncBtn.disabled = false;
          setTimeout(function () { setSyncLabel('Sync Now'); }, 2800);
        });
    }
    setSyncLabel('Sync Now');
    syncBtn.addEventListener('click', runSyncNow);

    window.addEventListener('online', function () {
      if (window.ToolboxSync && typeof window.ToolboxSync.flushQuietSync === 'function') {
        window.ToolboxSync.flushQuietSync().catch(function () {});
      }
      if (window.ToolboxSync && typeof window.ToolboxSync.refreshLocalCheckoutLocks === 'function') {
        window.ToolboxSync.refreshLocalCheckoutLocks().then(function () {
          const hash = window.location.hash || '#/';
          if (hash === '#/' || hash === '#') {
            try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {}
          }
        }).catch(function () {});
      }
    });

    // Resume Sync Now after full-page Cloudflare Access sign-in (iPhone PWA).
    try {
      const params = new URLSearchParams(window.location.search || '');
      const resume = params.get('resumeSync') === '1';
      let pending = false;
      try { pending = sessionStorage.getItem('toolboxPendingSync') === '1'; } catch (_) {}
      if (resume || pending) {
        try { sessionStorage.removeItem('toolboxPendingSync'); } catch (_) {}
        if (resume) {
          params.delete('resumeSync');
          const q = params.toString();
          const next = window.location.pathname + (q ? '?' + q : '') + (window.location.hash || '');
          history.replaceState({}, '', next);
        }
        setTimeout(runSyncNow, 350);
      }
    } catch (_) {}
  }

  window.addEventListener('hashchange', render);
  // What the local copies already know about foreign Check Outs goes back
  // into this device's lock map before anything is drawn, so a deep link
  // straight into a survey is answered correctly the first time.
  window.addEventListener('DOMContentLoaded', function () {
    const sync = window.ToolboxSync;
    if (!sync) {
      render();
      return;
    }
    // This device's id first -- it decides which device holds a Check Out,
    // and everything after this point asks for it.
    const ready = typeof sync.restoreDeviceId === 'function'
      ? sync.restoreDeviceId().catch(function () {})
      : Promise.resolve();
    ready.then(function () {
      if (typeof sync.seedForeignLocksFromLocalCopies === 'function') {
        return sync.seedForeignLocksFromLocalCopies();
      }
      return null;
    }).then(render, render);
  });

  // Shared helpers for other product-area modules (Customer File plans).
  window.ToolboxApp = {
    confirmAction: confirmAction,
    registerActiveFlush: registerActiveFlush,
    blankCustomerFile: blankCustomerFile,
    blankInitialVisit: blankInitialVisit,
    isVisitRecord: isVisitRecord,
    hasInvestigationData: hasInvestigationData,
    hasFieldCaptureCustomerData: hasFieldCaptureCustomerData,
    isEmptyCustomerFileStub: isEmptyCustomerFileStub,
    customerFileLocationLabel: customerFileLocationLabel,
    customerIdentity: {
      displayName: displayName,
      displayAddress: displayAddress,
      formatUpdated: formatUpdated,
    },
  };
})();
