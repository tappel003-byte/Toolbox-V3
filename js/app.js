// Toolbox — Milestone 1: Customer File.
//
// Cabinet (list) <-> Customer File (create/open/edit) using hash routing so
// reload/offline navigation stays inside the single cached document. All
// data lives in IndexedDB via ToolboxDB (js/db.js) — local, offline, and
// durable across reload/close-reopen, with no server or sync involved.

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;

  // Set by the active Customer File view so a single, persistent listener
  // can flush pending edits when the tab is hidden or closed — avoids
  // adding/removing per-view listeners on every navigation.
  let activeFileFlush = null;

  const FIELD_DEFS = {
    primary: [
      { id: 'firstName', label: 'First name', type: 'text' },
      { id: 'lastName', label: 'Last name', type: 'text' },
      { id: 'propertyAddress', label: 'Property / site address', type: 'textarea', placeholder: 'Street address, city, state, ZIP', rows: 2, full: true },
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
    const now = new Date().toISOString();
    return {
      id: id,
      createdAt: now,
      updatedAt: now,
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

  // ---- Routing ----------------------------------------------------------

  function parseRoute() {
    const hash = window.location.hash || '#/';
    const match = hash.match(/^#\/file\/(.+)$/);
    if (match) return { view: 'file', id: decodeURIComponent(match[1]) };
    return { view: 'cabinet' };
  }

  function render() {
    const app = document.getElementById('app-view');
    if (!app) return;
    const route = parseRoute();
    if (route.view === 'file') {
      renderFile(app, route.id);
    } else {
      renderCabinet(app);
    }
  }

  // ---- Cabinet view -------------------------------------------------

  function renderCabinet(app) {
    activeFileFlush = null;
    app.innerHTML =
      '<div class="view-bar view-bar--cabinet">' +
      '  <input type="search" id="cabinet-search" class="cabinet-search" placeholder="Search by name or address" autocomplete="off">' +
      '  <button type="button" id="cabinet-new" class="btn btn--accent">+ New Customer File</button>' +
      '</div>' +
      '<div class="cabinet-list" id="cabinet-list"></div>';

    const listEl = app.querySelector('#cabinet-list');
    const searchInput = app.querySelector('#cabinet-search');
    const newBtn = app.querySelector('#cabinet-new');

    newBtn.addEventListener('click', function () {
      window.location.hash = '#/file/' + generateId();
    });

    listEl.innerHTML = '<p class="cabinet-empty">Loading Customer Files…</p>';

    window.ToolboxDB.getAllCustomerFiles().then(function (records) {
      records.sort(function (a, b) {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });

      function renderList(filterText) {
        const term = (filterText || '').trim().toLowerCase();
        const filtered = term
          ? records.filter(function (r) {
              return (displayName(r) + ' ' + displayAddress(r)).toLowerCase().indexOf(term) !== -1;
            })
          : records;

        listEl.innerHTML = '';

        if (records.length === 0) {
          const p = document.createElement('p');
          p.className = 'cabinet-empty';
          p.textContent = 'No Customer Files yet. Create your first Customer File to get started.';
          listEl.appendChild(p);
          return;
        }

        if (filtered.length === 0) {
          const p = document.createElement('p');
          p.className = 'cabinet-empty';
          p.textContent = 'No Customer Files match "' + filterText + '".';
          listEl.appendChild(p);
          return;
        }

        filtered.forEach(function (record) {
          listEl.appendChild(cabinetRowNode(record));
        });
      }

      searchInput.addEventListener('input', function () {
        renderList(searchInput.value);
      });

      renderList('');
    }).catch(function (err) {
      console.error('Failed to load Customer Files:', err);
      listEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'cabinet-empty';
      p.textContent = 'Unable to load Customer Files right now.';
      listEl.appendChild(p);
    });
  }

  function cabinetRowNode(record) {
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
    meta.textContent = formatUpdated(record.updatedAt);

    row.appendChild(main);
    row.appendChild(meta);
    return row;
  }

  // ---- Customer File (open/edit) view --------------------------------

  function fieldRowHtml(field) {
    const widthClass = field.full ? ' field--full' : '';
    const inputHtml = field.type === 'textarea'
      ? '<textarea id="field-' + field.id + '" rows="' + (field.rows || 3) + '" placeholder="' + (field.placeholder || '') + '"></textarea>'
      : '<input type="' + field.type + '" id="field-' + field.id + '" placeholder="' + (field.placeholder || field.label) + '" autocomplete="off">';

    return '<div class="field' + widthClass + '">' +
      '<label for="field-' + field.id + '">' + field.label + '</label>' +
      inputHtml +
      '</div>';
  }

  function renderFile(app, id) {
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="file-back" class="btn btn--ghost">‹ Cabinet</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="file-identity-name"></span>' +
      '    <span class="file-identity__address" id="file-identity-address"></span>' +
      '  </div>' +
      '  <span class="file-status" id="file-status"></span>' +
      '</div>' +
      '<div class="file-form-wrap">' +
      '  <div class="customer-form" id="customer-form">' +
      FIELD_DEFS.primary.map(fieldRowHtml).join('') +
      '  </div>' +
      '  <details class="additional-info" id="additional-info">' +
      '    <summary>Additional Information</summary>' +
      '    <div class="customer-form">' +
      FIELD_DEFS.additional.map(fieldRowHtml).join('') +
      '      <div class="field field--full field--checkbox">' +
      '        <label class="checkbox-label"><input type="checkbox" id="field-mailingSameAsProperty"> Mailing / billing address same as property address</label>' +
      '      </div>' +
      '      <div class="field field--full" id="mailing-address-field">' +
      '        <label for="field-mailingAddress">Mailing / billing address</label>' +
      '        <textarea id="field-mailingAddress" rows="2" placeholder="Street address, city, state, ZIP"></textarea>' +
      '      </div>' +
      '    </div>' +
      '  </details>' +
      '  <div class="file-actions">' +
      '    <button type="button" id="file-save" class="btn btn--accent">Save</button>' +
      '  </div>' +
      '</div>';

    const backBtn = app.querySelector('#file-back');
    const saveBtn = app.querySelector('#file-save');
    const statusEl = app.querySelector('#file-status');
    const identityName = app.querySelector('#file-identity-name');
    const identityAddress = app.querySelector('#file-identity-address');
    const sameAddressCheckbox = app.querySelector('#field-mailingSameAsProperty');
    const mailingTextarea = app.querySelector('#field-mailingAddress');
    const propertyTextarea = app.querySelector('#field-propertyAddress');

    let record = null;
    let saveTimer = null;
    let dirty = false;

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
    }

    function updateMailingVisibility() {
      const same = sameAddressCheckbox.checked;
      mailingTextarea.disabled = same;
      mailingTextarea.classList.toggle('is-mirrored', same);
      if (same) {
        mailingTextarea.value = propertyTextarea.value;
      }
    }

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

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function scheduleSave() {
      dirty = true;
      setStatus('Unsaved changes…');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, AUTOSAVE_DELAY_MS);
    }

    function flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!dirty || !record) return Promise.resolve();
      collectFormIntoRecord();
      record.updatedAt = new Date().toISOString();
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        dirty = false;
        setStatus('Saved ' + formatUpdated(record.updatedAt));
        updateIdentityBar();
      }).catch(function (err) {
        console.error('Failed to save Customer File:', err);
        setStatus('Save failed — will retry');
      });
    }

    backBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/';
      });
    });

    saveBtn.addEventListener('click', function () {
      dirty = true;
      flushSave();
    });

    sameAddressCheckbox.addEventListener('change', function () {
      updateMailingVisibility();
      scheduleSave();
    });

    propertyTextarea.addEventListener('input', function () {
      if (sameAddressCheckbox.checked) mailingTextarea.value = propertyTextarea.value;
    });

    app.addEventListener('input', function (e) {
      if (e.target && e.target.id && e.target.id.indexOf('field-') === 0) {
        scheduleSave();
      }
    });

    activeFileFlush = flushSave;

    setStatus('Loading…');

    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      record = existing || blankCustomerFile(id);
      populateForm(record);
      updateIdentityBar();
      setStatus(existing ? 'Saved ' + formatUpdated(record.updatedAt) : 'New — not yet saved');
    }).catch(function (err) {
      console.error('Failed to load Customer File:', err);
      record = blankCustomerFile(id);
      populateForm(record);
      updateIdentityBar();
      setStatus('New — not yet saved');
    });
  }

  function flushActiveFile() {
    if (activeFileFlush) activeFileFlush();
  }
  document.addEventListener('visibilitychange', flushActiveFile);
  window.addEventListener('pagehide', flushActiveFile);

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);
})();
