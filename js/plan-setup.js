// Toolbox — Plan Setup.
//
// Owns the roster of Distress surfaces attached to a Customer File: the
// default "Floor Plan" surface (VISION.md §5), additional named surfaces,
// and which one is currently active. This module knows nothing about pins,
// photos, or capture — it only maintains the surface list and the active
// pointer that proven Distress capture will read next (see
// js/distress-seam.js for the attachment point).
//
// Surfaces live directly on the Customer File record via window.ToolboxDB,
// the same store Milestone 1 already uses. A dedicated object store isn't
// needed for this slice — one record per Customer File is still small, and
// this keeps Plan Setup persisting with zero migration for existing files.

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 900;

  function generateSurfaceId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'surf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function blankSurface(name) {
    const now = new Date().toISOString();
    return { id: generateSurfaceId(), name: name, createdAt: now, updatedAt: now };
  }

  // The first surface defaults to "Floor Plan" (VISION.md §5). Applied
  // lazily, the first time Plan Setup actually looks at a record, so a
  // Customer File created before this module existed — or created and
  // never saved — still gets a valid, active default surface with no
  // separate migration step. Returns true when it changed the record, so
  // the caller knows to persist it.
  function ensureDefaultSurface(record) {
    let changed = false;
    if (!Array.isArray(record.distressSurfaces) || record.distressSurfaces.length === 0) {
      const surface = blankSurface('Floor Plan');
      record.distressSurfaces = [surface];
      record.activeDistressSurfaceId = surface.id;
      changed = true;
    } else if (!record.distressSurfaces.some(function (s) { return s.id === record.activeDistressSurfaceId; })) {
      record.activeDistressSurfaceId = record.distressSurfaces[0].id;
      changed = true;
    }
    return changed;
  }

  function renderPlanSetup(app, id) {
    window.ToolboxApp.registerActiveFlush(null);

    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="plan-back" class="btn btn--ghost">‹ Cabinet</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="plan-identity-name"></span>' +
      '    <span class="file-identity__address" id="plan-identity-address"></span>' +
      '  </div>' +
      '  <span class="file-status" id="plan-status"></span>' +
      '</div>' +
      window.ToolboxApp.sectionNavHtml('plan') +
      '<div class="file-form-wrap">' +
      '  <h2 class="plan-setup-heading">Plan Setup</h2>' +
      '  <p class="plan-setup-hint">Distress surfaces for this Customer File. Capture happens on the active surface.</p>' +
      '  <div class="surface-list" id="surface-list"></div>' +
      '  <div class="surface-add" id="surface-add"></div>' +
      '  <div class="plan-setup-actions">' +
      '    <button type="button" id="plan-continue" class="btn btn--accent">Continue to Distress Capture ›</button>' +
      '  </div>' +
      '</div>';

    const backBtn = app.querySelector('#plan-back');
    const identityName = app.querySelector('#plan-identity-name');
    const identityAddress = app.querySelector('#plan-identity-address');
    const statusEl = app.querySelector('#plan-status');
    const listEl = app.querySelector('#surface-list');
    const addWrap = app.querySelector('#surface-add');
    const continueBtn = app.querySelector('#plan-continue');

    let record = null;
    let saveTimer = null;
    let dirty = false;

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
      record.updatedAt = new Date().toISOString();
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        dirty = false;
        setStatus('Saved ' + window.ToolboxApp.customerIdentity.formatUpdated(record.updatedAt));
      }).catch(function (err) {
        console.error('Failed to save Plan Setup:', err);
        setStatus('Save failed — will retry');
      });
    }

    function updateIdentityBar() {
      identityName.textContent = window.ToolboxApp.customerIdentity.displayName(record);
      identityAddress.textContent = window.ToolboxApp.customerIdentity.displayAddress(record);
    }

    function renderSurfaceList() {
      listEl.innerHTML = '';
      record.distressSurfaces.forEach(function (surface) {
        listEl.appendChild(surfaceRowNode(surface));
      });
    }

    function surfaceRowNode(surface) {
      const row = document.createElement('div');
      row.className = 'surface-row';
      const isActive = surface.id === record.activeDistressSurfaceId;
      if (isActive) row.classList.add('surface-row--active');

      const main = document.createElement('div');
      main.className = 'surface-row__main';

      const nameEl = document.createElement('span');
      nameEl.className = 'surface-row__name';
      nameEl.textContent = surface.name;
      main.appendChild(nameEl);

      if (isActive) {
        const badge = document.createElement('span');
        badge.className = 'surface-badge';
        badge.textContent = 'Active';
        main.appendChild(badge);
      }

      row.appendChild(main);

      const actions = document.createElement('div');
      actions.className = 'surface-row__actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'surface-icon-btn';
      editBtn.setAttribute('aria-label', 'Rename ' + surface.name);
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', function () {
        beginRename(row, surface);
      });
      actions.appendChild(editBtn);

      if (!isActive) {
        const activateBtn = document.createElement('button');
        activateBtn.type = 'button';
        activateBtn.className = 'btn btn--ghost btn--small';
        activateBtn.textContent = 'Set Active';
        activateBtn.addEventListener('click', function () {
          record.activeDistressSurfaceId = surface.id;
          scheduleSave();
          renderSurfaceList();
        });
        actions.appendChild(activateBtn);
      }

      row.appendChild(actions);
      return row;
    }

    function beginRename(row, surface) {
      row.innerHTML = '';
      row.classList.add('surface-row--editing');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'surface-rename-input';
      input.value = surface.name;
      row.appendChild(input);

      let settled = false;
      function commit() {
        if (settled) return;
        settled = true;
        const value = input.value.trim();
        if (value && value !== surface.name) {
          surface.name = value;
          surface.updatedAt = new Date().toISOString();
          scheduleSave();
        }
        renderSurfaceList();
      }

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          settled = true;
          renderSurfaceList();
        }
      });
      input.addEventListener('blur', commit);

      input.focus();
      input.select();
    }

    function renderAddControl() {
      addWrap.innerHTML = '<button type="button" id="surface-add-btn" class="btn btn--ghost">+ Add Surface</button>';
      addWrap.querySelector('#surface-add-btn').addEventListener('click', beginAdd);
    }

    function beginAdd() {
      addWrap.innerHTML =
        '<div class="surface-add-form">' +
        '  <input type="text" id="surface-add-input" placeholder="e.g. Basement, Second Floor" autocomplete="off">' +
        '  <button type="button" id="surface-add-confirm" class="btn btn--accent btn--small">Add</button>' +
        '  <button type="button" id="surface-add-cancel" class="btn btn--ghost btn--small">Cancel</button>' +
        '</div>';

      const input = addWrap.querySelector('#surface-add-input');
      const confirmBtn = addWrap.querySelector('#surface-add-confirm');
      const cancelBtn = addWrap.querySelector('#surface-add-cancel');

      function commit() {
        const value = input.value.trim();
        if (value) {
          record.distressSurfaces.push(blankSurface(value));
          scheduleSave();
        }
        renderAddControl();
        renderSurfaceList();
      }

      confirmBtn.addEventListener('click', commit);
      cancelBtn.addEventListener('click', function () {
        renderAddControl();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          renderAddControl();
        }
      });

      input.focus();
    }

    backBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/';
      });
    });

    continueBtn.addEventListener('click', function () {
      flushSave().then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/distress';
      });
    });

    window.ToolboxApp.wireSectionNav(app, id, flushSave);
    window.ToolboxApp.registerActiveFlush(flushSave);

    setStatus('Loading…');

    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      record = existing || window.ToolboxApp.blankCustomerFile(id);
      const changed = ensureDefaultSurface(record);
      updateIdentityBar();
      renderSurfaceList();
      renderAddControl();
      if (changed) {
        scheduleSave();
      } else {
        setStatus('Saved ' + window.ToolboxApp.customerIdentity.formatUpdated(record.updatedAt));
      }
    }).catch(function (err) {
      console.error('Failed to load Customer File for Plan Setup:', err);
      setStatus('Unable to load Plan Setup right now.');
    });
  }

  window.ToolboxPlanSetup = {
    renderPlanSetup: renderPlanSetup,
    ensureDefaultSurface: ensureDefaultSurface,
  };
})();
