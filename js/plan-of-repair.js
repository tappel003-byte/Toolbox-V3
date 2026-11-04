// Toolbox — Plan of Repair workspace.
//
// First working version: one 11×17 repair worksheet per Customer File.
// Authoritative document lives on record.planOfRepair and syncs as the
// `repair` component. Report Builder insertion is deferred; do not fork a
// second editable copy into reportBuilder in this pass.
(function () {
  'use strict';

  var SHEET_W = 1632;
  var SHEET_H = 1056;
  var DEFAULT_SYMBOL_SIZE = 2.4; // percent of plan frame short side
  var PLACEHOLDER_TLS =
    'TLS Foundations artwork is not in this repository yet — text brand mark.';

  var activeMount = null;

  function isoNow() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return (prefix || 'por') + '-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultSymbolDefs() {
    return [
      {
        id: 'helical',
        kind: 'circle',
        label: 'Helical pier — 20-kip service load max',
      },
      {
        id: 'helical-concrete',
        kind: 'circle-in-square',
        label: 'Helical requiring concrete removal and replacement',
      },
    ];
  }

  function normalizeSymbolDef(raw, fallback) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var base = fallback || {};
    var id = typeof src.id === 'string' && src.id ? src.id : (base.id || uid('def'));
    var kind = src.kind === 'circle-in-square' || base.kind === 'circle-in-square'
      ? 'circle-in-square'
      : 'circle';
    var label = typeof src.label === 'string' && src.label.trim()
      ? src.label.trim()
      : (base.label || 'Repair symbol');
    return { id: id, kind: kind, label: label };
  }

  function normalizeDoc(raw, record) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var defsIn = Array.isArray(src.symbolDefs) && src.symbolDefs.length
      ? src.symbolDefs
      : defaultSymbolDefs();
    var defaults = defaultSymbolDefs();
    var symbolDefs = defsIn.slice(0, 2).map(function (def, i) {
      return normalizeSymbolDef(def, defaults[i] || defaults[0]);
    });
    while (symbolDefs.length < 2) {
      symbolDefs.push(normalizeSymbolDef(null, defaults[symbolDefs.length]));
    }

    var planFrame = src.planFrame && typeof src.planFrame === 'object' ? src.planFrame : {};
    var legend = src.legend && typeof src.legend === 'object' ? src.legend : {};
    var rail = src.rail && typeof src.rail === 'object' ? src.rail : {};

    var symbols = Array.isArray(src.symbols) ? src.symbols : [];
    symbols = symbols.map(function (sym) {
      if (!sym || typeof sym !== 'object') return null;
      var defId = typeof sym.defId === 'string' ? sym.defId : symbolDefs[0].id;
      if (!symbolDefs.some(function (d) { return d.id === defId; })) defId = symbolDefs[0].id;
      return {
        id: typeof sym.id === 'string' && sym.id ? sym.id : uid('sym'),
        defId: defId,
        x: Number(sym.x),
        y: Number(sym.y),
      };
    }).filter(function (sym) {
      return sym && isFinite(sym.x) && isFinite(sym.y);
    });

    var notes = Array.isArray(src.notes) ? src.notes : [];
    notes = notes.map(function (note) {
      if (!note || typeof note !== 'object') return null;
      return {
        id: typeof note.id === 'string' && note.id ? note.id : uid('note'),
        x: clamp(note.x, 0, 96),
        y: clamp(note.y, 0, 96),
        w: clamp(note.w, 8, 70),
        h: clamp(note.h, 4, 50),
        text: typeof note.text === 'string' ? note.text : '',
      };
    }).filter(Boolean);

    var canvasId = typeof src.canvasId === 'string' ? src.canvasId : '';
    if (!canvasId && record && window.ToolboxPlanSetup) {
      var active = window.ToolboxPlanSetup.activeCanvas
        ? window.ToolboxPlanSetup.activeCanvas(record)
        : null;
      if (active && active.id) canvasId = active.id;
    }

    return {
      updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : '',
      canvasId: canvasId,
      planFrame: {
        x: clamp(planFrame.x, 1, 88),
        y: clamp(planFrame.y, 1, 88),
        w: clamp(planFrame.w != null ? planFrame.w : 78, 20, 96),
        h: clamp(planFrame.h != null ? planFrame.h : 86, 20, 96),
      },
      symbolSize: clamp(src.symbolSize != null ? src.symbolSize : DEFAULT_SYMBOL_SIZE, 1.2, 8),
      symbolDefs: symbolDefs,
      symbols: symbols,
      notes: notes,
      legend: {
        x: clamp(legend.x != null ? legend.x : 3, 0, 90),
        y: clamp(legend.y != null ? legend.y : 78, 0, 90),
        w: clamp(legend.w != null ? legend.w : 28, 12, 60),
        h: clamp(legend.h != null ? legend.h : 16, 8, 40),
      },
      rail: {
        title: typeof rail.title === 'string' && rail.title.trim()
          ? rail.title
          : 'Preliminary Underpinning Plan',
        date: typeof rail.date === 'string' ? rail.date : '',
        status: typeof rail.status === 'string' && rail.status.trim()
          ? rail.status
          : 'Preliminary — Subject to Structural Engineering',
        sheetId: typeof rail.sheetId === 'string' && rail.sheetId.trim()
          ? rail.sheetId
          : 'POR-1',
        northRotation: isFinite(Number(rail.northRotation)) ? Number(rail.northRotation) : 0,
        showSandiaAttribution: !!rail.showSandiaAttribution,
        clientOverride: typeof rail.clientOverride === 'string' ? rail.clientOverride : '',
        addressOverride: typeof rail.addressOverride === 'string' ? rail.addressOverride : '',
      },
    };
  }

  function usedDefs(doc) {
    var used = {};
    (doc.symbols || []).forEach(function (sym) { used[sym.defId] = true; });
    return (doc.symbolDefs || []).filter(function (def) { return used[def.id]; });
  }

  function displayName(record) {
    var first = ((record && record.firstName) || '').trim();
    var last = ((record && record.lastName) || '').trim();
    var company = ((record && record.companyName) || '').trim();
    var name = (first + ' ' + last).trim();
    if (name && /residence$/i.test(name) === false && last) return name + ' Residence';
    return name || company || 'Customer File';
  }

  function displayAddress(record) {
    return ((record && record.propertyAddress) || '').trim();
  }

  function symbolSvg(kind, sizePx) {
    var s = Math.max(8, sizePx || 18);
    if (kind === 'circle-in-square') {
      return '<svg class="por-symbol__mark" viewBox="0 0 24 24" width="' + s +
        '" height="' + s + '" aria-hidden="true">' +
        '<rect class="por-symbol__square" x="1.5" y="1.5" width="21" height="21" rx="1.5"/>' +
        '<circle class="por-symbol__circle" cx="12" cy="12" r="6.2"/>' +
        '</svg>';
    }
    return '<svg class="por-symbol__mark" viewBox="0 0 24 24" width="' + s +
      '" height="' + s + '" aria-hidden="true">' +
      '<circle class="por-symbol__circle" cx="12" cy="12" r="8.2"/>' +
      '</svg>';
  }

  function fitScale(stageEl) {
    if (!stageEl) return 1;
    var wrap = stageEl.parentElement;
    if (!wrap) return 1;
    var pad = 8;
    var availW = Math.max(240, wrap.clientWidth - pad);
    var availH = Math.max(180, wrap.clientHeight - pad);
    return Math.min(1, availW / SHEET_W, availH / SHEET_H);
  }

  function applySheetScale(sheetEl, stageEl) {
    var scale = fitScale(stageEl);
    sheetEl.style.transform = 'scale(' + scale + ')';
    stageEl.style.width = (SHEET_W * scale) + 'px';
    stageEl.style.height = (SHEET_H * scale) + 'px';
    return scale;
  }

  function mount(host, opts) {
    opts = opts || {};
    unmount();

    var customerFileId = opts.customerFileId;
    var onBack = typeof opts.onBack === 'function' ? opts.onBack : function () {};
    var root = document.createElement('div');
    root.className = 'por-root';
    host.appendChild(root);
    document.body.classList.add('plan-of-repair-open');

    var state = {
      record: null,
      doc: normalizeDoc(null, null),
      planUrl: '',
      planW: 0,
      planH: 0,
      readOnly: false,
      placeDefId: null,
      selected: null, // { kind:'symbol'|'note'|'legend'|'plan', id? }
      dirty: false,
      saveTimer: null,
      undo: [],
      redo: [],
      clipboard: null,
      scale: 1,
      drag: null,
      status: 'Loading…',
    };

    root.innerHTML =
      '<div class="por-bar" role="toolbar" aria-label="Plan of Repair tools">' +
      '  <button type="button" class="btn btn--ghost" id="por-back">‹ Customer File</button>' +
      '  <div class="por-bar__tools" id="por-tools"></div>' +
      '  <div class="por-bar__grow"></div>' +
      '  <div class="por-bar__meta">' +
      '    <label class="por-size">Symbol size <input id="por-size" type="range" min="1.2" max="8" step="0.1"></label>' +
      '    <button type="button" class="btn btn--secondary" id="por-undo" disabled>Undo</button>' +
      '    <button type="button" class="btn btn--secondary" id="por-redo" disabled>Redo</button>' +
      '    <button type="button" class="btn btn--secondary" id="por-add-note">Add note</button>' +
      '    <button type="button" class="btn btn--secondary" id="por-print">Print / PDF</button>' +
      '    <label class="por-size"><input id="por-sandia" type="checkbox"> Survey info by SandiaGEO</label>' +
      '    <span class="por-bar__status" id="por-status"></span>' +
      '  </div>' +
      '</div>' +
      '<div class="por-stage-wrap"><div class="por-stage" id="por-stage">' +
      '  <div class="por-sheet" id="por-sheet" aria-label="Plan of Repair worksheet, 11 by 17 inch landscape">' +
      '    <div class="por-sheet__frame" aria-hidden="true"></div>' +
      '    <div class="por-drawing" id="por-drawing"></div>' +
      '    <aside class="por-rail" id="por-rail" aria-label="Drawing information"></aside>' +
      '  </div>' +
      '</div></div>';

    var toolsEl = root.querySelector('#por-tools');
    var stageEl = root.querySelector('#por-stage');
    var sheetEl = root.querySelector('#por-sheet');
    var drawingEl = root.querySelector('#por-drawing');
    var railEl = root.querySelector('#por-rail');
    var statusEl = root.querySelector('#por-status');
    var sizeInput = root.querySelector('#por-size');
    var sandiaInput = root.querySelector('#por-sandia');

    function setStatus(text) {
      state.status = text || '';
      if (statusEl) statusEl.textContent = state.status;
    }

    function snapshot() {
      return deepClone(state.doc);
    }

    function pushHistory() {
      state.undo.push(snapshot());
      if (state.undo.length > 80) state.undo.shift();
      state.redo = [];
      syncHistoryButtons();
    }

    function syncHistoryButtons() {
      var undoBtn = root.querySelector('#por-undo');
      var redoBtn = root.querySelector('#por-redo');
      if (undoBtn) undoBtn.disabled = state.readOnly || !state.undo.length;
      if (redoBtn) redoBtn.disabled = state.readOnly || !state.redo.length;
    }

    function scheduleSave() {
      state.dirty = true;
      setStatus('Saving…');
      if (state.saveTimer) clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(function () {
        state.saveTimer = null;
        persistNow();
      }, 280);
    }

    function persistNow() {
      if (!state.record || state.readOnly) return Promise.resolve();
      var doc = normalizeDoc(state.doc, state.record);
      doc.updatedAt = isoNow();
      state.doc = doc;
      state.record.planOfRepair = doc;
      state.record.updatedAt = doc.updatedAt;
      return window.ToolboxDB.saveCustomerFile(state.record).then(function () {
        state.dirty = false;
        setStatus('Saved');
      }).catch(function (err) {
        console.error('Plan of Repair save failed', err);
        setStatus('Save failed');
      });
    }

    function symbolSizePx() {
      var frame = state.doc.planFrame;
      var shortSide = Math.min(
        (frame.w / 100) * (SHEET_W * 0.88),
        (frame.h / 100) * (SHEET_H * 0.98)
      );
      return Math.max(10, (state.doc.symbolSize / 100) * shortSide);
    }

    function defById(id) {
      var list = state.doc.symbolDefs || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return list[0] || null;
    }

    function renderTools() {
      toolsEl.innerHTML = '';
      state.doc.symbolDefs.forEach(function (def) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'por-tool' + (state.placeDefId === def.id ? ' is-active' : '');
        btn.title = def.label;
        btn.setAttribute('aria-pressed', state.placeDefId === def.id ? 'true' : 'false');
        btn.innerHTML = symbolSvg(def.kind, 18) + ' Place';
        btn.disabled = state.readOnly;
        btn.addEventListener('click', function () {
          if (state.readOnly) return;
          state.placeDefId = state.placeDefId === def.id ? null : def.id;
          state.selected = null;
          renderTools();
          renderSheet();
        });
        toolsEl.appendChild(btn);
      });
      var canvasSelect = document.createElement('select');
      canvasSelect.id = 'por-canvas';
      canvasSelect.className = 'por-tool';
      canvasSelect.setAttribute('aria-label', 'Plan / level');
      canvasSelect.disabled = state.readOnly;
      var canvases = (state.record && state.record.planSetup && state.record.planSetup.canvases) || [];
      canvases.forEach(function (canvas) {
        if (!window.ToolboxPlanSetup || !window.ToolboxPlanSetup.hasUsablePlan(canvas)) return;
        var opt = document.createElement('option');
        opt.value = canvas.id;
        opt.textContent = canvas.name || 'Plan';
        if (canvas.id === state.doc.canvasId) opt.selected = true;
        canvasSelect.appendChild(opt);
      });
      if (!canvasSelect.options.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'No plan on this file';
        canvasSelect.appendChild(empty);
      }
      canvasSelect.addEventListener('change', function () {
        if (state.readOnly) return;
        pushHistory();
        state.doc.canvasId = canvasSelect.value;
        loadPlan().then(function () {
          scheduleSave();
          renderSheet();
        });
      });
      toolsEl.appendChild(canvasSelect);
    }

    function renderRail() {
      var rail = state.doc.rail;
      var client = (rail.clientOverride && rail.clientOverride.trim()) || displayName(state.record);
      var address = (rail.addressOverride && rail.addressOverride.trim()) || displayAddress(state.record);
      var deg = rail.northRotation || 0;
      railEl.innerHTML =
        '<div class="por-rail__body">' +
        '  <div class="por-rail__compass" aria-label="North orientation">' +
        '    <svg class="por-rail__rose" viewBox="-30 -30 60 60" aria-hidden="true" focusable="false">' +
        '      <g transform="rotate(' + deg + ')">' +
        '        <circle cx="0" cy="0" r="26" fill="#fffaf0" stroke="#1a1a1a" stroke-width="1.5"/>' +
        '        <path d="M 0 -22 L 11 14 L 0 5 L -11 14 Z" fill="#c14a2b"/>' +
        '        <text x="0" y="20" fill="#1a1a1a" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="Georgia, \'Times New Roman\', serif">N</text>' +
        '      </g>' +
        '    </svg>' +
        '  </div>' +
        '  <header>' +
        '    <h2 class="por-rail__client por-rt" data-por-rail="client" contenteditable="' + (!state.readOnly) + '">' + escapeHtml(client) + '</h2>' +
        '    <address class="por-rail__address por-rt" data-por-rail="address" contenteditable="' + (!state.readOnly) + '">' + escapeHtml(address) + '</address>' +
        '  </header>' +
        '  <section class="por-rail__section">' +
        '    <h3 class="por-rail__label">Drawing title</h3>' +
        '    <p class="por-rail__title por-rt" data-por-rail="title" contenteditable="' + (!state.readOnly) + '">' + escapeHtml(rail.title) + '</p>' +
        '  </section>' +
        '  <section class="por-rail__section">' +
        '    <h3 class="por-rail__label">Plan date</h3>' +
        '    <p class="por-rail__date por-rt" data-por-rail="date" contenteditable="' + (!state.readOnly) + '">' + escapeHtml(rail.date || '') + '</p>' +
        '  </section>' +
        '  <section class="por-rail__section">' +
        '    <h3 class="por-rail__label">Status</h3>' +
        '    <p class="por-rail__status por-rt" data-por-rail="status" contenteditable="' + (!state.readOnly) + '">' + escapeHtml(rail.status) + '</p>' +
        '  </section>' +
        '  <section class="por-rail__section">' +
        '    <h3 class="por-rail__label">Sheet</h3>' +
        '    <p class="por-rail__sheet por-rt" data-por-rail="sheetId" contenteditable="' + (!state.readOnly) + '">' + escapeHtml(rail.sheetId) + '</p>' +
        '  </section>' +
        '</div>' +
        '<footer class="por-rail__foot">' +
        '  <p class="por-rail__brand" title="' + escapeAttr(PLACEHOLDER_TLS) + '">TLS Foundations<small>text brand mark</small></p>' +
        '  <img class="por-rail__sandia' + (rail.showSandiaAttribution ? ' is-on' : '') + '" src="brand/sandia-geo.png" alt="Sandia GEO">' +
        '  <p class="por-rail__sandia-note' + (rail.showSandiaAttribution ? ' is-on' : '') + '">Survey information by SandiaGEO</p>' +
        '</footer>';

      railEl.querySelectorAll('[data-por-rail]').forEach(function (el) {
        el.addEventListener('focus', function () {
          if (state.readOnly) return;
          el.setAttribute('data-por-before', el.textContent || '');
        });
        el.addEventListener('blur', function () {
          if (state.readOnly) return;
          var key = el.getAttribute('data-por-rail');
          var before = el.getAttribute('data-por-before') || '';
          var next = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
          if (next === before.trim()) return;
          pushHistory();
          if (key === 'client') state.doc.rail.clientOverride = next;
          else if (key === 'address') state.doc.rail.addressOverride = next;
          else if (key === 'title') state.doc.rail.title = next || 'Preliminary Underpinning Plan';
          else if (key === 'date') state.doc.rail.date = next;
          else if (key === 'status') state.doc.rail.status = next || 'Preliminary — Subject to Structural Engineering';
          else if (key === 'sheetId') state.doc.rail.sheetId = next || 'POR-1';
          scheduleSave();
        });
      });
    }

    function escapeHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function escapeAttr(text) {
      return escapeHtml(text).replace(/"/g, '&quot;');
    }

    function renderSheet() {
      var doc = state.doc;
      var frame = doc.planFrame;
      drawingEl.innerHTML = '';

      var plan = document.createElement('div');
      plan.className = 'por-plan' +
        (state.selected && state.selected.kind === 'plan' ? ' is-selected' : '') +
        (state.placeDefId ? ' is-placing' : '');
      plan.style.left = frame.x + '%';
      plan.style.top = frame.y + '%';
      plan.style.width = frame.w + '%';
      plan.style.height = frame.h + '%';
      plan.setAttribute('data-por-plan', '1');

      var fit = document.createElement('div');
      fit.className = 'por-plan__fit';
      if (state.planUrl) {
        var img = document.createElement('img');
        img.className = 'por-plan__image';
        img.alt = 'Floor plan';
        img.src = state.planUrl;
        fit.appendChild(img);
      } else {
        var missing = document.createElement('div');
        missing.className = 'por-plan__missing';
        missing.textContent = 'Choose a Customer File plan to begin the repair worksheet.';
        fit.appendChild(missing);
      }

      var layer = document.createElement('div');
      layer.className = 'por-symbols';
      var sizePx = symbolSizePx();
      doc.symbols.forEach(function (sym) {
        var def = defById(sym.defId);
        if (!def) return;
        var marker = document.createElement('div');
        marker.className = 'por-symbol' +
          (state.selected && state.selected.kind === 'symbol' && state.selected.id === sym.id
            ? ' is-selected' : '');
        marker.style.left = (sym.x * 100) + '%';
        marker.style.top = (sym.y * 100) + '%';
        marker.style.width = sizePx + 'px';
        marker.style.height = sizePx + 'px';
        marker.setAttribute('data-por-symbol', sym.id);
        marker.innerHTML = symbolSvg(def.kind, sizePx);
        marker.title = def.label;
        layer.appendChild(marker);
      });
      fit.appendChild(layer);
      plan.appendChild(fit);

      var grip = document.createElement('span');
      grip.className = 'por-plan__grip';
      grip.setAttribute('data-por-plan-resize', '1');
      plan.appendChild(grip);
      drawingEl.appendChild(plan);

      // Legend — only defs actually used on the sheet.
      var defs = usedDefs(doc);
      var legend = document.createElement('div');
      legend.className = 'por-legend' +
        (state.selected && state.selected.kind === 'legend' ? ' is-selected' : '');
      legend.style.left = doc.legend.x + '%';
      legend.style.top = doc.legend.y + '%';
      legend.style.width = doc.legend.w + '%';
      legend.setAttribute('data-por-legend', '1');
      var legendTitle = document.createElement('p');
      legendTitle.className = 'por-legend__title';
      legendTitle.textContent = 'Legend';
      legend.appendChild(legendTitle);
      if (!defs.length) {
        var empty = document.createElement('p');
        empty.className = 'por-legend__label';
        empty.textContent = 'Place a repair symbol to fill the legend.';
        legend.appendChild(empty);
      } else {
        defs.forEach(function (def) {
          var row = document.createElement('div');
          row.className = 'por-legend__row';
          var swatch = document.createElement('div');
          swatch.className = 'por-legend__swatch';
          swatch.innerHTML = symbolSvg(def.kind, 22);
          var label = document.createElement('p');
          label.className = 'por-legend__label por-rt';
          label.setAttribute('contenteditable', state.readOnly ? 'false' : 'true');
          label.setAttribute('data-por-def-label', def.id);
          label.textContent = def.label;
          row.appendChild(swatch);
          row.appendChild(label);
          legend.appendChild(row);
        });
      }
      var legendGrip = document.createElement('span');
      legendGrip.className = 'por-box__grip';
      legendGrip.setAttribute('data-por-legend-resize', '1');
      legend.appendChild(legendGrip);
      drawingEl.appendChild(legend);

      doc.notes.forEach(function (note) {
        var box = document.createElement('div');
        box.className = 'por-note' +
          (state.selected && state.selected.kind === 'note' && state.selected.id === note.id
            ? ' is-selected' : '');
        box.style.left = note.x + '%';
        box.style.top = note.y + '%';
        box.style.width = note.w + '%';
        box.setAttribute('data-por-note', note.id);
        var text = document.createElement('p');
        text.className = 'por-note__text por-rt';
        text.setAttribute('contenteditable', state.readOnly ? 'false' : 'true');
        text.setAttribute('data-por-note-text', note.id);
        text.textContent = note.text || '';
        box.appendChild(text);
        var noteGrip = document.createElement('span');
        noteGrip.className = 'por-box__grip';
        noteGrip.setAttribute('data-por-note-resize', note.id);
        box.appendChild(noteGrip);
        drawingEl.appendChild(box);
      });

      renderRail();
      wireSheetEditors();
      state.scale = applySheetScale(sheetEl, stageEl);
      syncHistoryButtons();
      sizeInput.value = String(doc.symbolSize);
      sandiaInput.checked = !!doc.rail.showSandiaAttribution;
    }

    function wireSheetEditors() {
      drawingEl.querySelectorAll('[data-por-def-label]').forEach(function (el) {
        el.addEventListener('focus', function () {
          el.setAttribute('data-por-before', el.textContent || '');
        });
        el.addEventListener('blur', function () {
          if (state.readOnly) return;
          var id = el.getAttribute('data-por-def-label');
          var before = el.getAttribute('data-por-before') || '';
          var next = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
          if (!next || next === before.trim()) {
            var def = defById(id);
            if (def) el.textContent = def.label;
            return;
          }
          pushHistory();
          var target = defById(id);
          if (target) target.label = next;
          scheduleSave();
          renderSheet();
        });
      });
      drawingEl.querySelectorAll('[data-por-note-text]').forEach(function (el) {
        el.addEventListener('focus', function () {
          el.setAttribute('data-por-before', el.textContent || '');
        });
        el.addEventListener('blur', function () {
          if (state.readOnly) return;
          var id = el.getAttribute('data-por-note-text');
          var before = el.getAttribute('data-por-before') || '';
          var next = (el.textContent || '').replace(/\u00a0/g, ' ');
          if (next === before) return;
          pushHistory();
          var note = state.doc.notes.find(function (n) { return n.id === id; });
          if (note) note.text = next;
          scheduleSave();
        });
      });
    }

    function pointerToPlanNorm(clientX, clientY) {
      var fit = drawingEl.querySelector('.por-plan__fit');
      if (!fit) return null;
      var rect = fit.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return null;
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      };
    }

    function pointerToDrawingPct(clientX, clientY) {
      var rect = drawingEl.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100,
      };
    }

    function onPointerDown(event) {
      if (state.readOnly) return;
      if (event.button != null && event.button !== 0) return;
      var target = event.target;
      if (target && target.closest && target.closest('[contenteditable="true"]')) return;

      var resizePlan = target.closest && target.closest('[data-por-plan-resize]');
      var resizeLegend = target.closest && target.closest('[data-por-legend-resize]');
      var resizeNote = target.closest && target.closest('[data-por-note-resize]');
      var symbolEl = target.closest && target.closest('[data-por-symbol]');
      var noteEl = target.closest && target.closest('[data-por-note]');
      var legendEl = target.closest && target.closest('[data-por-legend]');
      var planEl = target.closest && target.closest('[data-por-plan]');

      if (state.placeDefId && planEl && !symbolEl && !resizePlan) {
        var at = pointerToPlanNorm(event.clientX, event.clientY);
        if (!at) return;
        event.preventDefault();
        pushHistory();
        state.doc.symbols.push({
          id: uid('sym'),
          defId: state.placeDefId,
          x: at.x,
          y: at.y,
        });
        state.selected = { kind: 'symbol', id: state.doc.symbols[state.doc.symbols.length - 1].id };
        scheduleSave();
        renderSheet();
        return;
      }

      if (resizePlan) {
        event.preventDefault();
        pushHistory();
        state.selected = { kind: 'plan' };
        state.drag = {
          mode: 'resize-plan',
          startX: event.clientX,
          startY: event.clientY,
          orig: deepClone(state.doc.planFrame),
        };
        renderSheet();
        return;
      }
      if (resizeLegend) {
        event.preventDefault();
        pushHistory();
        state.selected = { kind: 'legend' };
        state.drag = {
          mode: 'resize-legend',
          startX: event.clientX,
          startY: event.clientY,
          orig: deepClone(state.doc.legend),
        };
        renderSheet();
        return;
      }
      if (resizeNote) {
        event.preventDefault();
        var noteId = resizeNote.getAttribute('data-por-note-resize');
        var note = state.doc.notes.find(function (n) { return n.id === noteId; });
        if (!note) return;
        pushHistory();
        state.selected = { kind: 'note', id: noteId };
        state.drag = {
          mode: 'resize-note',
          id: noteId,
          startX: event.clientX,
          startY: event.clientY,
          orig: deepClone(note),
        };
        renderSheet();
        return;
      }

      if (symbolEl) {
        event.preventDefault();
        var sid = symbolEl.getAttribute('data-por-symbol');
        var sym = state.doc.symbols.find(function (s) { return s.id === sid; });
        if (!sym) return;
        pushHistory();
        state.placeDefId = null;
        state.selected = { kind: 'symbol', id: sid };
        state.drag = {
          mode: 'move-symbol',
          id: sid,
          grab: pointerToPlanNorm(event.clientX, event.clientY),
          orig: { x: sym.x, y: sym.y },
        };
        renderTools();
        renderSheet();
        return;
      }

      if (legendEl) {
        event.preventDefault();
        pushHistory();
        state.selected = { kind: 'legend' };
        var lp = pointerToDrawingPct(event.clientX, event.clientY);
        state.drag = {
          mode: 'move-legend',
          start: lp,
          orig: deepClone(state.doc.legend),
        };
        renderSheet();
        return;
      }

      if (noteEl) {
        event.preventDefault();
        var nid = noteEl.getAttribute('data-por-note');
        var nobj = state.doc.notes.find(function (n) { return n.id === nid; });
        if (!nobj) return;
        pushHistory();
        state.selected = { kind: 'note', id: nid };
        var np = pointerToDrawingPct(event.clientX, event.clientY);
        state.drag = {
          mode: 'move-note',
          id: nid,
          start: np,
          orig: deepClone(nobj),
        };
        renderSheet();
        return;
      }

      if (planEl) {
        event.preventDefault();
        pushHistory();
        state.selected = { kind: 'plan' };
        var pp = pointerToDrawingPct(event.clientX, event.clientY);
        state.drag = {
          mode: 'move-plan',
          start: pp,
          orig: deepClone(state.doc.planFrame),
        };
        renderSheet();
        return;
      }

      state.selected = null;
      state.placeDefId = null;
      renderTools();
      renderSheet();
    }

    function onPointerMove(event) {
      if (!state.drag) return;
      event.preventDefault();
      var d = state.drag;
      var drawingRect = drawingEl.getBoundingClientRect();
      var dxPct = ((event.clientX - (d.startX || 0)) / drawingRect.width) * 100;
      var dyPct = ((event.clientY - (d.startY || 0)) / drawingRect.height) * 100;

      if (d.mode === 'move-symbol') {
        var at = pointerToPlanNorm(event.clientX, event.clientY);
        if (!at || !d.grab) return;
        var sym = state.doc.symbols.find(function (s) { return s.id === d.id; });
        if (!sym) return;
        sym.x = d.orig.x + (at.x - d.grab.x);
        sym.y = d.orig.y + (at.y - d.grab.y);
        renderSheet();
        return;
      }
      if (d.mode === 'move-plan' && d.start) {
        var p = pointerToDrawingPct(event.clientX, event.clientY);
        if (!p) return;
        state.doc.planFrame.x = clamp(d.orig.x + (p.x - d.start.x), 0, 90);
        state.doc.planFrame.y = clamp(d.orig.y + (p.y - d.start.y), 0, 90);
        renderSheet();
        return;
      }
      if (d.mode === 'resize-plan') {
        state.doc.planFrame.w = clamp(d.orig.w + dxPct, 20, 96);
        state.doc.planFrame.h = clamp(d.orig.h + dyPct, 20, 96);
        renderSheet();
        return;
      }
      if (d.mode === 'move-legend' && d.start) {
        var l = pointerToDrawingPct(event.clientX, event.clientY);
        if (!l) return;
        state.doc.legend.x = clamp(d.orig.x + (l.x - d.start.x), 0, 90);
        state.doc.legend.y = clamp(d.orig.y + (l.y - d.start.y), 0, 90);
        renderSheet();
        return;
      }
      if (d.mode === 'resize-legend') {
        state.doc.legend.w = clamp(d.orig.w + dxPct, 12, 60);
        state.doc.legend.h = clamp(d.orig.h + dyPct, 8, 40);
        renderSheet();
        return;
      }
      if (d.mode === 'move-note' && d.start) {
        var npos = pointerToDrawingPct(event.clientX, event.clientY);
        var note = state.doc.notes.find(function (n) { return n.id === d.id; });
        if (!npos || !note) return;
        note.x = clamp(d.orig.x + (npos.x - d.start.x), 0, 92);
        note.y = clamp(d.orig.y + (npos.y - d.start.y), 0, 92);
        renderSheet();
        return;
      }
      if (d.mode === 'resize-note') {
        var n2 = state.doc.notes.find(function (n) { return n.id === d.id; });
        if (!n2) return;
        n2.w = clamp(d.orig.w + dxPct, 8, 70);
        n2.h = clamp(d.orig.h + dyPct, 4, 50);
        renderSheet();
      }
    }

    function onPointerUp() {
      if (!state.drag) return;
      state.drag = null;
      scheduleSave();
      renderSheet();
    }

    function deleteSelected() {
      if (state.readOnly || !state.selected) return;
      if (state.selected.kind === 'symbol') {
        pushHistory();
        state.doc.symbols = state.doc.symbols.filter(function (s) {
          return s.id !== state.selected.id;
        });
        state.selected = null;
        scheduleSave();
        renderSheet();
      } else if (state.selected.kind === 'note') {
        pushHistory();
        state.doc.notes = state.doc.notes.filter(function (n) {
          return n.id !== state.selected.id;
        });
        state.selected = null;
        scheduleSave();
        renderSheet();
      }
    }

    function copySelected() {
      if (!state.selected || state.selected.kind !== 'symbol') return false;
      var sym = state.doc.symbols.find(function (s) { return s.id === state.selected.id; });
      if (!sym) return false;
      state.clipboard = deepClone(sym);
      setStatus('Symbol copied');
      return true;
    }

    function pasteClipboard() {
      if (state.readOnly || !state.clipboard) return false;
      pushHistory();
      var copy = deepClone(state.clipboard);
      copy.id = uid('sym');
      copy.x = Number(copy.x) + 0.03;
      copy.y = Number(copy.y) + 0.03;
      state.doc.symbols.push(copy);
      state.selected = { kind: 'symbol', id: copy.id };
      scheduleSave();
      renderSheet();
      setStatus('Symbol pasted');
      return true;
    }

    function onKeyDown(event) {
      if (!activeMount || activeMount.root !== root) return;
      var typing = event.target && (
        event.target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      );
      if (event.key === 'Escape') {
        state.placeDefId = null;
        state.selected = null;
        renderTools();
        renderSheet();
        return;
      }
      if (typing) return;
      var mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && (event.key === 'c' || event.key === 'C')) {
        if (copySelected()) event.preventDefault();
        return;
      }
      if (mod && (event.key === 'v' || event.key === 'V')) {
        if (pasteClipboard()) event.preventDefault();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      }
    }

    function undo() {
      if (state.readOnly || !state.undo.length) return;
      state.redo.push(snapshot());
      state.doc = normalizeDoc(state.undo.pop(), state.record);
      scheduleSave();
      renderTools();
      renderSheet();
    }

    function redo() {
      if (state.readOnly || !state.redo.length) return;
      state.undo.push(snapshot());
      state.doc = normalizeDoc(state.redo.pop(), state.record);
      scheduleSave();
      renderTools();
      renderSheet();
    }

    function loadPlan() {
      state.planUrl = '';
      state.planW = 0;
      state.planH = 0;
      var record = state.record;
      if (!record || !window.ToolboxPlanSetup) return Promise.resolve();
      var canvas = window.ToolboxPlanSetup.canvasById
        ? window.ToolboxPlanSetup.canvasById(record, state.doc.canvasId)
        : null;
      if (!canvas || !window.ToolboxPlanSetup.hasUsablePlan(canvas)) {
        var usable = (record.planSetup && record.planSetup.canvases || []).find(function (c) {
          return window.ToolboxPlanSetup.hasUsablePlan(c);
        });
        if (usable) {
          state.doc.canvasId = usable.id;
          canvas = usable;
        }
      }
      if (!canvas || !canvas.plan || !canvas.plan.id) return Promise.resolve();
      state.planW = Number(canvas.plan.width) || 0;
      state.planH = Number(canvas.plan.height) || 0;
      if (!window.ToolboxDB || typeof window.ToolboxDB.getMedia !== 'function') {
        return Promise.resolve();
      }
      return window.ToolboxDB.getMedia(canvas.plan.id).then(function (url) {
        if (typeof url === 'string' && url.indexOf('data:image/') === 0) {
          state.planUrl = url;
        }
      }).catch(function () {});
    }

    function buildPrintSheet() {
      var clone = sheetEl.cloneNode(true);
      clone.querySelectorAll('.por-plan__grip, .por-box__grip').forEach(function (el) {
        el.parentNode && el.parentNode.removeChild(el);
      });
      clone.querySelectorAll('.is-selected').forEach(function (el) {
        el.classList.remove('is-selected');
      });
      clone.querySelectorAll('[contenteditable]').forEach(function (el) {
        el.removeAttribute('contenteditable');
      });
      clone.style.transform = 'none';
      return clone;
    }

    function printPdf() {
      return persistNow().then(function () {
        var deck = document.createElement('div');
        deck.className = 'por-print';
        var page = document.createElement('div');
        page.className = 'por-print__page';
        page.appendChild(buildPrintSheet());
        deck.appendChild(page);
        document.body.appendChild(deck);
        document.body.classList.add('is-por-printing');
        var priorTitle = document.title;
        var name = displayName(state.record).replace(/[^\w\- ]+/g, '').trim() || 'Plan-of-Repair';
        document.title = name + ' Preliminary Repair Plan';
        var cleaned = false;
        function cleanup() {
          if (cleaned) return;
          cleaned = true;
          document.body.classList.remove('is-por-printing');
          if (deck.parentNode) deck.parentNode.removeChild(deck);
          document.title = priorTitle;
        }
        window.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(function () {
          try { window.print(); } catch (err) { cleanup(); }
          setTimeout(cleanup, 1500);
        }, 50);
      });
    }

    function onResize() {
      state.scale = applySheetScale(sheetEl, stageEl);
    }

    root.querySelector('#por-back').addEventListener('click', function () {
      persistNow().then(onBack);
    });
    root.querySelector('#por-undo').addEventListener('click', undo);
    root.querySelector('#por-redo').addEventListener('click', redo);
    root.querySelector('#por-add-note').addEventListener('click', function () {
      if (state.readOnly) return;
      pushHistory();
      var note = {
        id: uid('note'),
        x: 8,
        y: 8,
        w: 18,
        h: 10,
        text: 'Note',
      };
      state.doc.notes.push(note);
      state.selected = { kind: 'note', id: note.id };
      scheduleSave();
      renderSheet();
    });
    root.querySelector('#por-print').addEventListener('click', function () {
      printPdf();
    });
    sizeInput.addEventListener('change', function () {
      if (state.readOnly) return;
      pushHistory();
      state.doc.symbolSize = clamp(sizeInput.value, 1.2, 8);
      scheduleSave();
      renderSheet();
    });
    sandiaInput.addEventListener('change', function () {
      if (state.readOnly) return;
      pushHistory();
      state.doc.rail.showSandiaAttribution = !!sandiaInput.checked;
      scheduleSave();
      renderSheet();
    });

    sheetEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);

    activeMount = {
      root: root,
      host: host,
      persistNow: persistNow,
      destroy: function () {
        if (state.saveTimer) {
          clearTimeout(state.saveTimer);
          state.saveTimer = null;
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
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
      state.readOnly = !!(window.ToolboxSync &&
        typeof window.ToolboxSync.heldElsewhere === 'function' &&
        window.ToolboxSync.heldElsewhere(record));
      state.doc = normalizeDoc(record.planOfRepair, record);
      if (!state.doc.rail.date) {
        var today = new Date();
        state.doc.rail.date = (today.getMonth() + 1) + '/' + today.getDate() + '/' + today.getFullYear();
      }
      sizeInput.disabled = state.readOnly;
      sandiaInput.disabled = state.readOnly;
      root.querySelector('#por-add-note').disabled = state.readOnly;
      if (state.readOnly) setStatus('View only — checked out elsewhere');
      return loadPlan().then(function () {
        renderTools();
        renderSheet();
        if (!state.readOnly && !record.planOfRepair) scheduleSave();
        else if (!state.readOnly) setStatus('Ready');
      });
    }).catch(function (err) {
      console.error(err);
      setStatus('Unable to open Plan of Repair');
    });
  }

  function unmount() {
    if (!activeMount) return;
    try {
      if (typeof activeMount.persistNow === 'function') activeMount.persistNow();
    } catch (_) {}
    activeMount.destroy();
    activeMount = null;
  }

  window.ToolboxPlanOfRepair = {
    mount: mount,
    unmount: unmount,
    normalizeDoc: normalizeDoc,
    defaultSymbolDefs: defaultSymbolDefs,
    usedDefs: usedDefs,
    SHEET_W: SHEET_W,
    SHEET_H: SHEET_H,
  };
})();
