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

  function displayName(record) {
    const name = ((record.firstName || '') + ' ' + (record.lastName || '')).trim();
    return name || 'New Customer File';
  }

  function displayAddress(record) {
    const addr = (record.propertyAddress || '').trim();
    if (!addr) return 'No property address yet';
    return addr.split('\n')[0].trim() || 'No property address yet';
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
        (Array.isArray(distress.drawings) && distress.drawings.length)) {
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
   * Only a brand-new empty stub may be hard-deleted from Cabinet + cloud.
   * Name, address, or a usable plan means Soft Trash — permanent cloud DELETE
   * from one phone would wipe the shared Tim/Lee cabinet for every device.
   */
  function isEmptyCustomerFileStub(record) {
    if (!record) return true;
    if (hasInvestigationData(record)) return false;
    if (planReadiness(record).hasPlan) return false;
    if ((record.firstName || '').trim() || (record.lastName || '').trim()) return false;
    if ((record.propertyAddress || '').trim()) return false;
    if ((record.companyName || '').trim()) return false;
    if ((record.notes || '').trim()) return false;
    return true;
  }

  function daysUntilPurge(record) {
    const purgeAt = record && Date.parse(record.purgeAfter);
    if (!Number.isFinite(purgeAt)) return 0;
    return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
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
        '  <div class="confirm-card__actions">' +
        '    <button type="button" id="confirm-no" class="btn btn--secondary">No, keep it</button>' +
        '    <button type="button" id="confirm-yes" class="btn btn--danger">Yes</button>' +
        '  </div>' +
        '</section>';
      document.body.appendChild(overlay);
    }

    const title = overlay.querySelector('#confirm-title');
    const message = overlay.querySelector('#confirm-message');
    const noBtn = overlay.querySelector('#confirm-no');
    const yesBtn = overlay.querySelector('#confirm-yes');
    title.textContent = options.title;
    message.textContent = options.message;
    noBtn.textContent = options.cancelLabel || 'No, keep it';
    yesBtn.textContent = options.confirmLabel || 'Yes';
    overlay.hidden = false;
    noBtn.focus();

    return new Promise(function (resolve) {
      function finish(result) {
        overlay.hidden = true;
        noBtn.removeEventListener('click', cancel);
        yesBtn.removeEventListener('click', confirm);
        overlay.removeEventListener('click', outside);
        document.removeEventListener('keydown', escape);
        resolve(result);
      }
      function cancel() { finish(false); }
      function confirm() { finish(true); }
      function outside(event) { if (event.target === overlay) cancel(); }
      function escape(event) { if (event.key === 'Escape') cancel(); }
      noBtn.addEventListener('click', cancel);
      yesBtn.addEventListener('click', confirm);
      overlay.addEventListener('click', outside);
      document.addEventListener('keydown', escape);
    });
  }

  // ---- Routing ----------------------------------------------------------
  //
  // #/file/:id          → Customer File home (hub)
  // #/file/:id/edit     → edit contact + plans
  // #/file/:id/plan     → redirect to edit (legacy)
  // #/file/:id/<app>    → not-yet-connected stub (Distress, Floor, etc.)

  function parseRoute() {
    const hash = window.location.hash || '#/';
    if (hash === '#/trash') return { view: 'trash' };
    if (hash === '#/cabinet') return { view: 'file-cabinet' };
    if (hash === '#/import') return { view: 'import', id: null, allowDestinationChoice: true };
    const match = hash.match(/^#\/file\/([^/]+)(?:\/(edit|plan|import|distress|floor|diagnostics|report))?(?:\/(customer|contacts|plans))?$/);
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
      if (sub === 'diagnostics' || sub === 'report') {
        return { view: 'app-stub', id: id, app: sub };
      }
      return { view: 'home', id: id };
    }
    return { view: 'cabinet' };
  }

  function render() {
    const app = document.getElementById('app-view');
    if (!app) return;
    const route = parseRoute();
    if (route.view !== 'floor') {
      document.body.classList.remove('floor-survey-open');
      app.classList.remove('canvas--floor-survey');
      if (window.ToolboxFloorSurvey && typeof window.ToolboxFloorSurvey.unmount === 'function') {
        window.ToolboxFloorSurvey.unmount();
      }
    }
    if (route.view !== 'distress') {
      document.body.classList.remove('distress-survey-open');
      app.classList.remove('canvas--distress-survey');
      if (window.ToolboxDistress && typeof window.ToolboxDistress.unmount === 'function') {
        window.ToolboxDistress.unmount();
      }
    }
    if (route.legacyPlan) {
      window.location.replace('#/file/' + encodeURIComponent(route.id) + '/edit/plans');
      return;
    }
    if (route.view === 'edit') {
      renderFileEdit(app, route.id, route.section);
    } else if (route.view === 'home') {
      renderFileHome(app, route.id);
    } else if (route.view === 'floor') {
      renderFloorSurvey(app, route.id);
    } else if (route.view === 'distress') {
      renderDistressSurvey(app, route.id);
    } else if (route.view === 'import') {
      renderCustomerFileImport(app, route.id, { allowDestinationChoice: !!route.allowDestinationChoice });
    } else if (route.view === 'app-stub') {
      renderAppStub(app, route.id, route.app);
    } else if (route.view === 'trash') {
      renderTrash(app);
    } else if (route.view === 'file-cabinet') {
      renderFileCabinet(app);
    } else {
      renderCabinet(app);
    }
  }

  // ---- Customer Files (working area) + dedicated File Cabinet ----------

  let cabinetNotice = '';

  function renderCabinet(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<section class="cabinet-hero">' +
      '  <div>' +
      '    <p class="eyebrow">Toolbox</p>' +
      '    <h1>Customer Files</h1>' +
      '    <p>Open a job or create a file. Customer details and plans stay together.</p>' +
      '  </div>' +
      '  <div class="cabinet-hero__actions">' +
      '    <button type="button" id="cabinet-trash" class="btn btn--secondary cabinet-trash">🗑 Trash <span id="cabinet-trash-count"></span></button>' +
      '    <button type="button" id="cabinet-import" class="btn btn--secondary">Import standalone export</button>' +
      '    <button type="button" id="cabinet-new" class="btn btn--accent cabinet-new">+ New Customer File</button>' +
      '  </div>' +
      '</section>' +
      '  <p class="cabinet-notice" id="cabinet-notice" hidden></p>' +
      '<h2 class="cabinet-section-title">On this device</h2>' +
      '<div class="cabinet-list" id="cabinet-list"></div>' +
      '<button type="button" class="file-cabinet-entry" id="open-file-cabinet" aria-label="Open File Cabinet">' +
      '  <div class="file-cabinet-entry__main">' +
      '    <div class="file-cabinet-entry__title">File Cabinet</div>' +
      '    <div class="file-cabinet-entry__note">Browse cloud Customer Files. Check Out brings one onto this device.</div>' +
      '  </div>' +
      '  <span class="file-cabinet-entry__cta">Open File Cabinet ›</span>' +
      '</button>';

    const listEl = app.querySelector('#cabinet-list');
    const newBtn = app.querySelector('#cabinet-new');
    const importBtn = app.querySelector('#cabinet-import');
    const trashBtn = app.querySelector('#cabinet-trash');
    const trashCount = app.querySelector('#cabinet-trash-count');
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
    importBtn.addEventListener('click', function () {
      window.location.hash = '#/import';
    });
    trashBtn.addEventListener('click', function () {
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
      const trashed = allRecords.filter(function (record) { return !!record.deletedAt; });
      const records = allRecords.filter(function (record) { return !record.deletedAt; });
      trashCount.textContent = trashed.length ? '(' + trashed.length + ')' : '';
      records.sort(function (a, b) {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });

      listEl.innerHTML = '';

      if (records.length === 0) {
        const p = document.createElement('p');
        p.className = 'cabinet-empty';
        p.textContent = 'No Customer Files on this device yet.';
        listEl.appendChild(p);
      } else {
        records.forEach(function (record) {
          listEl.appendChild(cabinetRowNode(record, function () {
            requestCustomerFileRemoval(record).then(function (result) {
              if (!result) return;
              cabinetNotice = result;
              renderCabinet(app);
            }).catch(function (err) {
              console.error('Could not remove Customer File:', err);
              cabinetNotice = 'Could not remove that Customer File. Try again.';
              renderCabinet(app);
            });
          }));
        });
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

  function cloudAvailabilityLabel(entry) {
    if (!entry) return '';
    if (entry.availability === 'checked-out-here') return 'Checked out on this device';
    if (entry.availability === 'checked-out-elsewhere') {
      const who = entry.checkout && entry.checkout.email ? entry.checkout.email : 'another user/device';
      return 'Checked out elsewhere (' + who + ')';
    }
    if (entry.presence === 'local') return 'Also on this device';
    return 'Available to Check Out';
  }

  function filterCabinetEntries(entries, query) {
    const list = Array.isArray(entries) ? entries : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(function (entry) {
      if (!entry) return false;
      const name = String(entry.displayName || '').toLowerCase();
      const address = String(entry.propertyAddress || '').toLowerCase();
      return name.indexOf(q) !== -1 || address.indexOf(q) !== -1;
    });
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
      '      <p>Browse cloud Customer Files. Check Out brings one selected file onto this device.</p>' +
      '    </div>' +
      '  </header>' +
      '  <label class="file-cabinet-search">' +
      '    <span class="sr-only">Search File Cabinet</span>' +
      '    <input type="search" id="file-cabinet-search" placeholder="Search by customer or address" autocomplete="off" />' +
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
      filtered.sort(function (a, b) {
        return String(a.displayName || '').localeCompare(String(b.displayName || ''));
      });
      filtered.forEach(function (entry) {
        listEl.appendChild(cabinetCloudRowNode(entry, app));
      });
    }

    searchInput.addEventListener('input', paintList);

    if (!window.ToolboxSync || typeof window.ToolboxSync.browseCabinet !== 'function' ||
        !window.ToolboxSync.syncApiBase || !window.ToolboxSync.syncApiBase()) {
      listEl.innerHTML = '<p class="cabinet-empty">Sign in / Sync not configured — File Cabinet browse unavailable.</p>';
      return;
    }

    window.ToolboxSync.browseCabinet().then(function (browse) {
      inventory = cabinetInventoryEntries(browse);
      paintList();
    }).catch(function (err) {
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
    shell.className = 'cabinet-row-shell cabinet-row-shell--cloud';
    shell.dataset.customerFileId = entry.id;

    const row = document.createElement('div');
    row.className = 'cabinet-row cabinet-row--cloud';

    const main = document.createElement('div');
    main.className = 'cabinet-row__main';

    const name = document.createElement('div');
    name.className = 'cabinet-row__name';
    name.textContent = entry.displayName || 'Customer File';

    const address = document.createElement('div');
    address.className = 'cabinet-row__address';
    address.textContent = entry.propertyAddress || 'No property address';

    const meta = document.createElement('div');
    meta.className = 'cabinet-row__meta';
    meta.textContent = cloudAvailabilityLabel(entry);

    main.appendChild(name);
    main.appendChild(address);
    main.appendChild(meta);
    row.appendChild(main);

    if (entry.availability === 'available' && entry.presence !== 'local') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--secondary cabinet-checkout-btn';
      btn.textContent = 'Check Out';
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        btn.disabled = true;
        btn.textContent = 'Checking out…';
        window.ToolboxSync.checkOutCustomerFile(entry.id).then(function () {
          cabinetNotice = (entry.displayName || 'Customer File') + ' checked out to this device.';
          window.location.hash = '#/';
        }).catch(function (err) {
          console.warn('Check Out failed:', err);
          cabinetNotice = (err && err.message) || 'Check Out failed.';
          // Stay on File Cabinet so the failure notice is visible after re-render.
          renderFileCabinet(app);
          const notice = app.querySelector('#file-cabinet-notice');
          if (notice && cabinetNotice) {
            notice.textContent = cabinetNotice;
            notice.hidden = false;
            cabinetNotice = '';
          }
        });
      });
      row.appendChild(btn);
    } else if (entry.presence === 'local') {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn--secondary cabinet-checkout-btn';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', function () {
        window.location.hash = '#/file/' + encodeURIComponent(entry.id);
      });
      row.appendChild(openBtn);
    }

    shell.appendChild(row);
    return shell;
  }

  function removeCloudCopies(records) {
    if (!window.ToolboxSync || typeof window.ToolboxSync.deleteRemoteCustomerFile !== 'function') {
      return Promise.resolve();
    }
    if (!window.ToolboxSync.syncApiBase || !window.ToolboxSync.syncApiBase()) {
      return Promise.resolve();
    }
    const list = (records || []).filter(function (r) { return r && r.id; });
    if (!list.length) return Promise.resolve();
    return Promise.all(list.map(function (record) {
      return window.ToolboxSync.deleteRemoteCustomerFile(record.id).catch(function (err) {
        console.warn('Could not remove cloud copy of Customer File', record.id, err);
      });
    }));
  }

  function requestCustomerFileRemoval(record) {
    const name = displayName(record);
    // Multi-device: only truly empty stubs may hard-delete local+cloud.
    // Named jobs, addressed jobs, and plan-bearing files go to Trash so one
    // device cannot wipe the shared cabinet for Tim/Lee.
    if (isEmptyCustomerFileStub(record)) {
      return confirmAction({
        title: 'Delete empty file?',
        message: name + ' has no customer details, plans, or survey data. This permanently deletes it.',
        cancelLabel: 'No, keep file',
        confirmLabel: 'Yes, delete permanently',
      }).then(function (confirmed) {
        if (!confirmed) return null;
        return window.ToolboxDB.permanentlyDeleteCustomerFiles([record]).then(function () {
          return removeCloudCopies([record]).then(function () {
            return name + ' was permanently deleted.';
          });
        });
      });
    }

    return confirmAction({
      title: 'Move Customer File to Trash?',
      message: name + ' will remain recoverable for 120 days. Sync Now will update your other devices.',
      cancelLabel: 'No, keep file',
      confirmLabel: 'Yes, move to Trash',
    }).then(function (confirmed) {
      if (!confirmed) return null;
      return window.ToolboxDB.moveCustomerFileToTrash(record.id).then(function () {
        return name + ' was moved to Trash for 120 days.';
      });
    });
  }

  function cabinetRowNode(record, onRemove) {
    const shell = document.createElement('div');
    shell.className = 'cabinet-row-shell';
    shell.dataset.customerFileId = record.id;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cabinet-row';
    row.addEventListener('click', function () {
      window.location.hash = '#/file/' + encodeURIComponent(record.id);
    });

    const main = document.createElement('span');
    main.className = 'cabinet-row__main';

    const name = document.createElement('span');
    name.className = 'cabinet-row__name';
    name.textContent = displayName(record);

    const addr = document.createElement('span');
    addr.className = 'cabinet-row__address';
    addr.textContent = displayAddress(record);

    main.appendChild(name);
    main.appendChild(addr);

    const meta = document.createElement('span');
    meta.className = 'cabinet-row__meta';
    const readiness = planReadiness(record);
    const planState = document.createElement('span');
    planState.className = 'cabinet-row__plan-state' + (readiness.hasPlan ? ' is-ready' : '');
    planState.textContent = readiness.hasPlan
      ? readiness.ready.length + (readiness.ready.length === 1 ? ' plan ready' : ' plans ready')
      : 'Plan needed';
    const updated = document.createElement('span');
    updated.textContent = formatUpdated(record.updatedAt);
    meta.appendChild(planState);
    meta.appendChild(updated);

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

    const cabinetBacked = !!(window.ToolboxSync &&
      typeof window.ToolboxSync.isCheckedOutFromCabinet === 'function' &&
      window.ToolboxSync.isCheckedOutFromCabinet(record));

    if (cabinetBacked) {
      const checkInBtn = document.createElement('button');
      checkInBtn.type = 'button';
      checkInBtn.className = 'cabinet-row-menu__action';
      checkInBtn.textContent = 'Check In';
      checkInBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        menu.classList.remove('is-open');
        requestCheckInCustomerFile(record);
      });
      menu.appendChild(menuToggle);
      menu.appendChild(checkInBtn);
    } else {
      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'cabinet-row-menu__action';
      sendBtn.textContent = 'Send to File Cabinet';
      sendBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        menu.classList.remove('is-open');
        requestSendToFileCabinet(record);
      });
      menu.appendChild(menuToggle);
      menu.appendChild(sendBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cabinet-row-menu__danger';
    removeBtn.textContent = isEmptyCustomerFileStub(record) ? 'Delete empty file' : 'Move to Trash';
    removeBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.classList.remove('is-open');
      onRemove();
    });

    menu.appendChild(removeBtn);
    shell.appendChild(row);
    shell.appendChild(menu);
    return shell;
  }

  function requestSendToFileCabinet(record) {
    const name = displayName(record);
    if (!window.ToolboxSync || typeof window.ToolboxSync.sendToFileCabinet !== 'function') {
      cabinetNotice = 'Send to File Cabinet is unavailable.';
      window.location.hash = '#/';
      render();
      return;
    }
    confirmAction({
      title: 'Send to File Cabinet?',
      message: name + ' will be placed in the File Cabinet and removed from this device.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Send to File Cabinet',
    }).then(function (confirmed) {
      if (!confirmed) return;
      return window.ToolboxSync.sendToFileCabinet(record.id).then(function () {
        cabinetNotice = name + ' was sent to the File Cabinet.';
        window.location.hash = '#/';
        render();
      }).catch(function (err) {
        console.warn('Send to File Cabinet failed:', err);
        cabinetNotice = (err && err.message) || 'Send to File Cabinet failed.';
        window.location.hash = '#/';
        render();
      });
    });
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
      message: name + ' will sync to the File Cabinet, release the Check Out, and be removed from this device.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Check In',
    }).then(function (confirmed) {
      if (!confirmed) return;
      return window.ToolboxSync.checkInCustomerFile(record.id).then(function () {
        cabinetNotice = name + ' was checked in.';
        window.location.hash = '#/';
        render();
      }).catch(function (err) {
        console.warn('Check In failed:', err);
        cabinetNotice = (err && err.message) || 'Check In failed.';
        window.location.hash = '#/';
        render();
      });
    });
  }

  // ---- Trash ------------------------------------------------------------

  function renderTrash(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="trash-back" class="btn btn--ghost">‹ Customer Files</button>' +
      '  <div class="file-identity"><span class="file-identity__name">Trash</span></div>' +
      '</div>' +
      '<section class="trash-view">' +
      '  <header class="trash-head">' +
      '    <div><p class="eyebrow">Recoverable files</p><h1>Trash</h1><p>Customer Files containing investigation data remain recoverable for 120 days.</p></div>' +
      '    <button type="button" id="trash-empty" class="btn btn--danger">Empty Trash</button>' +
      '  </header>' +
      '  <p class="cabinet-notice" id="trash-notice" hidden></p>' +
      '  <div class="trash-list" id="trash-list"><p class="cabinet-empty">Loading Trash…</p></div>' +
      '</section>';

    const list = app.querySelector('#trash-list');
    const emptyBtn = app.querySelector('#trash-empty');
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
      window.ToolboxDB.purgeExpiredCustomerFiles().catch(function (err) {
        console.warn('Could not purge expired Customer Files:', err);
      }).then(function () {
        return window.ToolboxDB.getAllCustomerFiles();
      }).then(function (records) {
        const trashed = records.filter(function (record) { return !!record.deletedAt; });
        trashed.sort(function (a, b) {
          return (b.deletedAt || '').localeCompare(a.deletedAt || '');
        });
        emptyBtn.disabled = trashed.length === 0;
        list.innerHTML = '';
        if (!trashed.length) {
          const p = document.createElement('p');
          p.className = 'cabinet-empty trash-empty-state';
          p.textContent = 'Trash is empty.';
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

        emptyBtn.onclick = function () {
          confirmAction({
            title: 'Permanently empty Trash?',
            message: 'This permanently deletes ' + trashed.length + ' Customer File' + (trashed.length === 1 ? '' : 's') + ' and associated plans and photographs. This cannot be undone.',
            cancelLabel: 'No, keep files',
            confirmLabel: 'Yes, empty Trash',
          }).then(function (confirmed) {
            if (!confirmed) return;
            emptyBtn.disabled = true;
            window.ToolboxDB.permanentlyDeleteCustomerFiles(trashed).then(function () {
              return removeCloudCopies(trashed);
            }).then(function () {
              loadTrash('Trash was permanently emptied.');
            }).catch(function (err) {
              console.error('Could not empty Trash:', err);
              loadTrash('Could not empty Trash. Try again.');
            });
          });
        };
      }).catch(function (err) {
        console.error('Could not load Trash:', err);
        list.innerHTML = '<p class="cabinet-empty">Unable to load Trash right now.</p>';
      });
    }

    loadTrash('');
  }

  function trashRowNode(record, onRestore) {
    const row = document.createElement('article');
    row.className = 'trash-row';

    const main = document.createElement('div');
    main.className = 'trash-row__main';
    const name = document.createElement('strong');
    name.textContent = displayName(record);
    const address = document.createElement('span');
    address.textContent = displayAddress(record);
    const retention = document.createElement('small');
    const days = daysUntilPurge(record);
    retention.textContent = 'Permanently deletes in ' + days + ' day' + (days === 1 ? '' : 's');
    main.appendChild(name);
    main.appendChild(address);
    main.appendChild(retention);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn btn--secondary';
    restore.textContent = 'Restore';
    restore.addEventListener('click', onRestore);

    row.appendChild(main);
    row.appendChild(restore);
    return row;
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

  function renderFileHome(app, id) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--file view-bar--cf-home">' +
      '  <button type="button" id="home-back" class="btn btn--ghost">‹ Cabinet</button>' +
      '  <span class="file-status" id="home-status"></span>' +
      '  <button type="button" id="home-edit-top" class="btn btn--quiet">Edit customer</button>' +
      '</div>' +
      '<div class="cf-home" id="cf-home">' +
      '  <section class="cf-home__hero">' +
      '    <div class="cf-home__summary">' +
      '      <h1 class="cf-home__name" id="home-card-name"></h1>' +
      '      <p class="cf-home__address" id="home-card-address"></p>' +
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
      '      <p class="eyebrow">Workspaces</p>' +
      '      <h2>Choose where to work</h2>' +
      '    </div>' +
      '    <span class="cf-home__meta" id="home-card-meta"></span>' +
      '  </div>' +
      '  <div class="cf-home__apps" id="home-apps">' +
      appTileHtml('distress') +
      appTileHtml('floor') +
      appTileHtml('diagnostics') +
      appTileHtml('report') +
      '  </div>' +
      '  <p class="cf-home__hint">Each workspace opens with this Customer File. They are independent—not required steps.</p>' +
      '  <div class="cf-home__file-actions">' +
      '    <button type="button" id="home-import" class="btn btn--secondary">Import standalone export</button>' +
      '  </div>' +
      '</div>';

    const backBtn = app.querySelector('#home-back');
    const importBtn = app.querySelector('#home-import');
    const editTopBtn = app.querySelector('#home-edit-top');
    const planCta = app.querySelector('#home-plan-cta');
    const planCallout = app.querySelector('#home-plan-callout');
    const statusEl = app.querySelector('#home-status');
    const cardName = app.querySelector('#home-card-name');
    const cardAddress = app.querySelector('#home-card-address');
    const cardMeta = app.querySelector('#home-card-meta');
    const contactBadge = app.querySelector('#home-contact-badge');
    const planBadge = app.querySelector('#home-plan-badge');
    let currentRecord = null;

    backBtn.addEventListener('click', function () {
      window.location.hash = '#/';
    });
    function editFile(section) {
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/edit' + (section ? '/' + section : '');
    }
    importBtn.addEventListener('click', function () {
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/import';
    });
    editTopBtn.addEventListener('click', function () { editFile('customer'); });
    planCta.addEventListener('click', function () { editFile('plans'); });
    app.querySelectorAll('.cf-app-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!currentRecord) return;
        if (!planReadiness(currentRecord).hasPlan) {
          editFile('plans');
          return;
        }
        const appKey = btn.getAttribute('data-app');
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/' + appKey;
      });
    });

    statusEl.textContent = 'Loading…';
    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      if (existing && existing.deletedAt) {
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
      cardAddress.textContent = displayAddress(record);
      contactBadge.textContent = hasName && hasAddress ? 'Customer details ready' : 'Customer details started';
      contactBadge.classList.toggle('is-ready', hasName && hasAddress);
      planBadge.textContent = readiness.hasPlan ? planSummaryText(record) : 'Floor plan required';
      planBadge.classList.toggle('is-ready', readiness.hasPlan);
      planCallout.hidden = readiness.hasPlan;
      cardMeta.textContent = record.updatedAt ? 'Updated ' + formatUpdated(record.updatedAt) : '';
      app.querySelectorAll('.cf-app-btn').forEach(function (btn) {
        const state = btn.querySelector('.cf-app-btn__state');
        btn.classList.toggle('is-locked', !readiness.hasPlan);
        // Ready tiles stay quiet; locked tiles still say why they need a plan.
        state.textContent = readiness.hasPlan ? '' : 'Add a floor plan first';
      });
      statusEl.textContent = '';
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
      window.location.hash = '#/file/' + encodeURIComponent(id);
    }

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
      document.body.classList.remove('floor-survey-open');
      app.classList.remove('canvas--floor-survey');
      window.location.hash = '#/file/' + encodeURIComponent(id);
    }

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
      onBack: leave,
    });
  }

  function renderAppStub(app, id, appKey) {
    registerActiveFlush(null);
    document.body.classList.remove('floor-survey-open');
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

    function scheduleSave() {
      dirty = true;
      setStatus('Unsaved changes…');
      refreshEditorProgress();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        flushSave().catch(function () {});
      }, AUTOSAVE_DELAY_MS);
    }

    function flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!dirty || !record) return Promise.resolve();
      if (plansApi) plansApi.commitPending();
      collectFormIntoRecord();
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
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        dirty = false;
        isNewFile = false;
        setStatus('Saved ' + formatUpdated(record.updatedAt));
        updateIdentityBar();
        backBtn.textContent = '‹ Customer File';
      }).catch(function (err) {
        console.error('Failed to save Customer File:', err);
        setStatus('Save failed — will retry');
        throw err;
      });
    }

    function leaveEdit() {
      dirty = true;
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
        dirty = true;
        flushSave().then(function () {
          window.location.hash = '#/';
        }).catch(function () {});
        return;
      }
      leaveEdit();
    });

    saveBtn.addEventListener('click', function () {
      dirty = true;
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
        dirty = !!v;
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
      if (existing && existing.deletedAt) {
        window.location.replace('#/trash');
        return null;
      }
      isNewFile = !existing;
      record = existing || blankCustomerFile(id);
      if (window.ToolboxPlanSetup && window.ToolboxPlanSetup.ensurePlanSetup(record) && existing) {
        dirty = true;
      } else if (!existing && window.ToolboxPlanSetup) {
        window.ToolboxPlanSetup.ensurePlanSetup(record);
      }
      if (!record) return null;
      populateForm(record);
      updateIdentityBar();
      backBtn.textContent = isNewFile ? '‹ Cabinet' : '‹ Customer File';
      return plansApi.syncFromRecord().then(function () {
        refreshEditorProgress();
        if (!existing) dirty = true;
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
    refreshBtn.addEventListener('click', function () {
      flushActiveFile();
      window.location.reload();
    });
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
      Promise.resolve(flushActiveFile())
        .then(function () {
          return window.ToolboxSync.syncNow();
        })
        .then(function (result) {
          if (result && result.ok === false) {
            setSyncLabel('Sync incomplete');
            console.warn('Sync Now incomplete:', result);
            return;
          }
          // Transition wording: success means this device's local working files
          // synced — not that the whole File Cabinet is on this device.
          setSyncLabel('Local files synced');
          try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {
            window.location.hash = window.location.hash;
          }
        })
        .catch(function (err) {
          const code = err && err.code;
          if (code === 'offline' || code === 'network') setSyncLabel('Offline');
          else if (code === 'auth') setSyncLabel('Sign in to sync');
          else if (code === 'config') setSyncLabel('Sync not configured');
          else if (code === 'incomplete') setSyncLabel('Sync incomplete');
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
  window.addEventListener('DOMContentLoaded', render);

  // Shared helpers for other product-area modules (Customer File plans).
  window.ToolboxApp = {
    registerActiveFlush: registerActiveFlush,
    blankCustomerFile: blankCustomerFile,
    hasInvestigationData: hasInvestigationData,
    isEmptyCustomerFileStub: isEmptyCustomerFileStub,
    customerIdentity: {
      displayName: displayName,
      displayAddress: displayAddress,
      formatUpdated: formatUpdated,
    },
  };
})();
