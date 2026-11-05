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
      background: { kind: null, canvasId: '' },
      rail: {
        title: 'Preliminary Underpinning Plan',
        date: '',
        status: 'Preliminary — Subject to Structural Engineering',
        sheetId: '',
      },
    };
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
              kind: p.background.kind === 'contour' || p.background.kind === 'plan'
                ? p.background.kind
                : null,
              canvasId: typeof p.background.canvasId === 'string' ? p.background.canvasId : '',
            }
          : { kind: null, canvasId: '' };
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
      '  <button type="button" id="por-back" class="btn btn--ghost">‹ Customer File</button>' +
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
      '      <button type="button" class="por-linkbtn" id="por-clear-bg">Clear</button>' +
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
      scale: 1,
      zoomMode: 'fit',
      userScale: 1,
      drag: null,
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

    function loadBackground() {
      state.bgUrl = '';
      var page = activePage();
      var bg = page && page.background;
      if (!bg || !bg.kind || !bg.canvasId || !state.record) return Promise.resolve();
      var canvas = window.ToolboxPlanSetup && window.ToolboxPlanSetup.canvasById
        ? window.ToolboxPlanSetup.canvasById(state.record, bg.canvasId)
        : null;
      if (!canvas) return Promise.resolve();
      var mediaId = null;
      if (bg.kind === 'plan' && canvas.plan && canvas.plan.id) mediaId = canvas.plan.id;
      if (bg.kind === 'contour') {
        var layer = window.ToolboxPlanSetup.contourLayer
          ? window.ToolboxPlanSetup.contourLayer(canvas)
          : (canvas.contourLayer || null);
        if (layer && layer.id) mediaId = layer.id;
      }
      if (!mediaId || !window.ToolboxDB || !window.ToolboxDB.getMedia) return Promise.resolve();
      return window.ToolboxDB.getMedia(mediaId).then(function (url) {
        if (typeof url === 'string' && url.indexOf('data:image/') === 0) state.bgUrl = url;
      }).catch(function () {});
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
      if (state.bgUrl) {
        var img = document.createElement('img');
        img.src = state.bgUrl;
        img.alt = page.background && page.background.kind === 'contour' ? 'Contour' : 'Floor plan';
        bg.appendChild(img);
      } else {
        var empty = document.createElement('p');
        empty.className = 'por-sheet-bg__empty';
        empty.textContent = 'Bring in a floor plan or contour from the Toolbox panel.';
        bg.appendChild(empty);
      }
      sheetEl.appendChild(bg);

      var rail = renderRail(page);
      if (rail) sheetEl.appendChild(rail);

      if (api && typeof api.renderLayer === 'function') {
        var layer = api.renderLayer(overlayList(page), { locked: state.readOnly });
        if (layer) sheetEl.appendChild(layer);
      }

      if (state.selectedId) renderSelectionChrome(page);
      applySheetScale();
      wireRailEdits(page);
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
      var rot = document.createElement('span');
      rot.className = 'por-sel__rot';
      sel.appendChild(rot);
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
      scheduleSave();
      renderSheet();
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

    function onPointerDown(event) {
      if (state.readOnly) return;
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest && event.target.closest('[contenteditable="true"]')) return;
      if (event.target.closest && event.target.closest('.rb-rail__rail')) return;

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
      renderSheet();
    }

    function onPointerMove(event) {
      if (state.inkDrag) { moveInk(event); return; }
      if (!state.drag) return;
      var at = sheetPercent(event);
      if (!at || !state.drag.start) return;
      var page = activePage();
      var item = overlayList(page).find(function (o) { return o.id === state.selectedId; });
      if (!item) return;
      var dx = at.x - state.drag.start.x;
      var dy = at.y - state.drag.start.y;
      var orig = state.drag.orig;
      if (state.drag.mode === 'move') {
        if (typeof orig.x0 === 'number') {
          item.x0 = orig.x0 + dx; item.y0 = orig.y0 + dy;
          item.x1 = orig.x1 + dx; item.y1 = orig.y1 + dy;
        } else if (typeof orig.x === 'number') {
          item.x = orig.x + dx; item.y = orig.y + dy;
        } else if (Array.isArray(orig.points)) {
          item.points = orig.points.map(function (p) { return [p[0] + dx, p[1] + dy]; });
        }
      } else if (state.drag.mode === 'resize' && state.drag.origBox) {
        var nextBox = resizeBoxFromHandle(state.drag.origBox, state.drag.corner || 'se', dx, dy);
        applyBounds(item, nextBox, state.drag.origBox);
      }
      renderSheet();
    }

    function onPointerUp() {
      if (state.inkDrag) endInk();
      if (state.drag) {
        state.drag = null;
        var page = activePage();
        var api = overlayApi();
        if (api) page.overlays = api.normalize(overlayList(page));
        scheduleSave();
        renderSheet();
      }
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
      page.background = { kind: kind, canvasId: canvasId };
      scheduleSave();
      loadBackground().then(renderSheet);
      setStatus(kind === 'contour' ? 'Contour on sheet' : 'Floor plan on sheet');
    }

    function buildPrintDeck() {
      var deck = document.createElement('div');
      deck.className = 'por-print';
      state.doc.pages.forEach(function (page) {
        // Render each page into a detached sheet clone by temporarily
        // switching active page is heavy; print the current sheet clone for
        // v1 multi-page by walking pages.
      });
      var pageEl = document.createElement('div');
      pageEl.className = 'por-print__page';
      var clone = sheetEl.cloneNode(true);
      clone.querySelectorAll('.por-sel, .rb-ov__resize, .rb-ov__remove').forEach(function (el) {
        el.parentNode && el.parentNode.removeChild(el);
      });
      clone.querySelectorAll('[contenteditable]').forEach(function (el) {
        el.removeAttribute('contenteditable');
      });
      clone.style.transform = 'none';
      pageEl.appendChild(clone);
      deck.appendChild(pageEl);
      // Additional pages: quick static renders
      state.doc.pages.forEach(function (page) {
        if (page.id === state.doc.activePageId) return;
        var extra = document.createElement('div');
        extra.className = 'por-print__page';
        var art = document.createElement('article');
        art.className = 'rb-sheet';
        art.style.width = PAPER_W + 'px';
        art.style.height = PAPER_H + 'px';
        art.style.position = 'relative';
        art.style.background = '#fffaf0';
        var label = document.createElement('p');
        label.style.cssText = 'position:absolute;left:24px;top:24px;font:14px Georgia,serif;';
        label.textContent = (page.title || 'Drawing') + ' — open the page to print its drawing in full.';
        art.appendChild(label);
        var rail = renderRail(page);
        if (rail) art.appendChild(rail);
        if (overlayApi()) {
          var layer = overlayApi().renderLayer(overlayList(page), { locked: true });
          if (layer) art.appendChild(layer);
        }
        extra.appendChild(art);
        deck.appendChild(extra);
      });
      return deck;
    }

    function printPdf() {
      return persistNow().then(function () {
        var deck = buildPrintDeck();
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
        }
        window.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(function () {
          try { window.print(); } catch (err) { cleanup(); }
          setTimeout(cleanup, 1500);
        }, 40);
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
            if (color) {
              state.inkColor = color;
              if (state.inkFill) state.fillColor = color;
              var item = selectedItem();
              if (item && !state.readOnly) {
                pushHistory();
                item.color = color;
                scheduleSave();
                renderSheet();
              }
            }
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
              setStatus('Picture insert uses Paste on the sheet for now');
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
    root.querySelector('#por-clear-bg').addEventListener('click', function () {
      if (state.readOnly) return;
      pushHistory();
      activePage().background = { kind: null, canvasId: '' };
      state.bgUrl = '';
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
