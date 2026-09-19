// Toolbox — Distress workspace / Plan Setup.
//
// Customer File → Distress. Presents Plan Setup for Distress surfaces:
// default Floor Plan, add/rename/switch surfaces, real plan per surface,
// rooms (manual FRP overlay), front-door facing, FD marker, building type
// (survey-level, matching FRP project.buildingType).
//
// Capture is not implemented here. Survey-level pins[] / nextNum / startNum
// remain reserved for the locked FRP numbering model.

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;
  const DEFAULT_SURFACE_NAME = 'Floor Plan';

  function newId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return (prefix ? prefix + '-' : '') + window.crypto.randomUUID();
    }
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function blankSurface(name) {
    const now = new Date().toISOString();
    return {
      id: newId('surf'),
      name: name || DEFAULT_SURFACE_NAME,
      createdAt: now,
      updatedAt: now,
      plan: null, // { id, width, height }
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null, // { x, y } normalized 0..1
    };
  }

  function blankDistressSurvey() {
    const surface = blankSurface(DEFAULT_SURFACE_NAME);
    const now = new Date().toISOString();
    return {
      id: newId('distress'),
      createdAt: now,
      updatedAt: now,
      activeSurfaceId: surface.id,
      surfaces: [surface],
      // Survey-level, matching FRP project.buildingType
      buildingType: 'residential',
      // Reserved for locked capture numbering — do not use for setup
      startNum: 1,
      nextNum: 1,
      pins: [],
    };
  }

  function normalizeSurface(s) {
    let changed = false;
    if (!Array.isArray(s.rooms)) { s.rooms = []; changed = true; }
    if (typeof s.frontDoorFacing !== 'string') { s.frontDoorFacing = 'S'; changed = true; }
    if (s.frontDoor != null && (typeof s.frontDoor.x !== 'number' || typeof s.frontDoor.y !== 'number')) {
      s.frontDoor = null;
      changed = true;
    }
    return changed;
  }

  function ensureDistressSurvey(record) {
    let changed = false;
    if (!record.distress || typeof record.distress !== 'object') {
      record.distress = blankDistressSurvey();
      return true;
    }
    const d = record.distress;
    if (!d.id) { d.id = newId('distress'); changed = true; }
    if (!Array.isArray(d.surfaces) || d.surfaces.length === 0) {
      const surface = blankSurface(DEFAULT_SURFACE_NAME);
      d.surfaces = [surface];
      d.activeSurfaceId = surface.id;
      changed = true;
    }
    d.surfaces.forEach(function (s) {
      if (normalizeSurface(s)) changed = true;
    });
    if (!d.surfaces.some(function (s) { return s.id === d.activeSurfaceId; })) {
      d.activeSurfaceId = d.surfaces[0].id;
      changed = true;
    }
    if (typeof d.buildingType !== 'string' || !d.buildingType) {
      d.buildingType = 'residential';
      changed = true;
    }
    if (typeof d.startNum !== 'number') { d.startNum = 1; changed = true; }
    if (typeof d.nextNum !== 'number') { d.nextNum = 1; changed = true; }
    if (!Array.isArray(d.pins)) { d.pins = []; changed = true; }
    return changed;
  }

  function activeSurface(record) {
    if (!record || !record.distress || !Array.isArray(record.distress.surfaces)) return null;
    return record.distress.surfaces.find(function (s) {
      return s.id === record.distress.activeSurfaceId;
    }) || record.distress.surfaces[0] || null;
  }

  function hasUsablePlan(surface) {
    return !!(surface && surface.plan && surface.plan.id && surface.plan.width && surface.plan.height);
  }

  function formatUpdated(iso) {
    if (window.ToolboxApp && window.ToolboxApp.customerIdentity) {
      return window.ToolboxApp.customerIdentity.formatUpdated(iso);
    }
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function displayName(record) {
    if (window.ToolboxApp && window.ToolboxApp.customerIdentity) {
      return window.ToolboxApp.customerIdentity.displayName(record);
    }
    const name = ((record.firstName || '') + ' ' + (record.lastName || '')).trim();
    return name || 'New Customer File';
  }

  function displayAddress(record) {
    if (window.ToolboxApp && window.ToolboxApp.customerIdentity) {
      return window.ToolboxApp.customerIdentity.displayAddress(record);
    }
    const addr = (record.propertyAddress || '').trim();
    return addr ? addr.split('\n')[0].trim() : 'No property address yet';
  }

  function frontDoorSelectHtml(selected) {
    return window.ToolboxBuildingTypes.FRONT_DOOR_OPTIONS.map(function (opt) {
      const sel = opt.value === selected ? ' selected' : '';
      return '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
    }).join('');
  }

  function buildingTypeSelectHtml(selected) {
    const types = window.ToolboxBuildingTypes.BUILDING_TYPES;
    let html = '';
    Object.keys(types).forEach(function (key) {
      const sel = key === selected ? ' selected' : '';
      html += '<option value="' + key + '"' + sel + '>' + types[key].label + '</option>';
    });
    const allSel = selected === 'all' ? ' selected' : '';
    html += '<option value="all"' + allSel + '>All / Mixed</option>';
    return html;
  }

  function renderDistress(app, customerFileId) {
    if (window.ToolboxApp && window.ToolboxApp.registerActiveFlush) {
      window.ToolboxApp.registerActiveFlush(null);
    }

    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="distress-back" class="btn btn--ghost">‹ Customer File</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="distress-identity-name"></span>' +
      '    <span class="file-identity__address" id="distress-identity-address"></span>' +
      '  </div>' +
      '  <span class="file-status" id="distress-status"></span>' +
      '</div>' +
      '<div class="distress-setup" id="distress-setup">' +
      '  <div class="distress-setup__head">' +
      '    <h2 class="distress-setup__title">Distress · Plan Setup</h2>' +
      '    <p class="distress-setup__hint">Set up each surface for field capture.</p>' +
      '  </div>' +

      '  <div class="surface-roster" id="surface-roster"></div>' +
      '  <div class="surface-add-row">' +
      '    <button type="button" id="surface-add-btn" class="btn btn--ghost">+ Add surface</button>' +
      '  </div>' +

      '  <div class="distress-surface-name">' +
      '    <label for="surface-name-input">Active surface</label>' +
      '    <div class="distress-surface-name__row">' +
      '      <input type="text" id="surface-name-input" class="surface-name-input" autocomplete="off" aria-label="Surface name">' +
      '      <button type="button" id="surface-rename-btn" class="surface-icon-btn" aria-label="Rename surface" title="Rename">✎</button>' +
      '    </div>' +
      '  </div>' +

      '  <div class="field field--full">' +
      '    <label>Floor plan</label>' +
      '    <div id="plan-drop-zone" class="plan-drop-zone">' +
      '      <button type="button" class="plan-drop" id="plan-drop-btn">' +
      '        <div class="plan-drop__icon">📐</div>' +
      '        <div><b>Tap to upload</b></div>' +
      '        <div class="plan-drop__sub">JPG or PNG</div>' +
      '      </button>' +
      '    </div>' +
      '    <div id="plan-preview" class="plan-preview" hidden>' +
      '      <button type="button" class="plan-preview__change" id="plan-change-btn">Change</button>' +
      '      <button type="button" class="plan-preview__rooms" id="plan-rooms-btn">➕ Rooms / FD</button>' +
      '      <img id="plan-preview-img" alt="Floor plan preview">' +
      '      <p class="plan-preview__meta" id="plan-preview-meta"></p>' +
      '    </div>' +
      '    <input type="file" id="plan-file" accept="image/*" hidden>' +
      '  </div>' +

      '  <div class="field field--full" id="rooms-field" hidden>' +
      '    <label>Rooms <span id="rooms-status" class="field-hint-inline"></span></label>' +
      '    <div id="rooms-chips" class="rooms-chips"></div>' +
      '    <div class="room-actions">' +
      '      <button type="button" class="room-action-btn room-action-btn--primary" id="rooms-manual-btn">➕ Manual rooms</button>' +
      '    </div>' +
      '  </div>' +

      '  <div class="field field--full">' +
      '    <label for="front-door-select">Front door faces</label>' +
      '    <select id="front-door-select" class="setup-select"></select>' +
      '    <p class="field-hint">For sharper geometry, open Rooms / FD and place an FD marker on the plan.</p>' +
      '  </div>' +

      '  <div class="field field--full">' +
      '    <label for="building-type-select">Building type</label>' +
      '    <select id="building-type-select" class="setup-select"></select>' +
      '    <p class="field-hint">Sets which rooms appear in the picker. Shared across surfaces for this survey.</p>' +
      '  </div>' +

      '  <p class="distress-feedback" id="distress-feedback" hidden></p>' +
      '</div>';

    const backBtn = app.querySelector('#distress-back');
    const statusEl = app.querySelector('#distress-status');
    const identityName = app.querySelector('#distress-identity-name');
    const identityAddress = app.querySelector('#distress-identity-address');
    const rosterEl = app.querySelector('#surface-roster');
    const addSurfaceBtn = app.querySelector('#surface-add-btn');
    const nameInput = app.querySelector('#surface-name-input');
    const renameBtn = app.querySelector('#surface-rename-btn');
    const dropZone = app.querySelector('#plan-drop-zone');
    const dropBtn = app.querySelector('#plan-drop-btn');
    const preview = app.querySelector('#plan-preview');
    const previewImg = app.querySelector('#plan-preview-img');
    const previewMeta = app.querySelector('#plan-preview-meta');
    const changeBtn = app.querySelector('#plan-change-btn');
    const roomsOverlayBtn = app.querySelector('#plan-rooms-btn');
    const fileInput = app.querySelector('#plan-file');
    const roomsField = app.querySelector('#rooms-field');
    const roomsChips = app.querySelector('#rooms-chips');
    const roomsStatus = app.querySelector('#rooms-status');
    const roomsManualBtn = app.querySelector('#rooms-manual-btn');
    const frontDoorSelect = app.querySelector('#front-door-select');
    const buildingTypeSelect = app.querySelector('#building-type-select');
    const feedbackEl = app.querySelector('#distress-feedback');

    let record = null;
    let saveTimer = null;
    let dirty = false;
    let savingPlan = false;
    let hydratedPlanDataUrl = null;
    // Cache of hydrated plan dataUrls by plan.id for fast surface switching
    const planCache = Object.create(null);

    function setStatus(text) {
      statusEl.textContent = text || '';
    }

    function setFeedback(text) {
      feedbackEl.textContent = text || '';
      feedbackEl.hidden = !text;
    }

    function scheduleSave() {
      dirty = true;
      setStatus('Unsaved changes…');
      if (saveTimer) clearTimeout(saveTimer);
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
      const surface = activeSurface(record);
      if (surface) surface.updatedAt = new Date().toISOString();
      record.distress.updatedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        dirty = false;
        setStatus('Saved ' + formatUpdated(record.updatedAt));
      }).catch(function (err) {
        console.error('Failed to save Distress Plan Setup:', err);
        setStatus('Save failed — will retry');
        throw err;
      });
    }

    if (window.ToolboxApp && window.ToolboxApp.registerActiveFlush) {
      window.ToolboxApp.registerActiveFlush(flushSave);
    }

    function updateIdentityBar() {
      identityName.textContent = displayName(record);
      identityAddress.textContent = displayAddress(record);
    }

    function showNoPlan() {
      dropZone.hidden = false;
      preview.hidden = true;
      previewImg.removeAttribute('src');
      previewMeta.textContent = '';
      hydratedPlanDataUrl = null;
      roomsOverlayBtn.disabled = true;
    }

    function showPlanPreview(dataUrl, width, height) {
      hydratedPlanDataUrl = dataUrl;
      previewImg.src = dataUrl;
      previewMeta.textContent = width + ' × ' + height + ' px';
      preview.hidden = false;
      dropZone.hidden = true;
      roomsOverlayBtn.disabled = false;
    }

    function hydrateAndShowPlan(surface) {
      if (!hasUsablePlan(surface)) {
        showNoPlan();
        return Promise.resolve();
      }
      const planId = surface.plan.id;
      if (planCache[planId]) {
        showPlanPreview(planCache[planId], surface.plan.width, surface.plan.height);
        return Promise.resolve();
      }
      return window.ToolboxDB.getMedia(planId).then(function (dataUrl) {
        if (!dataUrl) {
          setFeedback('Plan image missing — tap Change to reload it.');
          showNoPlan();
          return;
        }
        planCache[planId] = dataUrl;
        showPlanPreview(dataUrl, surface.plan.width, surface.plan.height);
      }).catch(function (err) {
        console.error('Failed to hydrate plan:', err);
        setFeedback('Could not load saved plan — tap Change to reload it.');
        showNoPlan();
      });
    }

    function renderRoster() {
      rosterEl.innerHTML = '';
      record.distress.surfaces.forEach(function (surface) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'surface-chip';
        if (surface.id === record.distress.activeSurfaceId) btn.classList.add('is-active');
        const hasPlan = hasUsablePlan(surface);
        btn.textContent = surface.name + (hasPlan ? '' : ' · no plan');
        btn.setAttribute('aria-pressed', surface.id === record.distress.activeSurfaceId ? 'true' : 'false');
        btn.addEventListener('click', function () {
          if (surface.id === record.distress.activeSurfaceId) return;
          switchToSurface(surface.id);
        });
        rosterEl.appendChild(btn);
      });
    }

    function renderRoomsChips() {
      const surface = activeSurface(record);
      const list = (surface && surface.rooms) || [];
      roomsChips.innerHTML = '';
      if (!list.length) {
        roomsField.hidden = !hasUsablePlan(surface);
        roomsStatus.textContent = '';
        return;
      }
      roomsField.hidden = false;
      roomsStatus.textContent = '(' + list.length + ')';
      list.forEach(function (room, idx) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'room-chip';
        chip.textContent = room.name + ' ×';
        chip.title = 'Remove ' + room.name;
        chip.addEventListener('click', function () {
          surface.rooms = surface.rooms.slice();
          surface.rooms.splice(idx, 1);
          scheduleSave();
          renderRoomsChips();
        });
        roomsChips.appendChild(chip);
      });
    }

    function syncActiveSurfaceForm() {
      const surface = activeSurface(record);
      if (!surface) return;
      nameInput.value = surface.name;
      frontDoorSelect.innerHTML = frontDoorSelectHtml(surface.frontDoorFacing || '');
      buildingTypeSelect.innerHTML = buildingTypeSelectHtml(record.distress.buildingType || 'residential');
      renderRoster();
      renderRoomsChips();
    }

    function switchToSurface(surfaceId) {
      // Persist current form fields onto the outgoing surface first
      commitRename();
      const outgoing = activeSurface(record);
      if (outgoing) {
        outgoing.frontDoorFacing = frontDoorSelect.value;
      }
      record.distress.activeSurfaceId = surfaceId;
      scheduleSave();
      syncActiveSurfaceForm();
      setFeedback('');
      return hydrateAndShowPlan(activeSurface(record));
    }

    function commitRename() {
      const surface = activeSurface(record);
      if (!surface) return;
      const value = nameInput.value.trim();
      if (!value) {
        nameInput.value = surface.name;
        return;
      }
      if (value !== surface.name) {
        surface.name = value;
        scheduleSave();
        renderRoster();
      }
    }

    nameInput.addEventListener('change', commitRename);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });
    renameBtn.addEventListener('click', function () {
      nameInput.focus();
      nameInput.select();
    });

    addSurfaceBtn.addEventListener('click', function () {
      const suggested = 'Surface ' + (record.distress.surfaces.length + 1);
      const name = (prompt('Name for the new surface:', suggested) || '').trim();
      if (!name) return;
      commitRename();
      const surface = blankSurface(name);
      record.distress.surfaces.push(surface);
      record.distress.activeSurfaceId = surface.id;
      scheduleSave();
      syncActiveSurfaceForm();
      showNoPlan();
      setFeedback('');
    });

    frontDoorSelect.addEventListener('change', function () {
      const surface = activeSurface(record);
      if (!surface) return;
      surface.frontDoorFacing = frontDoorSelect.value;
      scheduleSave();
    });

    buildingTypeSelect.addEventListener('change', function () {
      record.distress.buildingType = buildingTypeSelect.value || 'residential';
      scheduleSave();
    });

    function openFilePicker() {
      if (savingPlan) return;
      fileInput.value = '';
      fileInput.click();
    }

    dropBtn.addEventListener('click', openFilePicker);
    changeBtn.addEventListener('click', openFilePicker);

    function openRoomsOverlay() {
      const surface = activeSurface(record);
      if (!hasUsablePlan(surface) || !hydratedPlanDataUrl) {
        setFeedback('Load a plan before adding rooms.');
        return;
      }
      window.ToolboxRoomVerify.open({
        getPlan: function () {
          return {
            dataUrl: hydratedPlanDataUrl,
            width: surface.plan.width,
            height: surface.plan.height,
          };
        },
        getRooms: function () { return surface.rooms || []; },
        setRooms: function (list) { surface.rooms = list; },
        getFrontDoor: function () { return surface.frontDoor; },
        setFrontDoor: function (fd) { surface.frontDoor = fd; },
        getBuildingType: function () { return record.distress.buildingType || 'residential'; },
        onChange: function () {
          scheduleSave();
          renderRoomsChips();
        },
      });
    }

    roomsOverlayBtn.addEventListener('click', openRoomsOverlay);
    roomsManualBtn.addEventListener('click', openRoomsOverlay);
    previewImg.addEventListener('click', openRoomsOverlay);

    fileInput.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setFeedback('');
      setStatus('Processing plan…');
      savingPlan = true;
      dropBtn.disabled = true;
      changeBtn.disabled = true;

      window.ToolboxPlanImage.processPlanFile(file, function (processed) {
        const surface = activeSurface(record);
        if (!surface) {
          savingPlan = false;
          dropBtn.disabled = false;
          changeBtn.disabled = false;
          return;
        }

        const oldPlanId = surface.plan && surface.plan.id ? surface.plan.id : null;
        const planId = window.ToolboxPlanImage.newPlanId();

        window.ToolboxDB.putMedia(planId, processed.dataUrl).then(function () {
          surface.plan = {
            id: planId,
            width: processed.width,
            height: processed.height,
          };
          // Match FRP onPlanFileChange: new plan clears FD and rooms
          surface.frontDoor = null;
          surface.rooms = [];
          surface.updatedAt = new Date().toISOString();
          record.distress.updatedAt = surface.updatedAt;
          record.updatedAt = surface.updatedAt;
          dirty = true;
          planCache[planId] = processed.dataUrl;
          if (oldPlanId) delete planCache[oldPlanId];

          return flushSave().then(function () {
            if (oldPlanId && oldPlanId !== planId) {
              window.ToolboxDB.deleteMedia(oldPlanId).catch(function () { /* best-effort */ });
            }
            showPlanPreview(processed.dataUrl, processed.width, processed.height);
            renderRoomsChips();
            renderRoster();
            setFeedback('');
          });
        }).catch(function (err) {
          console.error('Failed to save plan:', err);
          setFeedback('Could not save floor plan — try again.');
          setStatus('Save failed — will retry');
        }).then(function () {
          savingPlan = false;
          dropBtn.disabled = false;
          changeBtn.disabled = false;
        });
      }, function (err) {
        savingPlan = false;
        dropBtn.disabled = false;
        changeBtn.disabled = false;
        setFeedback((err && err.message) || 'Could not load that image.');
        setStatus('');
      });
    });

    backBtn.addEventListener('click', function () {
      commitRename();
      const surface = activeSurface(record);
      if (surface) surface.frontDoorFacing = frontDoorSelect.value;
      record.distress.buildingType = buildingTypeSelect.value || record.distress.buildingType;
      dirty = true;
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(customerFileId);
      }).catch(function () {
        // Stay on Distress so the investigator can retry save.
      });
    });

    setStatus('Loading…');

    window.ToolboxDB.getCustomerFile(customerFileId).then(function (existing) {
      record = existing || (window.ToolboxApp && window.ToolboxApp.blankCustomerFile
        ? window.ToolboxApp.blankCustomerFile(customerFileId)
        : { id: customerFileId });
      const created = ensureDistressSurvey(record);
      updateIdentityBar();
      syncActiveSurfaceForm();
      return hydrateAndShowPlan(activeSurface(record)).then(function () {
        if (created || !existing) {
          dirty = true;
          return flushSave();
        }
        setStatus(existing ? 'Saved ' + formatUpdated(record.updatedAt) : 'New — not yet saved');
      });
    }).catch(function (err) {
      console.error('Failed to load Customer File for Distress:', err);
      setStatus('Unable to load');
      setFeedback('Unable to open Distress for this Customer File.');
    });
  }

  window.ToolboxDistress = {
    renderDistress: renderDistress,
    ensureDistressSurvey: ensureDistressSurvey,
    activeSurface: activeSurface,
    hasUsablePlan: hasUsablePlan,
    DEFAULT_SURFACE_NAME: DEFAULT_SURFACE_NAME,
  };
})();
