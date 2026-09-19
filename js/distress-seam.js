// Toolbox — Distress capture seam (placeholder, not capture).
//
// This is the exact attachment point Plan Setup hands off to, and nothing
// more: given a Customer File id, it reads the surface roster Plan Setup
// maintains and shows the compact active-surface pill VISION.md §5
// describes ("Ground Floor ▾") over an empty canvas. It does not implement
// pins, photos, descriptions, or any other proven Distress capture
// behavior — when that capture is built, it replaces the placeholder body
// of this canvas and reads/writes the same active-surface pointer this
// pill already reads and writes.

(function () {
  'use strict';

  function renderDistressSeam(app, id) {
    app.innerHTML =
      '<div class="view-bar view-bar--file">' +
      '  <button type="button" id="seam-back" class="btn btn--ghost">‹ Plan Setup</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="seam-identity-name"></span>' +
      '    <span class="file-identity__address" id="seam-identity-address"></span>' +
      '  </div>' +
      '</div>' +
      '<div class="distress-seam-canvas">' +
      '  <div class="surface-pill-wrap">' +
      '    <button type="button" class="surface-pill" id="surface-pill" aria-haspopup="listbox" aria-expanded="false"></button>' +
      '    <ul class="surface-pill-menu" id="surface-pill-menu" role="listbox" hidden></ul>' +
      '  </div>' +
      '  <p class="distress-seam-placeholder">Proven Distress capture attaches here next — pins, photos, and descriptions for the active surface shown above.</p>' +
      '</div>';

    const backBtn = app.querySelector('#seam-back');
    const identityName = app.querySelector('#seam-identity-name');
    const identityAddress = app.querySelector('#seam-identity-address');
    const pillWrap = app.querySelector('.surface-pill-wrap');
    const pillBtn = app.querySelector('#surface-pill');
    const pillMenu = app.querySelector('#surface-pill-menu');

    let record = null;
    let pendingSave = Promise.resolve();

    function queueSave() {
      // Serialize writes so a quick sequence of surface changes cannot let
      // an older transaction finish after a newer choice. A failed write
      // remains visible to navigation/page lifecycle callers.
      pendingSave = pendingSave.catch(function () {
        // A new explicit change is also a retry opportunity.
      }).then(function () {
        record.updatedAt = new Date().toISOString();
        return window.ToolboxDB.saveCustomerFile(record);
      });
      return pendingSave;
    }

    window.ToolboxApp.registerActiveFlush(function () {
      return pendingSave;
    });

    backBtn.addEventListener('click', function () {
      pendingSave.then(function () {
        window.location.hash = '#/file/' + encodeURIComponent(id) + '/plan';
      }).catch(function (err) {
        console.error('Failed to save the active Distress surface:', err);
      });
    });

    function activeSurface() {
      if (!record || !Array.isArray(record.distressSurfaces)) return null;
      return record.distressSurfaces.find(function (s) {
        return s.id === record.activeDistressSurfaceId;
      }) || record.distressSurfaces[0] || null;
    }

    function closeMenu() {
      pillMenu.hidden = true;
      pillBtn.setAttribute('aria-expanded', 'false');
    }

    function renderPill() {
      const surface = activeSurface();
      pillBtn.textContent = (surface ? surface.name : 'No surface') + ' ▾';
      pillMenu.innerHTML = '';
      record.distressSurfaces.forEach(function (s) {
        const li = document.createElement('li');
        li.className = 'surface-pill-option';
        li.setAttribute('role', 'option');
        li.textContent = s.name;
        li.addEventListener('click', function () {
          record.activeDistressSurfaceId = s.id;
          closeMenu();
          renderPill();
          queueSave().catch(function (err) {
            console.error('Failed to save the active Distress surface:', err);
          });
        });
        pillMenu.appendChild(li);
      });
    }

    pillBtn.addEventListener('click', function () {
      const willOpen = pillMenu.hidden;
      pillMenu.hidden = !willOpen;
      pillBtn.setAttribute('aria-expanded', String(willOpen));
    });

    // Attached to the wrapper (not document) so it's discarded for free
    // when this view is torn down on navigation — no listener accumulates
    // across repeated visits to this route the way a document-level
    // listener registered on every render would.
    pillWrap.addEventListener('focusout', function (e) {
      if (!pillWrap.contains(e.relatedTarget)) closeMenu();
    });

    window.ToolboxDB.getCustomerFile(id).then(function (existing) {
      record = existing || window.ToolboxApp.blankCustomerFile(id);
      const changed = window.ToolboxPlanSetup.ensureDefaultSurface(record);
      identityName.textContent = window.ToolboxApp.customerIdentity.displayName(record);
      identityAddress.textContent = window.ToolboxApp.customerIdentity.displayAddress(record);
      renderPill();
      if (changed) {
        queueSave().catch(function (err) {
          console.error('Failed to save the default Distress surface:', err);
        });
      }
    }).catch(function (err) {
      console.error('Failed to load Customer File for the Distress seam:', err);
    });
  }

  window.ToolboxDistressSeam = {
    renderDistressSeam: renderDistressSeam,
  };
})();
