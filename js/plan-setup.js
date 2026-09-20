// Toolbox — Customer File plans (canvases/levels) + app ownership containers.
//
// Plans belong to the Customer File: contact info + plan(s) = Customer File.
// This module is implementation plumbing for plan images, rooms, FD, and
// building type — not a separate product application or gatekeeper.
//
// Data currently lives on record.planSetup (transitional key; physically on
// the Customer File). Migration from legacy distress.surfaces is preserved.
//
// Application ownership (KISS):
//   - Customer File owns canvases (via planSetup.canvases).
//   - Distress owns survey/pins; each pin references a CF canvas via canvasId.
//   - Floor Survey owns record.floorSurvey; layers keyed by CF canvasId.
// Apps never duplicate plan/rooms/media. Canvas deletion is not implemented;
// when it is, consult findOrphanedCanvasRefs before destroying field data.

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
      drawings: [],
    };
  }

  // Minimal Floor Survey application container. No plan images, rooms, or
  // topo-boundary modeling here — only ownership + canvasId association.
  function blankFloorSurvey() {
    const now = new Date().toISOString();
    return {
      id: newId('floorSurvey'),
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
      // Floor Survey–owned layers keyed by Customer File canvasId.
      // Values stay application-only; never copy plan/rooms/media into them.
      byCanvasId: {},
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
      if (normalizeDistressPinCanvasRefs(record)) changed = true;
    }

    // Floor Survey application container (tolerant init; no IDB version bump).
    if (ensureFloorSurvey(record)) changed = true;

    return changed;
  }

  function ensureFloorSurvey(record) {
    if (!record || typeof record !== 'object') return false;
    let changed = false;
    if (!record.floorSurvey || typeof record.floorSurvey !== 'object') {
      record.floorSurvey = blankFloorSurvey();
      return true;
    }
    const fs = record.floorSurvey;
    if (!fs.id) { fs.id = newId('floorSurvey'); changed = true; }
    if (typeof fs.schemaVersion !== 'number') { fs.schemaVersion = 1; changed = true; }
    if (!fs.byCanvasId || typeof fs.byCanvasId !== 'object' || Array.isArray(fs.byCanvasId)) {
      fs.byCanvasId = {};
      changed = true;
    }
    return changed;
  }

  // Distress observations reference a shared CF canvas by id only — no plan copy.
  // Missing canvasId is backfilled from the survey's active canvas when possible.
  function normalizeDistressPinCanvasRefs(record) {
    const d = record && record.distress;
    if (!d || !Array.isArray(d.pins)) return false;
    const fallback = d.activeCanvasId ||
      (record.planSetup && record.planSetup.activeCanvasId) ||
      null;
    let changed = false;
    d.pins.forEach(function (pin) {
      if (!pin || typeof pin !== 'object') return;
      if (typeof pin.canvasId !== 'string' || !pin.canvasId) {
        if (fallback) {
          pin.canvasId = fallback;
          changed = true;
        }
      }
    });
    return changed;
  }

  // Associate Floor Survey application data with an existing CF canvas.
  // Creates an empty layer slot; does not copy plan/rooms/media.
  function ensureFloorSurveyCanvasRef(record, canvasId) {
    if (!record || typeof canvasId !== 'string' || !canvasId) return false;
    ensurePlanSetup(record);
    if (!canvasById(record, canvasId)) return false;
    const fs = record.floorSurvey;
    const existing = fs.byCanvasId[canvasId];
    if (!existing || typeof existing !== 'object') {
      fs.byCanvasId[canvasId] = { canvasId: canvasId };
      fs.updatedAt = new Date().toISOString();
      return true;
    }
    if (existing.canvasId !== canvasId) {
      existing.canvasId = canvasId;
      fs.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  // Detect application refs whose canvasId no longer exists on the Customer File.
  // Canvas deletion is not product-implemented yet; this enables a future guard
  // that must not silently destroy field observations.
  function findOrphanedCanvasRefs(record) {
    const known = {};
    const canvases = (record && record.planSetup && record.planSetup.canvases) || [];
    canvases.forEach(function (c) {
      if (c && typeof c.id === 'string' && c.id) known[c.id] = true;
    });
    const distressPins = [];
    const pins = (record && record.distress && record.distress.pins) || [];
    pins.forEach(function (pin, index) {
      if (!pin || typeof pin !== 'object') return;
      if (typeof pin.canvasId === 'string' && pin.canvasId && !known[pin.canvasId]) {
        distressPins.push({
          index: index,
          pinId: typeof pin.id === 'string' ? pin.id : null,
          canvasId: pin.canvasId,
        });
      }
    });
    const floorSurveyCanvasIds = [];
    const by = (record && record.floorSurvey && record.floorSurvey.byCanvasId) || {};
    Object.keys(by).forEach(function (cid) {
      if (!known[cid]) floorSurveyCanvasIds.push(cid);
    });
    return { distressPins: distressPins, floorSurveyCanvasIds: floorSurveyCanvasIds };
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

  function newRoomId() {
    return newId('room');
  }

  function assignRoomIds(list) {
    return (list || []).map(function (r) {
      if (r.id) return r;
      return { id: newRoomId(), name: r.name, x: r.x, y: r.y };
    });
  }

  function mergeScannedRooms(canvas, found) {
    const rooms = (canvas.rooms || []).slice();
    let addedCount = 0;
    found.forEach(function (f) {
      const nearby = rooms.find(function (r) {
        return typeof r.x === 'number' && typeof r.y === 'number' &&
          Math.hypot(r.x - f.x, r.y - f.y) < 0.05;
      });
      if (nearby) return;
      const byName = rooms.find(function (r) {
        return (r.name || '').trim().toLowerCase() === (f.name || '').trim().toLowerCase() &&
          typeof r.x !== 'number';
      });
      if (byName) {
        byName.x = f.x;
        byName.y = f.y;
        addedCount += 1;
        return;
      }
      rooms.push({ id: newRoomId(), name: f.name, x: f.x, y: f.y });
      addedCount += 1;
    });
    canvas.rooms = rooms;
    return addedCount;
  }

  // Mount plans UI into a panel inside Customer File edit.
  // ctx: { getRecord, setDirty, scheduleSave, flushSave, setStatus, setFeedback }
  function mountPlansPanel(panel, ctx) {
    panel.innerHTML =
      '<div class="cf-plans" id="cf-plans">' +
      '  <div class="cf-plans__head">' +
      '    <h2 class="cf-plans__title">Floor plans</h2>' +
      '    <p class="cf-plans__hint">Part of this Customer File. Applications use these same plans.</p>' +
      '  </div>' +
      '  <div class="canvas-roster" id="canvas-roster" hidden></div>' +
      '  <div class="canvas-add-row" id="canvas-add-row">' +
      '    <button type="button" id="canvas-add-btn" class="btn btn--ghost">+ Add another level</button>' +
      '  </div>' +
      '  <div class="plan-canvas-name" id="plan-canvas-name-wrap">' +
      '    <label for="canvas-name-input">Plan / level name</label>' +
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
      '      <button type="button" class="plan-preview__rooms" id="plan-rooms-btn">Verify rooms / FD</button>' +
      '      <img id="plan-preview-img" alt="Floor plan preview">' +
      '      <p class="plan-preview__meta" id="plan-preview-meta"></p>' +
      '    </div>' +
      '    <input type="file" id="plan-file" accept="image/*" hidden>' +
      '  </div>' +
      '  <div class="field field--full" id="rooms-field" hidden>' +
      '    <label>Rooms <span id="rooms-status" class="field-hint-inline"></span></label>' +
      '    <div id="rooms-chips" class="rooms-chips"></div>' +
      '    <div class="room-actions">' +
      '      <button type="button" class="room-action-btn room-action-btn--primary" id="rooms-ocr-btn">🔍 Read labels</button>' +
      '      <button type="button" class="room-action-btn" id="rooms-ocr-more-btn" hidden>➕ Find more</button>' +
      '    </div>' +
      '    <div class="room-actions">' +
      '      <button type="button" class="room-action-btn" id="rooms-manual-btn">Verify / edit rooms</button>' +
      '    </div>' +
      '    <p class="field-hint" id="ocr-message" hidden></p>' +
      '  </div>' +
      '  <div class="field field--full">' +
      '    <label for="front-door-select">Front door faces</label>' +
      '    <select id="front-door-select" class="setup-select"></select>' +
      '    <p class="field-hint">Open Verify rooms / FD to place a front-door marker on the plan.</p>' +
      '  </div>' +
      '  <div class="field field--full">' +
      '    <label for="building-type-select">Building type</label>' +
      '    <select id="building-type-select" class="setup-select"></select>' +
      '    <p class="field-hint">Guides room recognition and the room name picker.</p>' +
      '  </div>' +
      '  <p class="plan-feedback" id="plan-panel-feedback" hidden></p>' +
      '</div>';

    const rosterEl = panel.querySelector('#canvas-roster');
    const addRow = panel.querySelector('#canvas-add-row');
    const addCanvasBtn = panel.querySelector('#canvas-add-btn');
    const nameWrap = panel.querySelector('#plan-canvas-name-wrap');
    const nameInput = panel.querySelector('#canvas-name-input');
    const renameBtn = panel.querySelector('#canvas-rename-btn');
    const dropZone = panel.querySelector('#plan-drop-zone');
    const dropBtn = panel.querySelector('#plan-drop-btn');
    const preview = panel.querySelector('#plan-preview');
    const previewImg = panel.querySelector('#plan-preview-img');
    const previewMeta = panel.querySelector('#plan-preview-meta');
    const changeBtn = panel.querySelector('#plan-change-btn');
    const roomsOverlayBtn = panel.querySelector('#plan-rooms-btn');
    const fileInput = panel.querySelector('#plan-file');
    const roomsField = panel.querySelector('#rooms-field');
    const roomsChips = panel.querySelector('#rooms-chips');
    const roomsStatus = panel.querySelector('#rooms-status');
    const roomsManualBtn = panel.querySelector('#rooms-manual-btn');
    const ocrBtn = panel.querySelector('#rooms-ocr-btn');
    const ocrMoreBtn = panel.querySelector('#rooms-ocr-more-btn');
    const ocrMessage = panel.querySelector('#ocr-message');
    const frontDoorSelect = panel.querySelector('#front-door-select');
    const buildingTypeSelect = panel.querySelector('#building-type-select');
    const panelFeedback = panel.querySelector('#plan-panel-feedback');

    let hydratedPlanDataUrl = null;
    let savingPlan = false;
    let ocrBusy = false;
    let ocrWaiters = [];
    const planCache = Object.create(null);

    function notifyOcrIdle() {
      if (ocrBusy || savingPlan) return;
      const waiters = ocrWaiters.slice();
      ocrWaiters = [];
      waiters.forEach(function (resolve) { resolve(); });
    }

    function record() { return ctx.getRecord(); }

    function setFeedback(text) {
      panelFeedback.textContent = text || '';
      panelFeedback.hidden = !text;
      if (ctx.setFeedback) ctx.setFeedback(text);
    }

    function setOcrMessage(text) {
      ocrMessage.textContent = text || '';
      ocrMessage.hidden = !text;
    }

    function showNoPlan() {
      dropZone.hidden = false;
      preview.hidden = true;
      previewImg.removeAttribute('src');
      previewMeta.textContent = '';
      hydratedPlanDataUrl = null;
      roomsOverlayBtn.disabled = true;
      ocrBtn.disabled = true;
      ocrMoreBtn.hidden = true;
    }

    function showPlanPreview(dataUrl, width, height) {
      hydratedPlanDataUrl = dataUrl;
      previewImg.src = dataUrl;
      previewMeta.textContent = width + ' × ' + height + ' px';
      preview.hidden = false;
      dropZone.hidden = true;
      roomsOverlayBtn.disabled = false;
      ocrBtn.disabled = false;
    }

    function hydrateAndShowPlan(canvas) {
      if (!hasUsablePlan(canvas)) {
        showNoPlan();
        roomsField.hidden = true;
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

    function updateLevelChrome() {
      const rec = record();
      const multi = rec.planSetup.canvases.length > 1;
      rosterEl.hidden = !multi;
      // Level name always available (even for one-level jobs); roster only when multi.
      nameWrap.hidden = false;
      addCanvasBtn.textContent = '+ Add another level';
    }

    function renderRoster() {
      const rec = record();
      rosterEl.innerHTML = '';
      updateLevelChrome();
      if (rec.planSetup.canvases.length <= 1) return;
      rec.planSetup.canvases.forEach(function (canvas) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'canvas-chip';
        if (canvas.id === rec.planSetup.activeCanvasId) btn.classList.add('is-active');
        btn.textContent = canvas.name + (hasUsablePlan(canvas) ? '' : ' · no plan');
        btn.addEventListener('click', function () {
          if (canvas.id === rec.planSetup.activeCanvasId) return;
          switchToCanvas(canvas.id);
        });
        rosterEl.appendChild(btn);
      });
    }

    function renderRoomsChips() {
      const canvas = activeCanvas(record());
      const list = (canvas && canvas.rooms) || [];
      roomsChips.innerHTML = '';
      if (!hasUsablePlan(canvas)) {
        roomsField.hidden = true;
        roomsStatus.textContent = '';
        return;
      }
      roomsField.hidden = false;
      roomsStatus.textContent = list.length ? '(' + list.length + ')' : '';
      list.forEach(function (room, idx) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'room-chip';
        chip.textContent = room.name + ' ×';
        chip.title = 'Remove ' + room.name;
        chip.addEventListener('click', function () {
          canvas.rooms = canvas.rooms.slice();
          canvas.rooms.splice(idx, 1);
          ctx.scheduleSave();
          renderRoomsChips();
        });
        roomsChips.appendChild(chip);
      });
    }

    function syncActiveCanvasForm() {
      const rec = record();
      const canvas = activeCanvas(rec);
      if (!canvas) return;
      nameInput.value = canvas.name;
      frontDoorSelect.innerHTML = frontDoorSelectHtml(canvas.frontDoorFacing || '');
      buildingTypeSelect.innerHTML = buildingTypeSelectHtml(rec.planSetup.buildingType || 'residential');
      renderRoster();
      renderRoomsChips();
    }

    function commitRename() {
      const canvas = activeCanvas(record());
      if (!canvas) return;
      const value = nameInput.value.trim();
      if (!value) {
        nameInput.value = canvas.name;
        return;
      }
      if (value !== canvas.name) {
        canvas.name = value;
        ctx.scheduleSave();
        renderRoster();
      }
    }

    function switchToCanvas(canvasId) {
      commitRename();
      const outgoing = activeCanvas(record());
      if (outgoing) outgoing.frontDoorFacing = frontDoorSelect.value;
      const rec = record();
      rec.planSetup.activeCanvasId = canvasId;
      if (rec.distress) rec.distress.activeCanvasId = canvasId;
      ctx.scheduleSave();
      syncActiveCanvasForm();
      setFeedback('');
      setOcrMessage('');
      ocrMoreBtn.hidden = true;
      return hydrateAndShowPlan(activeCanvas(rec));
    }

    function runOcrScan(auto) {
      const canvas = activeCanvas(record());
      if (!hasUsablePlan(canvas) || !hydratedPlanDataUrl || ocrBusy) return Promise.resolve();
      if (!window.ToolboxRoomOCR) {
        setOcrMessage('Room recognition is unavailable.');
        return Promise.resolve();
      }
      ocrBusy = true;
      ocrBtn.disabled = true;
      const oldText = ocrBtn.textContent;
      ocrBtn.textContent = 'Reading…';
      setOcrMessage(auto ? 'Reading room labels…' : 'Loading text reader…');
      const buildingType = record().planSetup.buildingType || 'residential';
      return window.ToolboxRoomOCR.scan(hydratedPlanDataUrl, buildingType, function (msg) {
        ocrBtn.textContent = msg;
        setOcrMessage(msg);
      }).then(function (result) {
        const found = result.rooms || [];
        const droppedCount = result.droppedCount || 0;
        const addedCount = mergeScannedRooms(canvas, found);
        ctx.scheduleSave();
        renderRoomsChips();
        ocrMoreBtn.hidden = false;
        const msg = addedCount
          ? 'Read ' + addedCount + ' label' + (addedCount === 1 ? '' : 's') +
            (droppedCount ? ' (dropped ' + droppedCount + ' low-confidence)' : '') +
            '. Verify below or open Verify rooms / FD.'
          : 'No room labels found. Use Verify / edit rooms to add them manually.';
        setOcrMessage(msg);
      }).catch(function (err) {
        console.error('OCR scan failed:', err);
        setOcrMessage((err && err.message) || 'Could not read labels. Add rooms manually.');
      }).then(function () {
        ocrBusy = false;
        ocrBtn.disabled = !hasUsablePlan(activeCanvas(record()));
        ocrBtn.textContent = oldText;
        notifyOcrIdle();
      });
    }

    function runOcrFindMore() {
      const canvas = activeCanvas(record());
      if (!hasUsablePlan(canvas) || !hydratedPlanDataUrl || ocrBusy) return Promise.resolve();
      ocrBusy = true;
      ocrMoreBtn.disabled = true;
      const oldText = ocrMoreBtn.textContent;
      ocrMoreBtn.textContent = 'Scanning…';
      setOcrMessage('Preparing deep scan…');
      const existing = (canvas.rooms || []).map(function (r) {
        return { name: r.name, x: r.x, y: r.y };
      });
      const buildingType = record().planSetup.buildingType || 'residential';
      return window.ToolboxRoomOCR.findMore(hydratedPlanDataUrl, buildingType, existing, function (msg) {
        ocrMoreBtn.textContent = msg;
        setOcrMessage(msg);
      }).then(function (result) {
        const merged = assignRoomIds(result.rooms || []);
        // Preserve ids for rooms that match by approximate position/name
        const prev = canvas.rooms || [];
        canvas.rooms = merged.map(function (r, i) {
          if (prev[i] && prev[i].id) return Object.assign({}, r, { id: prev[i].id });
          return r.id ? r : Object.assign({}, r, { id: newRoomId() });
        });
        ctx.scheduleSave();
        renderRoomsChips();
        const addedCount = result.addedCount || 0;
        setOcrMessage(addedCount
          ? 'Found ' + addedCount + ' more. Verify or edit as needed.'
          : 'No additional labels found.');
      }).catch(function (err) {
        console.error('OCR findMore failed:', err);
        setOcrMessage((err && err.message) || 'Deep scan failed.');
      }).then(function () {
        ocrBusy = false;
        ocrMoreBtn.disabled = false;
        ocrMoreBtn.textContent = oldText;
        notifyOcrIdle();
      });
    }

    nameInput.addEventListener('change', commitRename);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    });
    renameBtn.addEventListener('click', function () {
      nameInput.focus();
      nameInput.select();
    });

    addCanvasBtn.addEventListener('click', function () {
      const rec = record();
      const suggested = 'Level ' + (rec.planSetup.canvases.length + 1);
      const name = (prompt('Name for the new level:', suggested) || '').trim();
      if (!name) return;
      commitRename();
      const canvas = blankCanvas(name);
      rec.planSetup.canvases.push(canvas);
      rec.planSetup.activeCanvasId = canvas.id;
      if (rec.distress) rec.distress.activeCanvasId = canvas.id;
      ctx.scheduleSave();
      syncActiveCanvasForm();
      showNoPlan();
      setFeedback('');
      setOcrMessage('');
      ocrMoreBtn.hidden = true;
    });

    frontDoorSelect.addEventListener('change', function () {
      const canvas = activeCanvas(record());
      if (!canvas) return;
      canvas.frontDoorFacing = frontDoorSelect.value;
      ctx.scheduleSave();
    });

    buildingTypeSelect.addEventListener('change', function () {
      record().planSetup.buildingType = buildingTypeSelect.value || 'residential';
      ctx.scheduleSave();
    });

    function openFilePicker() {
      if (savingPlan) return;
      fileInput.value = '';
      fileInput.click();
    }
    dropBtn.addEventListener('click', openFilePicker);
    changeBtn.addEventListener('click', openFilePicker);

    function openRoomsOverlay() {
      const canvas = activeCanvas(record());
      if (!hasUsablePlan(canvas) || !hydratedPlanDataUrl) {
        setFeedback('Load a plan before verifying rooms.');
        return;
      }
      window.ToolboxRoomVerify.open({
        getPlan: function () {
          return { dataUrl: hydratedPlanDataUrl, width: canvas.plan.width, height: canvas.plan.height };
        },
        getRooms: function () { return canvas.rooms || []; },
        setRooms: function (list) { canvas.rooms = list; },
        getFrontDoor: function () { return canvas.frontDoor; },
        setFrontDoor: function (fd) { canvas.frontDoor = fd; },
        getBuildingType: function () { return record().planSetup.buildingType || 'residential'; },
        onChange: function () {
          ctx.scheduleSave();
          renderRoomsChips();
        },
      });
    }

    roomsOverlayBtn.addEventListener('click', openRoomsOverlay);
    roomsManualBtn.addEventListener('click', openRoomsOverlay);
    previewImg.addEventListener('click', openRoomsOverlay);
    ocrBtn.addEventListener('click', function () { runOcrScan(false); });
    ocrMoreBtn.addEventListener('click', runOcrFindMore);

    fileInput.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setFeedback('');
      setOcrMessage('');
      if (ctx.setStatus) ctx.setStatus('Processing plan…');
      savingPlan = true;
      dropBtn.disabled = true;
      changeBtn.disabled = true;

      window.ToolboxPlanImage.processPlanFile(file, function (processed) {
        const canvas = activeCanvas(record());
        if (!canvas) {
          savingPlan = false;
          dropBtn.disabled = false;
          changeBtn.disabled = false;
          return;
        }
        const oldPlanId = canvas.plan && canvas.plan.id ? canvas.plan.id : null;
        const planId = window.ToolboxPlanImage.newPlanId();

        window.ToolboxDB.putMedia(planId, processed.dataUrl).then(function () {
          canvas.plan = { id: planId, width: processed.width, height: processed.height };
          canvas.frontDoor = null;
          canvas.rooms = [];
          canvas.updatedAt = new Date().toISOString();
          record().planSetup.updatedAt = canvas.updatedAt;
          planCache[planId] = processed.dataUrl;
          if (oldPlanId) delete planCache[oldPlanId];
          ctx.setDirty(true);
          return ctx.flushSave().then(function () {
            if (oldPlanId && oldPlanId !== planId) {
              window.ToolboxDB.deleteMedia(oldPlanId).catch(function () {});
            }
            showPlanPreview(processed.dataUrl, processed.width, processed.height);
            renderRoomsChips();
            renderRoster();
            setFeedback('');
            // Automatic room recognition after plan load
            return runOcrScan(true);
          });
        }).catch(function (err) {
          console.error('Failed to save plan:', err);
          setFeedback('Could not save floor plan — try again.');
          if (ctx.setStatus) ctx.setStatus('Save failed — will retry');
        }).then(function () {
          savingPlan = false;
          dropBtn.disabled = false;
          changeBtn.disabled = false;
          notifyOcrIdle();
        });
      }, function (err) {
        savingPlan = false;
        dropBtn.disabled = false;
        changeBtn.disabled = false;
        notifyOcrIdle();
        setFeedback((err && err.message) || 'Could not load that image.');
        if (ctx.setStatus) ctx.setStatus('');
      });
    });

    // Public hooks for parent edit view
    return {
      syncFromRecord: function () {
        ensurePlanSetup(record());
        syncActiveCanvasForm();
        return hydrateAndShowPlan(activeCanvas(record()));
      },
      commitPending: function () {
        commitRename();
        const canvas = activeCanvas(record());
        if (canvas) canvas.frontDoorFacing = frontDoorSelect.value;
        record().planSetup.buildingType = buildingTypeSelect.value || record().planSetup.buildingType;
      },
      whenIdle: function () {
        if (!ocrBusy && !savingPlan) return Promise.resolve();
        return new Promise(function (resolve) { ocrWaiters.push(resolve); });
      },
      isBusy: function () { return !!ocrBusy || !!savingPlan; },
    };
  }

  window.ToolboxPlanSetup = {
    ensurePlanSetup: ensurePlanSetup,
    migrateLegacyDistressSurfaces: migrateLegacyDistressSurfaces,
    activeCanvas: activeCanvas,
    canvasById: canvasById,
    hasUsablePlan: hasUsablePlan,
    blankCanvas: blankCanvas,
    blankPlanSetup: blankPlanSetup,
    blankDistressSurvey: blankDistressSurvey,
    blankFloorSurvey: blankFloorSurvey,
    ensureFloorSurvey: ensureFloorSurvey,
    ensureFloorSurveyCanvasRef: ensureFloorSurveyCanvasRef,
    normalizeDistressPinCanvasRefs: normalizeDistressPinCanvasRefs,
    findOrphanedCanvasRefs: findOrphanedCanvasRefs,
    mountPlansPanel: mountPlansPanel,
    DEFAULT_CANVAS_NAME: DEFAULT_CANVAS_NAME,
  };
})();
