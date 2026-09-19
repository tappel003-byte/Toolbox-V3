// Toolbox — Distress workspace (Plan Setup slice).
//
// Customer File → Distress. If the active Distress surface has no usable
// plan, this workspace presents Plan Setup for that surface. Capture is
// not implemented in this slice; when a plan exists, Plan Setup still
// shows the real preview so the investigator can Change it. No fake
// capture canvas.
//
// Distress-only. Not a universal surface model. Floor Survey is out of
// scope. Additional surfaces are not UI-exposed yet, but the data shape
// is a surfaces[] array so the next step can add them without redesign.

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
      // plan: null | { id, width, height } — bytes in ToolboxDB media store
      plan: null,
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
      // Reserved for later capture attach — not used in this slice.
      // Survey-level pin list + sequence will live here so multi-surface
      // numbering can remain one continuous chronology (FRP-locked).
      startNum: 1,
      nextNum: 1,
      pins: [],
    };
  }

  // Returns true if the record's distress survey was created or repaired.
  function ensureDistressSurvey(record) {
    let changed = false;
    if (!record.distress || typeof record.distress !== 'object') {
      record.distress = blankDistressSurvey();
      return true;
    }
    const d = record.distress;
    if (!d.id) {
      d.id = newId('distress');
      changed = true;
    }
    if (!Array.isArray(d.surfaces) || d.surfaces.length === 0) {
      const surface = blankSurface(DEFAULT_SURFACE_NAME);
      d.surfaces = [surface];
      d.activeSurfaceId = surface.id;
      changed = true;
    }
    if (!d.surfaces.some(function (s) { return s.id === d.activeSurfaceId; })) {
      d.activeSurfaceId = d.surfaces[0].id;
      changed = true;
    }
    if (typeof d.startNum !== 'number') {
      d.startNum = 1;
      changed = true;
    }
    if (typeof d.nextNum !== 'number') {
      d.nextNum = 1;
      changed = true;
    }
    if (!Array.isArray(d.pins)) {
      d.pins = [];
      changed = true;
    }
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
      '    <p class="distress-setup__hint">Load a usable plan for this surface. Capture attaches next.</p>' +
      '  </div>' +
      '  <div class="distress-surface-name">' +
      '    <label for="surface-name-input">Surface</label>' +
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
      '      <img id="plan-preview-img" alt="Floor plan preview">' +
      '      <p class="plan-preview__meta" id="plan-preview-meta"></p>' +
      '    </div>' +
      '    <input type="file" id="plan-file" accept="image/*" hidden>' +
      '  </div>' +
      '  <p class="distress-feedback" id="distress-feedback" hidden></p>' +
      '</div>';

    const backBtn = app.querySelector('#distress-back');
    const statusEl = app.querySelector('#distress-status');
    const identityName = app.querySelector('#distress-identity-name');
    const identityAddress = app.querySelector('#distress-identity-address');
    const nameInput = app.querySelector('#surface-name-input');
    const renameBtn = app.querySelector('#surface-rename-btn');
    const dropZone = app.querySelector('#plan-drop-zone');
    const dropBtn = app.querySelector('#plan-drop-btn');
    const preview = app.querySelector('#plan-preview');
    const previewImg = app.querySelector('#plan-preview-img');
    const previewMeta = app.querySelector('#plan-preview-meta');
    const changeBtn = app.querySelector('#plan-change-btn');
    const fileInput = app.querySelector('#plan-file');
    const feedbackEl = app.querySelector('#distress-feedback');

    let record = null;
    let saveTimer = null;
    let dirty = false;
    let savingPlan = false;
    // In-memory hydrated dataUrl for the active surface plan (session only).
    let hydratedPlanDataUrl = null;

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
    }

    function showPlanPreview(dataUrl, width, height) {
      hydratedPlanDataUrl = dataUrl;
      previewImg.src = dataUrl;
      previewMeta.textContent = width + ' × ' + height + ' px';
      preview.hidden = false;
      dropZone.hidden = true;
    }

    function hydrateAndShowPlan(surface) {
      if (!hasUsablePlan(surface)) {
        showNoPlan();
        return Promise.resolve();
      }
      return window.ToolboxDB.getMedia(surface.plan.id).then(function (dataUrl) {
        if (!dataUrl) {
          setFeedback('Plan image missing — tap Change to reload it.');
          showNoPlan();
          return;
        }
        showPlanPreview(dataUrl, surface.plan.width, surface.plan.height);
      }).catch(function (err) {
        console.error('Failed to hydrate plan:', err);
        setFeedback('Could not load saved plan — tap Change to reload it.');
        showNoPlan();
      });
    }

    function syncNameInput() {
      const surface = activeSurface(record);
      nameInput.value = surface ? surface.name : DEFAULT_SURFACE_NAME;
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

    function openFilePicker() {
      if (savingPlan) return;
      fileInput.value = '';
      fileInput.click();
    }

    dropBtn.addEventListener('click', openFilePicker);
    changeBtn.addEventListener('click', openFilePicker);

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
          surface.updatedAt = new Date().toISOString();
          record.distress.updatedAt = surface.updatedAt;
          record.updatedAt = surface.updatedAt;
          dirty = true;

          return flushSave().then(function () {
            if (oldPlanId && oldPlanId !== planId) {
              window.ToolboxDB.deleteMedia(oldPlanId).catch(function () { /* best-effort */ });
            }
            showPlanPreview(processed.dataUrl, processed.width, processed.height);
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
      syncNameInput();
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
