// Toolbox — Distress Survey seam on shared Plan Setup canvases.
//
// Customer File → Distress. Consumes canvases/levels already established in
// Plan Setup. Does not own, copy, or recreate plan setup. When multiple
// levels exist, the investigator switches among those SAME established
// canvases inside Distress.
//
// Capture is not implemented here. Survey-level pins[] / nextNum / startNum
// remain reserved for the locked FRP numbering model (one continuous
// sequence across all canvases — never per-canvas restart).

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;

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

  function hasUsablePlan(canvas) {
    return window.ToolboxPlanSetup.hasUsablePlan(canvas);
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
      '<div class="distress-view" id="distress-view">' +
      '  <div class="distress-view__head">' +
      '    <h2 class="distress-view__title">Distress Survey</h2>' +
      '    <p class="distress-view__hint">Using plans established in Plan Setup. Capture comes next.</p>' +
      '  </div>' +
      '  <div class="canvas-roster canvas-roster--compact" id="distress-canvas-roster" hidden></div>' +
      '  <div id="distress-need-setup" class="distress-need-setup" hidden>' +
      '    <p class="distress-need-setup__msg">No plan is ready yet. Establish at least one level in Plan Setup first.</p>' +
      '    <button type="button" id="distress-open-plan" class="btn btn--accent">Open Plan Setup</button>' +
      '  </div>' +
      '  <div id="distress-canvas-panel" class="distress-canvas-panel" hidden>' +
      '    <div class="distress-canvas-panel__meta">' +
      '      <span class="distress-canvas-panel__name" id="distress-canvas-name"></span>' +
      '      <span class="distress-canvas-panel__rooms" id="distress-canvas-rooms"></span>' +
      '    </div>' +
      '    <div class="plan-preview plan-preview--consume" id="distress-plan-preview">' +
      '      <img id="distress-plan-img" alt="Active level plan">' +
      '      <p class="plan-preview__meta" id="distress-plan-meta"></p>' +
      '    </div>' +
      '  </div>' +
      '  <p class="plan-feedback" id="distress-feedback" hidden></p>' +
      '</div>';

    const backBtn = app.querySelector('#distress-back');
    const statusEl = app.querySelector('#distress-status');
    const identityName = app.querySelector('#distress-identity-name');
    const identityAddress = app.querySelector('#distress-identity-address');
    const rosterEl = app.querySelector('#distress-canvas-roster');
    const needSetupEl = app.querySelector('#distress-need-setup');
    const openPlanBtn = app.querySelector('#distress-open-plan');
    const canvasPanel = app.querySelector('#distress-canvas-panel');
    const canvasNameEl = app.querySelector('#distress-canvas-name');
    const canvasRoomsEl = app.querySelector('#distress-canvas-rooms');
    const previewImg = app.querySelector('#distress-plan-img');
    const previewMeta = app.querySelector('#distress-plan-meta');
    const feedbackEl = app.querySelector('#distress-feedback');

    let record = null;
    let saveTimer = null;
    let dirty = false;
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
      if (record.distress) record.distress.updatedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        dirty = false;
        setStatus('Saved ' + formatUpdated(record.updatedAt));
      }).catch(function (err) {
        console.error('Failed to save Distress:', err);
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

    function activeDistressCanvas() {
      if (!record || !record.distress || !record.planSetup) return null;
      return window.ToolboxPlanSetup.canvasById(record, record.distress.activeCanvasId) ||
        window.ToolboxPlanSetup.activeCanvas(record);
    }

    function establishedCanvasesWithPlans() {
      if (!record || !record.planSetup || !Array.isArray(record.planSetup.canvases)) return [];
      return record.planSetup.canvases.filter(hasUsablePlan);
    }

    function showNeedSetup() {
      needSetupEl.hidden = false;
      canvasPanel.hidden = true;
      rosterEl.hidden = true;
      rosterEl.innerHTML = '';
    }

    function renderRoster(canvases) {
      rosterEl.innerHTML = '';
      if (canvases.length <= 1) {
        rosterEl.hidden = true;
        return;
      }
      rosterEl.hidden = false;
      canvases.forEach(function (canvas) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'canvas-chip';
        if (canvas.id === record.distress.activeCanvasId) btn.classList.add('is-active');
        btn.textContent = canvas.name;
        btn.setAttribute('aria-pressed', canvas.id === record.distress.activeCanvasId ? 'true' : 'false');
        btn.addEventListener('click', function () {
          if (canvas.id === record.distress.activeCanvasId) return;
          switchToCanvas(canvas.id);
        });
        rosterEl.appendChild(btn);
      });
    }

    function showCanvas(canvas, dataUrl) {
      needSetupEl.hidden = true;
      canvasPanel.hidden = false;
      canvasNameEl.textContent = canvas.name;
      const roomCount = (canvas.rooms && canvas.rooms.length) || 0;
      const facing = canvas.frontDoorFacing ? ' · faces ' + canvas.frontDoorFacing : '';
      const fd = canvas.frontDoor ? ' · FD placed' : '';
      canvasRoomsEl.textContent = roomCount
        ? roomCount + ' room' + (roomCount === 1 ? '' : 's') + facing + fd
        : 'No rooms yet' + facing + fd;
      previewImg.src = dataUrl;
      previewMeta.textContent = canvas.plan.width + ' × ' + canvas.plan.height + ' px';
    }

    function hydrateActive() {
      const ready = establishedCanvasesWithPlans();
      if (ready.length === 0) {
        showNeedSetup();
        return Promise.resolve();
      }

      // Prefer distress.activeCanvasId if it has a plan; else first ready canvas.
      let canvas = activeDistressCanvas();
      if (!hasUsablePlan(canvas)) {
        canvas = ready[0];
        record.distress.activeCanvasId = canvas.id;
        scheduleSave();
      }

      renderRoster(ready);

      const planId = canvas.plan.id;
      if (planCache[planId]) {
        showCanvas(canvas, planCache[planId]);
        return Promise.resolve();
      }
      return window.ToolboxDB.getMedia(planId).then(function (dataUrl) {
        if (!dataUrl) {
          setFeedback('Plan image missing for “' + canvas.name + '”. Re-open Plan Setup to reload it.');
          showNeedSetup();
          return;
        }
        planCache[planId] = dataUrl;
        showCanvas(canvas, dataUrl);
      }).catch(function (err) {
        console.error('Failed to hydrate Distress plan:', err);
        setFeedback('Could not load the plan for this level.');
        showNeedSetup();
      });
    }

    function switchToCanvas(canvasId) {
      const canvas = window.ToolboxPlanSetup.canvasById(record, canvasId);
      if (!canvas || !hasUsablePlan(canvas)) return;
      record.distress.activeCanvasId = canvasId;
      // Do not change planSetup.activeCanvasId here — Distress selection is
      // the field layer's working canvas; Plan Setup keeps its own last-edited.
      scheduleSave();
      setFeedback('');
      return hydrateActive();
    }

    openPlanBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(customerFileId) + '/plan';
      }).catch(function () { /* stay */ });
    });

    backBtn.addEventListener('click', function () {
      dirty = true;
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(customerFileId);
      }).catch(function () { /* stay */ });
    });

    setStatus('Loading…');

    window.ToolboxDB.getCustomerFile(customerFileId).then(function (existing) {
      record = existing || (window.ToolboxApp && window.ToolboxApp.blankCustomerFile
        ? window.ToolboxApp.blankCustomerFile(customerFileId)
        : { id: customerFileId });
      const changed = window.ToolboxPlanSetup.ensurePlanSetup(record);
      updateIdentityBar();
      return hydrateActive().then(function () {
        if (changed || !existing) {
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
  };
})();
