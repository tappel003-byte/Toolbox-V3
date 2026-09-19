// Toolbox — Milestone 1: Customer File.
//
// Cabinet (list) <-> Customer File (create/open/edit) using hash routing so
// reload/offline navigation stays inside the single cached document. All
// data lives in IndexedDB via ToolboxDB (js/db.js) — local, offline, and
// durable across reload/close-reopen, with no server or sync involved.

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;

  // Registered by whichever view is currently mounted (Customer File,
  // Plan Setup, or Distress) so a single, persistent listener can flush
  // pending edits when the tab is hidden or closed — avoids adding/removing
  // per-view listeners on every navigation. Exposed via window.ToolboxApp
  // so other product-area modules can register/clear it too.
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
  // Customer File → Plan Setup (#/file/<id>/plan) establishes shared
  // canvases/levels. Customer File → Distress (#/file/<id>/distress)
  // consumes those same canvases — it does not own setup.

  function parseRoute() {
    const hash = window.location.hash || '#/';
    const match = hash.match(/^#\/file\/([^/]+)(?:\/(plan|distress))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (match[2] === 'plan') return { view: 'plan', id: id };
      if (match[2] === 'distress') return { view: 'distress', id: id };
      return { view: 'file', id: id };
    }
    return { view: 'cabinet' };
  }

  function render() {
    const app = document.getElementById('app-view');
    if (!app) return;
    const route = parseRoute();
    if (route.view === 'plan') {
      window.ToolboxPlanSetup.renderPlanSetup(app, route.id);
    } else if (route.view === 'distress') {
      window.ToolboxDistress.renderDistress(app, route.id);
    } else if (route.view === 'file') {
      renderFile(app, route.id);
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
      '  <div class="file-workspaces">' +
      '    <button type="button" id="file-plan" class="btn btn--accent">Plan Setup ›</button>' +
      '    <button type="button" id="file-distress" class="btn btn--ghost">Distress ›</button>' +
      '  </div>' +
      '</div>';

    const backBtn = app.querySelector('#file-back');
    const saveBtn = app.querySelector('#file-save');
    const planBtn = app.querySelector('#file-plan');
    const distressBtn = app.querySelector('#file-distress');
    const statusEl = app.querySelector('#file-status');
    const identityName = app.querySelector('#file-identity-name');
    const identityAddress = app.querySelector('#file-identity-address');
    const sameAddressCheckbox = app.querySelector('#field-mailingSameAsProperty');
    const mailingTextarea = app.querySelector('#field-mailingAddress');
    const propertyTextarea = app.querySelector('#field-propertyAddress');
    const addressSuggestionsEl = app.querySelector('#address-suggestions');
    const addressFeedbackEl = app.querySelector('#address-feedback');
    const useLocationBtn = app.querySelector('#use-current-location');

    let record = null;
    let saveTimer = null;
    let dirty = false;

    // Address-derived coordinates are convenience metadata layered on top
    // of the plain text field, not something the generic form-field loop
    // below knows about. lastGeocodedAddressText is the address text the
    // currently-stored lat/lon actually correspond to; whenever the
    // visible text diverges from it, the coordinates are stale and get
    // cleared (see invalidateStaleCoordinatesIfNeeded).
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
      if (same) {
        mailingTextarea.value = propertyTextarea.value;
      }
    }

    // Property address text can now change programmatically (suggestion
    // pick, GPS fill) as well as by typing. Any of those paths that touch
    // propertyTextarea.value must keep a checked "same as property" mailing
    // address in sync, since programmatic value changes don't fire 'input'.
    function syncMailingIfSame() {
      if (sameAddressCheckbox.checked) mailingTextarea.value = propertyTextarea.value;
    }

    // ---- Address autocomplete + Use Current Location (Geoapify) --------
    // Convenience only: every path here must leave manual typing and saving
    // fully usable, with or without a configured key, online or offline.

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
        li.addEventListener('click', function () {
          selectSuggestion(i);
        });
        addressSuggestionsEl.appendChild(li);
      });

      addressSuggestionsEl.hidden = false;
      propertyTextarea.setAttribute('aria-expanded', 'true');
    }

    // A suggestion is picked via click, which blurs the textarea first.
    // Intercepting mousedown (before blur fires) keeps focus in the field
    // so the click still lands on the right element.
    addressSuggestionsEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });

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
          if (results === null) return; // superseded by a newer request
          if (propertyTextarea.value.trim() !== text) return; // stale response
          if (results.length === 0) {
            // An empty result can mean "genuinely no matches" (say nothing,
            // per spec) or "the request itself failed" -- only the latter
            // has something worth telling the investigator.
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

    propertyTextarea.addEventListener('blur', function () {
      closeSuggestions();
    });

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

          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          record.propertyAddressLat = lat;
          record.propertyAddressLon = lon;
          lastGeocodedAddressText = propertyTextarea.value;
          scheduleSave();

          if (!window.ToolboxGeo || !window.ToolboxGeo.isAvailable()) {
            setAddressFeedback('Location captured. Enter the address manually.');
            return;
          }

          setAddressFeedback('Location captured — looking up the address…');
          window.ToolboxGeo.reverseGeocode(lat, lon).then(function (result) {
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

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function scheduleSave() {
      dirty = true;
      setStatus('Unsaved changes…');
      if (saveTimer) clearTimeout(saveTimer);
      // Autosave must not leave an unhandled rejection when IndexedDB fails;
      // status already shows "Save failed — will retry". Callers that navigate
      // on success (Distress, Cabinet) use their own .then/.catch.
      saveTimer = setTimeout(function () {
        flushSave().catch(function () { /* status already set */ });
      }, AUTOSAVE_DELAY_MS);
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
        // Keep dirty true so retry still has the edit. Re-throw so navigation
        // callers (Distress ›, ‹ Cabinet) do not proceed after a failed save.
        throw err;
      });
    }

    backBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/';
      }).catch(function () {
        // Stay on Customer File so the investigator can retry save.
      });
    });

    saveBtn.addEventListener('click', function () {
      dirty = true;
      flushSave().catch(function () { /* status already set */ });
    });

    sameAddressCheckbox.addEventListener('change', function () {
      updateMailingVisibility();
      scheduleSave();
    });

    propertyTextarea.addEventListener('input', syncMailingIfSame);

    app.addEventListener('input', function (e) {
      if (e.target && e.target.id && e.target.id.indexOf('field-') === 0) {
        scheduleSave();
      }
    });

    registerActiveFlush(flushSave);

    planBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/plan';
      }).catch(function () {
        // Stay on Customer File so the investigator can retry save.
      });
    });

    distressBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/distress';
      }).catch(function () {
        // Stay on Customer File so the investigator can retry save.
      });
    });

    setStatus('Loading…');

    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      record = existing || blankCustomerFile(id);
      // Migrate legacy Distress-owned Plan Setup into shared planSetup when
      // opening an existing development Customer File, without inventing
      // canvases for brand-new empty files until Plan Setup is entered.
      if (existing && window.ToolboxPlanSetup &&
          ((record.distress && Array.isArray(record.distress.surfaces) && record.distress.surfaces.length) ||
           (record.planSetup && Array.isArray(record.planSetup.canvases)))) {
        if (window.ToolboxPlanSetup.ensurePlanSetup(record)) {
          dirty = true;
          return flushSave().then(function () {
            populateForm(record);
            updateIdentityBar();
            setStatus('Saved ' + formatUpdated(record.updatedAt));
          });
        }
      }
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
