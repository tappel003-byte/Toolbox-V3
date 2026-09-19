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

  // ---- Routing ----------------------------------------------------------
  //
  // #/file/:id          → Customer File home (hub)
  // #/file/:id/edit     → edit contact + plans
  // #/file/:id/plan     → redirect to edit (legacy)
  // #/file/:id/<app>    → not-yet-connected stub (Distress, Floor, etc.)

  function parseRoute() {
    const hash = window.location.hash || '#/';
    const match = hash.match(/^#\/file\/([^/]+)(?:\/(edit|plan|distress|floor|diagnostics|report))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const sub = match[2] || null;
      if (sub === 'plan') return { view: 'edit', id: id, legacyPlan: true };
      if (sub === 'edit') return { view: 'edit', id: id };
      if (sub === 'distress' || sub === 'floor' || sub === 'diagnostics' || sub === 'report') {
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
    if (route.legacyPlan) {
      window.location.replace('#/file/' + encodeURIComponent(route.id) + '/edit');
      return;
    }
    if (route.view === 'edit') {
      renderFileEdit(app, route.id);
    } else if (route.view === 'home') {
      renderFileHome(app, route.id);
    } else if (route.view === 'app-stub') {
      renderAppStub(app, route.id, route.app);
    } else {
      renderCabinet(app);
    }
  }

  // ---- Cabinet view -------------------------------------------------

  function renderCabinet(app) {
    registerActiveFlush(null);
    app.innerHTML =
      '<div class="view-bar view-bar--cabinet">' +
      '  <input type="search" id="cabinet-search" class="cabinet-search" placeholder="Search by name or address" autocomplete="off">' +
      '  <button type="button" id="cabinet-new" class="btn btn--accent">+ New Customer FILE</button>' +
      '</div>' +
      '<div class="cabinet-list" id="cabinet-list"></div>';

    const listEl = app.querySelector('#cabinet-list');
    const searchInput = app.querySelector('#cabinet-search');
    const newBtn = app.querySelector('#cabinet-new');

    newBtn.addEventListener('click', function () {
      window.location.hash = '#/file/' + generateId() + '/edit';
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

  // ---- Customer File home (hub) -----------------------------------------

  const APP_LABELS = {
    distress: 'Distress Survey',
    floor: 'Floor Survey',
    diagnostics: 'Diagnostics',
    report: 'Report Builder',
  };

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
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="home-back" class="btn btn--ghost">‹ Cabinet</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="home-identity-name"></span>' +
      '    <span class="file-identity__address" id="home-identity-address"></span>' +
      '  </div>' +
      '  <span class="file-status" id="home-status"></span>' +
      '</div>' +
      '<div class="cf-home" id="cf-home">' +
      '  <div class="cf-home__card">' +
      '    <div class="cf-home__name" id="home-card-name"></div>' +
      '    <div class="cf-home__address" id="home-card-address"></div>' +
      '    <div class="cf-home__meta" id="home-card-meta"></div>' +
      '  </div>' +
      '  <div class="cf-home__apps" id="home-apps">' +
      '    <button type="button" class="cf-app-btn" data-app="distress">Distress Survey<span class="cf-app-btn__sub">pin capture</span></button>' +
      '    <button type="button" class="cf-app-btn" data-app="floor">Floor Survey<span class="cf-app-btn__sub">boundary + points</span></button>' +
      '    <button type="button" class="cf-app-btn" data-app="diagnostics">Diagnostics<span class="cf-app-btn__sub">3D view</span></button>' +
      '    <button type="button" class="cf-app-btn" data-app="report">Report Builder<span class="cf-app-btn__sub">pin schedule</span></button>' +
      '  </div>' +
      '  <p class="cf-home__hint">Applications open with this Customer File. They are independent — not a required sequence.</p>' +
      '  <button type="button" id="home-edit" class="btn btn--ghost cf-home__edit">Edit Customer File</button>' +
      '</div>';

    const backBtn = app.querySelector('#home-back');
    const editBtn = app.querySelector('#home-edit');
    const statusEl = app.querySelector('#home-status');
    const identityName = app.querySelector('#home-identity-name');
    const identityAddress = app.querySelector('#home-identity-address');
    const cardName = app.querySelector('#home-card-name');
    const cardAddress = app.querySelector('#home-card-address');
    const cardMeta = app.querySelector('#home-card-meta');

    backBtn.addEventListener('click', function () {
      window.location.hash = '#/';
    });
    editBtn.addEventListener('click', function () {
      window.location.hash = '#/file/' + encodeURIComponent(id) + '/edit';
    });
    app.querySelectorAll('.cf-app-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const appKey = btn.getAttribute('data-app');
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/' + appKey;
      });
    });

    statusEl.textContent = 'Loading…';
    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
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
      identityName.textContent = displayName(record);
      identityAddress.textContent = displayAddress(record);
      cardName.textContent = displayName(record);
      cardAddress.textContent = displayAddress(record);
      cardMeta.textContent = planSummaryText(record) +
        (record.updatedAt ? ' · updated ' + formatUpdated(record.updatedAt) : '');
      statusEl.textContent = '';
    }).catch(function (err) {
      console.error('Failed to load Customer File home:', err);
      statusEl.textContent = 'Unable to load';
    });
  }

  function renderAppStub(app, id, appKey) {
    registerActiveFlush(null);
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
      '  <p class="cf-stub__msg">Not connected in Toolbox V3 yet. The Customer File is ready; this application will use it in a later slice. Proven field apps are not redesigned here.</p>' +
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


  function renderFileEdit(app, id) {
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="file-back" class="btn btn--ghost">‹ Customer File</button>' +
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
      '  <div id="cf-plans-panel" class="cf-plans-panel"></div>' +
      '  <div class="file-actions file-actions--edit">' +
      '    <button type="button" id="file-save" class="btn btn--ghost">Save</button>' +
      '    <button type="button" id="file-done" class="btn btn--accent">Done</button>' +
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

    let record = null;
    let saveTimer = null;
    let dirty = false;
    let isNewFile = false;
    let plansApi = null;

    const ADDRESS_MIN_CHARS = 3;
    const ADDRESS_DEBOUNCE_MS = 150;
    let lastGeocodedAddressText = null;
    let currentSuggestions = [];
    let activeSuggestionIndex = -1;
    let addressDebounceTimer = null;
    let addressFeedbackTimer = null;

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

    function scheduleSave() {
      dirty = true;
      setStatus('Unsaved changes…');
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
      record.updatedAt = new Date().toISOString();
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
      flushSave().then(function () {
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
      scheduleSave();
    });
    propertyTextarea.addEventListener('input', syncMailingIfSame);
    app.addEventListener('input', function (e) {
      if (e.target && e.target.id && e.target.id.indexOf('field-') === 0) scheduleSave();
    });

    registerActiveFlush(flushSave);

    plansApi = window.ToolboxPlanSetup.mountPlansPanel(plansPanel, {
      getRecord: function () { return record; },
      setDirty: function (v) { dirty = !!v; },
      scheduleSave: scheduleSave,
      flushSave: flushSave,
      setStatus: setStatus,
      setFeedback: function () {},
    });

    setStatus('Loading…');
    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      isNewFile = !existing;
      record = existing || blankCustomerFile(id);
      if (window.ToolboxPlanSetup && window.ToolboxPlanSetup.ensurePlanSetup(record) && existing) {
        dirty = true;
      } else if (!existing && window.ToolboxPlanSetup) {
        window.ToolboxPlanSetup.ensurePlanSetup(record);
      }
      populateForm(record);
      updateIdentityBar();
      backBtn.textContent = isNewFile ? '‹ Cabinet' : '‹ Customer File';
      return plansApi.syncFromRecord().then(function () {
        if (dirty) return flushSave();
        setStatus(existing ? 'Saved ' + formatUpdated(record.updatedAt) : 'New — not yet saved');
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
    if (!activeFileFlush) return;
    Promise.resolve(activeFileFlush()).catch(function () {
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

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);

  // Shared helpers for other product-area modules (Plan Setup, Distress).
  window.ToolboxApp = {
    registerActiveFlush: registerActiveFlush,
    blankCustomerFile: blankCustomerFile,
    customerIdentity: {
      displayName: displayName,
      displayAddress: displayAddress,
      formatUpdated: formatUpdated,
    },
  };
})();
