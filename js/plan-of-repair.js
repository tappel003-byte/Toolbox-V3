// Toolbox — Plan of Repair drawing template.
//
// Same doorway (top-bar Plan of Repair). Same Report Builder look: top tools,
// left pages, sheet, right panel, title rail. Drawing-first: bring in a plan
// or black-and-white contour, then use the shared pencil / rect / circle /
// arrow / text tools, resize, and copy/paste shapes.
//
// Document lives on record.planOfRepair (sync component `repair`). Does not
// write into reportBuilder.
(function () {
  'use strict';

  var PAPER_W = 1632;
  var PAPER_H = 1056;
  var TLS_MARK = 'brand/tls-foundations.jpg';
  var activeMount = null;

  function isoNow() { return new Date().toISOString(); }

  function uid(prefix) {
    return (prefix || 'por') + '-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function displayName(record) {
    var first = ((record && record.firstName) || '').trim();
    var last = ((record && record.lastName) || '').trim();
    var company = ((record && record.companyName) || '').trim();
    var name = (first + ' ' + last).trim();
    if (name && last && !/residence$/i.test(name)) return name + ' Residence';
    return name || company || 'Customer File';
  }

  function displayAddress(record) {
    return ((record && record.propertyAddress) || '').trim();
  }

  function blankPage(title) {
    return {
      id: uid('page'),
      title: title || 'Drawing',
      overlays: [],
      background: { kind: null, canvasId: '', mediaId: '', source: null, sourceStatus: null },
      meta: {},
      rail: {
        title: 'Preliminary Underpinning Plan',
        date: '',
        status: 'Preliminary — Subject to Structural Engineering',
        sheetId: '',
      },
    };
  }

  function probeImageSize(url) {
    return new Promise(function (resolve) {
      if (!url) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 });
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  function migrateLegacy(raw) {
    // Older pier-symbol document → one drawing page with circle overlays.
    if (!raw || !Array.isArray(raw.symbols) || !raw.symbols.length) return null;
    var page = blankPage('Plan of Repair');
    if (raw.canvasId) page.background = { kind: 'plan', canvasId: raw.canvasId };
    if (raw.rail) {
      page.rail.title = raw.rail.title || page.rail.title;
      page.rail.date = raw.rail.date || '';
      page.rail.status = raw.rail.status || page.rail.status;
      page.rail.sheetId = raw.rail.sheetId || '';
    }
    var size = clamp(raw.symbolSize != null ? raw.symbolSize : 2.4, 1.2, 8);
    var half = size / 2;
    (raw.symbols || []).forEach(function (sym) {
      if (!sym || !isFinite(Number(sym.x)) || !isFinite(Number(sym.y))) return;
      var cx = Number(sym.x) * 100 * 0.88 + 5;
      var cy = Number(sym.y) * 100 * 0.88 + 5;
      var def = (raw.symbolDefs || []).find(function (d) { return d && d.id === sym.defId; });
      var filledSquare = def && def.kind === 'circle-in-square';
      if (filledSquare) {
        page.overlays.push({
          id: uid('ov'),
          kind: 'rect',
          color: '#eab308',
          thick: 2,
          fill: true,
          x0: cx - half * 1.15,
          y0: cy - half * 1.15,
          x1: cx + half * 1.15,
          y1: cy + half * 1.15,
        });
      }
      page.overlays.push({
        id: uid('ov'),
        kind: 'circle',
        color: '#1d4ed8',
        thick: 2,
        fill: true,
        x0: cx - half,
        y0: cy - half,
        x1: cx + half,
        y1: cy + half,
      });
    });
    return {
      updatedAt: raw.updatedAt || '',
      schema: 'toolbox.plan-of-repair',
      schemaVersion: 2,
      activePageId: page.id,
      northRotation: (raw.rail && Number(raw.rail.northRotation)) || 0,
      pages: [page],
      showSandiaAttribution: !!(raw.rail && raw.rail.showSandiaAttribution),
    };
  }

  function normalizeDoc(raw) {
    if (raw && Array.isArray(raw.pages)) {
      var pages = raw.pages.map(function (p, i) {
        var page = blankPage((p && p.title) || ('Drawing ' + (i + 1)));
        if (p && p.id) page.id = p.id;
        page.overlays = window.ToolboxReportOverlay
          ? window.ToolboxReportOverlay.normalize(p.overlays || [])
          : (Array.isArray(p.overlays) ? p.overlays : []);
        page.background = p && p.background && typeof p.background === 'object'
          ? {
              kind: p.background.kind === 'contour' || p.background.kind === 'plan' ||
                p.background.kind === 'import'
                ? p.background.kind
                : null,
              canvasId: typeof p.background.canvasId === 'string' ? p.background.canvasId : '',
              mediaId: typeof p.background.mediaId === 'string' ? p.background.mediaId : '',
              source: p.background.source && typeof p.background.source === 'object'
                ? {
                    mediaId: typeof p.background.source.mediaId === 'string' ? p.background.source.mediaId : '',
                    width: Number(p.background.source.width) || 0,
                    height: Number(p.background.source.height) || 0,
                  }
                : null,
              sourceStatus: p.background.sourceStatus === 'changed' || p.background.sourceStatus === 'accepted'
                ? p.background.sourceStatus
                : null,
            }
          : { kind: null, canvasId: '', mediaId: '', source: null, sourceStatus: null };
        page.meta = p && p.meta && typeof p.meta === 'object' ? Object.assign({}, p.meta) : {};
        page.rail = Object.assign(page.rail, (p && p.rail) || {});
        if (!page.rail.sheetId) page.rail.sheetId = 'POR-' + (i + 1);
        return page;
      });
      if (!pages.length) pages = [blankPage('Drawing 1')];
      var active = typeof raw.activePageId === 'string' ? raw.activePageId : pages[0].id;
      if (!pages.some(function (p) { return p.id === active; })) active = pages[0].id;
      return {
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        schema: 'toolbox.plan-of-repair',
        schemaVersion: 2,
        activePageId: active,
        northRotation: isFinite(Number(raw.northRotation)) ? Number(raw.northRotation) : 0,
        pages: pages,
        showSandiaAttribution: !!raw.showSandiaAttribution,
      };
    }
    var migrated = migrateLegacy(raw);
    if (migrated) return migrated;
    var first = blankPage('Drawing 1');
    first.rail.sheetId = 'POR-1';
    return {
      updatedAt: '',
      schema: 'toolbox.plan-of-repair',
      schemaVersion: 2,
      activePageId: first.id,
      northRotation: 0,
      pages: [first],
      showSandiaAttribution: false,
    };
  }

  function fitScale(stageEl) {
    var wrap = stageEl && stageEl.querySelector
      ? stageEl
      : null;
    if (!wrap) return 1;
    var pad = 16;
    var availW = Math.max(240, wrap.clientWidth - pad);
    var availH = Math.max(180, wrap.clientHeight - pad);
    return Math.min(1, availW / PAPER_W, availH / PAPER_H);
  }

  function mount(host, opts) {
    opts = opts || {};
    unmount();
    var customerFileId = opts.customerFileId;
    var onBack = typeof opts.onBack === 'function' ? opts.onBack : function () {};
    document.body.classList.add('plan-of-repair-open');

    var root = document.createElement('div');
    root.className = 'por-shell rb-shell';
    host.appendChild(root);

    root.innerHTML =
      '<div class="view-bar view-bar--file rb-identity">' +
      '  <button type="button" id="por-back" class="btn btn--ghost">‹ TLS</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name">Plan of Repair</span>' +
      '    <span class="file-identity__address" id="por-file-label"></span>' +
      '  </div>' +
      '  <span class="file-status" id="por-status">Loading…</span>' +
      '</div>' +
      '<div class="rb-toolbar">' +
      '  <div class="rb-toolbar__format" data-rb-format-host></div>' +
      '  <label class="por-fill-toggle"><input type="checkbox" id="por-fill"> Fill shape</label>' +
      '  <div class="rb-zoom" role="group" aria-label="Page size on screen">' +
      '    <button type="button" id="por-zoom-out" class="rb-zoom__btn" aria-label="Zoom out">−</button>' +
      '    <button type="button" id="por-zoom-level" class="rb-zoom__level">Fit</button>' +
      '    <button type="button" id="por-zoom-in" class="rb-zoom__btn" aria-label="Zoom in">+</button>' +
      '  </div>' +
      '  <button type="button" id="por-print" class="btn btn--secondary rb-print-btn">Print / PDF</button>' +
      '</div>' +
      '<div class="rb-workspace">' +
      '  <aside class="rb-ws" aria-label="Drawing pages">' +
      '    <div class="rb-rail__head">' +
      '      <p class="eyebrow">Pages</p>' +
      '      <strong>Drawing sheets</strong>' +
      '      <span id="por-save-status">…</span>' +
      '    </div>' +
      '    <div class="rb-rail__list" id="por-page-list"></div>' +
      '    <div class="rb-rail__actions">' +
      '      <button type="button" id="por-add-page" class="btn btn--secondary">Add page</button>' +
      '      <button type="button" id="por-dup-page" class="btn btn--quiet">Duplicate</button>' +
      '      <button type="button" id="por-remove-page" class="btn btn--quiet">Remove</button>' +
      '    </div>' +
      '  </aside>' +
      '  <div class="rb-stage" id="por-stage">' +
      '    <div class="rb-stage__paper">' +
      '      <article class="rb-sheet" id="por-sheet" aria-label="11 by 17 inch landscape drawing sheet"></article>' +
      '    </div>' +
      '  </div>' +
      '  <aside class="rb-panel por-panel" aria-label="Toolbox">' +
      '    <p class="eyebrow">Toolbox</p>' +
      '    <h2 class="por-panel__title">Drawing</h2>' +
      '    <label class="por-panel__label" for="por-canvas">Level</label>' +
      '    <select id="por-canvas" class="por-bg-select" aria-label="Level or canvas"></select>' +
      '    <div class="por-bg-actions" role="group" aria-label="Background">' +
      '      <button type="button" class="por-linkbtn" id="por-bring-plan">Floor plan</button>' +
      '      <button type="button" class="por-linkbtn" id="por-bring-contour">Contour</button>' +
      '      <button type="button" class="por-linkbtn" id="por-import-bg">Import drawing</button>' +
      '      <button type="button" class="por-linkbtn" id="por-clear-bg">Clear</button>' +
      '      <input type="file" id="por-import-file" accept="image/*" hidden>' +
      '    </div>' +
      '    <div class="por-bg-actions" role="group" aria-label="Views on this sheet">' +
      '      <button type="button" class="por-linkbtn" id="por-add-view">Add detail view</button>' +
      '      <button type="button" class="por-linkbtn" id="por-remove-view">Remove detail</button>' +
      '    </div>' +
      '    <label class="por-fill-toggle por-fill-toggle--compact"><input type="checkbox" id="por-sandia"> SandiaGEO note</label>' +
      '    <div class="por-inspector" id="por-inspector" hidden>' +
      '      <h3 id="por-inspector-title" class="por-inspector__heading">Format Shape</h3>' +
      '      <div class="por-inspector__line">' +
      '        <label class="por-fill-toggle por-fill-toggle--compact"><input type="checkbox" id="por-shape-fill"> Fill</label>' +
      '        <div class="por-inspector__swatches" id="por-fill-swatches" aria-label="Fill colour"></div>' +
      '      </div>' +
      '      <div class="por-inspector__line">' +
      '        <span class="por-inspector__tag">Line</span>' +
      '        <div class="por-inspector__swatches" id="por-outline-swatches" aria-label="Outline colour"></div>' +
      '      </div>' +
      '      <div class="por-inspector__line">' +
      '        <span class="por-inspector__tag">Weight</span>' +
      '        <div class="por-seg" id="por-outline-weights" role="group" aria-label="Outline weight">' +
      '          <button type="button" class="por-seg__btn" data-por-thick="1" title="Thin">1</button>' +
      '          <button type="button" class="por-seg__btn" data-por-thick="2" title="Medium">2</button>' +
      '          <button type="button" class="por-seg__btn" data-por-thick="3" title="Thick">3</button>' +
      '        </div>' +
      '      </div>' +
      '      <h3 class="por-inspector__heading">Size &amp; Position</h3>' +
      '      <div class="por-inspector__size" aria-label="Size and position in inches">' +
      '        <label class="por-inspector__field"><span>X</span><input type="number" id="por-size-x" step="0.05" min="0" max="17"></label>' +
      '        <label class="por-inspector__field"><span>Y</span><input type="number" id="por-size-y" step="0.05" min="0" max="11"></label>' +
      '        <label class="por-inspector__field"><span>W</span><input type="number" id="por-size-w" step="0.05" min="0.1" max="17"></label>' +
      '        <label class="por-inspector__field"><span>H</span><input type="number" id="por-size-h" step="0.05" min="0.1" max="11"></label>' +
      '      </div>' +
      '      <div class="por-stack" role="group" aria-label="Arrange">' +
      '        <button type="button" class="por-stack__btn" id="por-stack-front" title="Bring to Front">Front</button>' +
      '        <button type="button" class="por-stack__btn" id="por-stack-forward" title="Bring Forward">Forward</button>' +
      '        <button type="button" class="por-stack__btn" id="por-stack-backward" title="Send Backward">Back</button>' +
      '        <button type="button" class="por-stack__btn" id="por-stack-back" title="Send to Back">Bottom</button>' +
      '      </div>' +
      '    </div>' +
      '  </aside>' +
      '</div>';

    var state = {
      record: null,
      doc: normalizeDoc(null),
      readOnly: false,
      dirty: false,
      saveTimer: null,
      undo: [],
      redo: [],
      inkTool: null,
      inkThick: 2,
      inkColor: '#1d4ed8',
      inkFill: false,
      inkDrag: null,
      selectedId: null,
      clipboard: null,
      bgUrl: '',
      bgMissing: false,
      bgMissingByPageId: {},
      printMode: false,
      scale: 1,
      zoomMode: 'fit',
      userScale: 1,
      drag: null,
      selectedViewIndex: null,
      formatToolbar: null,
      shapeMenu: null,
      inspectorMode: 'format', // format | size
      fillColor: '#eab308',
      editSeq: 0,
    };

    var sheetEl = root.querySelector('#por-sheet');
    var stageEl = root.querySelector('#por-stage');
    var statusEl = root.querySelector('#por-status');
    var saveEl = root.querySelector('#por-save-status');
    var fillInput = root.querySelector('#por-fill');
    var sandiaInput = root.querySelector('#por-sandia');
    var canvasSelect = root.querySelector('#por-canvas');
    var inspectorEl = root.querySelector('#por-inspector');
    var shapeFillInput = root.querySelector('#por-shape-fill');
    var INCH_W = 17;
    var INCH_H = 11;
    var HANDLE_CORNERS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text || '';
      if (saveEl) saveEl.textContent = text || '';
    }

    function activePage() {
      var pages = state.doc.pages;
      for (var i = 0; i < pages.length; i++) if (pages[i].id === state.doc.activePageId) return pages[i];
      return pages[0];
    }

    function pushHistory() {
      state.undo.push(deepClone(state.doc));
      if (state.undo.length > 80) state.undo.shift();
      state.redo = [];
      syncHistoryButtons();
    }

    function syncHistoryButtons() {
      if (state.formatToolbar && state.formatToolbar.setHistory) {
        state.formatToolbar.setHistory(state.undo.length > 0, state.redo.length > 0);
      }
    }

    function applyHistory(doc) {
      state.doc = normalizeDoc(doc);
      state.selectedId = null;
      scheduleSave();
      renderAll();
    }

    function undo() {
      if (!state.undo.length || state.readOnly) return;
      state.redo.push(deepClone(state.doc));
      applyHistory(state.undo.pop());
    }

    function redo() {
      if (!state.redo.length || state.readOnly) return;
      state.undo.push(deepClone(state.doc));
      applyHistory(state.redo.pop());
    }

    function scheduleSave() {
      if (state.readOnly) return;
      state.dirty = true;
      state.editSeq += 1;
      var seq = state.editSeq;
      setStatus('Saving…');
      if (state.saveTimer) clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(function () {
        state.saveTimer = null;
        persistNow(seq);
      }, 320);
    }

    function persistNow(expectedSeq) {
      if (!state.record || state.readOnly) return Promise.resolve();
      var seq = expectedSeq != null ? expectedSeq : state.editSeq;
      // A newer edit landed while we were waiting — that edit owns the next save.
      if (seq !== state.editSeq) return Promise.resolve();
      var doc = normalizeDoc(state.doc);
      if (seq !== state.editSeq) return Promise.resolve();
      doc.updatedAt = isoNow();
      state.doc = doc;
      state.record.planOfRepair = doc;
      state.record.updatedAt = doc.updatedAt;
      return window.ToolboxDB.saveCustomerFile(state.record).then(function () {
        if (seq === state.editSeq) {
          state.dirty = false;
          setStatus('Saved');
        }
      }).catch(function (err) {
        console.error(err);
        setStatus('Save failed');
      });
    }

    function overlayApi() { return window.ToolboxReportOverlay; }

    function overlayList(page) {
      if (!page.overlays) page.overlays = [];
      return page.overlays;
    }

    function applySheetScale() {
      var paper = stageEl.querySelector('.rb-stage__paper');
      var scale = state.zoomMode === 'fit'
        ? fitScale(stageEl)
        : clamp(state.userScale, 0.35, 2.4);
      state.scale = scale;
      sheetEl.style.transform = 'scale(' + scale + ')';
      if (paper) {
        paper.style.width = (PAPER_W * scale) + 'px';
        paper.style.height = (PAPER_H * scale) + 'px';
      }
      var level = root.querySelector('#por-zoom-level');
      if (level) level.textContent = state.zoomMode === 'fit' ? 'Fit' : Math.round(scale * 100) + '%';
    }

    function acceptBgUrl(url) {
      return typeof url === 'string' && url && (
        url.indexOf('data:image/') === 0 ||
        url.indexOf('blob:') === 0 ||
        url.indexOf('http') === 0
      );
    }

    function resolveBackgroundMediaId(page) {
      var bg = page && page.background;
      if (!bg || !bg.kind || !state.record) return null;
      if (bg.kind === 'import') return bg.mediaId || null;
      if (!bg.canvasId) return null;
      var canvas = window.ToolboxPlanSetup && window.ToolboxPlanSetup.canvasById
        ? window.ToolboxPlanSetup.canvasById(state.record, bg.canvasId)
        : null;
      if (!canvas) return null;
      if (bg.kind === 'plan' && canvas.plan && canvas.plan.id) return canvas.plan.id;
      if (bg.kind === 'contour') {
        var layer = window.ToolboxPlanSetup.contourLayer
          ? window.ToolboxPlanSetup.contourLayer(canvas)
          : (canvas.contourLayer || null);
        if (layer && layer.id) return layer.id;
      }
      return null;
    }

    function applySourceProbe(page, mediaId, url) {
      return probeImageSize(url).then(function (size) {
        if (!page.background) return;
        var next = {
          mediaId: mediaId || '',
          width: size && size.width || 0,
          height: size && size.height || 0,
        };
        var prev = page.background.source;
        if (!prev || !prev.mediaId) {
          page.background.source = next;
          if (page.background.sourceStatus === 'changed') page.background.sourceStatus = null;
          return;
        }
        var changed = prev.mediaId !== next.mediaId ||
          (prev.width && next.width && prev.width !== next.width) ||
          (prev.height && next.height && prev.height !== next.height);
        if (changed) {
          if (page.background.sourceStatus !== 'accepted') {
            page.background.sourceStatus = 'changed';
          }
          // Keep prev.source until Tim accepts, but track live id for accept.
          page.background._liveSource = next;
        } else {
          page.background.source = next;
          page.background.sourceStatus = null;
          delete page.background._liveSource;
        }
      });
    }

    function markBgMissing(page, missing) {
      state.bgMissing = !!missing;
      if (page && page.id) state.bgMissingByPageId[page.id] = !!missing;
    }

    function loadBackground() {
      state.bgUrl = '';
      state.bgMissing = false;
      var page = activePage();
      var bg = page && page.background;
      if (!bg || !bg.kind || !state.record) {
        if (page && page.id) state.bgMissingByPageId[page.id] = false;
        return Promise.resolve();
      }
      var mediaId = resolveBackgroundMediaId(page);
      if (!mediaId || !window.ToolboxDB || !window.ToolboxDB.getMedia) {
        markBgMissing(page, !!bg.kind);
        return Promise.resolve();
      }
      return window.ToolboxDB.getMedia(mediaId).then(function (url) {
        if (acceptBgUrl(url)) {
          state.bgUrl = url;
          markBgMissing(page, false);
          return applySourceProbe(page, mediaId, url);
        }
        markBgMissing(page, true);
      }).catch(function () { markBgMissing(page, true); });
    }

    function defaultViewCamera(zoom) {
      return { cx: 0.5, cy: 0.5, zoom: Number(zoom) > 0 ? Number(zoom) : 1, rel: true };
    }

    function viewCamera(view) {
      if (view && view.camera && typeof view.camera === 'object' && Number(view.camera.zoom) > 0) {
        return {
          cx: isFinite(Number(view.camera.cx)) ? Number(view.camera.cx) : 0.5,
          cy: isFinite(Number(view.camera.cy)) ? Number(view.camera.cy) : 0.5,
          zoom: Number(view.camera.zoom),
          rel: true,
        };
      }
      return defaultViewCamera(1);
    }

    /** Position the background image inside a view frame from a relative camera. */
    function applyViewCamera(img, host, camera) {
      if (!img || !host) return;
      var tries = 0;
      function layout() {
        var fw = host.clientWidth;
        var fh = host.clientHeight;
        var iw = img.naturalWidth || 0;
        var ih = img.naturalHeight || 0;
        if ((fw < 2 || fh < 2 || iw < 1 || ih < 1) && tries < 20) {
          tries += 1;
          requestAnimationFrame(layout);
          return;
        }
        if (fw < 2 || fh < 2 || iw < 1 || ih < 1) return;
        var cam = camera || defaultViewCamera(1);
        var zoom = Number(cam.zoom) > 0 ? Number(cam.zoom) : 1;
        var cx = isFinite(Number(cam.cx)) ? Number(cam.cx) : 0.5;
        var cy = isFinite(Number(cam.cy)) ? Number(cam.cy) : 0.5;
        var base = Math.min(fw / iw, fh / ih);
        var scale = base * zoom;
        var dispW = iw * scale;
        var dispH = ih * scale;
        img.style.position = 'absolute';
        img.style.width = dispW + 'px';
        img.style.height = dispH + 'px';
        img.style.maxWidth = 'none';
        img.style.objectFit = 'fill';
        img.style.left = (fw / 2 - cx * dispW) + 'px';
        img.style.top = (fh / 2 - cy * dispH) + 'px';
      }
      if (img.complete && img.naturalWidth) layout();
      else {
        img.addEventListener('load', layout, { once: true });
        img.addEventListener('error', layout, { once: true });
      }
    }

    function waitForSheetImages() {
      var imgs = sheetEl.querySelectorAll('.por-view-frame img, .por-sheet-bg > img');
      return Promise.all(Array.prototype.map.call(imgs, function (img) {
        if (img.complete) return Promise.resolve();
        return new Promise(function (resolve) {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })).then(function () {
        var page = activePage();
        var viewsApi = window.ToolboxReportFloorViews;
        var views = (viewsApi && page && page.meta) ? viewsApi.viewsFor(page) : [];
        if (views && views.length > 1) {
          sheetEl.querySelectorAll('.por-view-frame').forEach(function (host) {
            var vi = Number(host.getAttribute('data-por-view'));
            var img = host.querySelector('img');
            applyViewCamera(img, host, viewCamera(views[vi]));
          });
        }
      });
    }

    function acceptSourceReplacement(page) {
      if (!page || !page.background) return;
      if (page.background._liveSource) {
        page.background.source = page.background._liveSource;
        delete page.background._liveSource;
      }
      page.background.sourceStatus = null;
      scheduleSave();
      renderSheet();
      setStatus('Replacement accepted for this sheet');
    }

    function renderPageList() {
      var list = root.querySelector('#por-page-list');
      list.innerHTML = '';
      state.doc.pages.forEach(function (page, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rb-rail__page' + (page.id === state.doc.activePageId ? ' is-active' : '');
        btn.textContent = (index + 1) + '. ' + (page.title || 'Drawing');
        btn.addEventListener('click', function () {
          if (page.id === state.doc.activePageId) return;
          state.doc.activePageId = page.id;
          state.selectedId = null;
          loadBackground().then(renderSheet);
          renderPageList();
        });
        list.appendChild(btn);
      });
    }

    function renderCanvasOptions() {
      canvasSelect.innerHTML = '';
      var canvases = (state.record && state.record.planSetup && state.record.planSetup.canvases) || [];
      canvases.forEach(function (canvas) {
        if (!window.ToolboxPlanSetup || !window.ToolboxPlanSetup.hasUsablePlan(canvas)) return;
        var opt = document.createElement('option');
        opt.value = canvas.id;
        var hasContour = !!(window.ToolboxPlanSetup.contourLayer && window.ToolboxPlanSetup.contourLayer(canvas));
        opt.textContent = (canvas.name || 'Plan') + (hasContour ? '' : '');
        canvasSelect.appendChild(opt);
      });
      if (!canvasSelect.options.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'No plan on this file';
        canvasSelect.appendChild(empty);
      }
      var page = activePage();
      if (page && page.background && page.background.canvasId) {
        canvasSelect.value = page.background.canvasId;
      }
    }

    function renderRail(page) {
      var railApi = window.ToolboxReportRail;
      if (!railApi || !railApi.render) return null;
      var today = new Date();
      var dateStr = page.rail.date || ((today.getMonth() + 1) + '/' + today.getDate() + '/' + today.getFullYear());
      if (!page.rail.date) page.rail.date = dateStr;
      var rail = railApi.render({
        residence: displayName(state.record),
        address: displayAddress(state.record),
        title: page.rail.title || 'Preliminary Underpinning Plan',
        surveyDate: dateStr,
        correctedNote: page.rail.status || '',
        figureLabel: page.rail.sheetId || 'POR',
        northRotation: state.doc.northRotation || 0,
        markSrc: TLS_MARK,
        editable: !state.readOnly,
        stats: [],
      });
      // Retitle the survey-date section label visually via CSS isn't available;
      // the correctedNote line carries status. Swap logo alt.
      var logo = rail.querySelector('.rb-rail__logo');
      if (logo) logo.alt = 'TLS Foundations';
      if (state.doc.showSandiaAttribution) {
        var sandia = document.createElement('img');
        sandia.src = 'brand/sandia-geo.png';
        sandia.alt = 'Sandia GEO';
        sandia.className = 'rb-rail__logo';
        sandia.style.marginTop = '6px';
        var note = document.createElement('p');
        note.className = 'rb-rail__note';
        note.textContent = 'Survey information by SandiaGEO';
        rail.querySelector('.rb-rail__foot').appendChild(sandia);
        rail.querySelector('.rb-rail__foot').appendChild(note);
      }
      return rail;
    }

    function renderSheet() {
      var page = activePage();
      var api = overlayApi();
      sheetEl.innerHTML = '';
      sheetEl.classList.toggle('rb-sheet--inking', !!state.inkTool);
      sheetEl.classList.toggle('rb-sheet--erasing', state.inkTool === 'eraser');

      var frame = document.createElement('div');
      frame.className = 'rb-sheet__frame';
      frame.setAttribute('aria-hidden', 'true');
      // Reuse sheet border treatment from RB via CSS if present; otherwise a
      // simple POR frame.
      frame.style.cssText = 'position:absolute;inset:10px;border:1.5px solid #5c4a32;pointer-events:none;z-index:4;';
      sheetEl.appendChild(frame);

      var bg = document.createElement('div');
      bg.className = 'por-sheet-bg';
      var viewsApi = window.ToolboxReportFloorViews;
      var views = (viewsApi && page.meta) ? viewsApi.viewsFor(page) : [];
      var multi = views && views.length > 1;
      if (state.bgUrl && multi) {
        views.forEach(function (view, vi) {
          var frame = view && view.frame ? view.frame : { x: 5, y: 5, w: 40, h: 40 };
          var host = document.createElement('div');
          host.className = 'por-view-frame' +
            (!state.printMode && state.selectedViewIndex === vi ? ' is-selected' : '');
          host.setAttribute('data-por-view', String(vi));
          host.style.left = frame.x + '%';
          host.style.top = frame.y + '%';
          host.style.width = frame.w + '%';
          host.style.height = frame.h + '%';
          host.style.zIndex = String((frame.z || 1) + 1);
          var img = document.createElement('img');
          img.src = state.bgUrl;
          img.alt = 'View ' + (vi + 1);
          img.draggable = false;
          host.appendChild(img);
          var label = document.createElement('span');
          label.className = 'por-view-frame__label';
          label.setAttribute('data-por-view-move', String(vi));
          label.textContent = vi === 0 ? 'Overall' : ('Detail ' + vi);
          host.appendChild(label);
          if (!state.printMode && !state.readOnly) {
            var move = document.createElement('button');
            move.type = 'button';
            move.className = 'por-view-frame__move';
            move.setAttribute('data-por-view-move', String(vi));
            move.title = 'Drag to move this view frame';
            move.textContent = 'Move';
            host.appendChild(move);
            ['nw', 'ne', 'se', 'sw'].forEach(function (corner) {
              var handle = document.createElement('span');
              handle.className = 'por-view-frame__handle por-view-frame__handle--' + corner;
              handle.setAttribute('data-por-view-resize', String(vi));
              handle.setAttribute('data-por-corner', corner);
              host.appendChild(handle);
            });
          }
          bg.appendChild(host);
          applyViewCamera(img, host, viewCamera(view));
        });
      } else if (state.bgUrl) {
        var img = document.createElement('img');
        img.src = state.bgUrl;
        img.alt = page.background && page.background.kind === 'contour'
          ? 'Contour'
          : (page.background && page.background.kind === 'import' ? 'Imported drawing' : 'Floor plan');
        bg.appendChild(img);
      } else if (!state.printMode) {
        var empty = document.createElement('p');
        empty.className = 'por-sheet-bg__empty';
        empty.textContent = state.bgMissing
          ? 'Referenced background is missing — review before print.'
          : 'Blank sheet, or bring in a floor plan, contour, or imported drawing.';
        bg.appendChild(empty);
      }
      sheetEl.appendChild(bg);

      if (!state.printMode && page.background && page.background.sourceStatus === 'changed') {
        var banner = document.createElement('div');
        banner.className = 'por-source-banner';
        banner.innerHTML =
          '<span>Background source changed under this drawing.</span>' +
          '<button type="button" class="btn btn--secondary" data-por-accept-source="1">Review / accept replacement</button>';
        var acceptBtn = banner.querySelector('[data-por-accept-source]');
        if (acceptBtn) {
          acceptBtn.addEventListener('click', function () {
            if (state.readOnly) return;
            pushHistory();
            acceptSourceReplacement(page);
          });
        }
        sheetEl.appendChild(banner);
      }

      var rail = renderRail(page);
      if (rail) sheetEl.appendChild(rail);

      if (api && typeof api.renderLayer === 'function') {
        var layer = api.renderLayer(overlayList(page), { locked: state.readOnly });
        if (layer) sheetEl.appendChild(layer);
      }

      if (state.selectedId) renderSelectionChrome(page);
      applySheetScale();
      wireRailEdits(page);
      wireOverlayText(page);
      syncInspector();
    }

    function wireRailEdits(page) {
      sheetEl.querySelectorAll('[data-rb-rail-field]').forEach(function (el) {
        el.addEventListener('blur', function () {
          if (state.readOnly) return;
          var key = el.getAttribute('data-rb-rail-field');
          var text = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
          pushHistory();
          if (key === 'title') page.rail.title = text || 'Preliminary Underpinning Plan';
          else if (key === 'date') page.rail.date = text;
          else if (key === 'corrected') page.rail.status = text;
          else if (key === 'figure') page.rail.sheetId = text || page.rail.sheetId;
          scheduleSave();
        });
      });
      var compass = sheetEl.querySelector('.rb-rail__compass');
      if (compass && !state.readOnly) {
        compass.style.cursor = 'grab';
        compass.title = 'Drag sideways to rotate north';
        compass.addEventListener('pointerdown', function (event) {
          event.preventDefault();
          pushHistory();
          var startX = event.clientX;
          var startDeg = state.doc.northRotation || 0;
          function move(ev) {
            state.doc.northRotation = startDeg + (ev.clientX - startX) * 0.4;
            renderSheet();
          }
          function up() {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            scheduleSave();
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
    }

    function itemBounds(item) {
      if (!item) return null;
      if (typeof item.x0 === 'number') {
        return {
          x: Math.min(item.x0, item.x1),
          y: Math.min(item.y0, item.y1),
          w: Math.abs(item.x1 - item.x0) || 1,
          h: Math.abs(item.y1 - item.y0) || 1,
        };
      }
      if (typeof item.x === 'number') {
        return { x: item.x, y: item.y, w: item.w || 8, h: item.h || 8 };
      }
      if (Array.isArray(item.points) && item.points.length) {
        var xs = item.points.map(function (p) { return p[0]; });
        var ys = item.points.map(function (p) { return p[1]; });
        var minX = Math.min.apply(null, xs);
        var maxX = Math.max.apply(null, xs);
        var minY = Math.min.apply(null, ys);
        var maxY = Math.max.apply(null, ys);
        return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
      }
      return null;
    }

    function applyBounds(item, box, oldBox) {
      if (!item || !box) return;
      var next = {
        x: clamp(box.x, -5, 105),
        y: clamp(box.y, -5, 105),
        w: clamp(box.w, 0.6, 100),
        h: clamp(box.h, 0.6, 100),
      };
      if (typeof item.x0 === 'number') {
        item.x0 = next.x;
        item.y0 = next.y;
        item.x1 = next.x + next.w;
        item.y1 = next.y + next.h;
        return;
      }
      if (typeof item.x === 'number') {
        item.x = next.x;
        item.y = next.y;
        item.w = next.w;
        item.h = next.h;
        return;
      }
      if (Array.isArray(item.points) && oldBox && oldBox.w > 0.01 && oldBox.h > 0.01) {
        item.points = item.points.map(function (p) {
          var rx = (p[0] - oldBox.x) / oldBox.w;
          var ry = (p[1] - oldBox.y) / oldBox.h;
          return [next.x + rx * next.w, next.y + ry * next.h];
        });
      }
    }

    function resizeBoxFromHandle(origBox, corner, dx, dy) {
      var box = { x: origBox.x, y: origBox.y, w: origBox.w, h: origBox.h };
      var right = origBox.x + origBox.w;
      var bottom = origBox.y + origBox.h;
      if (corner.indexOf('w') !== -1) box.x = origBox.x + dx;
      if (corner.indexOf('n') !== -1) box.y = origBox.y + dy;
      if (corner.indexOf('e') !== -1) box.w = origBox.w + dx;
      else if (corner.indexOf('w') !== -1) box.w = right - box.x;
      if (corner.indexOf('s') !== -1) box.h = origBox.h + dy;
      else if (corner.indexOf('n') !== -1) box.h = bottom - box.y;
      if (box.w < 0.6) {
        if (corner.indexOf('w') !== -1) box.x = right - 0.6;
        box.w = 0.6;
      }
      if (box.h < 0.6) {
        if (corner.indexOf('n') !== -1) box.y = bottom - 0.6;
        box.h = 0.6;
      }
      return box;
    }

    function selectedItem() {
      var page = activePage();
      if (!page || !state.selectedId) return null;
      return overlayList(page).find(function (o) { return o.id === state.selectedId; }) || null;
    }

    function applyInspectorColor(role, color) {
      if (state.readOnly || !color || !state.selectedId) {
        setStatus(!state.selectedId ? 'No shape selected' : 'Can’t format');
        return false;
      }
      var page = activePage();
      var list = overlayList(page);
      var index = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === state.selectedId) { index = i; break; }
      }
      if (index < 0) {
        setStatus('No shape selected');
        return false;
      }
      var item = list[index];
      var canFill = item.kind === 'rect' || item.kind === 'circle';
      pushHistory();
      // Re-resolve after history snapshot — never mutate a detached copy.
      list = overlayList(activePage());
      item = null;
      for (i = 0; i < list.length; i++) {
        if (list[i].id === state.selectedId) { item = list[i]; break; }
      }
      if (!item) return false;
      if (role === 'fill') {
        if (!canFill) return false;
        item.fill = true;
        item.fillColor = color;
        shapeFillInput.checked = true;
        state.fillColor = color;
      } else if (role === 'outline') {
        item.color = color;
        state.inkColor = color;
      } else {
        return false;
      }
      scheduleSave();
      renderSheet();
      setStatus(role === 'fill' ? 'Fill updated' : 'Outline updated');
      return true;
    }

    function paintSwatches(host, selected, role) {
      host.innerHTML = '';
      var colors = (overlayApi() && overlayApi().COLORS) || ['#c14a2b', '#111111', '#1d4ed8', '#16a34a', '#ea7317', '#eab308'];
      colors.forEach(function (c) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'por-inspector__swatch' + (c === selected ? ' is-on' : '');
        btn.style.background = c;
        btn.title = c;
        btn.setAttribute('data-por-swatch', role);
        btn.setAttribute('data-por-color', c);
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          applyInspectorColor(role, c);
        });
        host.appendChild(btn);
      });
    }

    function syncInspector() {
      var item = selectedItem();
      if (!inspectorEl) return;
      if (!item) {
        inspectorEl.hidden = true;
        return;
      }
      inspectorEl.hidden = false;
      var title = root.querySelector('#por-inspector-title');
      if (title) {
        title.textContent = state.inspectorMode === 'size' ? 'Size and Position' : 'Format Shape';
      }
      var canFill = item.kind === 'rect' || item.kind === 'circle';
      shapeFillInput.disabled = !canFill || state.readOnly;
      shapeFillInput.checked = !!(item.fill && canFill);
      var fillColor = item.fillColor || item.color || state.fillColor;
      var outline = item.color || state.inkColor;
      paintSwatches(root.querySelector('#por-fill-swatches'), fillColor, 'fill');
      paintSwatches(root.querySelector('#por-outline-swatches'), outline, 'outline');
      root.querySelectorAll('[data-por-thick]').forEach(function (btn) {
        var level = Number(btn.getAttribute('data-por-thick'));
        btn.classList.toggle('is-on', level === item.thick);
      });
      var box = itemBounds(item);
      if (box) {
        root.querySelector('#por-size-x').value = (box.x / 100 * INCH_W).toFixed(2);
        root.querySelector('#por-size-y').value = (box.y / 100 * INCH_H).toFixed(2);
        root.querySelector('#por-size-w').value = (box.w / 100 * INCH_W).toFixed(2);
        root.querySelector('#por-size-h').value = (box.h / 100 * INCH_H).toFixed(2);
      }
      ['por-size-x', 'por-size-y', 'por-size-w', 'por-size-h'].forEach(function (id) {
        root.querySelector('#' + id).disabled = state.readOnly;
      });
      root.querySelectorAll('.por-stack__btn, .por-linkbtn').forEach(function (btn) {
        btn.disabled = state.readOnly;
      });
    }

    function applySizeFields() {
      var item = selectedItem();
      if (!item || state.readOnly) return;
      var old = itemBounds(item);
      var next = {
        x: (Number(root.querySelector('#por-size-x').value) / INCH_W) * 100,
        y: (Number(root.querySelector('#por-size-y').value) / INCH_H) * 100,
        w: (Number(root.querySelector('#por-size-w').value) / INCH_W) * 100,
        h: (Number(root.querySelector('#por-size-h').value) / INCH_H) * 100,
      };
      if (![next.x, next.y, next.w, next.h].every(isFinite)) return;
      pushHistory();
      applyBounds(item, next, old);
      var api = overlayApi();
      if (api) activePage().overlays = api.normalize(overlayList(activePage()));
      scheduleSave();
      renderSheet();
    }

    function reorderSelected(where) {
      if (state.readOnly || !state.selectedId) return;
      var page = activePage();
      var list = overlayList(page).slice();
      var index = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === state.selectedId) { index = i; break; }
      }
      if (index < 0) return;
      var item = list.splice(index, 1)[0];
      if (where === 'front') list.push(item);
      else if (where === 'back') list.unshift(item);
      else if (where === 'forward') list.splice(Math.min(list.length, index + 1), 0, item);
      else if (where === 'backward') list.splice(Math.max(0, index - 1), 0, item);
      else return;
      pushHistory();
      page.overlays = list;
      scheduleSave();
      renderSheet();
      setStatus(where === 'front' || where === 'forward' ? 'Brought forward' : 'Sent back');
    }

    function renderSelectionChrome(page) {
      var item = overlayList(page).find(function (o) { return o.id === state.selectedId; });
      var box = itemBounds(item);
      if (!box) return;
      var sel = document.createElement('div');
      sel.className = 'por-sel';
      sel.style.left = box.x + '%';
      sel.style.top = box.y + '%';
      sel.style.width = box.w + '%';
      sel.style.height = box.h + '%';
      HANDLE_CORNERS.forEach(function (corner) {
        var handle = document.createElement('span');
        handle.className = 'por-sel__handle por-sel__handle--' + corner;
        handle.setAttribute('data-por-resize', state.selectedId);
        handle.setAttribute('data-por-corner', corner);
        sel.appendChild(handle);
      });
      sheetEl.appendChild(sel);
    }

    function renderAll() {
      renderPageList();
      renderCanvasOptions();
      fillInput.checked = !!state.inkFill;
      sandiaInput.checked = !!state.doc.showSandiaAttribution;
      loadBackground().then(renderSheet);
      syncHistoryButtons();
    }

    function sheetPercent(event) {
      var rect = sheetEl.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
    }

    function setInkTool(name) {
      state.inkTool = name || null;
      if (state.formatToolbar && state.formatToolbar.setTool) {
        state.formatToolbar.setTool(state.inkTool);
      }
      renderSheet();
    }

    function beginInk(event) {
      var page = activePage();
      var api = overlayApi();
      if (!page || !api || !state.inkTool || state.inkTool === 'eraser' || state.readOnly) return;
      var at = sheetPercent(event);
      if (!at) return;
      event.preventDefault();
      pushHistory();
      var item = {
        id: uid('ov'),
        kind: state.inkTool === 'pencil' ? 'path' : state.inkTool,
        color: state.inkColor,
        thick: state.inkThick,
      };
      if (state.inkFill && (item.kind === 'rect' || item.kind === 'circle')) {
        item.fill = true;
        item.fillColor = state.fillColor || state.inkColor;
      }
      if (item.kind === 'path') item.points = [[at.x, at.y]];
      else { item.x0 = at.x; item.y0 = at.y; item.x1 = at.x; item.y1 = at.y; }
      overlayList(page).push(item);
      state.inkDrag = { id: item.id };
      state.selectedId = item.id;
      renderSheet();
    }

    function moveInk(event) {
      if (!state.inkDrag) return;
      var page = activePage();
      var item = overlayList(page).find(function (o) { return o.id === state.inkDrag.id; });
      var at = sheetPercent(event);
      if (!item || !at) return;
      if (item.kind === 'path') {
        var last = item.points[item.points.length - 1];
        if (!last || Math.hypot(at.x - last[0], at.y - last[1]) > 0.2) {
          item.points.push([at.x, at.y]);
        }
      } else {
        item.x1 = at.x;
        item.y1 = at.y;
      }
      renderSheet();
    }

    function endInk() {
      if (!state.inkDrag) return;
      state.inkDrag = null;
      var page = activePage();
      var api = overlayApi();
      if (api) page.overlays = api.normalize(overlayList(page));
      // One-shot draw: return to Select so the next click adjusts, not stacks.
      if (state.inkTool && state.inkTool !== 'pencil' && state.inkTool !== 'eraser') {
        setInkTool(null);
      }
      scheduleSave();
      renderSheet();
    }

    function commitOverlayText(field) {
      if (!field || state.readOnly) return false;
      var ovId = field.getAttribute('data-rb-ov-field');
      if (!ovId) return false;
      var page = activePage();
      var list = overlayList(page);
      var item = list.find(function (o) { return o.id === ovId; });
      if (!item || item.kind !== 'text') return false;
      var textApi = window.ToolboxReportText;
      var next = textApi && typeof textApi.fromElement === 'function'
        ? (textApi.compact ? textApi.compact(textApi.fromElement(field)) : textApi.fromElement(field))
        : (field.textContent || '');
      if (item.text === next) return false;
      pushHistory();
      item.text = next;
      scheduleSave();
      return true;
    }

    function wireOverlayText(page) {
      sheetEl.querySelectorAll('[data-rb-ov-field]').forEach(function (field) {
        if (field.getAttribute('data-por-text-wired') === '1') return;
        field.setAttribute('data-por-text-wired', '1');
        field.addEventListener('blur', function () {
          commitOverlayText(field);
        });
      });
    }

    function eraseAt(event) {
      var target = event.target.closest && event.target.closest('[data-rb-ov]');
      if (!target) return;
      var id = target.getAttribute('data-rb-ov');
      var page = activePage();
      pushHistory();
      page.overlays = overlayList(page).filter(function (o) { return o.id !== id; });
      if (state.selectedId === id) state.selectedId = null;
      scheduleSave();
      renderSheet();
    }

    function selectAt(event) {
      var target = event.target.closest && event.target.closest('[data-rb-ov]');
      if (!target) {
        state.selectedId = null;
        renderSheet();
        return false;
      }
      state.selectedId = target.getAttribute('data-rb-ov');
      renderSheet();
      return true;
    }

    function copySelected() {
      var item = selectedItem();
      if (!item) return false;
      state.clipboard = deepClone(item);
      setStatus('Shape copied');
      return true;
    }

    function cutSelected() {
      if (state.readOnly || !selectedItem()) return false;
      if (!copySelected()) return false;
      deleteSelected();
      setStatus('Shape cut');
      return true;
    }

    function pasteClipboard() {
      if (state.readOnly || !state.clipboard) return false;
      var page = activePage();
      pushHistory();
      var copy = deepClone(state.clipboard);
      copy.id = uid('ov');
      if (typeof copy.x0 === 'number') {
        copy.x0 += 2; copy.y0 += 2; copy.x1 += 2; copy.y1 += 2;
      } else if (typeof copy.x === 'number') {
        copy.x += 2; copy.y += 2;
      } else if (Array.isArray(copy.points)) {
        copy.points = copy.points.map(function (p) { return [p[0] + 2, p[1] + 2]; });
      }
      overlayList(page).push(copy);
      state.selectedId = copy.id;
      scheduleSave();
      renderSheet();
      setStatus('Shape pasted');
      return true;
    }

    function deleteSelected() {
      if (state.readOnly || !state.selectedId) return;
      var page = activePage();
      pushHistory();
      page.overlays = overlayList(page).filter(function (o) { return o.id !== state.selectedId; });
      state.selectedId = null;
      scheduleSave();
      renderSheet();
    }

    function closeShapeMenu() {
      if (state.shapeMenu && state.shapeMenu.parentNode) {
        state.shapeMenu.parentNode.removeChild(state.shapeMenu);
      }
      state.shapeMenu = null;
    }

    function menuItem(menu, label, action, disabled) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rb-stackmenu__item';
      btn.textContent = label;
      if (disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (btn.disabled) return;
        closeShapeMenu();
        action();
      });
      menu.appendChild(btn);
      return btn;
    }

    function menuSep(menu) {
      var sep = document.createElement('div');
      sep.className = 'por-stackmenu__sep';
      menu.appendChild(sep);
    }

    function openShapeMenu(event, id) {
      closeShapeMenu();
      state.selectedId = id;
      renderSheet();
      var menu = document.createElement('div');
      menu.className = 'rb-stackmenu';
      menu.setAttribute('data-por-shapemenu', '1');
      menuItem(menu, 'Cut', function () { cutSelected(); }, state.readOnly);
      menuItem(menu, 'Copy', function () { copySelected(); });
      menuItem(menu, 'Paste', function () { pasteClipboard(); }, state.readOnly || !state.clipboard);
      menuSep(menu);
      menuItem(menu, 'Bring to Front', function () { reorderSelected('front'); }, state.readOnly);
      menuItem(menu, 'Bring Forward', function () { reorderSelected('forward'); }, state.readOnly);
      menuItem(menu, 'Send Backward', function () { reorderSelected('backward'); }, state.readOnly);
      menuItem(menu, 'Send to Back', function () { reorderSelected('back'); }, state.readOnly);
      menuSep(menu);
      menuItem(menu, 'Size and Position…', function () {
        state.inspectorMode = 'size';
        syncInspector();
        inspectorEl.scrollIntoView({ block: 'nearest' });
        root.querySelector('#por-size-w').focus();
      });
      menuItem(menu, 'Format Shape…', function () {
        state.inspectorMode = 'format';
        syncInspector();
        inspectorEl.scrollIntoView({ block: 'nearest' });
        shapeFillInput.focus();
      });
      menuSep(menu);
      menuItem(menu, 'Delete', function () { deleteSelected(); }, state.readOnly);
      menu.style.left = Math.round(event.clientX) + 'px';
      menu.style.top = Math.round(event.clientY) + 'px';
      document.body.appendChild(menu);
      state.shapeMenu = menu;
      var mw = menu.offsetWidth;
      var mh = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(window.innerWidth - mw - 4, event.clientX)) + 'px';
      menu.style.top = Math.max(4, Math.min(window.innerHeight - mh - 4, event.clientY)) + 'px';
      setTimeout(function () {
        document.addEventListener('pointerdown', function away(ev) {
          if (ev.target.closest && ev.target.closest('[data-por-shapemenu]')) return;
          closeShapeMenu();
          document.removeEventListener('pointerdown', away, true);
        }, true);
      }, 0);
    }

    function activeViews() {
      var page = activePage();
      var api = window.ToolboxReportFloorViews;
      return (api && page && page.meta) ? (api.viewsFor(page) || []) : [];
    }

    function onPointerDown(event) {
      if (state.readOnly) return;
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest && event.target.closest('[contenteditable="true"]')) return;
      if (event.target.closest && event.target.closest('.rb-rail__rail')) return;

      var viewResize = event.target.closest && event.target.closest('[data-por-view-resize]');
      if (viewResize) {
        event.preventDefault();
        event.stopPropagation();
        var rVi = Number(viewResize.getAttribute('data-por-view-resize'));
        var rViews = activeViews();
        var rView = rViews[rVi];
        if (!rView) return;
        pushHistory();
        state.selectedViewIndex = rVi;
        state.selectedId = null;
        state.drag = {
          mode: 'view-resize',
          viewIndex: rVi,
          corner: viewResize.getAttribute('data-por-corner') || 'se',
          start: sheetPercent(event),
          origFrame: deepClone(rView.frame || { x: 0, y: 0, w: 49, h: 100 }),
        };
        renderSheet();
        return;
      }

      var viewMove = event.target.closest && event.target.closest('[data-por-view-move]');
      if (viewMove) {
        event.preventDefault();
        event.stopPropagation();
        var mVi = Number(viewMove.getAttribute('data-por-view-move'));
        var mViews = activeViews();
        var mView = mViews[mVi];
        if (!mView) return;
        pushHistory();
        state.selectedViewIndex = mVi;
        state.selectedId = null;
        state.drag = {
          mode: 'view-move',
          viewIndex: mVi,
          start: sheetPercent(event),
          origFrame: deepClone(mView.frame || { x: 0, y: 0, w: 49, h: 100 }),
        };
        renderSheet();
        return;
      }

      var viewHost = event.target.closest && event.target.closest('[data-por-view]');
      if (viewHost && !state.inkTool) {
        event.preventDefault();
        var pVi = Number(viewHost.getAttribute('data-por-view'));
        var pViews = activeViews();
        var pView = pViews[pVi];
        if (!pView) return;
        pushHistory();
        state.selectedViewIndex = pVi;
        state.selectedId = null;
        if (!pView.camera || typeof pView.camera !== 'object') {
          pView.camera = defaultViewCamera(1);
        }
        state.drag = {
          mode: 'view-pan',
          viewIndex: pVi,
          startClient: { x: event.clientX, y: event.clientY },
          host: viewHost,
          origCamera: deepClone(viewCamera(pView)),
        };
        renderSheet();
        return;
      }

      var resize = event.target.closest && event.target.closest('[data-por-resize]');
      if (resize) {
        event.preventDefault();
        var page = activePage();
        var item = overlayList(page).find(function (o) { return o.id === state.selectedId; });
        if (!item) return;
        pushHistory();
        state.drag = {
          mode: 'resize',
          corner: resize.getAttribute('data-por-corner') || 'se',
          start: sheetPercent(event),
          orig: deepClone(item),
          origBox: itemBounds(item),
        };
        return;
      }

      // An existing mark under the pointer is selected/moved even when a draw
      // tool is armed — otherwise the next click stacks a second shape and
      // Format Shape edits the accidental one while the first still shows.
      var hitExisting = event.target.closest && event.target.closest('[data-rb-ov]');
      if (state.inkTool === 'eraser') {
        eraseAt(event);
        return;
      }
      if (hitExisting) {
        state.selectedId = hitExisting.getAttribute('data-rb-ov');
        state.selectedViewIndex = null;
        renderSheet();
        var page2 = activePage();
        var item2 = overlayList(page2).find(function (o) { return o.id === state.selectedId; });
        if (!item2) return;
        event.preventDefault();
        pushHistory();
        state.drag = {
          mode: 'move',
          start: sheetPercent(event),
          orig: deepClone(item2),
        };
        return;
      }
      if (state.inkTool) {
        beginInk(event);
        return;
      }

      state.selectedId = null;
      state.selectedViewIndex = null;
      renderSheet();
    }

    function onPointerMove(event) {
      if (state.inkDrag) { moveInk(event); return; }
      if (!state.drag) return;
      var page = activePage();
      var viewsApi = window.ToolboxReportFloorViews;

      if (state.drag.mode === 'view-move' || state.drag.mode === 'view-resize') {
        var at = sheetPercent(event);
        if (!at || !state.drag.start) return;
        var views = activeViews();
        var view = views[state.drag.viewIndex];
        if (!view) return;
        var dx = at.x - state.drag.start.x;
        var dy = at.y - state.drag.start.y;
        var orig = state.drag.origFrame || { x: 0, y: 0, w: 49, h: 100 };
        var next;
        if (state.drag.mode === 'view-move') {
          next = {
            x: orig.x + dx,
            y: orig.y + dy,
            w: orig.w,
            h: orig.h,
            z: orig.z || 1,
          };
        } else {
          next = resizeBoxFromHandle(orig, state.drag.corner || 'se', dx, dy);
          next.z = orig.z || 1;
        }
        if (viewsApi && typeof viewsApi.normalizeFrame === 'function') {
          next = viewsApi.normalizeFrame(next);
        } else {
          next.w = Math.max(18, Math.min(100, next.w));
          next.h = Math.max(25, Math.min(100, next.h));
          next.x = Math.max(0, Math.min(100 - next.w, next.x));
          next.y = Math.max(0, Math.min(100 - next.h, next.y));
        }
        view.frame = next;
        renderSheet();
        return;
      }

      if (state.drag.mode === 'view-pan') {
        var host = state.drag.host;
        var views2 = activeViews();
        var view2 = views2[state.drag.viewIndex];
        if (!view2 || !host) return;
        var fw = host.clientWidth || 1;
        var fh = host.clientHeight || 1;
        var cam = state.drag.origCamera || defaultViewCamera(1);
        var zoom = Number(cam.zoom) > 0 ? Number(cam.zoom) : 1;
        // Dragging right reveals content to the left (cx decreases).
        var ndx = (event.clientX - state.drag.startClient.x) / fw;
        var ndy = (event.clientY - state.drag.startClient.y) / fh;
        var nextCam = {
          cx: Math.max(0, Math.min(1, cam.cx - ndx / zoom)),
          cy: Math.max(0, Math.min(1, cam.cy - ndy / zoom)),
          zoom: zoom,
          rel: true,
        };
        view2.camera = nextCam;
        var img = host.querySelector('img');
        applyViewCamera(img, host, nextCam);
        return;
      }

      var at2 = sheetPercent(event);
      if (!at2 || !state.drag.start) return;
      var item = overlayList(page).find(function (o) { return o.id === state.selectedId; });
      if (!item) return;
      var dx2 = at2.x - state.drag.start.x;
      var dy2 = at2.y - state.drag.start.y;
      var orig2 = state.drag.orig;
      if (state.drag.mode === 'move') {
        if (typeof orig2.x0 === 'number') {
          item.x0 = orig2.x0 + dx2; item.y0 = orig2.y0 + dy2;
          item.x1 = orig2.x1 + dx2; item.y1 = orig2.y1 + dy2;
        } else if (typeof orig2.x === 'number') {
          item.x = orig2.x + dx2; item.y = orig2.y + dy2;
        } else if (Array.isArray(orig2.points)) {
          item.points = orig2.points.map(function (p) { return [p[0] + dx2, p[1] + dy2]; });
        }
      } else if (state.drag.mode === 'resize' && state.drag.origBox) {
        var nextBox = resizeBoxFromHandle(state.drag.origBox, state.drag.corner || 'se', dx2, dy2);
        applyBounds(item, nextBox, state.drag.origBox);
      }
      renderSheet();
    }

    function onPointerUp() {
      if (state.inkDrag) endInk();
      if (state.drag) {
        var wasView = state.drag.mode && String(state.drag.mode).indexOf('view-') === 0;
        state.drag = null;
        var page = activePage();
        if (!wasView) {
          var api = overlayApi();
          if (api) page.overlays = api.normalize(overlayList(page));
        }
        scheduleSave();
        renderSheet();
      }
    }

    function onViewWheel(event) {
      if (state.readOnly || state.printMode) return;
      var host = event.target.closest && event.target.closest('[data-por-view]');
      if (!host) return;
      event.preventDefault();
      var vi = Number(host.getAttribute('data-por-view'));
      var views = activeViews();
      var view = views[vi];
      if (!view) return;
      var cam = viewCamera(view);
      var factor = event.deltaY > 0 ? (1 / 1.12) : 1.12;
      var nextZoom = Math.max(1, Math.min(8, cam.zoom * factor));
      view.camera = { cx: cam.cx, cy: cam.cy, zoom: nextZoom, rel: true };
      state.selectedViewIndex = vi;
      applyViewCamera(host.querySelector('img'), host, view.camera);
      scheduleSave();
    }

    function onKeyDown(event) {
      if (!activeMount || activeMount.root !== root) return;
      var typing = event.target && (
        event.target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      );
      if (event.key === 'Escape') {
        setInkTool(null);
        state.selectedId = null;
        closeShapeMenu();
        renderSheet();
        return;
      }
      if (typing) return;
      var mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (mod && event.key.toLowerCase() === 'c') { if (copySelected()) event.preventDefault(); return; }
      if (mod && event.key.toLowerCase() === 'x') { if (cutSelected()) event.preventDefault(); return; }
      if (mod && event.key.toLowerCase() === 'v') { if (pasteClipboard()) event.preventDefault(); return; }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (copySelected()) pasteClipboard();
        return;
      }
      if (!mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown' ||
          event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        var nudgeItem = selectedItem();
        if (!nudgeItem || state.readOnly) return;
        event.preventDefault();
        var step = event.shiftKey ? 1 : 0.25;
        var dx = event.key === 'ArrowLeft' ? -step : (event.key === 'ArrowRight' ? step : 0);
        var dy = event.key === 'ArrowUp' ? -step : (event.key === 'ArrowDown' ? step : 0);
        pushHistory();
        if (nudgeItem.points) {
          nudgeItem.points = nudgeItem.points.map(function (p) { return [p[0] + dx, p[1] + dy]; });
        } else if (nudgeItem.x0 != null) {
          nudgeItem.x0 += dx; nudgeItem.x1 += dx;
          nudgeItem.y0 += dy; nudgeItem.y1 += dy;
        } else if (nudgeItem.x != null) {
          nudgeItem.x = clamp(nudgeItem.x + dx, 0, 100);
          nudgeItem.y = clamp(nudgeItem.y + dy, 0, 100);
        }
        scheduleSave();
        renderSheet();
        return;
      }
      if (mod && event.key.toLowerCase() === ']' && event.shiftKey) {
        event.preventDefault();
        reorderSelected('front');
        return;
      }
      if (mod && event.key.toLowerCase() === '[' && event.shiftKey) {
        event.preventDefault();
        reorderSelected('back');
        return;
      }
      if (mod && event.key.toLowerCase() === ']') { event.preventDefault(); reorderSelected('forward'); return; }
      if (mod && event.key.toLowerCase() === '[') { event.preventDefault(); reorderSelected('backward'); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      }
    }

    function bringBackground(kind) {
      if (state.readOnly) return;
      var canvasId = canvasSelect.value;
      if (!canvasId) {
        setStatus('Add a floor plan to this Customer File first');
        return;
      }
      if (kind === 'contour') {
        var canvas = window.ToolboxPlanSetup.canvasById(state.record, canvasId);
        var layer = window.ToolboxPlanSetup.contourLayer(canvas);
        if (!layer) {
          setStatus('No contour on this level yet');
          return;
        }
      }
      pushHistory();
      var page = activePage();
      page.background = {
        kind: kind,
        canvasId: canvasId,
        mediaId: '',
        source: null,
        sourceStatus: null,
      };
      scheduleSave();
      loadBackground().then(function () {
        // Fresh place: stamp whatever we just loaded as the sheet source.
        if (page.background && page.background._liveSource) {
          page.background.source = page.background._liveSource;
          delete page.background._liveSource;
        }
        page.background.sourceStatus = null;
        scheduleSave();
        renderSheet();
      });
      setStatus(kind === 'contour' ? 'Contour on sheet' : 'Floor plan on sheet');
    }

    function stripPrintChrome(node) {
      node.querySelectorAll(
        '.por-sel, .rb-ov__resize, .rb-ov__remove, .por-view-frame__handle, .por-view-frame__move'
      ).forEach(function (el) {
        el.parentNode && el.parentNode.removeChild(el);
      });
      node.querySelectorAll('[contenteditable]').forEach(function (el) {
        el.removeAttribute('contenteditable');
      });
      node.querySelectorAll('.por-sheet-bg__empty, .por-source-banner, .por-print__warn').forEach(function (el) {
        el.parentNode && el.parentNode.removeChild(el);
      });
      node.querySelectorAll('.por-view-frame.is-selected').forEach(function (el) {
        el.classList.remove('is-selected');
      });
      node.style.transform = 'none';
    }

    function sheetsNeedingSourceReview() {
      var issues = [];
      state.doc.pages.forEach(function (page, index) {
        var bg = page && page.background;
        if (!bg || !bg.kind) return;
        if (bg.sourceStatus === 'changed') {
          issues.push({ index: index + 1, title: page.title || ('Drawing ' + (index + 1)), reason: 'changed' });
        }
      });
      return issues;
    }

    function buildPrintDeck() {
      var priorActive = state.doc.activePageId;
      var priorSelected = state.selectedId;
      var deck = document.createElement('div');
      deck.className = 'por-print';
      var chain = Promise.resolve();
      state.printMode = true;
      state.doc.pages.forEach(function (page) {
        chain = chain.then(function () {
          state.doc.activePageId = page.id;
          state.selectedId = null;
          return loadBackground().then(function () {
            renderSheet();
            return waitForSheetImages().then(function () {
              var pageEl = document.createElement('div');
              pageEl.className = 'por-print__page';
              var clone = sheetEl.cloneNode(true);
              stripPrintChrome(clone);
              pageEl.appendChild(clone);
              deck.appendChild(pageEl);
            });
          });
        });
      });
      return chain.then(function () {
        state.printMode = false;
        state.doc.activePageId = priorActive;
        state.selectedId = priorSelected;
        return loadBackground().then(function () {
          renderSheet();
          return deck;
        });
      }).catch(function (err) {
        state.printMode = false;
        throw err;
      });
    }

    function printPdf() {
      setStatus('Preparing print…');
      return persistNow().then(function () {
        // Probe every sheet so sourceStatus is current before we warn.
        var prior = state.doc.activePageId;
        var chain = Promise.resolve();
        state.doc.pages.forEach(function (page) {
          chain = chain.then(function () {
            state.doc.activePageId = page.id;
            return loadBackground();
          });
        });
        return chain.then(function () {
          state.doc.activePageId = prior;
          return loadBackground();
        });
      }).then(function () {
        var issues = sheetsNeedingSourceReview();
        var missing = [];
        state.doc.pages.forEach(function (page, index) {
          var bg = page && page.background;
          if (!bg || !bg.kind) return;
          // Prefer the actual load result (imported media can keep a stale mediaId).
          var loadFailed = !!state.bgMissingByPageId[page.id];
          if (loadFailed || !resolveBackgroundMediaId(page)) {
            missing.push((index + 1) + '. ' + (page.title || 'Drawing'));
          }
        });
        if (issues.length || missing.length) {
          var lines = [];
          if (missing.length) {
            lines.push('Missing background on:\n' + missing.join('\n'));
          }
          if (issues.length) {
            lines.push('Changed source on:\n' + issues.map(function (i) {
              return i.index + '. ' + i.title;
            }).join('\n'));
          }
          lines.push('\nPrint will keep every sheet intact (marks, frame, title block). Review or accept replacements on those sheets when you are ready.');
          if (!window.confirm(lines.join('\n'))) {
            setStatus('Print cancelled');
            return null;
          }
        }
        return buildPrintDeck();
      }).then(function (deck) {
        if (!deck) return;

        document.body.appendChild(deck);
        document.body.classList.add('is-por-printing');
        var prior = document.title;
        document.title = displayName(state.record) + ' Plan of Repair';
        var done = false;
        function cleanup() {
          if (done) return;
          done = true;
          document.body.classList.remove('is-por-printing');
          if (deck.parentNode) deck.parentNode.removeChild(deck);
          document.title = prior;
          setStatus('Ready');
        }
        window.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(function () {
          try { window.print(); } catch (err) { cleanup(); }
          setTimeout(cleanup, 1500);
        }, 40);
      }).catch(function (err) {
        console.error(err);
        setStatus('Print failed');
      });
    }

    // Toolbar
    if (window.ToolboxReportToolbar && window.ToolboxReportToolbar.mount) {
      state.formatToolbar = window.ToolboxReportToolbar.mount(
        root,
        {
          onTool: function (name) {
            if (state.readOnly) return;
            state.selectedId = null;
            setInkTool(name);
          },
          onColor: function (color) {
            if (!color) return;
            var item = selectedItem();
            if (item && !state.readOnly) {
              // Selected-object style only — do not redefine the next tool default.
              pushHistory();
              item.color = color;
              if (item.fill) item.fillColor = color;
              scheduleSave();
              renderSheet();
              return;
            }
            state.inkColor = color;
            if (state.inkFill) state.fillColor = color;
          },
          onThick: function (level) {
            state.inkThick = Number(level) || state.inkThick;
          },
          onHistory: function (which) {
            if (which === 'undo') undo();
            else if (which === 'redo') redo();
          },
          onInsert: function (kind) {
            if (state.readOnly) return;
            if (kind === 'text') {
              setInkTool(null);
              var page = activePage();
              var api = overlayApi();
              if (!api || !api.create) return;
              pushHistory();
              var item = api.create('text');
              overlayList(page).push(item);
              state.selectedId = item.id;
              scheduleSave();
              renderSheet();
              return;
            }
            if (kind === 'image') {
              setStatus('Use Import drawing in the Toolbox panel to place a picture on the sheet');
            }
          },
        }
      );
    }

    root.querySelector('#por-back').addEventListener('click', function () {
      persistNow().then(onBack);
    });
    root.querySelector('#por-print').addEventListener('click', printPdf);
    root.querySelector('#por-add-page').addEventListener('click', function () {
      if (state.readOnly) return;
      pushHistory();
      var page = blankPage('Drawing ' + (state.doc.pages.length + 1));
      page.rail.sheetId = 'POR-' + (state.doc.pages.length + 1);
      state.doc.pages.push(page);
      state.doc.activePageId = page.id;
      state.selectedId = null;
      scheduleSave();
      renderAll();
    });
    root.querySelector('#por-dup-page').addEventListener('click', function () {
      if (state.readOnly) return;
      pushHistory();
      var src = activePage();
      var copy = deepClone(src);
      copy.id = uid('page');
      copy.title = (src.title || 'Drawing') + ' copy';
      copy.rail.sheetId = 'POR-' + (state.doc.pages.length + 1);
      (copy.overlays || []).forEach(function (o) { o.id = uid('ov'); });
      state.doc.pages.push(copy);
      state.doc.activePageId = copy.id;
      scheduleSave();
      renderAll();
    });
    root.querySelector('#por-remove-page').addEventListener('click', function () {
      if (state.readOnly || state.doc.pages.length < 2) return;
      pushHistory();
      var id = state.doc.activePageId;
      state.doc.pages = state.doc.pages.filter(function (p) { return p.id !== id; });
      state.doc.activePageId = state.doc.pages[0].id;
      state.selectedId = null;
      scheduleSave();
      renderAll();
    });
    root.querySelector('#por-bring-plan').addEventListener('click', function () { bringBackground('plan'); });
    root.querySelector('#por-bring-contour').addEventListener('click', function () { bringBackground('contour'); });
    root.querySelector('#por-import-bg').addEventListener('click', function () {
      if (state.readOnly) return;
      root.querySelector('#por-import-file').click();
    });
    root.querySelector('#por-import-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file || state.readOnly) return;
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        if (typeof dataUrl !== 'string') return;
        var mediaId = 'porimp_' + uid('bg');
        window.ToolboxDB.putMedia(mediaId, dataUrl).then(function () {
          pushHistory();
          var page = activePage();
          page.background = {
            kind: 'import',
            canvasId: '',
            mediaId: mediaId,
            source: null,
            sourceStatus: null,
          };
          scheduleSave();
          return loadBackground().then(function () {
            if (page.background && page.background._liveSource) {
              page.background.source = page.background._liveSource;
              delete page.background._liveSource;
            }
            page.background.sourceStatus = null;
            scheduleSave();
            renderSheet();
          });
        }).then(function () {
          setStatus('Imported drawing on sheet');
        }).catch(function (err) {
          console.error(err);
          setStatus('Could not import drawing');
        });
      };
      reader.onerror = function () { setStatus('Could not read that file'); };
      reader.readAsDataURL(file);
    });
    root.querySelector('#por-add-view').addEventListener('click', function () {
      if (state.readOnly) return;
      var page = activePage();
      if (!page.meta) page.meta = {};
      var api = window.ToolboxReportFloorViews;
      if (!api || typeof api.addView !== 'function') {
        setStatus('View controls unavailable');
        return;
      }
      pushHistory();
      api.ensurePageViews(page);
      api.addView(page, 0);
      var views = api.viewsFor(page) || [];
      // POR overall/detail frames move independently; cameras are per-view.
      views.forEach(function (v) {
        if (!v) return;
        v.linkGroup = null;
      });
      if (views[0]) views[0].camera = defaultViewCamera(1);
      if (views.length > 1) {
        var detail = views[views.length - 1];
        // Detail starts zoomed so overall and detail are visibly different.
        detail.camera = defaultViewCamera(2.4);
        state.selectedViewIndex = views.length - 1;
      }
      scheduleSave();
      renderSheet();
      setStatus('Detail view added — drag Move to place; drag inside to pan; scroll to zoom');
    });
    root.querySelector('#por-remove-view').addEventListener('click', function () {
      if (state.readOnly) return;
      var page = activePage();
      var api = window.ToolboxReportFloorViews;
      if (!api || typeof api.removeView !== 'function') return;
      pushHistory();
      api.ensurePageViews(page);
      if ((api.viewsFor(page) || []).length <= 1) {
        setStatus('Only one view on this sheet');
        return;
      }
      api.removeView(page, (api.viewsFor(page).length - 1));
      scheduleSave();
      renderSheet();
      setStatus('Detail view removed');
    });
    root.querySelector('#por-clear-bg').addEventListener('click', function () {
      if (state.readOnly) return;
      pushHistory();
      activePage().background = {
        kind: null, canvasId: '', mediaId: '', source: null, sourceStatus: null,
      };
      state.bgUrl = '';
      state.bgMissing = false;
      scheduleSave();
      renderSheet();
    });
    fillInput.addEventListener('change', function () {
      state.inkFill = !!fillInput.checked;
      if (state.inkFill) state.fillColor = state.inkColor;
    });
    sandiaInput.addEventListener('change', function () {
      if (state.readOnly) return;
      pushHistory();
      state.doc.showSandiaAttribution = !!sandiaInput.checked;
      scheduleSave();
      renderSheet();
    });
    shapeFillInput.addEventListener('change', function () {
      var item = selectedItem();
      if (!item || state.readOnly) return;
      if (item.kind !== 'rect' && item.kind !== 'circle') {
        shapeFillInput.checked = false;
        return;
      }
      pushHistory();
      if (shapeFillInput.checked) {
        item.fill = true;
        item.fillColor = item.fillColor || item.color;
      } else {
        delete item.fill;
        delete item.fillColor;
      }
      scheduleSave();
      renderSheet();
    });
    inspectorEl.addEventListener('click', function (event) {
      var swatch = event.target.closest && event.target.closest('[data-por-swatch]');
      if (!swatch) return;
      event.preventDefault();
      applyInspectorColor(swatch.getAttribute('data-por-swatch'), swatch.getAttribute('data-por-color'));
    });
    root.querySelector('#por-outline-weights').addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('[data-por-thick]');
      var item = selectedItem();
      if (!btn || !item || state.readOnly) return;
      pushHistory();
      item.thick = Number(btn.getAttribute('data-por-thick')) || 2;
      scheduleSave();
      renderSheet();
    });
    ['por-size-x', 'por-size-y', 'por-size-w', 'por-size-h'].forEach(function (id) {
      root.querySelector('#' + id).addEventListener('change', applySizeFields);
    });
    root.querySelector('#por-stack-front').addEventListener('click', function () { reorderSelected('front'); });
    root.querySelector('#por-stack-forward').addEventListener('click', function () { reorderSelected('forward'); });
    root.querySelector('#por-stack-backward').addEventListener('click', function () { reorderSelected('backward'); });
    root.querySelector('#por-stack-back').addEventListener('click', function () { reorderSelected('back'); });
    root.querySelector('#por-zoom-out').addEventListener('click', function () {
      state.zoomMode = 'user';
      state.userScale = clamp((state.scale || 1) / 1.15, 0.35, 2.4);
      applySheetScale();
    });
    root.querySelector('#por-zoom-in').addEventListener('click', function () {
      state.zoomMode = 'user';
      state.userScale = clamp((state.scale || 1) * 1.15, 0.35, 2.4);
      applySheetScale();
    });
    root.querySelector('#por-zoom-level').addEventListener('click', function () {
      state.zoomMode = 'fit';
      applySheetScale();
    });

    sheetEl.addEventListener('pointerdown', onPointerDown);
    sheetEl.addEventListener('wheel', onViewWheel, { passive: false });
    sheetEl.addEventListener('contextmenu', function (event) {
      var target = event.target.closest && event.target.closest('[data-rb-ov]');
      if (!target && event.target.closest && event.target.closest('.por-sel') && state.selectedId) {
        event.preventDefault();
        openShapeMenu(event, state.selectedId);
        return;
      }
      if (!target) return;
      event.preventDefault();
      openShapeMenu(event, target.getAttribute('data-rb-ov'));
    });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', applySheetScale);

    activeMount = {
      root: root,
      persistNow: persistNow,
      destroy: function () {
        if (state.saveTimer) clearTimeout(state.saveTimer);
        closeShapeMenu();
        if (state.formatToolbar && state.formatToolbar.destroy) state.formatToolbar.destroy();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', applySheetScale);
        sheetEl.removeEventListener('wheel', onViewWheel);
        document.body.classList.remove('plan-of-repair-open', 'is-por-printing');
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };

    setStatus('Loading…');
    return window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (!record) {
        setStatus('Customer File not found');
        return;
      }
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
      state.record = record;
      state.readOnly = !!(window.ToolboxSync && window.ToolboxSync.heldElsewhere &&
        window.ToolboxSync.heldElsewhere(record));
      state.doc = normalizeDoc(record.planOfRepair);
      root.querySelector('#por-file-label').textContent =
        displayName(record) + (displayAddress(record) ? ' · ' + displayAddress(record) : '');
      ['por-add-page', 'por-dup-page', 'por-remove-page', 'por-bring-plan', 'por-bring-contour', 'por-clear-bg']
        .forEach(function (id) {
          var el = root.querySelector('#' + id);
          if (el) el.disabled = state.readOnly;
        });
      fillInput.disabled = state.readOnly;
      sandiaInput.disabled = state.readOnly;
      canvasSelect.disabled = state.readOnly;
      if (state.readOnly) setStatus('View only — checked out elsewhere');
      else setStatus('Ready');
      renderAll();
      if (!state.readOnly && !record.planOfRepair) scheduleSave();
    }).catch(function (err) {
      console.error(err);
      setStatus('Unable to open Plan of Repair');
    });
  }

  function unmount() {
    if (!activeMount) return;
    try { activeMount.persistNow(); } catch (_) {}
    activeMount.destroy();
    activeMount = null;
  }

  window.ToolboxPlanOfRepair = {
    mount: mount,
    unmount: unmount,
    normalizeDoc: normalizeDoc,
    migrateLegacy: migrateLegacy,
    PAPER_W: PAPER_W,
    PAPER_H: PAPER_H,
  };
})();
