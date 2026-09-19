// Toolbox — Standalone Plan Setup.
//
// Customer File → Plan Setup. Establishes shared canvases/levels once:
// plan image, canvas identity/name, rooms, front-door/orientation,
// building type. Field applications (Distress, later Floor Survey) consume
// these same canvases; they do not own or copy them.
//
// Data lives on record.planSetup. Migration from the incorrect prior
// record.distress.surfaces ownership preserves canvas ids and media.

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;
  const DEFAULT_CANVAS_NAME = 'Floor Plan';

  function newId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return (prefix ? prefix + '-' : '') + window.crypto.randomUUID();
    }
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function blankCanvas(name) {
    const now = new Date().toISOString();
    return {
      id: newId('canvas'),
      name: name || DEFAULT_CANVAS_NAME,
      createdAt: now,
      updatedAt: now,
      plan: null, // { id, width, height }
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null, // { x, y } normalized 0..1
    };
  }

  function blankPlanSetup() {
    const canvas = blankCanvas(DEFAULT_CANVAS_NAME);
    const now = new Date().toISOString();
    return {
      id: newId('planSetup'),
      createdAt: now,
      updatedAt: now,
      activeCanvasId: canvas.id,
      canvases: [canvas],
      buildingType: 'residential',
    };
  }

  function blankDistressSurvey(activeCanvasId) {
    const now = new Date().toISOString();
    return {
      id: newId('distress'),
      createdAt: now,
      updatedAt: now,
      activeCanvasId: activeCanvasId || null,
      // Survey-level — reserved for locked FRP numbering (not per-canvas)
      startNum: 1,
      nextNum: 1,
      pins: [],
    };
  }

  function normalizeCanvas(c) {
    let changed = false;
    if (!Array.isArray(c.rooms)) { c.rooms = []; changed = true; }
    if (typeof c.frontDoorFacing !== 'string') { c.frontDoorFacing = 'S'; changed = true; }
    if (c.frontDoor != null && (typeof c.frontDoor.x !== 'number' || typeof c.frontDoor.y !== 'number')) {
      c.frontDoor = null;
      changed = true;
    }
    return changed;
  }

  // Migrate legacy Distress-owned surfaces into shared planSetup once.
  // Preserves canvas ids so media and any future layer refs stay valid.
  function migrateLegacyDistressSurfaces(record) {
    if (!record || !record.distress || typeof record.distress !== 'object') return false;
    const d = record.distress;
    if (!Array.isArray(d.surfaces) || d.surfaces.length === 0) return false;

    let ps = record.planSetup;
    const hasShared = ps && Array.isArray(ps.canvases) && ps.canvases.length > 0;

    if (!hasShared) {
      if (!ps || typeof ps !== 'object') {
        ps = {
          id: newId('planSetup'),
          createdAt: d.createdAt || new Date().toISOString(),
          updatedAt: d.updatedAt || new Date().toISOString(),
          activeCanvasId: null,
          canvases: [],
          buildingType: 'residential',
        };
        record.planSetup = ps;
      }
      ps.canvases = d.surfaces.map(function (s) {
        return {
          id: s.id || newId('canvas'),
          name: s.name || DEFAULT_CANVAS_NAME,
          createdAt: s.createdAt || ps.createdAt,
          updatedAt: s.updatedAt || ps.updatedAt,
          plan: s.plan || null,
          rooms: Array.isArray(s.rooms) ? s.rooms : [],
          frontDoorFacing: typeof s.frontDoorFacing === 'string' ? s.frontDoorFacing : 'S',
          frontDoor: s.frontDoor && typeof s.frontDoor.x === 'number' && typeof s.frontDoor.y === 'number'
            ? s.frontDoor
            : null,
        };
      });
      const preferred = d.activeSurfaceId;
      if (preferred && ps.canvases.some(function (c) { return c.id === preferred; })) {
        ps.activeCanvasId = preferred;
      } else {
        ps.activeCanvasId = ps.canvases[0].id;
      }
      if (typeof d.buildingType === 'string' && d.buildingType) {
        ps.buildingType = d.buildingType;
      } else if (typeof ps.buildingType !== 'string' || !ps.buildingType) {
        ps.buildingType = 'residential';
      }
    }

    // Point Distress at the shared canvases; drop owned setup fields.
    if (!d.activeCanvasId) {
      d.activeCanvasId = (record.planSetup && record.planSetup.activeCanvasId) ||
        (d.activeSurfaceId || null);
    }
    delete d.surfaces;
    delete d.activeSurfaceId;
    delete d.buildingType;
    return true;
  }

  function ensurePlanSetup(record) {
    let changed = migrateLegacyDistressSurfaces(record);

    if (!record.planSetup || typeof record.planSetup !== 'object') {
      record.planSetup = blankPlanSetup();
      changed = true;
    }

    const ps = record.planSetup;
    if (!ps.id) { ps.id = newId('planSetup'); changed = true; }
    if (!Array.isArray(ps.canvases) || ps.canvases.length === 0) {
      const canvas = blankCanvas(DEFAULT_CANVAS_NAME);
      ps.canvases = [canvas];
      ps.activeCanvasId = canvas.id;
      changed = true;
    }
    ps.canvases.forEach(function (c) {
      if (normalizeCanvas(c)) changed = true;
    });
    if (!ps.canvases.some(function (c) { return c.id === ps.activeCanvasId; })) {
      ps.activeCanvasId = ps.canvases[0].id;
      changed = true;
    }
    if (typeof ps.buildingType !== 'string' || !ps.buildingType) {
      ps.buildingType = 'residential';
      changed = true;
    }

    // Keep Distress survey shell aligned (numbering reserved; no surfaces).
    if (!record.distress || typeof record.distress !== 'object') {
      record.distress = blankDistressSurvey(ps.activeCanvasId);
      changed = true;
    } else {
      const d = record.distress;
      if (!d.id) { d.id = newId('distress'); changed = true; }
      if (typeof d.startNum !== 'number') { d.startNum = 1; changed = true; }
      if (typeof d.nextNum !== 'number') { d.nextNum = 1; changed = true; }
      if (!Array.isArray(d.pins)) { d.pins = []; changed = true; }
      if (Array.isArray(d.surfaces)) {
        // Migration already ran or surfaces empty — strip residual ownership.
        delete d.surfaces;
        delete d.activeSurfaceId;
        delete d.buildingType;
        changed = true;
      }
      if (!d.activeCanvasId || !ps.canvases.some(function (c) { return c.id === d.activeCanvasId; })) {
        d.activeCanvasId = ps.activeCanvasId;
        changed = true;
      }
    }

    return changed;
  }

  function activeCanvas(record) {
    if (!record || !record.planSetup || !Array.isArray(record.planSetup.canvases)) return null;
    return record.planSetup.canvases.find(function (c) {
      return c.id === record.planSetup.activeCanvasId;
    }) || record.planSetup.canvases[0] || null;
  }

  function canvasById(record, canvasId) {
    if (!record || !record.planSetup || !Array.isArray(record.planSetup.canvases)) return null;
    return record.planSetup.canvases.find(function (c) { return c.id === canvasId; }) || null;
  }

  function hasUsablePlan(canvas) {
    return !!(canvas && canvas.plan && canvas.plan.id && canvas.plan.width && canvas.plan.height);
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
    let matched = false;
    Object.keys(types).forEach(function (key) {
      const sel = key === selected ? ' selected' : '';
      if (key === selected) matched = true;
      html += '<option value="' + key + '"' + sel + '>' + types[key].label + '</option>';
    });
    const allSel = selected === 'all' ? ' selected' : '';
    if (selected === 'all') matched = true;
    html += '<option value="all"' + allSel + '>All / Mixed</option>';
    // Preserve migrated/unknown values so they remain visible and selectable.
    if (selected && !matched) {
      html += '<option value="' + selected + '" selected>' + selected + ' (saved)</option>';
    }
    return html;
  }

  function renderPlanSetup(app, customerFileId) {
    if (window.ToolboxApp && window.ToolboxApp.registerActiveFlush) {
      window.ToolboxApp.registerActiveFlush(null);
    }

    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="plan-back" class="btn btn--ghost">‹ Customer File</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="plan-identity-name"></span>' +
      '    <span class="file-identity__address" id="plan-identity-address"></span>' +
      '  </div>' +
      '  <span class="file-status" id="plan-status"></span>' +
      '</div>' +
      '<div class="plan-setup" id="plan-setup">' +
      '  <div class="plan-setup__head">' +
      '    <h2 class="plan-setup__title">Plan Setup</h2>' +
      '    <p class="plan-setup__hint">Establish each plan/level once for this Customer File. Distress and Floor Survey will use these same levels.</p>' +
      '  </div>' +

      '  <div class="canvas-roster" id="canvas-roster"></div>' +
      '  <div class="canvas-add-row">' +
      '    <button type="button" id="canvas-add-btn" class="btn btn--ghost">+ Add level</button>' +
      '  </div>' +

      '  <div class="plan-canvas-name">' +
      '    <label for="canvas-name-input">Active level</label>' +
      '    <div class="plan-canvas-name__row">' +
      '      <input type="text" id="canvas-name-input" class="canvas-name-input" autocomplete="off" aria-label="Level name">' +
      '      <button type="button" id="canvas-rename-btn" class="canvas-icon-btn" aria-label="Rename level" title="Rename">✎</button>' +
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
      '    <p class="field-hint">Sets which rooms appear in the picker. Shared across levels for this Customer File.</p>' +
      '  </div>' +

      '  <p class="plan-feedback" id="plan-feedback" hidden></p>' +
      '</div>';

    const backBtn = app.querySelector('#plan-back');
    const statusEl = app.querySelector('#plan-status');
    const identityName = app.querySelector('#plan-identity-name');
    const identityAddress = app.querySelector('#plan-identity-address');
    const rosterEl = app.querySelector('#canvas-roster');
    const addCanvasBtn = app.querySelector('#canvas-add-btn');
    const nameInput = app.querySelector('#canvas-name-input');
    const renameBtn = app.querySelector('#canvas-rename-btn');
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
    const feedbackEl = app.querySelector('#plan-feedback');

    let record = null;
    let saveTimer = null;
    let dirty = false;
    let savingPlan = false;
    let hydratedPlanDataUrl = null;
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
      const canvas = activeCanvas(record);
      if (canvas) canvas.updatedAt = new Date().toISOString();
      record.planSetup.updatedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        dirty = false;
        setStatus('Saved ' + formatUpdated(record.updatedAt));
      }).catch(function (err) {
        console.error('Failed to save Plan Setup:', err);
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

    function hydrateAndShowPlan(canvas) {
      if (!hasUsablePlan(canvas)) {
        showNoPlan();
        return Promise.resolve();
      }
      const planId = canvas.plan.id;
      if (planCache[planId]) {
        showPlanPreview(planCache[planId], canvas.plan.width, canvas.plan.height);
        return Promise.resolve();
      }
      return window.ToolboxDB.getMedia(planId).then(function (dataUrl) {
        if (!dataUrl) {
          setFeedback('Plan image missing — tap Change to reload it.');
          showNoPlan();
          return;
        }
        planCache[planId] = dataUrl;
        showPlanPreview(dataUrl, canvas.plan.width, canvas.plan.height);
      }).catch(function (err) {
        console.error('Failed to hydrate plan:', err);
        setFeedback('Could not load saved plan — tap Change to reload it.');
        showNoPlan();
      });
    }

    function renderRoster() {
      rosterEl.innerHTML = '';
      record.planSetup.canvases.forEach(function (canvas) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'canvas-chip';
        if (canvas.id === record.planSetup.activeCanvasId) btn.classList.add('is-active');
        const hasPlan = hasUsablePlan(canvas);
        btn.textContent = canvas.name + (hasPlan ? '' : ' · no plan');
        btn.setAttribute('aria-pressed', canvas.id === record.planSetup.activeCanvasId ? 'true' : 'false');
        btn.addEventListener('click', function () {
          if (canvas.id === record.planSetup.activeCanvasId) return;
          switchToCanvas(canvas.id);
        });
        rosterEl.appendChild(btn);
      });
    }

    function renderRoomsChips() {
      const canvas = activeCanvas(record);
      const list = (canvas && canvas.rooms) || [];
      roomsChips.innerHTML = '';
      if (!list.length) {
        roomsField.hidden = !hasUsablePlan(canvas);
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
          canvas.rooms = canvas.rooms.slice();
          canvas.rooms.splice(idx, 1);
          scheduleSave();
          renderRoomsChips();
        });
        roomsChips.appendChild(chip);
      });
    }

    function syncActiveCanvasForm() {
      const canvas = activeCanvas(record);
      if (!canvas) return;
      nameInput.value = canvas.name;
      frontDoorSelect.innerHTML = frontDoorSelectHtml(canvas.frontDoorFacing || '');
      buildingTypeSelect.innerHTML = buildingTypeSelectHtml(record.planSetup.buildingType || 'residential');
      renderRoster();
      renderRoomsChips();
    }

    function switchToCanvas(canvasId) {
      commitRename();
      const outgoing = activeCanvas(record);
      if (outgoing) {
        outgoing.frontDoorFacing = frontDoorSelect.value;
      }
      record.planSetup.activeCanvasId = canvasId;
      if (record.distress) record.distress.activeCanvasId = canvasId;
      scheduleSave();
      syncActiveCanvasForm();
      setFeedback('');
      return hydrateAndShowPlan(activeCanvas(record));
    }

    function commitRename() {
      const canvas = activeCanvas(record);
      if (!canvas) return;
      const value = nameInput.value.trim();
      if (!value) {
        nameInput.value = canvas.name;
        return;
      }
      if (value !== canvas.name) {
        canvas.name = value;
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

    addCanvasBtn.addEventListener('click', function () {
      const suggested = 'Level ' + (record.planSetup.canvases.length + 1);
      const name = (prompt('Name for the new level:', suggested) || '').trim();
      if (!name) return;
      commitRename();
      const canvas = blankCanvas(name);
      record.planSetup.canvases.push(canvas);
      record.planSetup.activeCanvasId = canvas.id;
      if (record.distress) record.distress.activeCanvasId = canvas.id;
      scheduleSave();
      syncActiveCanvasForm();
      showNoPlan();
      setFeedback('');
    });

    frontDoorSelect.addEventListener('change', function () {
      const canvas = activeCanvas(record);
      if (!canvas) return;
      canvas.frontDoorFacing = frontDoorSelect.value;
      scheduleSave();
    });

    buildingTypeSelect.addEventListener('change', function () {
      record.planSetup.buildingType = buildingTypeSelect.value || 'residential';
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
      const canvas = activeCanvas(record);
      if (!hasUsablePlan(canvas) || !hydratedPlanDataUrl) {
        setFeedback('Load a plan before adding rooms.');
        return;
      }
      window.ToolboxRoomVerify.open({
        getPlan: function () {
          return {
            dataUrl: hydratedPlanDataUrl,
            width: canvas.plan.width,
            height: canvas.plan.height,
          };
        },
        getRooms: function () { return canvas.rooms || []; },
        setRooms: function (list) { canvas.rooms = list; },
        getFrontDoor: function () { return canvas.frontDoor; },
        setFrontDoor: function (fd) { canvas.frontDoor = fd; },
        getBuildingType: function () { return record.planSetup.buildingType || 'residential'; },
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
        const canvas = activeCanvas(record);
        if (!canvas) {
          savingPlan = false;
          dropBtn.disabled = false;
          changeBtn.disabled = false;
          return;
        }

        const oldPlanId = canvas.plan && canvas.plan.id ? canvas.plan.id : null;
        const planId = window.ToolboxPlanImage.newPlanId();

        window.ToolboxDB.putMedia(planId, processed.dataUrl).then(function () {
          canvas.plan = {
            id: planId,
            width: processed.width,
            height: processed.height,
          };
          // Match FRP onPlanFileChange: new plan clears FD and rooms
          canvas.frontDoor = null;
          canvas.rooms = [];
          canvas.updatedAt = new Date().toISOString();
          record.planSetup.updatedAt = canvas.updatedAt;
          record.updatedAt = canvas.updatedAt;
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
      const canvas = activeCanvas(record);
      if (canvas) canvas.frontDoorFacing = frontDoorSelect.value;
      record.planSetup.buildingType = buildingTypeSelect.value || record.planSetup.buildingType;
      dirty = true;
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(customerFileId);
      }).catch(function () {
        // Stay on Plan Setup so the investigator can retry save.
      });
    });

    setStatus('Loading…');

    window.ToolboxDB.getCustomerFile(customerFileId).then(function (existing) {
      record = existing || (window.ToolboxApp && window.ToolboxApp.blankCustomerFile
        ? window.ToolboxApp.blankCustomerFile(customerFileId)
        : { id: customerFileId });
      const created = ensurePlanSetup(record);
      updateIdentityBar();
      syncActiveCanvasForm();
      return hydrateAndShowPlan(activeCanvas(record)).then(function () {
        if (created || !existing) {
          dirty = true;
          return flushSave();
        }
        setStatus(existing ? 'Saved ' + formatUpdated(record.updatedAt) : 'New — not yet saved');
      });
    }).catch(function (err) {
      console.error('Failed to load Customer File for Plan Setup:', err);
      setStatus('Unable to load');
      setFeedback('Unable to open Plan Setup for this Customer File.');
    });
  }

  window.ToolboxPlanSetup = {
    renderPlanSetup: renderPlanSetup,
    ensurePlanSetup: ensurePlanSetup,
    migrateLegacyDistressSurfaces: migrateLegacyDistressSurfaces,
    activeCanvas: activeCanvas,
    canvasById: canvasById,
    hasUsablePlan: hasUsablePlan,
    blankCanvas: blankCanvas,
    blankPlanSetup: blankPlanSetup,
    blankDistressSurvey: blankDistressSurvey,
    DEFAULT_CANVAS_NAME: DEFAULT_CANVAS_NAME,
  };
})();
