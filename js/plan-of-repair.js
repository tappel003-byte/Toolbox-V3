// Toolbox — Plan of Repair drawing workspace (Fabric.js drawing surface).
//
// TLS doorway. Pages / backgrounds / views / TLS title block / Print unchanged
// in role. Drawing marks run on vendored Fabric.js (see js/por-fabric.js).
// Report Builder and js/report-overlay.js are not modified.
//
// Document lives on record.planOfRepair (sync component `repair`).
(function () {
  'use strict';

  var PAPER_W = 1632;
  var PAPER_H = 1056;
  /** Drawing area stays left of the TLS title block (~12.5% rail). */
  var DRAW_MAX_RIGHT = 84;
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
    var identity = window.ToolboxApp && window.ToolboxApp.customerIdentity;
    if (identity && typeof identity.displayName === 'function') {
      var named = identity.displayName(record || {});
      if (named && named !== 'New Customer File') return named;
    }
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
      schemaVersion: 3,
      engine: 'fabric',
      fabricVersion: (window.ToolboxPorFabric && window.ToolboxPorFabric.VERSION) || '5.3.0',
      activePageId: page.id,
      northRotation: (raw.rail && Number(raw.rail.northRotation)) || 0,
      pages: [page],
      showSandiaAttribution: !!(raw.rail && raw.rail.showSandiaAttribution),
    };
  }

  var POR_OVERLAY_KINDS = {
    path: 1, rect: 1, roundRect: 1, circle: 1, triangle: 1,
    line: 1, arrow: 1, text: 1, image: 1, group: 1, ellipse: 1,
  };

  function normalizePorOverlays(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      var kind = POR_OVERLAY_KINDS[raw.kind] ? raw.kind : null;
      if (!kind) {
        // Legacy / foreign — let RB normalize handle placed boxes only.
        if (window.ToolboxReportOverlay && window.ToolboxReportOverlay.normalize) {
          var one = window.ToolboxReportOverlay.normalize([raw])[0];
          if (one) out.push(one);
        }
        return;
      }
      // Shallow clone keeps Fabric fields (bold, fontSize, members, angle, mediaId…).
      var item = Object.assign({}, raw);
      item.kind = kind;
      if (!item.id) item.id = uid('ov');
      if (kind === 'group' && Array.isArray(raw.members)) {
        item.members = normalizePorOverlays(raw.members);
      }
      // Legacy rich text {paragraphs:[{runs:[{bold:true}]}]} → Fabric bold flag.
      if (kind === 'text' && item.text && typeof item.text === 'object') {
        var rich = (window.ToolboxPorFabric && window.ToolboxPorFabric.richTextPlainAndBold)
          ? window.ToolboxPorFabric.richTextPlainAndBold(item)
          : null;
        if (rich) {
          if (rich.bold) item.bold = true;
          if (rich.italic) item.italic = true;
          if (rich.underline) item.underline = true;
          if (rich.strike) item.strike = true;
          if (rich.fontSize != null && item.fontSize == null) item.fontSize = rich.fontSize;
          item.text = rich.text;
        }
      }
      out.push(item);
    });
    return out;
  }

  function normalizeDoc(raw) {
    if (raw && Array.isArray(raw.pages)) {
      var pages = raw.pages.map(function (p, i) {
        var page = blankPage((p && p.title) || ('Drawing ' + (i + 1)));
        if (p && p.id) page.id = p.id;
        // Fabric POR overlays carry fields RB normalize strips (bold, roundRect,
        // line, group, triangle, angle…). Keep a POR-aware pass; do not run
        // ToolboxReportOverlay.normalize on schema-v3 drawings.
        page.overlays = normalizePorOverlays(p.overlays || []);
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
              // Contour switched on over the floor plan (plan multiplied over it).
              contourOn: p.background.kind === 'plan' && p.background.contourOn === true,
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
        // v3 = Fabric-backed drawing surface (Tim, Nov 10, 2026).
        schemaVersion: 3,
        engine: 'fabric',
        fabricVersion: (window.ToolboxPorFabric && window.ToolboxPorFabric.VERSION) || '5.3.0',
        activePageId: active,
        northRotation: isFinite(Number(raw.northRotation)) ? Number(raw.northRotation) : 0,
        pages: pages,
        showSandiaAttribution: !!raw.showSandiaAttribution,
      };
    }
    var migrated = migrateLegacy(raw);
    if (migrated) {
      migrated.schemaVersion = 3;
      migrated.engine = 'fabric';
      migrated.fabricVersion = (window.ToolboxPorFabric && window.ToolboxPorFabric.VERSION) || '5.3.0';
      return migrated;
    }
    var first = blankPage('Drawing 1');
    first.rail.sheetId = 'POR-1';
    return {
      updatedAt: '',
      schema: 'toolbox.plan-of-repair',
      schemaVersion: 3,
      engine: 'fabric',
      fabricVersion: (window.ToolboxPorFabric && window.ToolboxPorFabric.VERSION) || '5.3.0',
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

    var inkColors = (window.ToolboxReportOverlay && window.ToolboxReportOverlay.COLORS) ||
      ['#c14a2b', '#111111', '#1d4ed8', '#16a34a', '#ea7317', '#eab308'];

    // Microsoft Fluent UI System Icons (MIT), regular weight — vendored in
    // js/vendor/fluent-icons.js + icons/fluent/*.svg. Add/restyle only; never strip controls.
    function svgIcon(body) {
      return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
        body + '</svg>';
    }

    function fluentIcon(name, cls) {
      var api = window.ToolboxFluentIcons;
      if (api && typeof api.icon === 'function') {
        var html = api.icon(name, cls || '');
        if (html) return html;
      }
      return '';
    }

    var SHAPE_TOOLS = ['line', 'arrow', 'rect', 'roundRect', 'circle', 'triangle'];

    var ICONS = {
      select: fluentIcon('cursor', 'fluent-icon--accent') || svgIcon('<path d="M5.5 3.5 11.2 20l2-6.2L19.5 11.8z"/>'),
      undo: fluentIcon('arrow_undo') || svgIcon('<path d="M8.5 9.5h7a4 4 0 1 1 0 8H11"/><path d="M11.5 6.5 8 9.5l3.5 3"/>'),
      redo: fluentIcon('arrow_redo') || svgIcon('<path d="M15.5 9.5h-7a4 4 0 1 0 0 8H13"/><path d="M12.5 6.5 16 9.5l-3.5 3"/>'),
      pencil: fluentIcon('pen') || svgIcon('<path d="M4.5 19.5 5.8 15.2 15.5 5.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L9.3 17.7 4.5 19.5z"/><path d="M14 7l3 3"/>'),
      arrow: fluentIcon('arrow_up_right') || svgIcon('<path d="M5 19 18 6"/><path d="M11 6h7v7"/>'),
      rect: fluentIcon('rectangle') || svgIcon('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
      circle: fluentIcon('circle') || svgIcon('<circle cx="12" cy="12" r="7.5"/>'),
      text: fluentIcon('textbox') || svgIcon('<path d="M5.5 6.5h13M12 6.5v11M8.5 17.5h7"/>'),
      eraser: fluentIcon('eraser') || svgIcon('<path d="M8.2 19H5.6a1.4 1.4 0 0 1-1-2.4L14 7.2a1.8 1.8 0 0 1 2.5 0l2.2 2.2a1.8 1.8 0 0 1 0 2.5L12.2 18.4"/><path d="M8.2 19h10.3"/>'),
      weight: fluentIcon('line') || svgIcon('<path d="M4 8.5h16M4 12h16M4 15.5h16" stroke-width="1.1"/><path d="M4 12h16" stroke-width="2.6"/>'),
      cut: fluentIcon('cut') || svgIcon('<circle cx="6.2" cy="7.2" r="2.2"/><circle cx="6.2" cy="16.8" r="2.2"/><path d="M7.8 8.6 18.5 4.2"/><path d="M7.8 15.4 18.5 19.8"/>'),
      copy: fluentIcon('copy') || svgIcon('<rect x="8.5" y="7.5" width="10" height="12" rx="1"/><path d="M5.5 14.5V5.5a1 1 0 0 1 1-1h8"/>'),
      paste: fluentIcon('clipboard_paste', 'fluent-icon--paste') || svgIcon('<path d="M9 3.8h6v2.6H9z"/><rect x="6" y="5.5" width="12" height="14.2" rx="1.2"/><path d="M9.5 11.5h5M9.5 14.5h5"/>'),
      fillBucket: fluentIcon('paint_bucket', 'fluent-icon--fill') || svgIcon('<path d="M4.5 13.5 12 6l5.5 5.5-7.5 7.5H4.5z"/>'),
      outlinePen: fluentIcon('pen', 'fluent-icon--outline') || svgIcon('<path d="M4.5 19.5 5.8 15.2 15.6 5.4a1.7 1.7 0 0 1 2.4 0l.5.5a1.7 1.7 0 0 1 0 2.4L9.3 17.7 4.5 19.5z"/>'),
      styleBrush: fluentIcon('paint_brush', 'fluent-icon--style') || svgIcon('<path d="M7.5 3.5h6.5l2.8 2.8v3.4H7.5z"/><path d="M9.5 9.7v7.2a2 2 0 0 0 4 0v-1.6"/>'),
      bringForward: fluentIcon('layer', 'fluent-icon--arrange') || svgIcon('<rect x="8.5" y="4.5" width="10" height="10" rx="1"/><rect x="4.5" y="8.5" width="10" height="10" rx="1"/>'),
      sendBackward: fluentIcon('layer_diagonal', 'fluent-icon--arrange') || fluentIcon('layer', 'fluent-icon--arrange') || svgIcon('<rect x="4.5" y="8.5" width="10" height="10" rx="1"/><rect x="8.5" y="4.5" width="10" height="10" rx="1"/>'),
      selectionPane: fluentIcon('apps_list') || svgIcon('<rect x="5" y="5" width="10" height="10" rx="1"/><rect x="9" y="9" width="10" height="10" rx="1"/>'),
      align: fluentIcon('align_left') || svgIcon('<path d="M5 5.5v13"/><path d="M8 7.5h10M8 12h7M8 16.5h10"/>'),
      group: fluentIcon('group') || svgIcon('<rect x="4.5" y="4.5" width="9" height="9" rx="1" stroke-dasharray="2 1.5"/><rect x="10.5" y="10.5" width="9" height="9" rx="1" stroke-dasharray="2 1.5"/>'),
      rotate: fluentIcon('rotate') || svgIcon('<path d="M7 16.5 16.5 7"/><path d="M7 7v9.5h9.5"/>'),
      textBox: fluentIcon('textbox') || svgIcon('<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M8 10h8M8 14h5"/>'),
      shapes: fluentIcon('shapes') || svgIcon('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
      effects: fluentIcon('effects', 'fluent-icon--effects') || fluentIcon('sparkle', 'fluent-icon--effects') || svgIcon('<path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5.1L12 14.8 7.5 16.8l.9-5.1L4.8 8.2l5-.7z"/>'),
      star: fluentIcon('star', 'fluent-icon--star') || svgIcon('<path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5.1L12 14.8 7.5 16.8l.9-5.1L4.8 8.2l5-.7z"/>'),
      bold: fluentIcon('text_bold') || '<b>B</b>',
      italic: fluentIcon('text_italic') || '<i>I</i>',
      underline: fluentIcon('text_underline') || '<u>U</u>',
      strike: fluentIcon('text_strikethrough') || '<s>S</s>',
      fontColor: fluentIcon('text_color') || '<span class="por-font-color__glyph">A</span>',
      fontGrow: fluentIcon('text_font_size') || 'A+',
      bullet: fluentIcon('bullet_list') || '•',
      grid: fluentIcon('grid') || '▦',
      hand: fluentIcon('hand') || svgIcon('<path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11"/>'),
      triangle: fluentIcon('triangle') || svgIcon('<path d="M12 4 20 19H4z"/>'),
      line: fluentIcon('line') || svgIcon('<path d="M5 19 19 5"/>'),
      square: fluentIcon('square') || svgIcon('<rect x="5" y="5" width="14" height="14" rx="1"/>'),
    };

    function shadeHex(hex, factor) {
      var h = String(hex || '#000000').replace('#', '');
      if (h.length !== 6) return hex;
      var r = Math.round(parseInt(h.slice(0, 2), 16) * factor);
      var g = Math.round(parseInt(h.slice(2, 4), 16) * factor);
      var b = Math.round(parseInt(h.slice(4, 6), 16) * factor);
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      return '#' + [r, g, b].map(function (n) {
        return ('0' + n.toString(16)).slice(-2);
      }).join('');
    }

    function colorGrid(attr) {
      var cells = [];
      inkColors.forEach(function (c) {
        [1.35, 1.15, 1, 0.75, 0.5].forEach(function (f) {
          var shade = f === 1 ? c : shadeHex(c, f);
          cells.push(
            '<button type="button" class="por-swatch" ' + attr + '="' + shade + '" ' +
            'style="--por-swatch:' + shade + '" title="' + shade + '" aria-label="Colour ' + shade + '"></button>'
          );
        });
      });
      return '<div class="por-swatch-grid">' + cells.join('') + '</div>';
    }

    // PowerPoint chrome: labeled ribbon groups, shape gallery, request-only
    // Format Shape / Selection panes, page thumbs left, status bar bottom.
    // Saved drawing format / sync / print behaviour unchanged.
    root.innerHTML =
      '<div class="view-bar view-bar--file rb-identity">' +
      '  <button type="button" id="por-back" class="btn btn--ghost">‹ TLS</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name">Plan of Repair</span>' +
      '    <span class="file-identity__address" id="por-file-label"></span>' +
      '  </div>' +
      '  <span class="file-status" id="por-status">Loading…</span>' +
      '</div>' +
      '<div class="por-tabs" role="tablist" aria-label="Plan of Repair tabs">' +
      '  <button type="button" class="por-tabs__tab" data-por-tab="file" disabled hidden>File</button>' +
      '  <button type="button" class="por-tabs__tab is-active" data-por-tab="home" aria-selected="true">Home</button>' +
      '  <button type="button" class="por-tabs__tab" data-por-tab="insert" id="por-tab-insert">Insert</button>' +
      '  <button type="button" class="por-tabs__tab" data-por-tab="draw" disabled hidden>Draw</button>' +
      '  <button type="button" class="por-tabs__tab" data-por-tab="design" disabled hidden>Design</button>' +
      '  <button type="button" class="por-tabs__tab" data-por-tab="view" disabled hidden>View</button>' +
      '</div>' +
      '<div class="por-toolbar por-ribbon" role="toolbar" aria-label="Drawing tools">' +
      '<div class="por-ribbon__scroll">' +
      '  <div class="por-ribbon__group por-ribbon__group--collapsible" data-por-collapse="clipboard" role="group" aria-label="Clipboard">' +
      '    <div class="por-ribbon__row por-ribbon__row--clipboard">' +
      '      <button type="button" class="por-ribbon__large" id="por-paste" title="Paste (Ctrl+V)" aria-label="Paste">' +
              ICONS.paste + '<span class="por-ribbon__large-label">Paste</span></button>' +
      '      <div class="por-ribbon__stack">' +
      '        <button type="button" class="por-iconbtn" id="por-cut" title="Cut (Ctrl+X)" aria-label="Cut">' + ICONS.cut + '</button>' +
      '        <button type="button" class="por-iconbtn" id="por-copy" title="Copy (Ctrl+C)" aria-label="Copy">' + ICONS.copy + '</button>' +
      '        <button type="button" class="por-iconbtn" id="por-format-painter" title="Format Painter" aria-label="Format Painter">' +
                ICONS.styleBrush + '</button>' +
      '      </div>' +
      '    </div>' +
      '    <span class="por-ribbon__label">Clipboard</span>' +
      '  </div>' +
      '  <div class="por-ribbon__sep" aria-hidden="true"></div>' +
      '  <div class="por-ribbon__group por-toolbar__text por-ribbon__group--collapsible por-ribbon__group--font" data-por-collapse="font" id="por-text-format" role="group" aria-label="Font">' +
      '    <div class="por-ribbon__font">' +
      '      <div class="por-ribbon__row">' +
      '        <select id="por-font-family" class="por-font-select" title="Font" aria-label="Font">' +
      '          <option value="Calibri, Arial, sans-serif">Calibri</option>' +
      '          <option value="Arial, sans-serif">Arial</option>' +
      '          <option value="Georgia, serif">Georgia</option>' +
      '          <option value="Times New Roman, serif">Times</option>' +
      '          <option value="Courier New, monospace">Courier</option>' +
      '        </select>' +
      '        <input type="number" id="por-font-size" class="por-font-size" min="8" max="96" value="18" title="Font size" aria-label="Font size">' +
      '        <button type="button" class="por-iconbtn" id="por-font-grow" title="Increase Font Size" aria-label="Grow font">' + ICONS.fontGrow + '</button>' +
      '        <button type="button" class="por-iconbtn" id="por-font-shrink" title="Decrease Font Size" aria-label="Shrink font">A−</button>' +
      '      </div>' +
      '      <div class="por-ribbon__row">' +
      '        <button type="button" class="por-iconbtn" data-por-text="bold" title="Bold" aria-label="Bold">' + ICONS.bold + '</button>' +
      '        <button type="button" class="por-iconbtn" data-por-text="italic" title="Italic" aria-label="Italic">' + ICONS.italic + '</button>' +
      '        <button type="button" class="por-iconbtn" data-por-text="underline" title="Underline" aria-label="Underline">' + ICONS.underline + '</button>' +
      '        <button type="button" class="por-iconbtn" data-por-text="strike" title="Strikethrough" aria-label="Strikethrough">' + ICONS.strike + '</button>' +
      '        <div class="por-picker" data-por-picker="font-color">' +
      '          <button type="button" class="por-picker__btn por-picker__btn--font" id="por-font-color-btn" title="Font Color" aria-label="Font colour" aria-haspopup="true" aria-expanded="false">' +
      '            ' + ICONS.fontColor + '<span class="por-picker__chip" id="por-font-color-chip"></span>' +
      '          </button>' +
      '          <div class="por-picker__pop por-picker__pop--colors" id="por-font-color-pop" hidden role="listbox" aria-label="Font colours">' +
                colorGrid('data-por-font-color') +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <span class="por-ribbon__label">Font</span>' +
      '  </div>' +
      '  <div class="por-ribbon__sep" aria-hidden="true"></div>' +
      '  <div class="por-ribbon__group por-ribbon__group--collapsible" data-por-collapse="paragraph" role="group" aria-label="Paragraph">' +
      '    <div class="por-ribbon__row">' +
      '      <button type="button" class="por-iconbtn" data-por-align="left" title="Align Left" aria-label="Align left">' + (fluentIcon('align_left') || '⫷') + '</button>' +
      '      <button type="button" class="por-iconbtn" data-por-align="center" title="Center" aria-label="Align center">' + (fluentIcon('align_center') || '☰') + '</button>' +
      '      <button type="button" class="por-iconbtn" data-por-align="right" title="Align Right" aria-label="Align right">' + (fluentIcon('align_right') || '⫸') + '</button>' +
      '      <button type="button" class="por-iconbtn" data-por-text="bullet" title="Bullets" aria-label="Bullets">' + ICONS.bullet + '</button>' +
      '      <button type="button" class="por-iconbtn" id="por-line-spacing" title="Line Spacing" aria-label="Line spacing" disabled>≡</button>' +
      '    </div>' +
      '    <span class="por-ribbon__label">Paragraph</span>' +
      '  </div>' +
      '  <div class="por-ribbon__sep" aria-hidden="true"></div>' +
      '  <div class="por-ribbon__group por-ribbon__group--collapsible" data-por-collapse="drawing" role="group" aria-label="Drawing">' +
      '    <div class="por-ribbon__row por-ribbon__row--drawing">' +
      '      <div class="por-picker por-shapes por-shapes--docked" data-por-picker="shapes">' +
      '        <div class="por-shapes__head">' +
      '          <button type="button" class="por-picker__btn por-shapes__btn" id="por-shapes-btn" title="Shapes" aria-label="Shapes" aria-haspopup="true" aria-expanded="true">' +
                    ICONS.shapes + '<span class="por-shapes__btn-label">Shapes</span><span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '        </div>' +
      '        <div class="por-picker__pop por-shapes__pop por-shapes__pop--docked" id="por-shapes-pop" role="menu" aria-label="Shapes">' +
      '          <div class="por-shapes__grid por-toolbar__tools">' +
      '            <button type="button" class="por-iconbtn is-on" data-por-tool="select" title="Select" aria-label="Select">' + ICONS.select + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="line" title="Line" aria-label="Line">' + ICONS.line + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="arrow" title="Arrow" aria-label="Arrow">' + ICONS.arrow + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="rect" title="Rectangle" aria-label="Rectangle">' + ICONS.rect + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="roundRect" title="Rounded Rectangle" aria-label="Rounded rectangle">' +
                      (fluentIcon('square') || svgIcon('<rect x="3.5" y="5.5" width="17" height="13" rx="4"/>')) + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="circle" title="Oval" aria-label="Circle">' + ICONS.circle + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="triangle" title="Triangle" aria-label="Triangle">' + ICONS.triangle + '</button>' +
      '            <button type="button" class="por-iconbtn" id="por-insert-text" title="Text Box" aria-label="Text">' + ICONS.textBox + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="pencil" title="Freeform" aria-label="Pencil">' + ICONS.pencil + '</button>' +
      '            <button type="button" class="por-iconbtn" data-rb-tool="eraser" title="Eraser" aria-label="Eraser">' + ICONS.eraser + '</button>' +
      '            <button type="button" class="por-iconbtn" id="por-keep-tool" title="Keep tool on for many marks" aria-label="Keep tool on" aria-pressed="false">' +
                      svgIcon('<path d="M7 7h10v10H7z"/><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2"/>') + '</button>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="por-ribbon__stack por-ribbon__stack--labelled">' +
      '        <div class="por-picker" data-por-picker="arrange">' +
      '          <button type="button" class="por-ribbon__large" id="por-arrange-btn" title="Arrange" aria-label="Arrange" aria-haspopup="true" aria-expanded="false">' +
                    ICONS.bringForward + '<span class="por-ribbon__large-label">Arrange</span><span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop por-arrange__pop" id="por-arrange-pop" hidden role="menu" aria-label="Arrange">' +
      '            <button type="button" class="por-menu-item" data-por-stack="front" title="Bring to Front">' +
                      ICONS.bringForward + '<span>Bring to Front</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-stack="forward" title="Bring Forward">' +
                      ICONS.bringForward + '<span>Bring Forward</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-stack="backward" title="Send Backward">' +
                      ICONS.sendBackward + '<span>Send Backward</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-stack="back" title="Send to Back">' +
                      ICONS.sendBackward + '<span>Send to Back</span></button>' +
      '            <div class="por-stackmenu__sep"></div>' +
      '            <button type="button" class="por-menu-item" data-por-align-marks="left" title="Align Left">' +
                      ICONS.align + '<span>Align Left</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-align-marks="center" title="Align Center">' +
                      ICONS.align + '<span>Align Center</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-align-marks="right" title="Align Right">' +
                      ICONS.align + '<span>Align Right</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-align-marks="top" title="Align Top">' +
                      ICONS.align + '<span>Align Top</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-align-marks="middle" title="Align Middle">' +
                      ICONS.align + '<span>Align Middle</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-align-marks="bottom" title="Align Bottom">' +
                      ICONS.align + '<span>Align Bottom</span></button>' +
      '            <div class="por-stackmenu__sep"></div>' +
      '            <button type="button" class="por-menu-item" data-por-distribute="h" title="Distribute Horizontally">' +
                      ICONS.align + '<span>Distribute Horizontally</span></button>' +
      '            <button type="button" class="por-menu-item" data-por-distribute="v" title="Distribute Vertically">' +
                      ICONS.align + '<span>Distribute Vertically</span></button>' +
      '            <div class="por-stackmenu__sep"></div>' +
      '            <button type="button" class="por-menu-item" id="por-group-btn" title="Group">' +
                      ICONS.group + '<span>Group</span></button>' +
      '            <button type="button" class="por-menu-item" id="por-ungroup-btn" title="Ungroup">' +
                      ICONS.group + '<span>Ungroup</span></button>' +
      '          </div>' +
      '        </div>' +
      '        <div class="por-picker" data-por-picker="styles">' +
      '          <button type="button" class="por-ribbon__large" id="por-styles-btn" title="Quick Styles" aria-label="Quick Styles" aria-haspopup="true" aria-expanded="false">' +
                    ICONS.styleBrush + '<span class="por-ribbon__large-label">Quick Styles</span><span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop por-styles__pop" id="por-styles-pop" hidden role="menu" aria-label="Quick Styles">' +
      '            <button type="button" class="por-menu-item" data-por-quick-style="#eab308" title="Gold fill">Gold</button>' +
      '            <button type="button" class="por-menu-item" data-por-quick-style="#1d4ed8" title="Blue fill">Blue</button>' +
      '            <button type="button" class="por-menu-item" data-por-quick-style="#c14a2b" title="Terra fill">Terra</button>' +
      '            <button type="button" class="por-menu-item" data-por-quick-style="#16a34a" title="Green fill">Green</button>' +
      '            <button type="button" class="por-menu-item" data-por-quick-style="#111111" title="Black fill">Black</button>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="por-ribbon__stack por-ribbon__stack--shape-style">' +
      '        <div class="por-picker" data-por-picker="fill">' +
      '          <button type="button" class="por-picker__btn por-picker__btn--shape por-picker__btn--labelled" id="por-fill-btn" title="Shape Fill" aria-label="Fill colour" aria-haspopup="true" aria-expanded="false">' +
      '            <span class="por-shape-fill__icon" aria-hidden="true">' + ICONS.fillBucket + '</span>' +
      '            <span class="por-picker__text">Shape Fill</span>' +
      '            <span class="por-picker__chip" id="por-fill-chip"></span>' +
      '            <span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop por-picker__pop--colors" id="por-fill-pop" hidden role="listbox" aria-label="Fill colours">' +
                colorGrid('data-por-fill') +
      '            <div class="por-picker__extras">' +
      '              <label class="por-picker__custom">Custom <input type="color" id="por-fill-custom" value="#eab308"></label>' +
      '              <div class="por-picker__recent" id="por-fill-recent" aria-label="Recent fill colours"></div>' +
      '            </div>' +
      '          </div>' +
      '        </div>' +
      '        <div class="por-picker" data-por-picker="outline">' +
      '          <button type="button" class="por-picker__btn por-picker__btn--shape por-picker__btn--labelled" id="por-outline-btn" title="Shape Outline" aria-label="Outline colour" aria-haspopup="true" aria-expanded="false">' +
      '            <span class="por-shape-outline__icon" aria-hidden="true">' + ICONS.outlinePen + '</span>' +
      '            <span class="por-picker__text">Shape Outline</span>' +
      '            <span class="por-picker__chip" id="por-outline-chip"></span>' +
      '            <span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop por-picker__pop--colors" id="por-outline-pop" hidden role="listbox" aria-label="Outline colours">' +
                colorGrid('data-por-outline') +
      '            <div class="por-picker__extras">' +
      '              <label class="por-picker__custom">Custom <input type="color" id="por-outline-custom" value="#1d4ed8"></label>' +
      '              <div class="por-picker__recent" id="por-outline-recent" aria-label="Recent outline colours"></div>' +
      '            </div>' +
      '          </div>' +
      '        </div>' +
      '        <div class="por-picker" data-por-picker="effects">' +
      '          <button type="button" class="por-picker__btn por-picker__btn--shape por-picker__btn--labelled" id="por-effects-btn" title="Shape Effects" aria-label="Shape Effects" aria-haspopup="true" aria-expanded="false">' +
      '            <span aria-hidden="true">' + ICONS.effects + '</span>' +
      '            <span class="por-picker__text">Shape Effects</span>' +
      '            <span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop" id="por-effects-pop" hidden role="menu" aria-label="Shape Effects">' +
      '            <button type="button" class="por-menu-item" data-por-effect="none" title="No effect">No Effect</button>' +
      '            <button type="button" class="por-menu-item" data-por-effect="shadow" title="Shadow">Shadow</button>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="por-ribbon__stack por-ribbon__stack--extras">' +
      '        <label class="por-fill-toggle por-fill-toggle--tool" title="Fill shapes when drawing"><input type="checkbox" id="por-fill" aria-label="Fill shapes"><span class="por-fill-toggle__text">Fill</span></label>' +
      '        <label class="por-opacity" title="Transparency"><span class="por-opacity__label">Transp.</span><input type="range" id="por-opacity" min="0" max="100" value="100" aria-label="Transparency"></label>' +
      '        <div class="por-ribbon__row">' +
      '          <div class="por-picker" data-por-picker="weight">' +
      '            <button type="button" class="por-picker__btn por-picker__btn--icon" id="por-weight-btn" title="Weight" aria-label="Line weight" aria-haspopup="true" aria-expanded="false">' +
                      ICONS.weight + '</button>' +
      '            <div class="por-picker__pop por-picker__pop--weight" id="por-weight-pop" hidden role="listbox" aria-label="Line weight">' +
      '              <button type="button" class="por-weight" data-por-pt="0.75" data-por-thick="1" title="0.75 pt" aria-label="0.75 pt"><span class="por-weight__bar" style="height:1.5px"></span><span class="por-weight__label">0.75</span></button>' +
      '              <button type="button" class="por-weight" data-por-pt="1.5" data-por-thick="2" title="1.5 pt" aria-label="1.5 pt"><span class="por-weight__bar" style="height:3px"></span><span class="por-weight__label">1.5</span></button>' +
      '              <button type="button" class="por-weight" data-por-pt="3" data-por-thick="3" title="3 pt" aria-label="3 pt"><span class="por-weight__bar" style="height:5px"></span><span class="por-weight__label">3</span></button>' +
      '              <button type="button" class="por-weight" data-por-pt="4.5" data-por-thick="3" title="4.5 pt" aria-label="4.5 pt"><span class="por-weight__bar" style="height:7px"></span><span class="por-weight__label">4.5</span></button>' +
      '            </div>' +
      '          </div>' +
      '          <div class="por-picker" data-por-picker="dash">' +
      '            <button type="button" class="por-picker__btn por-picker__btn--icon" id="por-dash-btn" title="Dashes" aria-label="Dash style" aria-haspopup="true" aria-expanded="false">' +
                      svgIcon('<path d="M4 12h3M10 12h3M16 12h4"/>') + '</button>' +
      '            <div class="por-picker__pop" id="por-dash-pop" hidden role="listbox" aria-label="Dash styles">' +
      '              <button type="button" class="por-dash" data-por-dash="solid" title="Solid">────</button>' +
      '              <button type="button" class="por-dash" data-por-dash="dashed" title="Dashed">- - -</button>' +
      '              <button type="button" class="por-dash" data-por-dash="dotted" title="Dotted">· · ·</button>' +
      '            </div>' +
      '          </div>' +
      '          <button type="button" class="por-iconbtn" id="por-set-default" title="Set as Default" aria-label="Set as default">' +
                    ICONS.star + '</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <span class="por-ribbon__label">Drawing</span>' +
      '  </div>' +
'  <div class="por-ribbon__sep" aria-hidden="true"></div>' +
      '</div>' +

      // Insert + Print stay pinned outside the scroll so Floor plan / Contour
      // remain reachable at 1440 and 1280 (CC: Insert was under Print / off-screen).
      '  <div class="por-ribbon__end" role="group" aria-label="Insert and output">' +
      '    <div class="por-ribbon__group" role="group" aria-label="Editing">' +
      '      <div class="por-ribbon__row">' +
      '        <div class="por-picker" data-por-picker="select-menu">' +
      '          <button type="button" class="por-ribbon__large" id="por-select-menu-btn" title="Select" aria-label="Select menu" aria-haspopup="true" aria-expanded="false">' +
                    ICONS.select + '<span class="por-ribbon__large-label">Select</span><span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop" id="por-select-menu-pop" hidden role="menu" aria-label="Select">' +
      '            <button type="button" class="por-menu-item" id="por-select-all" title="Select All">Select All</button>' +
      '            <button type="button" class="por-menu-item" id="por-open-selpane" title="Selection Pane">' +
                    ICONS.selectionPane + '<span>Selection Pane…</span></button>' +
      '          </div>' +
      '        </div>' +
      '        <button type="button" class="por-iconbtn" id="por-undo" title="Undo (Ctrl+Z)" aria-label="Undo">' + ICONS.undo + '</button>' +
      '        <button type="button" class="por-iconbtn" id="por-redo" title="Redo" aria-label="Redo">' + ICONS.redo + '</button>' +
      '        <button type="button" class="por-iconbtn" id="por-toggle-grid" title="Show Grid" aria-label="Show grid" aria-pressed="false">▦</button>' +
      '        <button type="button" class="por-iconbtn" id="por-toggle-rulers" title="Show Rulers" aria-label="Show rulers" aria-pressed="false">▤</button>' +
      '        <button type="button" class="por-iconbtn" id="por-hand" title="Hand / Pan (Space)" aria-label="Hand tool" aria-pressed="false">' +
                svgIcon('<path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v8.5a4.5 4.5 0 0 1-4.5 4.5H12a5 5 0 0 1-5-5V11a1.5 1.5 0 0 1 3 0"/>') + '</button>' +
      '      </div>' +
      '      <span class="por-ribbon__label">Editing</span>' +
      '    </div>' +
      '    <div class="por-ribbon__group" role="group" aria-label="Insert">' +
      '      <div class="por-ribbon__row">' +
      '        <button type="button" class="por-contour-toggle" id="por-contour-toggle" aria-pressed="false" title="Show the contour under the floor plan">' +
      '          <svg class="por-contour-toggle__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 15c3-7 8-9 13-6 2 1 4 3 5 6"/><path d="M6 17c2-4 5-5 8-3 1 .6 2 1.6 3 3"/><path d="M10 19c1-1.5 2-2 3.4-1.4"/></svg>' +
      '          <span class="por-contour-toggle__label">Contour</span>' +
      '        </button>' +
      '        <div class="por-picker" data-por-picker="insert">' +
      '          <button type="button" class="por-picker__btn por-picker__btn--label" id="por-insert-btn" title="Insert" aria-label="Insert" aria-haspopup="true" aria-expanded="false">' +
      '            Insert <span class="por-shapes__chev">▾</span>' +
      '          </button>' +
      '          <div class="por-picker__pop por-insert__pop por-bg-actions" id="por-insert-pop" hidden role="menu" aria-label="Insert">' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-bring-plan" title="Floor plan">Floor plan</button>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-bring-contour" title="Contour">Contour</button>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-import-bg" title="Import drawing">Import drawing</button>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-clear-bg" title="Blank">Blank</button>' +
      '            <input type="file" id="por-import-file" accept="image/*" hidden>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-insert-pic" title="Picture">Picture</button>' +
      '            <input type="file" id="por-pic-file" accept="image/*" hidden>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-add-view" title="Detail view">Detail view</button>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-remove-view" title="Remove detail">Remove detail</button>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-export-selection" title="Save selection as picture">Save selection</button>' +
      '            <button type="button" class="por-menu-item por-linkbtn" id="por-export-page" title="Save page as picture">Save page</button>' +
      '            <div class="por-stackmenu__sep"></div>' +
      '            <label class="por-menu-item por-insert__level">Level <select id="por-canvas" class="por-bg-select por-bg-select--inline" title="Level" aria-label="Level or canvas"></select></label>' +
      '            <label class="por-fill-toggle por-fill-toggle--compact por-menu-item" title="SandiaGEO note"><input type="checkbox" id="por-sandia"> SandiaGEO</label>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <span class="por-ribbon__label">Insert</span>' +
      '    </div>' +
      '    <div class="por-toolbar__out" role="group" aria-label="Drawing output">' +
      '      <button type="button" id="por-print" class="btn btn--secondary rb-print-btn" title="Print / PDF">Print / PDF</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="rb-workspace por-workspace">' +
      '  <aside class="rb-ws" aria-label="Drawing pages">' +
      '    <div class="rb-rail__head">' +
      '      <p class="eyebrow">Slides</p>' +
      '      <strong>Pages</strong>' +
      '      <span id="por-save-status">…</span>' +
      '    </div>' +
      '    <div class="rb-rail__list" id="por-page-list"></div>' +
      '    <div class="rb-rail__actions">' +
      '      <button type="button" id="por-add-page" class="btn btn--secondary" title="New page">New</button>' +
      '      <button type="button" id="por-dup-page" class="btn btn--quiet" title="Duplicate page">Duplicate</button>' +
      '      <button type="button" id="por-remove-page" class="btn btn--quiet" title="Delete page">Delete</button>' +
      '    </div>' +
      '  </aside>' +
      '  <div class="rb-stage" id="por-stage">' +
      '    <div class="rb-stage__paper">' +
      '      <article class="rb-sheet por-sheet" id="por-sheet" aria-label="11 by 17 inch landscape drawing sheet"></article>' +
      '    </div>' +
      '  </div>' +
      '  <aside class="rb-panel por-panel por-panel--flyout" id="por-panel" hidden aria-label="Format pane">' +
      '    <div class="por-panel__chrome">' +
      '      <h2 class="por-panel__title" id="por-panel-title">Format Shape</h2>' +
      '      <button type="button" class="por-panel__close" id="por-panel-close" title="Close" aria-label="Close pane">×</button>' +
      '    </div>' +
      '    <div class="por-selpane" id="por-selpane" hidden>' +
      '      <h3 class="por-inspector__heading">Selection</h3>' +
      '      <ul class="por-selpane__list" id="por-selpane-list" aria-label="Marks on this sheet"></ul>' +
      '    </div>' +
      '    <div class="por-inspector" id="por-inspector" hidden>' +
      '      <details class="por-inspector__section" open>' +
      '        <summary class="por-inspector__heading" id="por-inspector-title">Fill</summary>' +
      '        <div class="por-inspector__line">' +
      '          <label class="por-fill-toggle por-fill-toggle--compact"><input type="checkbox" id="por-shape-fill"> Fill</label>' +
      '          <div class="por-inspector__swatches" id="por-fill-swatches" aria-label="Fill colour"></div>' +
      '        </div>' +
      '      </details>' +
      '      <details class="por-inspector__section" open>' +
      '        <summary class="por-inspector__heading">Line</summary>' +
      '        <div class="por-inspector__line">' +
      '          <span class="por-inspector__tag">Colour</span>' +
      '          <div class="por-inspector__swatches" id="por-outline-swatches" aria-label="Outline colour"></div>' +
      '        </div>' +
      '        <div class="por-inspector__line">' +
      '          <span class="por-inspector__tag">Weight</span>' +
      '          <div class="por-seg" id="por-outline-weights" role="group" aria-label="Outline weight">' +
      '            <button type="button" class="por-seg__btn" data-por-thick="1" title="Thin">1</button>' +
      '            <button type="button" class="por-seg__btn" data-por-thick="2" title="Medium">2</button>' +
      '            <button type="button" class="por-seg__btn" data-por-thick="3" title="Thick">3</button>' +
      '          </div>' +
      '        </div>' +
      '      </details>' +
      '      <details class="por-inspector__section" open>' +
      '        <summary class="por-inspector__heading">Size</summary>' +
      '        <div class="por-inspector__size" aria-label="Size and position in inches">' +
      '          <label class="por-inspector__field"><span>X</span><input type="number" id="por-size-x" step="0.05" min="0" max="17"></label>' +
      '          <label class="por-inspector__field"><span>Y</span><input type="number" id="por-size-y" step="0.05" min="0" max="11"></label>' +
      '          <label class="por-inspector__field"><span>W</span><input type="number" id="por-size-w" step="0.05" min="0.1" max="17"></label>' +
      '          <label class="por-inspector__field"><span>H</span><input type="number" id="por-size-h" step="0.05" min="0.1" max="11"></label>' +
      '        </div>' +
      '        <div class="por-stack" role="group" aria-label="Arrange">' +
      '          <button type="button" class="por-stack__btn" id="por-stack-front" title="Bring to Front">Front</button>' +
      '          <button type="button" class="por-stack__btn" id="por-stack-forward" title="Bring Forward">Forward</button>' +
      '          <button type="button" class="por-stack__btn" id="por-stack-backward" title="Send Backward">Back</button>' +
      '          <button type="button" class="por-stack__btn" id="por-stack-back" title="Send to Back">Bottom</button>' +
      '        </div>' +
      '      </details>' +
      '    </div>' +
      '  </aside>' +
      '</div>' +
      '<div class="por-statusbar" role="status" aria-label="Status bar">' +
      '  <span class="por-statusbar__page" id="por-page-indicator">1 of 1</span>' +
      '  <div class="por-statusbar__zoom" role="group" aria-label="Zoom">' +
      '    <button type="button" id="por-zoom-out" class="por-iconbtn" aria-label="Zoom out" title="Zoom out">−</button>' +
      '    <input type="range" id="por-zoom-slider" class="por-zoom-slider" min="35" max="240" value="100" aria-label="Zoom">' +
      '    <span class="por-statusbar__pct" id="por-zoom-pct">100%</span>' +
      '    <button type="button" id="por-zoom-level" class="por-zoom-level" title="Fit page">Fit</button>' +
      '    <button type="button" id="por-zoom-in" class="por-iconbtn" aria-label="Zoom in" title="Zoom in">+</button>' +
      '  </div>' +
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
      keepTool: false,
      inkThick: 2,
      inkColor: '#1d4ed8',
      inkFill: false,
      inkDrag: null,
      selectedId: null,
      lastStyleTargetId: null,
      clipboard: null,
      bgUrl: '',
      contourUrl: '',
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
      inspectorMode: 'format',
      inspectorOpen: false,
      fillColor: '#eab308',
      recentColors: [],
      inkOpacity: 1,
      inkDash: 'solid',
      inkArrowStart: 'none',
      inkArrowEnd: 'none',
      formatPainter: null,
      styleDefaults: null,
      editSeq: 0,
      editingText: false,
      fabricCanvas: null,
      fabricHost: null,
      fabricWired: false,
      convertingLegacy: false,
      shapeDraft: null,
      showGrid: false,
      showRulers: false,
      handTool: false,
      spaceDown: false,
      sheetPan: null,
      guides: [],
      snapGuides: [],
    };
    var PorFab = window.ToolboxPorFabric;

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
      var undoBtn = root.querySelector('#por-undo');
      var redoBtn = root.querySelector('#por-redo');
      if (undoBtn) undoBtn.disabled = state.undo.length === 0 || state.readOnly;
      if (redoBtn) redoBtn.disabled = state.redo.length === 0 || state.readOnly;
      root.querySelectorAll('[data-rb-tool]').forEach(function (btn) {
        btn.classList.toggle('is-on', btn.getAttribute('data-rb-tool') === state.inkTool);
      });
      root.querySelectorAll('[data-por-tool="select"]').forEach(function (btn) {
        btn.classList.toggle('is-on', !state.inkTool);
      });
      // Colour bars follow the selected shape when one is active; otherwise the
      // tool defaults (CC: outline chip stayed blue after a red outline apply).
      var chipOutline = state.inkColor;
      var chipFill = state.fillColor;
      var activeChip = null;
      try { activeChip = state.fabricCanvas && state.fabricCanvas.getActiveObject(); } catch (_) {}
      if (activeChip) {
        if (activeChip.stroke) chipOutline = activeChip.stroke;
        if (activeChip.fill && activeChip.fill !== 'transparent') chipFill = activeChip.fill;
      } else {
        var sel = selectedItem();
        if (sel) {
          if (sel.color) chipOutline = sel.color;
          if (sel.fillColor) chipFill = sel.fillColor;
        }
      }
      var outlineChip = root.querySelector('#por-outline-chip');
      if (outlineChip) outlineChip.style.background = chipOutline;
      var fillChip = root.querySelector('#por-fill-chip');
      if (fillChip) fillChip.style.background = chipFill;
      var fontChip = root.querySelector('#por-font-color-chip');
      if (fontChip) fontChip.style.background = chipOutline;
      var textStrip = root.querySelector('#por-text-format');
      if (textStrip) textStrip.hidden = false;
      syncStatusBar();
      syncSheetCursor();
    }

    function closeRibbonCollapsePops() {
      root.querySelectorAll('.por-ribbon__group--collapsible.is-open').forEach(function (g) {
        g.classList.remove('is-open');
        var btn = g.querySelector('.por-ribbon__collapse-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        var body = g.querySelector('.por-ribbon__body');
        if (body) {
          body.style.position = '';
          body.style.left = '';
          body.style.top = '';
          body.style.right = '';
          body.style.zIndex = '';
        }
      });
    }

    function fitRibbon() {
      var scroll = root.querySelector('.por-ribbon__scroll');
      if (!scroll) return;
      var groups = Array.prototype.slice.call(
        scroll.querySelectorAll('.por-ribbon__group--collapsible')
      );
      // Expand all, then collapse Font → Paragraph → Clipboard → Drawing until
      // the scroll fits (PowerPoint ribbon overflow). Drawing last so tools stay.
      groups.forEach(function (g) {
        g.classList.remove('is-collapsed', 'is-open');
        var body = g.querySelector('.por-ribbon__body');
        if (body) {
          body.style.position = '';
          body.style.left = '';
          body.style.top = '';
          body.style.right = '';
          body.style.zIndex = '';
        }
      });
      void scroll.offsetWidth;
      // Tim/CC: Font (B/I/U/colours) always visible at 1280 and 1440 — never fold into "Font ▾".
      var order = window.innerWidth >= 1280
        ? ['paragraph', 'clipboard', 'drawing']
        : ['paragraph', 'clipboard', 'drawing', 'font'];
      var i = 0;
      while (scroll.scrollWidth > scroll.clientWidth + 1 && i < order.length) {
        var g = scroll.querySelector('[data-por-collapse="' + order[i] + '"]');
        if (g) g.classList.add('is-collapsed');
        i += 1;
        void scroll.offsetWidth;
      }
    }

    function enhanceRibbonCollapse() {
      root.querySelectorAll('.por-ribbon__group--collapsible').forEach(function (group) {
        if (group.querySelector('.por-ribbon__collapse-btn')) return;
        var label = group.getAttribute('aria-label') || 'Group';
        var body = document.createElement('div');
        body.className = 'por-ribbon__body';
        while (group.firstChild) body.appendChild(group.firstChild);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'por-ribbon__collapse-btn';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', label);
        btn.title = label;
        var collapseKey = group.getAttribute('data-por-collapse') || '';
        var collapseIcon = collapseKey === 'clipboard' ? ICONS.paste
          : collapseKey === 'font' ? ICONS.fontColor
          : collapseKey === 'paragraph' ? ICONS.align
          : collapseKey === 'drawing' ? ICONS.shapes : '';
        btn.innerHTML = (collapseIcon || '') + '<span>' + label + ' <span class="por-shapes__chev">▾</span></span>';
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var open = group.classList.contains('is-open');
          closeRibbonCollapsePops();
          closePickers();
          if (!open) {
            group.classList.add('is-open');
            btn.setAttribute('aria-expanded', 'true');
            placePickerPop(body, btn);
          }
        });
        group.appendChild(btn);
        group.appendChild(body);
      });
      document.addEventListener('pointerdown', function (ev) {
        if (ev.target.closest && ev.target.closest('.por-ribbon__group--collapsible.is-open')) return;
        closeRibbonCollapsePops();
      }, true);
      fitRibbon();
    }

    /** Expand a collapsed ribbon group that contains sel so tests/UI can click it. */
    function ensureRibbonControl(sel) {
      var el = typeof sel === 'string' ? root.querySelector(sel) : sel;
      if (!el) return null;
      var group = el.closest && el.closest('.por-ribbon__group--collapsible');
      if (group && group.classList.contains('is-collapsed') && !group.classList.contains('is-open')) {
        var btn = group.querySelector('.por-ribbon__collapse-btn');
        if (btn) btn.click();
      }
      return el;
    }

    function syncStatusBar() {
      var ind = root.querySelector('#por-page-indicator');
      if (ind && state.doc && Array.isArray(state.doc.pages)) {
        var idx = Math.max(0, state.doc.pages.findIndex(function (p) {
          return p.id === state.doc.activePageId;
        }));
        ind.textContent = (idx + 1) + ' of ' + state.doc.pages.length;
      }
      var pct = root.querySelector('#por-zoom-pct');
      if (pct) {
        var slider = root.querySelector('#por-zoom-slider');
        var n = slider ? Number(slider.value) : Math.round((state.userScale || 1) * 100);
        if (!isFinite(n)) n = 100;
        pct.textContent = Math.round(n) + '%';
      }
    }

    function syncSheetCursor() {
      if (!sheetEl || !stageEl) return;
      stageEl.classList.toggle('por-stage--draw', !!state.inkTool && state.inkTool !== 'eraser');
      stageEl.classList.toggle('por-stage--erase', state.inkTool === 'eraser');
      stageEl.classList.toggle('por-stage--text', state.inkTool === 'text' || state.editingText);
      if (state.fabricCanvas) {
        var cursor = 'default';
        if (state.handTool || state.spaceDown) cursor = 'grab';
        else if (state.editingText) cursor = 'text';
        else if (state.inkTool === 'eraser') cursor = 'cell';
        else if (state.inkTool) cursor = 'crosshair';
        state.fabricCanvas.defaultCursor = cursor;
        state.fabricCanvas.hoverCursor = state.inkTool ? cursor : 'move';
        state.fabricCanvas.freeDrawingCursor = 'crosshair';
      }
    }

    function closePickers() {
      root.querySelectorAll('.por-picker__pop').forEach(function (pop) {
        // PowerPoint Drawing gallery stays docked in the ribbon.
        if (pop.id === 'por-shapes-pop' && pop.classList.contains('por-shapes__pop--docked')) return;
        pop.hidden = true;
      });
      root.querySelectorAll('.por-picker__btn, .por-ribbon__large').forEach(function (btn) {
        if (btn.id === 'por-shapes-btn') {
          btn.setAttribute('aria-expanded', 'true');
          return;
        }
        btn.setAttribute('aria-expanded', 'false');
      });
    }

    function placePickerPop(pop, btn) {
      if (!pop || !btn) return;
      // Fixed positioning escapes the toolbar/sheet stacking fight so swatches
      // receive real mouse clicks even when the pop hangs over the Fabric host.
      var rect = btn.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - 220, rect.left)) + 'px';
      pop.style.top = (rect.bottom + 4) + 'px';
      pop.style.right = 'auto';
      pop.style.zIndex = '10060';
    }

    function togglePicker(which) {
      var pop = root.querySelector('#por-' + which + '-pop');
      var btn = root.querySelector('#por-' + which + '-btn');
      if (!pop || !btn) return;
      var open = pop.hidden;
      closePickers();
      if (open) {
        placePickerPop(pop, btn);
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    }

    function findFabricByPorId(id) {
      if (!state.fabricCanvas || !id) return null;
      var found = null;
      state.fabricCanvas.getObjects().forEach(function (o) {
        if (!found && o && o.porId === id) found = o;
      });
      return found;
    }

    // Active Fabric object, or the last selected mark (toolbar pickers clear activeObject).
    function styleTarget() {
      if (!state.fabricCanvas || state.readOnly) return null;
      var active = state.fabricCanvas.getActiveObject();
      if (active) return active;
      var id = state.selectedId || state.lastStyleTargetId;
      var obj = findFabricByPorId(id);
      if (obj) {
        try {
          state.fabricCanvas.setActiveObject(obj);
          state.selectedId = obj.porId || state.selectedId;
          if (obj.porId) state.lastStyleTargetId = obj.porId;
        } catch (_) {}
      }
      return obj;
    }

    function patchOverlayStyle(itemId, patch) {
      if (!itemId || !patch) return;
      var page = activePage();
      if (!page || !Array.isArray(page.overlays)) return;
      page.overlays.forEach(function (ov) {
        if (!ov) return;
        if (ov.id === itemId) Object.assign(ov, patch);
        if (ov.kind === 'group' && Array.isArray(ov.members)) {
          ov.members.forEach(function (m) {
            if (m && m.id === itemId) Object.assign(m, patch);
          });
        }
      });
    }

    function applyOutlineColor(color) {
      if (!color) return;
      rememberColor(color);
      var hex = (PorFab && PorFab.toHexColor ? PorFab.toHexColor(color) : null) || color;
      // Always drive the Shape Outline colour bar from the colour just applied
      // (CC: chip stayed blue after a selected shape was set to red).
      state.inkColor = hex;
      if (state.fabricCanvas && !state.readOnly) {
        var active = styleTarget();
        if (active) {
          pushHistory();
          if (active.type === 'activeSelection') {
            active.forEachObject(function (o) {
              if (o.type === 'textbox' || o.type === 'i-text') o.set('fill', hex);
              else o.set('stroke', hex);
              if (o.porId) patchOverlayStyle(o.porId, { color: hex });
            });
          } else if (active.type === 'textbox' || active.type === 'i-text') {
            active.set('fill', hex);
            if (active.porId) patchOverlayStyle(active.porId, { color: hex });
          } else {
            active.set('stroke', hex);
            if (active.porId) patchOverlayStyle(active.porId, { color: hex });
          }
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          if (active.type !== 'activeSelection' && active.porId) {
            patchOverlayStyle(active.porId, { color: hex });
          }
          scheduleSave();
          syncHistoryButtons();
          return;
        }
      }
      var item = selectedItem();
      if (item && !state.readOnly) {
        pushHistory();
        item.color = hex;
        var fab = findFabricByPorId(item.id);
        if (fab) {
          if (fab.type === 'textbox' || fab.type === 'i-text') fab.set('fill', hex);
          else fab.set('stroke', hex);
          if (state.fabricCanvas) state.fabricCanvas.requestRenderAll();
        }
        scheduleSave();
        syncInspector();
        syncHistoryButtons();
        return;
      }
      syncHistoryButtons();
      applyFabricToolMode();
    }

    function applyFillColor(color) {
      if (!color) return;
      rememberColor(color);
      var hex = (PorFab && PorFab.toHexColor ? PorFab.toHexColor(color) : null) || color;
      if (state.fabricCanvas && !state.readOnly) {
        var active = styleTarget();
        if (active && active.type !== 'line' && active.type !== 'path') {
          pushHistory();
          if (active.type === 'activeSelection') {
            active.forEachObject(function (o) {
              if (o.type !== 'line' && o.type !== 'path') {
                o.set('fill', hex);
                if (o.porId) patchOverlayStyle(o.porId, { fill: true, fillColor: hex });
              }
            });
          } else {
            active.set('fill', hex);
            if (active.porId) patchOverlayStyle(active.porId, { fill: true, fillColor: hex });
          }
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          if (active.porId) patchOverlayStyle(active.porId, { fill: true, fillColor: hex });
          scheduleSave();
          syncHistoryButtons();
          return;
        }
      }
      var item = selectedItem();
      if (item && !state.readOnly && (item.kind === 'rect' || item.kind === 'circle' ||
          item.kind === 'roundRect' || item.kind === 'triangle')) {
        pushHistory();
        item.fill = true;
        item.fillColor = hex;
        var fabFill = findFabricByPorId(item.id);
        if (fabFill) {
          fabFill.set('fill', hex);
          if (state.fabricCanvas) state.fabricCanvas.requestRenderAll();
        }
        scheduleSave();
        syncInspector();
        syncHistoryButtons();
        return;
      }
      state.fillColor = hex;
      state.inkFill = true;
      if (fillInput) fillInput.checked = true;
      syncHistoryButtons();
    }

    function applyWeight(level) {
      level = Number(level) || 2;
      if (state.fabricCanvas && !state.readOnly) {
        var active = styleTarget();
        if (active) {
          pushHistory();
          var sw = PorFab.strokeWidthFromThick(level);
          if (active.type === 'activeSelection') {
            active.forEachObject(function (o) {
              o.set('strokeWidth', sw);
              if (o.porId) patchOverlayStyle(o.porId, { thick: level });
            });
          } else {
            active.set('strokeWidth', sw);
            if (active.porId) patchOverlayStyle(active.porId, { thick: level });
          }
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          if (active.porId) patchOverlayStyle(active.porId, { thick: level });
          scheduleSave();
          syncHistoryButtons();
          return;
        }
      }
      var item = selectedItem();
      if (item && !state.readOnly) {
        pushHistory();
        item.thick = level;
        var fabW = findFabricByPorId(item.id);
        if (fabW && PorFab) {
          fabW.set('strokeWidth', PorFab.strokeWidthFromThick(level));
          if (state.fabricCanvas) state.fabricCanvas.requestRenderAll();
        }
        scheduleSave();
        syncInspector();
        syncHistoryButtons();
        return;
      }
      state.inkThick = level;
      syncHistoryButtons();
      applyFabricToolMode();
    }

    function clampFrameToDrawArea(frame) {
      var f = frame && typeof frame === 'object' ? frame : { x: 0, y: 0, w: 40, h: 40 };
      var w = Math.max(18, Math.min(DRAW_MAX_RIGHT, Number(f.w) || 40));
      var h = Math.max(20, Math.min(100, Number(f.h) || 40));
      var x = Math.max(0, Math.min(DRAW_MAX_RIGHT - w, Number(f.x) || 0));
      var y = Math.max(0, Math.min(100 - h, Number(f.y) || 0));
      return { x: x, y: y, w: w, h: h, z: isFinite(Number(f.z)) ? Number(f.z) : 1 };
    }

    /** Side-by-side within the draw area so a new detail never covers overall. */
    function layoutPorViews(views) {
      if (!views || !views.length) return;
      var gutter = 2;
      var avail = DRAW_MAX_RIGHT;
      if (views.length === 1) {
        views[0].frame = clampFrameToDrawArea({ x: 0, y: 0, w: avail, h: 100, z: 1 });
        return;
      }
      var n = views.length;
      var share = (avail - gutter * (n - 1)) / n;
      views.forEach(function (v, i) {
        if (!v) return;
        v.frame = clampFrameToDrawArea({
          x: i * (share + gutter),
          y: 0,
          w: share,
          h: 100,
          z: i + 1,
        });
      });
    }

    function applyHistory(doc) {
      // Tear down Fabric WITHOUT syncing — otherwise the live canvas overwrites
      // the restored doc and Undo/Redo appear to do nothing.
      destroyFabric();
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
          // Conversion complete: drop retained pre-Fabric overlay bytes.
          if (state.convertingLegacy) {
            state.doc.pages.forEach(function (p) {
              if (p) delete p._legacyOverlays;
            });
            state.convertingLegacy = false;
          }
        }
      }).catch(function (err) {
        console.error(err);
        setStatus('Save failed');
        // Restore legacy overlays if conversion save failed.
        if (state.convertingLegacy) {
          state.doc.pages.forEach(function (p) {
            if (p && p._legacyOverlays) {
              p.overlays = deepClone(p._legacyOverlays);
              delete p._fabricConverted;
            }
          });
        }
      });
    }

    function overlayApi() { return window.ToolboxReportOverlay; }

    function overlayList(page) {
      if (!page.overlays) page.overlays = [];
      return page.overlays;
    }

    function destroyFabric() {
      if (state.fabricCanvas) {
        try {
          // Drop listeners before dispose — in-flight mouse events otherwise hit a
          // torn-down upper canvas and throw getBoundingClientRect on undefined.
          state.fabricCanvas.off();
          state.fabricCanvas.dispose();
        } catch (_) {}
      }
      state.fabricCanvas = null;
      state.fabricHost = null;
      state.fabricWired = false;
      state.shapeDraft = null;
      if (state.drag && state.drag.mode === 'view-pan') state.drag = null;
    }

    function overlaysFingerprint(list) {
      try { return JSON.stringify(list || []); } catch (_) { return ''; }
    }

    function syncOverlaysFromFabric() {
      if (!state.fabricCanvas || !PorFab) return false;
      var page = activePage();
      if (!page) return false;
      // Keep pre-conversion overlay bytes until the first successful save after convert.
      if (!page._legacyOverlays && Array.isArray(page.overlays) && page.overlays.length &&
          state.convertingLegacy) {
        page._legacyOverlays = deepClone(page.overlays);
      }
      var next = PorFab.canvasToOverlays(state.fabricCanvas);
      var active = state.fabricCanvas.getActiveObject();
      state.selectedId = active && active.porId ? active.porId : null;
      // Nothing changed → do not rewrite overlays or dirty the file on open/close.
      if (overlaysFingerprint(next) === overlaysFingerprint(page.overlays)) return false;
      page.overlays = next;
      return true;
    }

    function syncAndSave() {
      var page = activePage();
      if (page) delete page._thumbDataUrl;
      if (syncOverlaysFromFabric()) {
        scheduleSave();
        setTimeout(function () { refreshActivePageThumb(); }, 30);
      }
    }

    function wireFabricEvents(canvas) {
      if (!canvas || state.fabricWired) return;
      state.fabricWired = true;
      var pushAndSync = function () {
        if (state.readOnly || state.printMode) return;
        pushHistory();
        syncAndSave();
        syncHistoryButtons();
      };
      canvas.on('object:modified', function () {
        clearSnapGuides();
        pushAndSync();
        syncSelectionPane();
      });
      canvas.on('object:moving', function (opt) {
        if (opt && opt.target) snapMovingObject(opt.target);
      });
      canvas.on('object:removed', function () {
        if (state.readOnly || state.printMode) return;
        syncOverlaysFromFabric();
        scheduleSave();
        syncSelectionPane();
      });
      canvas.on('selection:created', function (opt) {
        var active = canvas.getActiveObject();
        var t = active || (opt && opt.selected && opt.selected[0]);
        state.selectedId = t && t.porId ? t.porId : null;
        if (state.selectedId) state.lastStyleTargetId = state.selectedId;
        if (state.formatPainter && active && !state.readOnly) {
          pushHistory();
          applyStyleToFabricTarget(active, state.formatPainter);
          canvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          state.formatPainter = null;
          setStatus('Style painted');
          syncHistoryButtons();
        }
        var isText = !!(active && (active.type === 'textbox' || active.type === 'i-text'));
        state.editingText = isText;
        syncInspector();
        syncHistoryButtons();
        syncSelectionPane();
      });
      canvas.on('selection:updated', function (opt) {
        var active = canvas.getActiveObject();
        var t = active || (opt && opt.selected && opt.selected[0]);
        state.selectedId = t && t.porId ? t.porId : null;
        if (state.selectedId) state.lastStyleTargetId = state.selectedId;
        if (state.formatPainter && active && !state.readOnly) {
          pushHistory();
          applyStyleToFabricTarget(active, state.formatPainter);
          canvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          state.formatPainter = null;
          setStatus('Style painted');
        }
        state.editingText = !!(active && (active.type === 'textbox' || active.type === 'i-text'));
        syncInspector();
        syncHistoryButtons();
        syncSelectionPane();
      });
      canvas.on('selection:cleared', function () {
        // Keep lastStyleTargetId so outline/fill/dash toolbar clicks still style
        // the shape the investigator just selected (Fabric clears activeObject
        // when focus moves to the picker).
        state.selectedId = state.lastStyleTargetId || null;
        state.editingText = false;
        syncInspector();
        syncHistoryButtons();
        syncSelectionPane();
      });
      canvas.on('text:editing:entered', function () {
        state.editingText = true;
        syncHistoryButtons();
      });
      canvas.on('text:editing:exited', function () {
        state.editingText = false;
        syncOverlaysFromFabric();
        scheduleSave();
        syncHistoryButtons();
      });
      canvas.on('path:created', function (opt) {
        if (state.readOnly) return;
        var path = opt && opt.path;
        if (path) {
          path.set({
            porId: PorFab.uid('ov'),
            porKind: 'path',
            stroke: state.inkColor,
            strokeWidth: PorFab.strokeWidthFromThick(state.inkThick),
            fill: '',
          });
          PorFab.styleControls(path);
        }
        pushHistory();
        syncOverlaysFromFabric();
        scheduleSave();
        if (!state.keepTool) setInkTool(null);
        else canvas.isDrawingMode = state.inkTool === 'pencil';
      });
      // Before Fabric starts a marquee selection, claim empty-space drags over a
      // view frame as view-pan (Fabric sits above the plan images).
      canvas.on('mouse:down:before', function (opt) {
        if (state.readOnly || state.printMode || state.inkTool) return;
        if (opt.target || !opt.e || opt.e.button === 2) return;
        var pe = opt.e;
        if (!sheetEl) return;
        var frames = sheetEl.querySelectorAll('.por-view-frame');
        for (var fi = 0; fi < frames.length; fi++) {
          var frameEl = frames[fi];
          if (!frameEl || typeof frameEl.getBoundingClientRect !== 'function') continue;
          var fr = frameEl.getBoundingClientRect();
          if (pe.clientX >= fr.left && pe.clientX <= fr.right &&
              pe.clientY >= fr.top && pe.clientY <= fr.bottom) {
            var vi = Number(frameEl.getAttribute('data-por-view'));
            var views = activeViews();
            var view = views[vi];
            if (!view) return;
            pushHistory();
            state.drag = {
              mode: 'view-pan',
              viewIndex: vi,
              startClient: { x: pe.clientX, y: pe.clientY },
              hostW: Math.max(1, fr.width),
              hostH: Math.max(1, fr.height),
              origCamera: deepClone(viewCamera(view)),
            };
            state.selectedViewIndex = vi;
            canvas.selection = false;
            canvas.discardActiveObject();
            return;
          }
        }
      });
      canvas.on('mouse:down', function (opt) {
        if (state.readOnly || state.printMode) return;
        if (opt.e && opt.e.button === 2) return;
        var tool = state.inkTool;
        // View-pan already claimed in mouse:down:before.
        if (state.drag && state.drag.mode === 'view-pan') return;
        if (!tool || tool === 'pencil' || tool === 'eraser') return;
        if (opt.target && tool !== 'eraser') return;
        var pointer = canvas.getPointer(opt.e);
        if (tool === 'text') return;
        state.shapeDraft = {
          tool: tool,
          x: pointer.x,
          y: pointer.y,
          shift: !!(opt.e && opt.e.shiftKey),
        };
      });
      canvas.on('mouse:move', function (opt) {
        if (state.drag && state.drag.mode === 'view-pan') {
          applyViewPanFromClient(opt.e);
          return;
        }
        if (!state.shapeDraft || !state.inkTool) return;
        var pointer = canvas.getPointer(opt.e);
        var d = state.shapeDraft;
        var shift = !!(opt.e && opt.e.shiftKey) || d.shift;
        if (d.obj) canvas.remove(d.obj);
        d.obj = makeDraftShape(d.tool, d.x, d.y, pointer.x, pointer.y, shift);
        if (d.obj) {
          d.obj.set({ selectable: false, evented: false, excludeFromExport: true });
          canvas.add(d.obj);
          canvas.requestRenderAll();
        }
      });
      canvas.on('mouse:up', function (opt) {
        if (state.drag && state.drag.mode === 'view-pan') {
          applyViewPanFromClient(opt && opt.e);
          state.drag = null;
          if (state.fabricCanvas) state.fabricCanvas.selection = !state.readOnly;
          scheduleSave();
          return;
        }
        if (!state.shapeDraft) return;
        var d = state.shapeDraft;
        state.shapeDraft = null;
        if (d.obj) canvas.remove(d.obj);
        var pointer = canvas.getPointer(opt.e);
        var shift = !!(opt.e && opt.e.shiftKey) || d.shift;
        var box = [d.x, d.y, pointer.x, pointer.y];
        if (Math.abs(pointer.x - d.x) < 3 && Math.abs(pointer.y - d.y) < 3) {
          box = defaultShapeBox(d.tool, d.x, d.y);
          shift = false;
        }
        var shape = makeDraftShape(d.tool, box[0], box[1], box[2], box[3], shift);
        if (!shape) return;
        PorFab.styleControls(shape);
        shape.set({
          porId: PorFab.uid('ov'),
          porKind: d.tool === 'arrow' ? 'arrow' : d.tool,
          selectable: true,
          evented: true,
          excludeFromExport: false,
        });
        pushHistory();
        if (shape.type === 'line' || shape.porKind === 'line' || shape.porKind === 'arrow') {
          try { PorFab.captureLineEnds(shape); } catch (_) {}
          // Fresh draw: pin the just-captured ends as pct so the first save is exact.
          if (shape.porEnds) {
            shape.porPctEnds = {
              x0: PorFab.xToPct(shape.porEnds.x0),
              y0: PorFab.yToPct(shape.porEnds.y0),
              x1: PorFab.xToPct(shape.porEnds.x1),
              y1: PorFab.yToPct(shape.porEnds.y1),
            };
          }
        }
        canvas.add(shape);
        canvas.setActiveObject(shape);
        canvas.requestRenderAll();
        syncAndSave();
        if (!state.keepTool) setInkTool(null);
      });
      canvas.on('editing:exited', function (opt) {
        if (state.readOnly || state.printMode) return;
        state.editingText = false;
        syncAndSave();
        syncHistoryButtons();
      });
      canvas.on('mouse:dblclick', function (opt) {
        if (opt.target && (opt.target.type === 'textbox' || opt.target.type === 'i-text')) {
          state.editingText = true;
          syncHistoryButtons();
        }
      });
      canvas.on('mouse:down', function (opt) {
        if (!opt.e || opt.e.button !== 2) return;
        if (!opt.target || state.readOnly) return;
        opt.e.preventDefault();
        var id = opt.target.porId;
        if (!id) return;
        state.selectedId = id;
        canvas.setActiveObject(opt.target);
        canvas.requestRenderAll();
        openShapeMenu(opt.e, id);
      });
    }

    /** A bare click with a shape tool armed drops a default shape centred on the click
        (PowerPoint places one too). Sizes are a share of the sheet so they read the same
        at any zoom: pier dot 1.4 %, square 4 %, rectangle 6 x 4 %, line / arrow 8 %. */
    function defaultShapeBox(tool, x, y) {
      var u = PorFab && typeof PorFab.pctToX === 'function' ? PorFab.pctToX(1) : 9;
      var half;
      if (tool === 'line' || tool === 'arrow') { half = u * 4; return [x - half, y, x + half, y]; }
      if (tool === 'circle') { half = u * 0.7; return [x - half, y - half, x + half, y + half]; }
      if (tool === 'rect' || tool === 'roundRect') { return [x - u * 3, y - u * 2, x + u * 3, y + u * 2]; }
      half = u * 2;
      return [x - half, y - half, x + half, y + half];
    }

    function makeDraftShape(tool, x0, y0, x1, y1, shift) {
      if (!PorFab || !window.fabric) return null;
      var f = window.fabric;
      var left = Math.min(x0, x1); var top = Math.min(y0, y1);
      var w = Math.abs(x1 - x0); var h = Math.abs(y1 - y0);
      if (shift) {
        if (tool === 'line' || tool === 'arrow') {
          var dx = x1 - x0; var dy = y1 - y0;
          var ang = Math.atan2(dy, dx);
          var snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          var len = Math.sqrt(dx * dx + dy * dy);
          x1 = x0 + Math.cos(snap) * len;
          y1 = y0 + Math.sin(snap) * len;
          left = Math.min(x0, x1); top = Math.min(y0, y1);
          w = Math.abs(x1 - x0); h = Math.abs(y1 - y0);
        } else {
          var side = Math.max(w, h);
          w = side; h = side;
          if (x1 < x0) left = x0 - side;
          if (y1 < y0) top = y0 - side;
        }
      }
      var defs = state.styleDefaults || {};
      var stroke = defs.stroke || state.inkColor;
      var fill = state.inkFill || defs.fill
        ? (defs.fillColor || state.fillColor)
        : 'rgba(0,0,0,0)';
      if (defs.fill && defs.fill !== 'rgba(0,0,0,0)' && defs.fill !== '') fill = defs.fill;
      var sw = defs.strokeWidth != null ? defs.strokeWidth : PorFab.strokeWidthFromThick(state.inkThick);
      var opacity = state.inkOpacity != null ? state.inkOpacity : 1;
      var dash = dashArrayFor(state.inkDash, state.inkThick);
      if (defs.strokeDashArray) dash = defs.strokeDashArray;
      var common = { stroke: stroke, strokeWidth: sw, fill: fill, opacity: opacity, strokeDashArray: dash };
      if (tool === 'rect' || tool === 'roundRect') {
        return new f.Rect(Object.assign({
          left: left, top: top, width: Math.max(2, w), height: Math.max(2, h),
          rx: tool === 'roundRect' ? 12 : 0, ry: tool === 'roundRect' ? 12 : 0,
        }, common));
      }
      if (tool === 'circle') {
        return new f.Ellipse(Object.assign({
          left: left, top: top,
          rx: Math.max(1, w / 2), ry: Math.max(1, (shift ? w : h) / 2),
        }, common));
      }
      if (tool === 'triangle') {
        return new f.Triangle(Object.assign({
          left: left, top: top, width: Math.max(2, w), height: Math.max(2, h),
        }, common));
      }
      if (tool === 'line' || tool === 'arrow') {
        var isArrow = tool === 'arrow' || state.inkArrowEnd === 'triangle';
        var line = new f.Line([x0, y0, x1, y1], Object.assign({}, common, {
          fill: '',
          porArrow: isArrow,
          porKind: isArrow ? 'arrow' : 'line',
        }));
        if (isArrow && PorFab.decorateArrow) PorFab.decorateArrow(line);
        return line;
      }
      return null;
    }

    function ensureFabricOnSheet() {
      if (!PorFab || !PorFab.ready()) return null;
      if (state.printMode) return null;
      var host = document.createElement('div');
      host.className = 'por-fabric-host';
      host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;';
      var canvasEl = document.createElement('canvas');
      canvasEl.id = 'por-fabric-canvas';
      host.appendChild(canvasEl);
      sheetEl.appendChild(host);
      state.fabricHost = host;
      state.fabricWired = false;
      state.fabricCanvas = PorFab.createCanvas(canvasEl, {
        width: PAPER_W,
        height: PAPER_H,
        readOnly: state.readOnly,
      });
      // Match CSS box of the sheet so pointer hits land correctly.
      var sheetBox = sheetEl && typeof sheetEl.getBoundingClientRect === 'function'
        ? sheetEl.getBoundingClientRect()
        : { width: 0, height: 0 };
      if (sheetBox.width > 0 && sheetBox.height > 0) {
        state.fabricCanvas.setDimensions({
          width: sheetBox.width,
          height: sheetBox.height,
        });
        // Keep logical drawing space at paper pixels via viewport transform.
        var sx = sheetBox.width / PAPER_W;
        var sy = sheetBox.height / PAPER_H;
        state.fabricCanvas.setViewportTransform([sx, 0, 0, sy, 0, 0]);
      }
      wireFabricEvents(state.fabricCanvas);
      host._porCanvas = state.fabricCanvas;
      // First open of a pre-Fabric drawing: keep originals until save succeeds.
      var page = activePage();
      if (page && page.overlays && page.overlays.length && !page._fabricConverted) {
        state.convertingLegacy = true;
        page._legacyOverlays = deepClone(page.overlays);
        page._fabricConverted = true;
      }
      PorFab.overlaysToCanvas(state.fabricCanvas, overlayList(page), {
        readOnly: state.readOnly,
        loadMedia: function (mediaId) {
          return window.ToolboxDB.getMedia(mediaId).then(function (row) {
            return row && (row.dataUrl || row.data || row);
          });
        },
      });
      applyFabricToolMode();
      return state.fabricCanvas;
    }

    function insertPictureFromDataUrl(dataUrl, name) {
      if (!dataUrl || state.readOnly || !state.fabricCanvas || !PorFab) return Promise.resolve(false);
      var mediaId = 'porimg_' + uid('pic');
      return window.ToolboxDB.putMedia(mediaId, dataUrl).then(function () {
        pushHistory();
        window.fabric.Image.fromURL(dataUrl, function (img) {
          if (!img) return;
          var maxW = PAPER_W * 0.35;
          if (img.width > maxW) img.scaleToWidth(maxW);
          img.set({
            left: PAPER_W * 0.12,
            top: PAPER_H * 0.18,
            porId: PorFab.uid('ov'),
            porKind: 'image',
            porMediaId: mediaId,
            porName: name || 'Picture',
            objectCaching: false,
          });
          PorFab.styleControls(img);
          state.fabricCanvas.add(img);
          state.fabricCanvas.setActiveObject(img);
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          syncSelectionPane();
          setStatus('Picture inserted');
        }, { crossOrigin: 'anonymous' });
        return true;
      });
    }

    function exportActiveAsPicture() {
      if (!state.fabricCanvas) return;
      var active = state.fabricCanvas.getActiveObject();
      if (!active) {
        setStatus('Select marks to save as a picture');
        return;
      }
      state.fabricCanvas.discardActiveObject();
      var dataUrl = active.toDataURL({ format: 'png', multiplier: 2 });
      state.fabricCanvas.setActiveObject(active);
      state.fabricCanvas.requestRenderAll();
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'por-selection.png';
      a.click();
      setStatus('Selection saved as picture');
    }

    function exportPageAsPicture() {
      if (!state.fabricCanvas || !PorFab) return;
      var url = PorFab.snapshotCanvas(state.fabricCanvas);
      if (!url) return;
      var a = document.createElement('a');
      a.href = url;
      a.download = (activePage().title || 'drawing') + '.png';
      a.click();
      setStatus('Page saved as picture');
    }

    function applyFabricToolMode() {
      var canvas = state.fabricCanvas;
      if (!canvas) return;
      var tool = state.inkTool;
      canvas.isDrawingMode = tool === 'pencil' && !state.readOnly;
      canvas.selection = !tool || tool === null;
      // A shape tool is armed: a drag must always draw, never grab the handles
      // (or body) of the shape just drawn. Eraser and pencil keep hit-testing.
      canvas.skipTargetFind = SHAPE_TOOLS.indexOf(tool) !== -1;
      if (canvas.skipTargetFind) canvas.discardActiveObject();
      canvas.defaultCursor = tool && tool !== 'eraser' ? 'crosshair' : 'default';
      canvas.forEachObject(function (o) {
        o.selectable = !tool || tool === 'eraser';
        o.evented = !tool || tool === 'eraser';
      });
      if (tool === 'pencil') {
        canvas.freeDrawingBrush.color = state.inkColor;
        canvas.freeDrawingBrush.width = PorFab.strokeWidthFromThick(state.inkThick);
      }
      canvas.requestRenderAll();
    }

    function selectionTargets() {
      var canvas = state.fabricCanvas;
      if (!canvas) return [];
      var active = canvas.getActiveObject();
      if (!active) return [];
      if (active.type === 'activeSelection') {
        return typeof active.getObjects === 'function' ? active.getObjects() : (active._objects || []);
      }
      return [active];
    }

    // Move a Fabric object by a canvas-space delta even when it lives inside an
    // ActiveSelection (child left/top are group-relative — never add sheet dx/dy
    // to those). setPositionByOrigin always takes absolute sheet points.
    function moveObjectBy(obj, dx, dy) {
      if (!obj || (!dx && !dy)) return;
      var center = typeof obj.getCenterPoint === 'function'
        ? obj.getCenterPoint()
        : { x: obj.left || 0, y: obj.top || 0 };
      if (typeof obj.setPositionByOrigin === 'function' && window.fabric && window.fabric.Point) {
        obj.setPositionByOrigin(
          new window.fabric.Point(center.x + dx, center.y + dy),
          'center',
          'center'
        );
      } else {
        obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
      }
      obj.setCoords();
      if (obj.type === 'line' || obj.porKind === 'line' || obj.porKind === 'arrow') {
        obj.porPctEnds = null;
        try { PorFab.captureLineEnds(obj); } catch (_) {}
      }
    }

    // Flatten ActiveSelection to absolute objects, run work, sync overlays while
    // absolute, then optionally restore the multi-selection.
    function runOnAbsoluteSelection(work) {
      var canvas = state.fabricCanvas;
      if (!canvas) return false;
      var active = canvas.getActiveObject();
      if (!active) return false;
      var targets;
      if (active.type === 'activeSelection') {
        targets = (typeof active.getObjects === 'function'
          ? active.getObjects()
          : (active._objects || [])).slice();
        // discardActiveObject restores child left/top to canvas space once —
        // do not also call _restoreObjectsState (that double-applies the lift).
        canvas.discardActiveObject();
        targets.forEach(function (o) {
          try {
            if (o.group) o.group = undefined;
            o.setCoords();
          } catch (_) {}
        });
      } else {
        targets = [active];
      }
      if (!targets.length) return false;
      work(targets);
      // Persist while left/top are absolute — before re-wrapping in ActiveSelection.
      syncAndSave();
      if (targets.length > 1) {
        try {
          var sel = new window.fabric.ActiveSelection(targets, { canvas: canvas });
          canvas.setActiveObject(sel);
        } catch (_) {}
      } else if (targets.length === 1) {
        try { canvas.setActiveObject(targets[0]); } catch (_) {}
      }
      canvas.requestRenderAll();
      return true;
    }

    function groupSelection() {
      var canvas = state.fabricCanvas;
      if (!canvas || state.readOnly) return;
      var active = canvas.getActiveObject();
      if (!active || active.type !== 'activeSelection') return;
      pushHistory();
      active.toGroup();
      var g = canvas.getActiveObject();
      if (g) {
        g.set({ porId: PorFab.uid('grp'), porKind: 'group' });
        PorFab.styleControls(g);
      }
      canvas.requestRenderAll();
      syncAndSave();
    }

    function alignMarks(mode) {
      var canvas = state.fabricCanvas;
      if (!canvas || state.readOnly) return;
      if (!selectionTargets().length) return;
      pushHistory();
      runOnAbsoluteSelection(function (targets) {
        var boxes = targets.map(function (o) {
          // Prefer stroke-free absolute box so align matches saved geometry.
          var abs = null;
          try {
            if (typeof o.getPointByOrigin === 'function') {
              var pt = o.getPointByOrigin('left', 'top');
              var w = Math.abs((o.width || 0) * (o.scaleX || 1));
              var h = Math.abs((o.height || 0) * (o.scaleY || 1));
              abs = { left: pt.x, top: pt.y, width: w, height: h };
            }
          } catch (_) { abs = null; }
          var b = abs || o.getBoundingRect(true, true);
          return { o: o, b: b };
        });
        var useSheet = boxes.length < 2;
        var minL = useSheet ? 0 : Math.min.apply(null, boxes.map(function (x) { return x.b.left; }));
        var maxR = useSheet ? PAPER_W : Math.max.apply(null, boxes.map(function (x) { return x.b.left + x.b.width; }));
        var minT = useSheet ? 0 : Math.min.apply(null, boxes.map(function (x) { return x.b.top; }));
        var maxB = useSheet ? PAPER_H : Math.max.apply(null, boxes.map(function (x) { return x.b.top + x.b.height; }));
        var midX = (minL + maxR) / 2;
        var midY = (minT + maxB) / 2;
        boxes.forEach(function (x) {
          var b = x.b;
          var dx = 0;
          var dy = 0;
          if (mode === 'left') dx = minL - b.left;
          else if (mode === 'center') dx = midX - (b.left + b.width / 2);
          else if (mode === 'right') dx = maxR - (b.left + b.width);
          else if (mode === 'top') dy = minT - b.top;
          else if (mode === 'middle') dy = midY - (b.top + b.height / 2);
          else if (mode === 'bottom') dy = maxB - (b.top + b.height);
          moveObjectBy(x.o, dx, dy);
        });
      });
      setStatus('Aligned ' + mode);
    }

    function distributeMarks(axis) {
      var canvas = state.fabricCanvas;
      if (!canvas || state.readOnly) return;
      if (selectionTargets().length < 3) {
        setStatus('Select three or more marks to distribute');
        return;
      }
      pushHistory();
      runOnAbsoluteSelection(function (targets) {
        var boxes = targets.map(function (o) {
          return { o: o, b: o.getBoundingRect(true, true) };
        });
        boxes.sort(function (a, b) {
          return axis === 'h'
            ? (a.b.left + a.b.width / 2) - (b.b.left + b.b.width / 2)
            : (a.b.top + a.b.height / 2) - (b.b.top + b.b.height / 2);
        });
        var first = boxes[0];
        var last = boxes[boxes.length - 1];
        if (axis === 'h') {
          var span = (last.b.left + last.b.width / 2) - (first.b.left + first.b.width / 2);
          var step = span / (boxes.length - 1);
          boxes.forEach(function (x, i) {
            var want = (first.b.left + first.b.width / 2) + step * i;
            var cur = x.b.left + x.b.width / 2;
            moveObjectBy(x.o, want - cur, 0);
          });
        } else {
          var spanV = (last.b.top + last.b.height / 2) - (first.b.top + first.b.height / 2);
          var stepV = spanV / (boxes.length - 1);
          boxes.forEach(function (x, i) {
            var want = (first.b.top + first.b.height / 2) + stepV * i;
            var cur = x.b.top + x.b.height / 2;
            moveObjectBy(x.o, 0, want - cur);
          });
        }
      });
      setStatus('Distributed ' + (axis === 'h' ? 'horizontally' : 'vertically'));
    }

    function syncSelectionPane() {
      var list = root.querySelector('#por-selpane-list');
      if (!list) return;
      list.innerHTML = '';
      var canvas = state.fabricCanvas;
      if (!canvas) return;
      var objs = canvas.getObjects().filter(function (o) { return !o.excludeFromExport; }).slice().reverse();
      objs.forEach(function (obj, index) {
        var li = document.createElement('li');
        li.className = 'por-selpane__item' + (canvas.getActiveObject() === obj ? ' is-on' : '');
        li.setAttribute('data-por-sel', obj.porId || '');
        var name = obj.porName || obj.porKind || obj.type || ('Mark ' + (index + 1));
        var vis = document.createElement('button');
        vis.type = 'button';
        vis.className = 'por-selpane__vis';
        vis.title = obj.visible === false ? 'Show' : 'Hide';
        vis.textContent = obj.visible === false ? '○' : '●';
        vis.addEventListener('click', function (ev) {
          ev.stopPropagation();
          obj.visible = obj.visible === false;
          canvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          syncSelectionPane();
        });
        var label = document.createElement('button');
        label.type = 'button';
        label.className = 'por-selpane__name';
        label.textContent = name;
        label.addEventListener('click', function () {
          canvas.setActiveObject(obj);
          canvas.requestRenderAll();
          state.selectedId = obj.porId || null;
          syncSelectionPane();
        });
        label.addEventListener('dblclick', function () {
          var next = window.prompt('Rename mark', name);
          if (!next) return;
          obj.porName = next;
          syncOverlaysFromFabric();
          scheduleSave();
          syncSelectionPane();
        });
        var up = document.createElement('button');
        up.type = 'button';
        up.className = 'por-selpane__order';
        up.title = 'Bring forward';
        up.textContent = '↑';
        up.addEventListener('click', function (ev) {
          ev.stopPropagation();
          canvas.bringForward(obj);
          canvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          syncSelectionPane();
        });
        var down = document.createElement('button');
        down.type = 'button';
        down.className = 'por-selpane__order';
        down.title = 'Send backward';
        down.textContent = '↓';
        down.addEventListener('click', function (ev) {
          ev.stopPropagation();
          canvas.sendBackwards(obj);
          canvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          syncSelectionPane();
        });
        li.appendChild(vis);
        li.appendChild(label);
        li.appendChild(up);
        li.appendChild(down);
        list.appendChild(li);
      });
    }

    function clearSnapGuides() {
      state.snapGuides = [];
      var layer = sheetEl && sheetEl.querySelector('.por-guides');
      if (layer) layer.innerHTML = '';
    }

    function drawSnapGuides(guides) {
      state.snapGuides = guides || [];
      var layer = sheetEl && sheetEl.querySelector('.por-guides');
      if (!layer) return;
      layer.innerHTML = '';
      state.snapGuides.forEach(function (g) {
        var el = document.createElement('div');
        el.className = 'por-guide por-guide--' + g.axis;
        if (g.axis === 'x') el.style.left = g.pos + '%';
        else el.style.top = g.pos + '%';
        layer.appendChild(el);
      });
    }

    function snapMovingObject(obj) {
      if (!obj || !state.fabricCanvas) return;
      var thresh = 8;
      var b = obj.getBoundingRect(true, true);
      var cx = b.left + b.width / 2;
      var cy = b.top + b.height / 2;
      var others = state.fabricCanvas.getObjects().filter(function (o) {
        return o !== obj && !o.excludeFromExport && o.visible !== false;
      });
      var snapsX = [0, PAPER_W / 2, PAPER_W];
      var snapsY = [0, PAPER_H / 2, PAPER_H];
      others.forEach(function (o) {
        var ob = o.getBoundingRect(true, true);
        snapsX.push(ob.left, ob.left + ob.width / 2, ob.left + ob.width);
        snapsY.push(ob.top, ob.top + ob.height / 2, ob.top + ob.height);
      });
      state.guides.forEach(function (g) {
        if (g.axis === 'x') snapsX.push(g.pos / 100 * PAPER_W);
        else snapsY.push(g.pos / 100 * PAPER_H);
      });
      var dx = 0;
      var dy = 0;
      var guides = [];
      function near(value, snaps, axis) {
        for (var i = 0; i < snaps.length; i++) {
          if (Math.abs(value - snaps[i]) <= thresh) {
            guides.push({ axis: axis, pos: snaps[i] / (axis === 'x' ? PAPER_W : PAPER_H) * 100 });
            return snaps[i] - value;
          }
        }
        return 0;
      }
      dx = near(b.left, snapsX, 'x') || near(cx, snapsX, 'x') || near(b.left + b.width, snapsX, 'x');
      dy = near(b.top, snapsY, 'y') || near(cy, snapsY, 'y') || near(b.top + b.height, snapsY, 'y');
      if (dx || dy) {
        obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
        obj.setCoords();
      }
      drawSnapGuides(guides);
    }

    function ungroupSelection() {
      var canvas = state.fabricCanvas;
      if (!canvas || state.readOnly) return;
      var active = canvas.getActiveObject();
      if (!active || active.type !== 'group') return;
      pushHistory();
      active.toActiveSelection();
      // Flatten ActiveSelection immediately so saved coords stay absolute.
      var sel = canvas.getActiveObject();
      var members = sel && sel.type === 'activeSelection'
        ? (typeof sel.getObjects === 'function' ? sel.getObjects() : (sel._objects || [])).slice()
        : [];
      if (members.length) {
        canvas.discardActiveObject();
        members.forEach(function (o) { try { o.setCoords(); } catch (_) {} });
        if (members.length > 1) {
          canvas.setActiveObject(new window.fabric.ActiveSelection(members, { canvas: canvas }));
        } else if (members.length === 1) {
          canvas.setActiveObject(members[0]);
        }
      }
      canvas.requestRenderAll();
      syncAndSave();
    }

    function parkFabricTextarea() {
      // Fabric appends IText's hidden textarea on document.body; absolute top
      // after edit can push document.scrollHeight past the window.
      document.querySelectorAll('body > textarea').forEach(function (ta) {
        if (document.activeElement === ta) return;
        ta.style.top = '0px';
        ta.style.left = '0px';
        ta.style.paddingTop = '0px';
      });
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
      if (level) level.textContent = 'Fit';
      var slider = root.querySelector('#por-zoom-slider');
      if (slider && document.activeElement !== slider) {
        slider.value = String(Math.round(scale * 100));
      }
      var pct = root.querySelector('#por-zoom-pct');
      if (pct) pct.textContent = Math.round(scale * 100) + '%';
      parkFabricTextarea();
    }

    function zoomAtPointer(factor, clientX, clientY) {
      var rect = stageEl.getBoundingClientRect();
      var before = state.scale || 1;
      state.zoomMode = 'user';
      state.userScale = clamp(before * factor, 0.35, 2.4);
      applySheetScale();
      // Keep the pointer's sheet point under the cursor after scale.
      if (typeof clientX === 'number' && typeof clientY === 'number' && stageEl.scrollWidth) {
        var mx = clientX - rect.left + stageEl.scrollLeft;
        var my = clientY - rect.top + stageEl.scrollTop;
        var ratio = state.scale / before;
        stageEl.scrollLeft = mx * ratio - (clientX - rect.left);
        stageEl.scrollTop = my * ratio - (clientY - rect.top);
      }
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

    /** The level's contour picture, when the floor plan page has Contour switched on. */
    function resolveContourMediaId(page) {
      var bg = page && page.background;
      if (!bg || bg.kind !== 'plan' || !bg.contourOn || !bg.canvasId || !state.record) return null;
      var canvas = window.ToolboxPlanSetup && window.ToolboxPlanSetup.canvasById
        ? window.ToolboxPlanSetup.canvasById(state.record, bg.canvasId)
        : null;
      if (!canvas) return null;
      var layer = window.ToolboxPlanSetup.contourLayer
        ? window.ToolboxPlanSetup.contourLayer(canvas)
        : (canvas.contourLayer || null);
      return layer && layer.id ? layer.id : null;
    }

    function loadContourOverlay(page) {
      state.contourUrl = '';
      var mediaId = resolveContourMediaId(page);
      if (!mediaId || !window.ToolboxDB || !window.ToolboxDB.getMedia) return Promise.resolve();
      return window.ToolboxDB.getMedia(mediaId).then(function (url) {
        if (acceptBgUrl(url)) state.contourUrl = url;
      }).catch(function () { state.contourUrl = ''; });
    }

    function loadBackground() {
      state.bgUrl = '';
      state.contourUrl = '';
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
          return applySourceProbe(page, mediaId, url).then(function () {
            return loadContourOverlay(page);
          });
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

    function pageThumbDataUrl(page) {
      if (!page) return '';
      if (page._thumbDataUrl) return page._thumbDataUrl;
      if (!PorFab || !PorFab.ready()) return '';
      try {
        var tw = 204;
        var th = 132;
        var out = document.createElement('canvas');
        out.width = tw;
        out.height = th;
        var ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        if (page.id === state.doc.activePageId) {
          var bgImg = sheetEl && sheetEl.querySelector('.por-sheet-bg img');
          if (bgImg && bgImg.naturalWidth) ctx.drawImage(bgImg, 0, 0, tw, th);
        }
        var thumbEl = document.createElement('canvas');
        thumbEl.width = tw;
        thumbEl.height = th;
        thumbEl.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;';
        document.body.appendChild(thumbEl);
        var fc = PorFab.createCanvas(thumbEl, { width: tw, height: th, readOnly: true });
        fc.backgroundColor = 'rgba(0,0,0,0)';
        PorFab.overlaysToCanvas(fc, overlayList(page), { readOnly: true });
        if (typeof fc.renderAll === 'function') fc.renderAll();
        var markCanvas = (typeof fc.toCanvasElement === 'function') ? fc.toCanvasElement() : thumbEl;
        ctx.drawImage(markCanvas, 0, 0, tw, th);
        try { fc.dispose(); } catch (_) {}
        if (thumbEl.parentNode) thumbEl.parentNode.removeChild(thumbEl);
        var url = out.toDataURL('image/png');
        page._thumbDataUrl = url;
        return url;
      } catch (_) {
        return '';
      }
    }

    function refreshActivePageThumb() {
      var page = activePage();
      if (!page) return;
      try {
        delete page._thumbDataUrl;
        var tw = 204;
        var th = 132;
        var out = document.createElement('canvas');
        out.width = tw;
        out.height = th;
        var ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        var bgImg = sheetEl && sheetEl.querySelector('.por-sheet-bg img');
        if (bgImg && bgImg.naturalWidth) ctx.drawImage(bgImg, 0, 0, tw, th);
        function paintMarks(markCanvas) {
          if (markCanvas) ctx.drawImage(markCanvas, 0, 0, tw, th);
          page._thumbDataUrl = out.toDataURL('image/png');
          var thumb = root.querySelector('.por-page.is-active .por-page__thumb');
          if (thumb) {
            thumb.src = page._thumbDataUrl;
            thumb.classList.remove('is-empty');
          }
        }
        if (state.fabricCanvas && typeof state.fabricCanvas.toCanvasElement === 'function') {
          paintMarks(state.fabricCanvas.toCanvasElement());
          return;
        }
        if (state.fabricCanvas) {
          var data = state.fabricCanvas.toDataURL({
            format: 'png',
            multiplier: tw / PAPER_W,
            enableRetinaScaling: false,
          });
          var img = new Image();
          img.onload = function () { paintMarks(img); };
          img.src = data;
          return;
        }
        pageThumbDataUrl(page);
      } catch (_) {}
    }

    function reorderPages(fromId, toId) {
      if (!fromId || !toId || fromId === toId || state.readOnly) return;
      var pages = state.doc.pages;
      var from = -1;
      var to = -1;
      pages.forEach(function (p, i) {
        if (p.id === fromId) from = i;
        if (p.id === toId) to = i;
      });
      if (from < 0 || to < 0) return;
      pushHistory();
      var moved = pages.splice(from, 1)[0];
      pages.splice(to, 0, moved);
      scheduleSave();
      renderPageList();
    }

    function openPageThumbMenu(event, pageId) {
      closeShapeMenu();
      var wrap = document.createElement('div');
      wrap.className = 'por-ctx por-ctx--page';
      wrap.setAttribute('data-por-shapemenu', '1');
      var menu = document.createElement('div');
      menu.className = 'rb-stackmenu por-ctx__menu';
      menuItem(menu, 'New', function () {
        root.querySelector('#por-add-page').click();
      }, state.readOnly);
      menuItem(menu, 'Duplicate', function () {
        if (pageId && pageId !== state.doc.activePageId) {
          state.doc.activePageId = pageId;
        }
        root.querySelector('#por-dup-page').click();
      }, state.readOnly);
      menuItem(menu, 'Delete', function () {
        if (pageId && pageId !== state.doc.activePageId) {
          state.doc.activePageId = pageId;
          renderPageList();
        }
        root.querySelector('#por-remove-page').click();
      }, state.readOnly || state.doc.pages.length <= 1);
      wrap.appendChild(menu);
      wrap.style.left = Math.round(event.clientX) + 'px';
      wrap.style.top = Math.round(event.clientY) + 'px';
      document.body.appendChild(wrap);
      state.shapeMenu = wrap;
      setTimeout(function () {
        document.addEventListener('pointerdown', function away(ev) {
          if (ev.target.closest && ev.target.closest('[data-por-shapemenu]')) return;
          closeShapeMenu();
          document.removeEventListener('pointerdown', away, true);
        }, true);
      }, 0);
    }

    function renderPageList() {
      var list = root.querySelector('#por-page-list');
      list.innerHTML = '';
      state.doc.pages.forEach(function (page, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rb-rail__page por-page' + (page.id === state.doc.activePageId ? ' is-active' : '');
        btn.draggable = !state.readOnly;
        btn.setAttribute('data-por-page', page.id);
        var num = document.createElement('span');
        num.className = 'por-page__num';
        num.textContent = String(index + 1);
        var thumb = document.createElement('img');
        thumb.className = 'por-page__thumb';
        thumb.alt = 'Page ' + (index + 1);
        var dataUrl = pageThumbDataUrl(page);
        if (dataUrl) thumb.src = dataUrl;
        else thumb.classList.add('is-empty');
        var label = document.createElement('span');
        label.className = 'por-page__label';
        label.textContent = page.title || 'Drawing';
        btn.appendChild(num);
        btn.appendChild(thumb);
        btn.appendChild(label);
        btn.addEventListener('click', function () {
          if (page.id === state.doc.activePageId) return;
          state.doc.activePageId = page.id;
          state.selectedId = null;
          loadBackground().then(renderSheet);
          renderPageList();
          syncStatusBar();
        });
        btn.addEventListener('contextmenu', function (ev) {
          ev.preventDefault();
          openPageThumbMenu(ev, page.id);
        });
        btn.addEventListener('dragstart', function (ev) {
          if (state.readOnly) return;
          ev.dataTransfer.setData('text/por-page', page.id);
          ev.dataTransfer.effectAllowed = 'move';
          btn.classList.add('is-dragging');
        });
        btn.addEventListener('dragend', function () {
          btn.classList.remove('is-dragging');
        });
        btn.addEventListener('dragover', function (ev) {
          if (state.readOnly) return;
          ev.preventDefault();
          btn.classList.add('is-drop');
        });
        btn.addEventListener('dragleave', function () {
          btn.classList.remove('is-drop');
        });
        btn.addEventListener('drop', function (ev) {
          ev.preventDefault();
          btn.classList.remove('is-drop');
          var fromId = ev.dataTransfer.getData('text/por-page');
          reorderPages(fromId, page.id);
        });
        list.appendChild(btn);
      });
      syncStatusBar();
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
      // Sync marks out before tearing down the Fabric canvas.
      if (state.fabricCanvas && !state.printMode) {
        try { syncOverlaysFromFabric(); } catch (_) {}
      }
      destroyFabric();
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
          var frame = clampFrameToDrawArea(view && view.frame);
          if (view) view.frame = frame;
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
          var contourImg = null;
          if (state.contourUrl) {
            contourImg = document.createElement('img');
            contourImg.src = state.contourUrl;
            contourImg.alt = 'Contour';
            contourImg.className = 'por-bg-contour';
            contourImg.draggable = false;
            img.classList.add('por-bg-plan--over');
            host.appendChild(contourImg);
          }
          host.appendChild(img);
          var label = document.createElement('span');
          label.className = 'por-view-frame__label';
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
          if (contourImg) applyViewCamera(contourImg, host, viewCamera(view));
        });
      } else if (state.bgUrl) {
        var img = document.createElement('img');
        img.src = state.bgUrl;
        img.alt = page.background && page.background.kind === 'contour'
          ? 'Contour'
          : (page.background && page.background.kind === 'import' ? 'Imported drawing' : 'Floor plan');
        if (state.contourUrl && page.background && page.background.kind === 'plan') {
          // Contour switched on: contour is the base, the plan is multiplied over it,
          // both at the plan's extent (the same order the Topo tab and report use).
          var stack = document.createElement('div');
          stack.className = 'por-bg-stack';
          var contourBase = document.createElement('img');
          contourBase.src = state.contourUrl;
          contourBase.alt = 'Contour';
          contourBase.className = 'por-bg-contour';
          contourBase.draggable = false;
          img.classList.add('por-bg-plan--over');
          stack.appendChild(contourBase);
          stack.appendChild(img);
          bg.appendChild(stack);
        } else {
          bg.appendChild(img);
        }
      } else if (!state.printMode) {
        // Hint only on a truly blank sheet (no marks). Missing-bg warning stays
        // until a background resolves; never enter the print DOM (printMode).
        var hasMarks = overlayList(page).length > 0;
        if (state.bgMissing) {
          var missing = document.createElement('p');
          missing.className = 'por-sheet-bg__empty por-sheet-bg__empty--warn';
          missing.textContent = 'Referenced background is missing — review before print.';
          bg.appendChild(missing);
        } else if (!hasMarks) {
          var empty = document.createElement('p');
          empty.className = 'por-sheet-bg__empty';
          empty.setAttribute('aria-hidden', 'true');
          empty.textContent = 'Blank sheet, or bring in a floor plan, contour, or imported drawing.';
          bg.appendChild(empty);
        }
      }
      sheetEl.appendChild(bg);
      syncContourToggle();

      if (!state.printMode) {
        var guides = document.createElement('div');
        guides.className = 'por-guides';
        guides.setAttribute('aria-hidden', 'true');
        sheetEl.appendChild(guides);
        if (state.showGrid) {
          var grid = document.createElement('div');
          grid.className = 'por-grid';
          grid.setAttribute('aria-hidden', 'true');
          sheetEl.appendChild(grid);
        }
        if (state.showRulers) {
          var rulerX = document.createElement('div');
          rulerX.className = 'por-ruler por-ruler--x';
          var rulerY = document.createElement('div');
          rulerY.className = 'por-ruler por-ruler--y';
          sheetEl.appendChild(rulerX);
          sheetEl.appendChild(rulerY);
          rulerX.addEventListener('pointerdown', function (ev) {
            if (state.readOnly) return;
            var rect = sheetEl.getBoundingClientRect();
            var y = ((ev.clientY - rect.top) / rect.height) * 100;
            state.guides.push({ axis: 'y', pos: Math.max(0, Math.min(100, y)) });
            drawSnapGuides(state.guides.map(function (g) { return g; }));
          });
          rulerY.addEventListener('pointerdown', function (ev) {
            if (state.readOnly) return;
            var rect = sheetEl.getBoundingClientRect();
            var x = ((ev.clientX - rect.left) / rect.width) * 100;
            state.guides.push({ axis: 'x', pos: Math.max(0, Math.min(100, x)) });
            drawSnapGuides(state.guides.map(function (g) { return g; }));
          });
        }
        if (state.guides.length) drawSnapGuides(state.guides.slice());
      }

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

      // Fabric drawing surface (Stage 1). Overlays persist; Fabric is the editor.
      if (!state.printMode && PorFab && PorFab.ready()) {
        ensureFabricOnSheet();
        syncSelectionPane();
      } else if (state.printMode && PorFab && PorFab.ready()) {
        // Print: paint marks as a flat PNG so paper has no editor chrome.
        var printHost = document.createElement('div');
        printHost.className = 'por-fabric-host por-fabric-host--print';
        printHost.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;pointer-events:none;';
        var tmpCanvas = document.createElement('canvas');
        printHost.appendChild(tmpCanvas);
        sheetEl.appendChild(printHost);
        var tmp = PorFab.createCanvas(tmpCanvas, { width: PAPER_W, height: PAPER_H, readOnly: true });
        PorFab.overlaysToCanvas(tmp, overlayList(page), { readOnly: true });
        var url = PorFab.snapshotCanvas(tmp);
        try { tmp.dispose(); } catch (_) {}
        printHost.innerHTML = '';
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;display:block;';
        printHost.appendChild(img);
      } else if (api && typeof api.renderLayer === 'function') {
        // Fallback if Fabric failed to load — keep prior overlay renderer.
        var layer = api.renderLayer(overlayList(page), { locked: state.readOnly });
        if (layer) sheetEl.appendChild(layer);
        if (state.selectedId) renderSelectionChrome(page);
      }

      applySheetScale();
      wireRailEdits(page);
      syncInspector();
      syncStatusBar();
      syncSheetCursor();
      // Refresh the active page's slide thumb after marks land.
      setTimeout(function () { refreshActivePageThumb(); }, 40);
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
      if (state.readOnly || !color) {
        setStatus('Can’t format');
        return false;
      }
      rememberColor(color);
      var target = fabricActive();
      if (state.fabricCanvas && target) {
        pushHistory();
        if (role === 'fill') {
          applyStyleToFabricTarget(target, { fill: color });
          state.fillColor = color;
          state.inkFill = true;
          if (fillInput) fillInput.checked = true;
        } else if (role === 'outline') {
          applyStyleToFabricTarget(target, { stroke: color });
          state.inkColor = color;
        } else {
          return false;
        }
        state.fabricCanvas.requestRenderAll();
        syncOverlaysFromFabric();
        scheduleSave();
        syncHistoryButtons();
        setStatus(role === 'fill' ? 'Fill updated' : 'Outline updated');
        return true;
      }
      if (!state.selectedId) {
        if (role === 'fill') { state.fillColor = color; state.inkFill = true; if (fillInput) fillInput.checked = true; }
        else state.inkColor = color;
        syncHistoryButtons();
        return true;
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
      var canFill = item.kind === 'rect' || item.kind === 'circle' || item.kind === 'roundRect' ||
        item.kind === 'triangle';
      pushHistory();
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

    function rememberColor(color) {
      if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
      state.recentColors = [color].concat(state.recentColors.filter(function (c) {
        return c !== color;
      })).slice(0, 8);
      ['por-outline-recent', 'por-fill-recent'].forEach(function (id) {
        var host = root.querySelector('#' + id);
        if (!host) return;
        host.innerHTML = state.recentColors.map(function (c) {
          return '<button type="button" class="por-swatch" data-por-recent="' + c + '" style="--por-swatch:' + c + '" title="' + c + '"></button>';
        }).join('');
      });
    }

    function fabricActive() {
      return state.fabricCanvas && state.fabricCanvas.getActiveObject
        ? state.fabricCanvas.getActiveObject()
        : null;
    }

    function applyStyleToFabricTarget(target, style) {
      if (!target || !style) return;
      if (target.type === 'activeSelection' || target.type === 'group') {
        var kids = typeof target.getObjects === 'function' ? target.getObjects() : (target._objects || []);
        kids.forEach(function (child) { applyStyleToFabricTarget(child, style); });
        return;
      }
      if (style.stroke) target.set('stroke', style.stroke);
      if (style.strokeWidth != null) target.set('strokeWidth', style.strokeWidth);
      if (style.fill !== undefined) target.set('fill', style.fill);
      if (style.opacity != null) target.set('opacity', style.opacity);
      if (style.strokeDashArray !== undefined) target.set('strokeDashArray', style.strokeDashArray);
      if (style.porArrow != null) target.set('porArrow', style.porArrow);
      target.setCoords();
    }

    function dashArrayFor(name, thick) {
      if (name === 'dashed') return [10, 6];
      if (name === 'dotted') return [2, 4];
      return null;
    }

    function captureStyleFromTarget(target) {
      if (!target) return null;
      return {
        stroke: target.stroke,
        strokeWidth: target.strokeWidth,
        fill: target.fill,
        opacity: target.opacity,
        strokeDashArray: target.strokeDashArray || null,
        porArrow: !!target.porArrow,
      };
    }

    function openPanel(which) {
      var panel = root.querySelector('#por-panel');
      var selpane = root.querySelector('#por-selpane');
      if (!panel) return;
      panel.hidden = false;
      if (which === 'selection') {
        if (selpane) selpane.hidden = false;
        if (inspectorEl) inspectorEl.hidden = true;
        var pt = root.querySelector('#por-panel-title');
        if (pt) pt.textContent = 'Selection';
        syncSelectionPane();
      } else {
        if (selpane) selpane.hidden = true;
        openInspector(which === 'size' ? 'size' : 'format');
      }
      // Sheet column shrinks when the pane opens — re-fit so title block stays visible.
      requestAnimationFrame(function () { applySheetScale(); fitRibbon(); });
    }

    function closePanel() {
      var panel = root.querySelector('#por-panel');
      var selpane = root.querySelector('#por-selpane');
      if (panel) panel.hidden = true;
      if (selpane) selpane.hidden = true;
      closeInspector();
      requestAnimationFrame(function () { applySheetScale(); fitRibbon(); });
    }

    function openInspector(mode) {
      state.inspectorMode = mode || 'format';
      state.inspectorOpen = true;
      var panel = root.querySelector('#por-panel');
      var selpane = root.querySelector('#por-selpane');
      if (panel) panel.hidden = false;
      if (selpane) selpane.hidden = true;
      var pt = root.querySelector('#por-panel-title');
      if (pt) pt.textContent = mode === 'size' ? 'Size and Position' : 'Format Shape';
      syncInspector();
      if (inspectorEl) inspectorEl.scrollIntoView({ block: 'nearest' });
      requestAnimationFrame(function () { applySheetScale(); fitRibbon(); });
    }

    function closeInspector() {
      state.inspectorOpen = false;
      if (inspectorEl) inspectorEl.hidden = true;
    }

    function syncInspector() {
      var item = selectedItem();
      if (!inspectorEl) return;
      if (!item || !state.inspectorOpen) {
        inspectorEl.hidden = true;
        return;
      }
      inspectorEl.hidden = false;
      var title = root.querySelector('#por-inspector-title');
      if (title && title.tagName === 'SUMMARY') {
        /* Fill section keeps its own label */
      } else if (title) {
        title.textContent = state.inspectorMode === 'size' ? 'Size and Position' : 'Format Shape';
      }
      var canFill = item.kind === 'rect' || item.kind === 'circle' || item.kind === 'roundRect' ||
        item.kind === 'triangle' || item.kind === 'ellipse';
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
      if (state.readOnly) return;
      if (state.fabricCanvas) {
        var active = state.fabricCanvas.getActiveObject();
        if (!active) return;
        pushHistory();
        if (where === 'front') state.fabricCanvas.bringToFront(active);
        else if (where === 'back') state.fabricCanvas.sendToBack(active);
        else if (where === 'forward') state.fabricCanvas.bringForward(active);
        else if (where === 'backward') state.fabricCanvas.sendBackwards(active);
        else return;
        state.fabricCanvas.requestRenderAll();
        syncOverlaysFromFabric();
        scheduleSave();
        setStatus(where === 'front' || where === 'forward' ? 'Brought forward' : 'Sent back');
        return;
      }
      if (!state.selectedId) return;
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

    function applyViewPanFromClient(event) {
      if (!state.drag || state.drag.mode !== 'view-pan' || !event) return;
      if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
      var views2 = activeViews();
      var view2 = views2[state.drag.viewIndex];
      if (!view2) return;
      var liveHost = sheetEl && sheetEl.querySelector
        ? sheetEl.querySelector('[data-por-view="' + state.drag.viewIndex + '"]')
        : null;
      var fw = state.drag.hostW || (liveHost && liveHost.clientWidth) || 1;
      var fh = state.drag.hostH || (liveHost && liveHost.clientHeight) || 1;
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
      if (liveHost) {
        applyViewCamera(liveHost.querySelector('img'), liveHost, nextCam);
      }
    }

    function sheetPercent(event) {
      if (!sheetEl || typeof sheetEl.getBoundingClientRect !== 'function') return null;
      var rect = sheetEl.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
    }

    function setInkTool(name) {
      state.inkTool = name || null;
      sheetEl.classList.toggle('rb-sheet--inking', !!state.inkTool);
      sheetEl.classList.toggle('rb-sheet--erasing', state.inkTool === 'eraser');
      if (state.fabricCanvas) applyFabricToolMode();
      else syncHistoryButtons();
      syncHistoryButtons();
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
        field.addEventListener('focus', function () {
          state.editingText = true;
          var host = field.closest('[data-rb-ov]');
          if (host) state.selectedId = host.getAttribute('data-rb-ov');
          syncHistoryButtons();
        });
        field.addEventListener('blur', function () {
          commitOverlayText(field);
          state.editingText = false;
          syncHistoryButtons();
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
        state.editingText = false;
        renderSheet();
        syncHistoryButtons();
        return false;
      }
      state.selectedId = target.getAttribute('data-rb-ov');
      var item = selectedItem();
      state.editingText = !!(item && item.kind === 'text');
      renderSheet();
      syncHistoryButtons();
      return true;
    }

    function copySelected() {
      if (state.fabricCanvas) {
        var active = state.fabricCanvas.getActiveObject();
        if (!active) return false;
        state.clipboard = active.toObject([
          'porId', 'porKind', 'porArrow',
        ]);
        setStatus('Shape copied');
        return true;
      }
      var item = selectedItem();
      if (!item) return false;
      state.clipboard = deepClone(item);
      setStatus('Shape copied');
      return true;
    }

    function cutSelected() {
      if (state.readOnly) return false;
      if (!copySelected()) return false;
      deleteSelected();
      setStatus('Shape cut');
      return true;
    }

    function pasteClipboard() {
      if (state.readOnly || !state.clipboard) return false;
      if (state.fabricCanvas && state.clipboard && state.clipboard.type) {
        pushHistory();
        window.fabric.util.enlivenObjects([state.clipboard], function (objects) {
          var obj = objects[0];
          if (!obj) return;
          obj.set({
            left: (obj.left || 0) + 24,
            top: (obj.top || 0) + 24,
            porId: PorFab.uid('ov'),
          });
          PorFab.styleControls(obj);
          state.fabricCanvas.add(obj);
          state.fabricCanvas.setActiveObject(obj);
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          scheduleSave();
          setStatus('Shape pasted');
        });
        return true;
      }
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
      if (state.readOnly) return;
      if (state.fabricCanvas) {
        var active = state.fabricCanvas.getActiveObject();
        if (!active) return;
        pushHistory();
        if (active.type === 'activeSelection') {
          active.forEachObject(function (o) { state.fabricCanvas.remove(o); });
        }
        state.fabricCanvas.remove(active);
        state.fabricCanvas.discardActiveObject();
        state.fabricCanvas.requestRenderAll();
        state.selectedId = null;
        syncOverlaysFromFabric();
        scheduleSave();
        return;
      }
      if (!state.selectedId) return;
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

    function menuItem(menu, label, action, disabled, iconHtml) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rb-stackmenu__item por-ctx__item';
      if (iconHtml) {
        var ic = document.createElement('span');
        ic.className = 'por-ctx__icon';
        ic.innerHTML = iconHtml;
        btn.appendChild(ic);
      }
      var lab = document.createElement('span');
      lab.className = 'por-ctx__label';
      lab.textContent = label;
      btn.appendChild(lab);
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

    function menuSub(menu, label, iconHtml, entries) {
      var wrap = document.createElement('div');
      wrap.className = 'por-ctx__subwrap';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rb-stackmenu__item por-ctx__item por-ctx__item--sub';
      if (iconHtml) {
        var ic = document.createElement('span');
        ic.className = 'por-ctx__icon';
        ic.innerHTML = iconHtml;
        btn.appendChild(ic);
      }
      var lab = document.createElement('span');
      lab.className = 'por-ctx__label';
      lab.textContent = label;
      btn.appendChild(lab);
      var chev = document.createElement('span');
      chev.className = 'por-ctx__chev';
      chev.textContent = '▸';
      btn.appendChild(chev);
      var fly = document.createElement('div');
      fly.className = 'por-ctx__submenu';
      fly.hidden = true;
      entries.forEach(function (entry) {
        menuItem(fly, entry.label, entry.action, entry.disabled, entry.icon);
      });
      btn.addEventListener('mouseenter', function () { fly.hidden = false; });
      wrap.addEventListener('mouseleave', function () { fly.hidden = true; });
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        fly.hidden = !fly.hidden;
      });
      wrap.appendChild(btn);
      wrap.appendChild(fly);
      menu.appendChild(wrap);
      return wrap;
    }

    function openShapeMenu(event, id) {
      closeShapeMenu();
      state.selectedId = id;
      // Do not re-render the sheet — that tears down the Fabric canvas mid-gesture.
      var wrap = document.createElement('div');
      wrap.className = 'por-ctx';
      wrap.setAttribute('data-por-shapemenu', '1');

      var fillColor = state.fillColor || '#eab308';
      var outlineColor = state.inkColor || '#1d4ed8';
      var active = fabricActive();
      if (active) {
        if (active.fill && active.fill !== 'transparent') fillColor = active.fill;
        if (active.stroke) outlineColor = active.stroke;
      }

      var mini = document.createElement('div');
      mini.className = 'por-mini';
      mini.setAttribute('role', 'toolbar');
      mini.setAttribute('aria-label', 'Quick format');

      function miniIconBtn(key, title, iconHtml, colorBar, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'por-mini__btn por-mini__btn--icon';
        b.title = title;
        b.setAttribute('aria-label', key);
        // Keep a text node for tests that read textContent (Style/Fill/Outline).
        var sr = document.createElement('span');
        sr.className = 'por-sr-only';
        sr.textContent = key;
        b.appendChild(sr);
        var ic = document.createElement('span');
        ic.className = 'por-mini__glyph';
        ic.innerHTML = iconHtml;
        b.appendChild(ic);
        if (colorBar) {
          var bar = document.createElement('span');
          bar.className = 'por-mini__bar';
          bar.style.background = colorBar;
          bar.setAttribute('data-por-mini-swatch', key.toLowerCase());
          b.appendChild(bar);
        }
        var chev = document.createElement('span');
        chev.className = 'por-mini__chev';
        chev.textContent = '▾';
        b.appendChild(chev);
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          closeShapeMenu();
          fn();
        });
        mini.appendChild(b);
      }

      miniIconBtn('Style', 'Style', ICONS.styleBrush, null, function () {
        var t = fabricActive();
        state.formatPainter = captureStyleFromTarget(t);
        setStatus(state.formatPainter ? 'Format Painter ready — click a mark' : 'Nothing to copy');
        syncHistoryButtons();
      });
      miniIconBtn('Fill', 'Fill', ICONS.fillBucket, fillColor, function () {
        openInspector('format');
        setTimeout(function () {
          var btn = root.querySelector('#por-fill-btn');
          if (btn) btn.click();
        }, 0);
      });
      miniIconBtn('Outline', 'Outline', ICONS.outlinePen, outlineColor, function () {
        openInspector('format');
        setTimeout(function () {
          var btn = root.querySelector('#por-outline-btn');
          if (btn) btn.click();
        }, 0);
      });
      wrap.appendChild(mini);

      var menu = document.createElement('div');
      menu.className = 'rb-stackmenu por-ctx__menu';
      menuItem(menu, 'Cut', function () { cutSelected(); }, state.readOnly, ICONS.cut);
      menuItem(menu, 'Copy', function () { copySelected(); }, false, ICONS.copy);
      menuItem(menu, 'Paste', function () { pasteClipboard(); }, state.readOnly || !state.clipboard, ICONS.paste);
      menuSep(menu);
      var isText = !!(active && (active.type === 'textbox' || active.type === 'i-text' || active.porKind === 'text'));
      var isGroup = !!(active && active.type === 'group');
      var isMulti = !!(active && active.type === 'activeSelection');
      menuItem(menu, 'Edit Text', function () {
        if (!active || state.readOnly) return;
        if (isText && typeof active.enterEditing === 'function') {
          active.enterEditing();
          active.selectAll();
          state.editingText = true;
          syncHistoryButtons();
        } else {
          setStatus('Select a text box to edit');
        }
      }, state.readOnly || !isText, ICONS.text);
      menuSub(menu, 'Group', svgIcon('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/><path d="M11 8h2v8h-2z"/>'), [
        { label: 'Group', action: function () { groupSelection(); }, disabled: state.readOnly || !isMulti },
        { label: 'Ungroup', action: function () { ungroupSelection(); }, disabled: state.readOnly || !isGroup },
      ]);
      menuSep(menu);
      menuSub(menu, 'Bring to Front', svgIcon('<path d="M5 16h14M7 12h10M9 8h6"/>'), [
        { label: 'Bring to Front', action: function () { reorderSelected('front'); }, disabled: state.readOnly },
        { label: 'Bring Forward', action: function () { reorderSelected('forward'); }, disabled: state.readOnly },
      ]);
      menuSub(menu, 'Send to Back', svgIcon('<path d="M5 8h14M7 12h10M9 16h6"/>'), [
        { label: 'Send to Back', action: function () { reorderSelected('back'); }, disabled: state.readOnly },
        { label: 'Send Backward', action: function () { reorderSelected('backward'); }, disabled: state.readOnly },
      ]);
      menuSep(menu);
      menuItem(menu, 'Size and Position…', function () {
        openInspector('size');
        root.querySelector('#por-size-w').focus();
      }, false, svgIcon('<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>'));
      menuItem(menu, 'Format Shape…', function () {
        openInspector('format');
        if (shapeFillInput) shapeFillInput.focus();
      }, false, ICONS.rect);
      menuSep(menu);
      menuItem(menu, 'Delete', function () { deleteSelected(); }, state.readOnly, svgIcon('<path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12"/>'));
      wrap.appendChild(menu);

      wrap.style.left = Math.round(event.clientX) + 'px';
      wrap.style.top = Math.round(event.clientY) + 'px';
      document.body.appendChild(wrap);
      state.shapeMenu = wrap;
      var mw = wrap.offsetWidth;
      var mh = wrap.offsetHeight;
      wrap.style.left = Math.max(4, Math.min(window.innerWidth - mw - 4, event.clientX)) + 'px';
      wrap.style.top = Math.max(4, Math.min(window.innerHeight - mh - 4, event.clientY - 36)) + 'px';
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
      // Fabric owns drawing/selection on its canvas. Intercepting pointerdown here
      // (beginInk → preventDefault / renderSheet) stopped real mouse events from
      // reaching Fabric — tests only passed with synthetic MouseEvents.
      if (event.target.closest && event.target.closest(
        '.por-fabric-host, .canvas-container, .upper-canvas, .lower-canvas'
      )) {
        return;
      }

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
        // Capture live frame size BEFORE renderSheet() — storing the host node
        // and reading clientWidth after re-render yields 0 (detached) and flings
        // the camera to the edge (fw/fh fall back to 1).
        state.drag = {
          mode: 'view-pan',
          viewIndex: pVi,
          startClient: { x: event.clientX, y: event.clientY },
          hostW: Math.max(1, viewHost.clientWidth || 0),
          hostH: Math.max(1, viewHost.clientHeight || 0),
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
        // Legacy DOM ink path only when Fabric is not mounted.
        if (!state.fabricCanvas) beginInk(event);
        return;
      }

      state.selectedId = null;
      state.selectedViewIndex = null;
      if (state.fabricCanvas) {
        state.fabricCanvas.discardActiveObject();
        state.fabricCanvas.requestRenderAll();
        syncHistoryButtons();
        syncSelectionPane();
        return;
      }
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
        }
        view.frame = clampFrameToDrawArea(next);
        renderSheet();
        return;
      }

      if (state.drag.mode === 'view-pan') {
        applyViewPanFromClient(event);
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
        var wasViewPan = state.drag.mode === 'view-pan';
        state.drag = null;
        if (wasViewPan && state.fabricCanvas) state.fabricCanvas.selection = !state.readOnly;
        var page = activePage();
        if (!wasView) {
          var api = overlayApi();
          if (api) page.overlays = api.normalize(overlayList(page));
        }
        scheduleSave();
        // View-pan already applied live camera CSS; avoid a full re-render wipe.
        if (wasViewPan) return;
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
        state.editingText = false;
        closeShapeMenu();
        clearSnapGuides();
        if (state.fabricCanvas) {
          state.fabricCanvas.discardActiveObject();
          state.fabricCanvas.requestRenderAll();
          syncHistoryButtons();
        } else {
          renderSheet();
        }
        return;
      }
      if (event.code === 'Space' && !typing) {
        if (!state.spaceDown) {
          state.spaceDown = true;
          stageEl.classList.add('por-stage--hand');
        }
        event.preventDefault();
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
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        if (state.fabricCanvas && !state.readOnly) {
          var objs = state.fabricCanvas.getObjects().filter(function (o) { return o.selectable !== false; });
          if (objs.length) {
            var sel = new window.fabric.ActiveSelection(objs, { canvas: state.fabricCanvas });
            state.fabricCanvas.setActiveObject(sel);
            state.fabricCanvas.requestRenderAll();
          }
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (!mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown' ||
          event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (state.fabricCanvas && state.fabricCanvas.getActiveObject()) {
          event.preventDefault();
          var activeNudge = state.fabricCanvas.getActiveObject();
          // Don't steal arrow keys while typing into a text box.
          if (activeNudge.isEditing) return;
          var stepPx = event.shiftKey ? 16 : 4;
          var dxPx = event.key === 'ArrowLeft' ? -stepPx : (event.key === 'ArrowRight' ? stepPx : 0);
          var dyPx = event.key === 'ArrowUp' ? -stepPx : (event.key === 'ArrowDown' ? stepPx : 0);
          pushHistory();
          // Nudge the ActiveSelection (or single object) as a unit — Fabric keeps
          // children consistent; canvasToOverlays discards selection for absolute save.
          activeNudge.set({
            left: (activeNudge.left || 0) + dxPx,
            top: (activeNudge.top || 0) + dyPx,
          });
          activeNudge.setCoords();
          if (activeNudge.type === 'line' || activeNudge.porKind === 'arrow' ||
              activeNudge.porKind === 'line') {
            activeNudge.porPctEnds = null;
            try { PorFab.captureLineEnds(activeNudge); } catch (_) {}
          }
          state.fabricCanvas.requestRenderAll();
          syncAndSave();
          return;
        }
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

    /** Contour toggle: on only for a floor-plan page whose level has a contour. */
    function syncContourToggle() {
      var btn = root.querySelector('#por-contour-toggle');
      if (!btn) return;
      var page = activePage();
      var bg = page && page.background;
      var onPlan = !!(bg && bg.kind === 'plan' && bg.canvasId);
      var hasContour = false;
      if (onPlan && state.record && window.ToolboxPlanSetup && window.ToolboxPlanSetup.canvasById) {
        var cv = window.ToolboxPlanSetup.canvasById(state.record, bg.canvasId);
        hasContour = !!(cv && window.ToolboxPlanSetup.contourLayer && window.ToolboxPlanSetup.contourLayer(cv));
      }
      var on = onPlan && hasContour && bg.contourOn === true;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.disabled = state.readOnly || !onPlan || !hasContour;
      btn.title = !onPlan
        ? 'Contour sits on a floor plan: put a floor plan on this sheet first'
        : (!hasContour ? 'No contour on this level yet' : (on ? 'Contour is on: click to hide it' : 'Show the contour under the floor plan'));
    }

    function toggleContour() {
      if (state.readOnly) return;
      var page = activePage();
      var bg = page && page.background;
      if (!bg || bg.kind !== 'plan' || !bg.canvasId) return;
      pushHistory();
      bg.contourOn = !bg.contourOn;
      scheduleSave();
      loadBackground().then(function () {
        scheduleSave();
        renderSheet();
      });
      setStatus(bg.contourOn ? 'Contour on the floor plan' : 'Contour hidden');
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
        '.por-sel, .rb-ov__resize, .rb-ov__remove, .por-view-frame__handle, .por-view-frame__move, .upper-canvas, .canvas-container'
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

    // Paint / PowerPoint icon toolbar (not the RB text ribbon).
    root.querySelector('#por-undo').addEventListener('click', function () { undo(); });
    root.querySelector('#por-redo').addEventListener('click', function () { redo(); });
    root.querySelectorAll('[data-por-tool="select"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedId = null;
        state.editingText = false;
        setInkTool(null);
      });
    });
    root.querySelectorAll('[data-rb-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.readOnly) return;
        var want = btn.getAttribute('data-rb-tool');
        state.selectedId = null;
        state.editingText = false;
        closePickers();
        setInkTool(state.inkTool === want ? null : want);
      });
    });
    root.querySelector('#por-insert-text').addEventListener('click', function () {
      if (state.readOnly) return;
      closePickers();
      setInkTool(null);
      if (state.fabricCanvas && window.fabric) {
        pushHistory();
        var tb = new window.fabric.Textbox('Text', {
          left: PAPER_W * 0.08,
          top: PAPER_H * 0.68,
          width: PAPER_W * 0.22,
          fontSize: 18,
          fontFamily: 'Calibri, Arial, sans-serif',
          fill: '#111111',
          porId: PorFab.uid('ov'),
          porKind: 'text',
        });
        PorFab.styleControls(tb);
        state.fabricCanvas.add(tb);
        state.fabricCanvas.setActiveObject(tb);
        state.fabricCanvas.requestRenderAll();
        state.editingText = true;
        // PowerPoint feel: new text box is in edit mode with placeholder selected
        // so the next keystrokes replace "Text" instead of being ignored.
        try {
          if (typeof tb.enterEditing === 'function') {
            tb.enterEditing();
            if (typeof tb.selectAll === 'function') tb.selectAll();
          }
        } catch (_) {}
        syncAndSave();
        syncHistoryButtons();
        return;
      }
      var page = activePage();
      var api = overlayApi();
      if (!api || !api.create) return;
      pushHistory();
      var item = api.create('text');
      overlayList(page).push(item);
      state.selectedId = item.id;
      state.editingText = true;
      scheduleSave();
      renderSheet();
      syncHistoryButtons();
    });
    var keepBtn = root.querySelector('#por-keep-tool');
    if (keepBtn) {
      keepBtn.addEventListener('click', function () {
        state.keepTool = !state.keepTool;
        keepBtn.classList.toggle('is-on', state.keepTool);
        keepBtn.setAttribute('aria-pressed', state.keepTool ? 'true' : 'false');
      });
    }
    root.querySelector('#por-outline-btn').addEventListener('click', function (event) {
      event.stopPropagation();
      togglePicker('outline');
    });
    root.querySelector('#por-fill-btn').addEventListener('click', function (event) {
      event.stopPropagation();
      togglePicker('fill');
    });
    root.querySelector('#por-weight-btn').addEventListener('click', function (event) {
      event.stopPropagation();
      togglePicker('weight');
    });
    var dashBtn = root.querySelector('#por-dash-btn');
    if (dashBtn) {
      dashBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        togglePicker('dash');
      });
    }
    // PowerPoint ribbon: shape gallery, Arrange, Select, Clipboard, Format pane.
    ['shapes', 'arrange', 'select-menu', 'font-color', 'insert', 'styles', 'effects'].forEach(function (which) {
      var b = root.querySelector('#por-' + which + '-btn');
      if (!b) return;
      b.addEventListener('click', function (event) {
        event.stopPropagation();
        if (which === 'shapes') {
          // Docked gallery is always visible; button is a visual affordance.
          var shapesPop = root.querySelector('#por-shapes-pop');
          if (shapesPop) shapesPop.hidden = false;
          b.setAttribute('aria-expanded', 'true');
          return;
        }
        togglePicker(which);
      });
    });
    // Quick Styles — apply fill colour presets (add-only).
    root.querySelectorAll('[data-por-quick-style]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var color = btn.getAttribute('data-por-quick-style');
        var fillCb = root.querySelector('#por-fill');
        if (fillCb && !fillCb.checked) {
          fillCb.checked = true;
          fillCb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        var sw = root.querySelector('#por-fill-pop [data-por-fill="' + color + '"]');
        if (sw) sw.click();
        closePickers();
      });
    });
    root.querySelectorAll('[data-por-effect]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-por-effect');
        var target = styleTarget();
        if (target && state.fabricCanvas) {
          try {
            if (kind === 'shadow') {
              target.set('shadow', new window.fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 8, offsetX: 2, offsetY: 2 }));
            } else {
              target.set('shadow', null);
            }
            state.fabricCanvas.requestRenderAll();
            scheduleSave();
          } catch (_) {}
        }
        closePickers();
      });
    });
    var tabInsert = root.querySelector('#por-tab-insert');
    if (tabInsert) {
      tabInsert.addEventListener('click', function () {
        root.querySelectorAll('.por-tabs__tab').forEach(function (t) {
          t.classList.toggle('is-active', t === tabInsert);
          t.setAttribute('aria-selected', t === tabInsert ? 'true' : 'false');
        });
        var insertBtn = root.querySelector('#por-insert-btn');
        if (insertBtn) insertBtn.click();
      });
    }
    var tabHome = root.querySelector('.por-tabs__tab[data-por-tab="home"]');
    if (tabHome) {
      tabHome.addEventListener('click', function () {
        root.querySelectorAll('.por-tabs__tab').forEach(function (t) {
          var on = t.getAttribute('data-por-tab') === 'home';
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        closePickers();
      });
    }
    // Dismiss Insert menu after choosing an action.
    root.querySelectorAll('#por-insert-pop .por-linkbtn').forEach(function (btn) {
      btn.addEventListener('click', function () { closePickers(); });
    });
    root.querySelectorAll('[data-rb-tool], [data-por-tool="select"], #por-insert-text').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var shapesPop = root.querySelector('#por-shapes-pop');
        // Docked gallery stays open; floating gallery still dismisses.
        if (shapesPop && shapesPop.classList.contains('por-shapes__pop--docked')) return;
        if (shapesPop && !shapesPop.hidden && btn.closest && btn.closest('#por-shapes-pop')) {
          closePickers();
        }
      });
    });
    var pasteBtn = root.querySelector('#por-paste');
    if (pasteBtn) pasteBtn.addEventListener('click', function () { pasteClipboard(); });
    var cutBtn = root.querySelector('#por-cut');
    if (cutBtn) cutBtn.addEventListener('click', function () { cutSelected(); });
    var copyBtn = root.querySelector('#por-copy');
    if (copyBtn) copyBtn.addEventListener('click', function () { copySelected(); });
    var groupBtn = root.querySelector('#por-group-btn');
    if (groupBtn) groupBtn.addEventListener('click', function () {
      closePickers();
      groupSelection();
    });
    var ungroupBtn = root.querySelector('#por-ungroup-btn');
    if (ungroupBtn) ungroupBtn.addEventListener('click', function () {
      closePickers();
      ungroupSelection();
    });
    root.querySelectorAll('#por-arrange-pop [data-por-stack]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePickers();
        reorderSelected(btn.getAttribute('data-por-stack'));
      });
    });
    root.querySelectorAll('#por-arrange-pop [data-por-align-marks]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePickers();
        alignMarks(btn.getAttribute('data-por-align-marks'));
      });
    });
    root.querySelectorAll('#por-arrange-pop [data-por-distribute]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePickers();
        distributeMarks(btn.getAttribute('data-por-distribute'));
      });
    });
    var selectAllBtn = root.querySelector('#por-select-all');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function () {
        closePickers();
        if (!state.fabricCanvas) return;
        var objs = state.fabricCanvas.getObjects().filter(function (o) {
          return !o.excludeFromExport && o.selectable !== false;
        });
        if (!objs.length) return;
        state.fabricCanvas.discardActiveObject();
        if (objs.length === 1) state.fabricCanvas.setActiveObject(objs[0]);
        else {
          var sel = new window.fabric.ActiveSelection(objs, { canvas: state.fabricCanvas });
          state.fabricCanvas.setActiveObject(sel);
        }
        state.fabricCanvas.requestRenderAll();
        syncHistoryButtons();
      });
    }
    var openSelpaneBtn = root.querySelector('#por-open-selpane');
    if (openSelpaneBtn) {
      openSelpaneBtn.addEventListener('click', function () {
        closePickers();
        openPanel('selection');
      });
    }
    var panelClose = root.querySelector('#por-panel-close');
    if (panelClose) {
      panelClose.addEventListener('click', function () { closePanel(); });
    }
    var fontColorPop = root.querySelector('#por-font-color-pop');
    if (fontColorPop) {
      fontColorPop.addEventListener('click', function (event) {
        var sw = event.target.closest && event.target.closest('[data-por-font-color]');
        if (!sw) return;
        var color = sw.getAttribute('data-por-font-color');
        var active = styleTarget() || fabricActive();
        if (active && (active.type === 'textbox' || active.type === 'i-text' || active.porKind === 'text')) {
          pushHistory();
          active.set('fill', color);
          state.fabricCanvas.requestRenderAll();
          syncAndSave();
        }
        state.inkColor = color;
        syncHistoryButtons();
        closePickers();
      });
    }
    function previewColor(role, color) {
      if (state._previewLocked) return;
      var active = styleTarget() || fabricActive();
      if (!active || !color) return;
      if (!state._previewStyle) state._previewStyle = captureStyleFromTarget(active);
      if (role === 'fill') applyStyleToFabricTarget(active, { fill: color });
      else applyStyleToFabricTarget(active, { stroke: color });
      state.fabricCanvas.requestRenderAll();
    }
    function restorePreview() {
      // After a swatch click we lock preview so mouseleave cannot paint the old
      // colour back over the committed style before autosave lands.
      if (state._previewLocked) {
        state._previewStyle = null;
        return;
      }
      var active = styleTarget() || fabricActive();
      if (!active || !state._previewStyle) return;
      applyStyleToFabricTarget(active, state._previewStyle);
      state.fabricCanvas.requestRenderAll();
      state._previewStyle = null;
    }
    function lockPreviewCommit() {
      state._previewLocked = true;
      state._previewStyle = null;
      setTimeout(function () { state._previewLocked = false; }, 400);
    }
    root.querySelector('#por-outline-pop').addEventListener('click', function (event) {
      var recent = event.target.closest && event.target.closest('[data-por-recent]');
      if (recent) {
        lockPreviewCommit();
        applyOutlineColor(recent.getAttribute('data-por-recent'));
        closePickers();
        return;
      }
      var sw = event.target.closest && event.target.closest('[data-por-outline]');
      if (!sw) return;
      lockPreviewCommit();
      applyOutlineColor(sw.getAttribute('data-por-outline'));
      closePickers();
    });
    root.querySelector('#por-outline-pop').addEventListener('mouseover', function (event) {
      var sw = event.target.closest && event.target.closest('[data-por-outline], [data-por-recent]');
      if (!sw) return;
      previewColor('outline', sw.getAttribute('data-por-outline') || sw.getAttribute('data-por-recent'));
    });
    root.querySelector('#por-outline-pop').addEventListener('mouseleave', restorePreview);
    root.querySelector('#por-fill-pop').addEventListener('click', function (event) {
      var recent = event.target.closest && event.target.closest('[data-por-recent]');
      if (recent) {
        lockPreviewCommit();
        applyFillColor(recent.getAttribute('data-por-recent'));
        closePickers();
        return;
      }
      var sw = event.target.closest && event.target.closest('[data-por-fill]');
      if (!sw) return;
      lockPreviewCommit();
      applyFillColor(sw.getAttribute('data-por-fill'));
      closePickers();
    });
    root.querySelector('#por-fill-pop').addEventListener('mouseover', function (event) {
      var sw = event.target.closest && event.target.closest('[data-por-fill], [data-por-recent]');
      if (!sw) return;
      previewColor('fill', sw.getAttribute('data-por-fill') || sw.getAttribute('data-por-recent'));
    });
    root.querySelector('#por-fill-pop').addEventListener('mouseleave', restorePreview);
    var outlineCustom = root.querySelector('#por-outline-custom');
    if (outlineCustom) {
      outlineCustom.addEventListener('input', function () {
        applyOutlineColor(outlineCustom.value);
      });
    }
    var fillCustom = root.querySelector('#por-fill-custom');
    if (fillCustom) {
      fillCustom.addEventListener('input', function () {
        applyFillColor(fillCustom.value);
      });
    }
    root.querySelector('#por-weight-pop').addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('[data-por-thick]');
      if (!btn) return;
      applyWeight(btn.getAttribute('data-por-thick'));
      closePickers();
    });
    var dashPop = root.querySelector('#por-dash-pop');
    if (dashPop) {
      dashPop.addEventListener('click', function (event) {
        var btn = event.target.closest && event.target.closest('[data-por-dash]');
        if (!btn) return;
        state.inkDash = btn.getAttribute('data-por-dash') || 'solid';
        var active = styleTarget() || fabricActive();
        if (active && !state.readOnly) {
          pushHistory();
          applyStyleToFabricTarget(active, { strokeDashArray: dashArrayFor(state.inkDash) });
          if (active.type === 'activeSelection') {
            active.forEachObject(function (o) {
              if (o.porId) {
                patchOverlayStyle(o.porId, state.inkDash === 'solid'
                  ? { dash: undefined } : { dash: state.inkDash });
              }
            });
          } else if (active.porId) {
            if (state.inkDash === 'solid') {
              var pageD = activePage();
              (pageD && pageD.overlays || []).forEach(function (ov) {
                if (ov && ov.id === active.porId) delete ov.dash;
              });
            } else {
              patchOverlayStyle(active.porId, { dash: state.inkDash });
            }
          }
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          // Re-assert dash after sync (serialization must keep non-solid dashes).
          if (active.type !== 'activeSelection' && active.porId && state.inkDash !== 'solid') {
            patchOverlayStyle(active.porId, { dash: state.inkDash });
          }
          scheduleSave();
        } else {
          var itemD = selectedItem();
          if (itemD && !state.readOnly) {
            pushHistory();
            if (state.inkDash === 'solid') delete itemD.dash;
            else itemD.dash = state.inkDash;
            var fabD = findFabricByPorId(itemD.id);
            if (fabD) {
              applyStyleToFabricTarget(fabD, { strokeDashArray: dashArrayFor(state.inkDash) });
              if (state.fabricCanvas) state.fabricCanvas.requestRenderAll();
            }
            scheduleSave();
          }
        }
        closePickers();
        setStatus('Dash: ' + state.inkDash);
        syncHistoryButtons();
      });
    }
    var opacityInput = root.querySelector('#por-opacity');
    if (opacityInput) {
      opacityInput.addEventListener('input', function () {
        state.inkOpacity = Math.max(0, Math.min(1, Number(opacityInput.value) / 100));
        var active = styleTarget() || fabricActive();
        if (active && !state.readOnly) {
          pushHistory();
          applyStyleToFabricTarget(active, { opacity: state.inkOpacity });
          if (active.porId) patchOverlayStyle(active.porId, { opacity: state.inkOpacity });
          state.fabricCanvas.requestRenderAll();
          syncOverlaysFromFabric();
          if (active.porId) patchOverlayStyle(active.porId, { opacity: state.inkOpacity });
          scheduleSave();
        }
      });
    }
    var painterBtn = root.querySelector('#por-format-painter');
    if (painterBtn) {
      painterBtn.addEventListener('click', function () {
        var active = fabricActive();
        if (!active) {
          setStatus('Select a mark first');
          return;
        }
        state.formatPainter = captureStyleFromTarget(active);
        painterBtn.classList.add('is-on');
        setStatus('Format Painter ready — click a mark');
      });
    }
    var defaultBtn = root.querySelector('#por-set-default');
    if (defaultBtn) {
      defaultBtn.addEventListener('click', function () {
        var active = fabricActive();
        if (!active) {
          setStatus('Select a mark first');
          return;
        }
        state.styleDefaults = captureStyleFromTarget(active);
        if (state.styleDefaults.stroke) state.inkColor = state.styleDefaults.stroke;
        if (state.styleDefaults.fill && state.styleDefaults.fill !== 'rgba(0,0,0,0)') {
          state.fillColor = state.styleDefaults.fill;
          state.inkFill = true;
          if (fillInput) fillInput.checked = true;
        }
        setStatus('Default style set for new shapes');
        syncHistoryButtons();
      });
    }
    function applyTextProp(mutator) {
      var active = fabricActive();
      if (!active || state.readOnly) return;
      var targets = [];
      if (active.type === 'activeSelection') {
        active.forEachObject(function (o) {
          if (o.type === 'textbox' || o.type === 'i-text') targets.push(o);
        });
      } else if (active.type === 'textbox' || active.type === 'i-text') {
        targets.push(active);
      }
      if (!targets.length) return;
      pushHistory();
      targets.forEach(mutator);
      state.fabricCanvas.requestRenderAll();
      syncOverlaysFromFabric();
      scheduleSave();
    }
    root.querySelectorAll('[data-por-text]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-por-text');
        applyTextProp(function (t) {
          if (cmd === 'bold') {
            t.set('fontWeight', t.fontWeight === 'bold' || t.fontWeight === 700 ? 'normal' : 'bold');
          } else if (cmd === 'italic') {
            t.set('fontStyle', t.fontStyle === 'italic' ? 'normal' : 'italic');
          } else if (cmd === 'underline') {
            t.set('underline', !t.underline);
          } else if (cmd === 'strike') {
            t.set('linethrough', !t.linethrough);
          } else if (cmd === 'bullet') {
            var lines = String(t.text || '').split('\n').map(function (line) {
              return /^\s*•\s/.test(line) ? line.replace(/^\s*•\s/, '') : ('• ' + line);
            });
            t.set('text', lines.join('\n'));
          }
        });
        try { document.execCommand(cmd === 'strike' ? 'strikeThrough' : cmd, false, null); } catch (err) { /* ignore */ }
      });
    });
    root.querySelectorAll('[data-por-align]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var align = btn.getAttribute('data-por-align');
        applyTextProp(function (t) { t.set('textAlign', align); });
      });
    });
    var fontFamily = root.querySelector('#por-font-family');
    if (fontFamily) {
      fontFamily.addEventListener('change', function () {
        applyTextProp(function (t) { t.set('fontFamily', fontFamily.value); });
      });
    }
    var fontSize = root.querySelector('#por-font-size');
    if (fontSize) {
      fontSize.addEventListener('change', function () {
        var size = Math.max(8, Math.min(96, Number(fontSize.value) || 18));
        applyTextProp(function (t) { t.set('fontSize', size); });
      });
    }
    var grow = root.querySelector('#por-font-grow');
    if (grow) {
      grow.addEventListener('click', function () {
        applyTextProp(function (t) {
          var next = Math.min(96, (t.fontSize || 18) + 2);
          t.set('fontSize', next);
          if (fontSize) fontSize.value = String(next);
        });
      });
    }
    var shrink = root.querySelector('#por-font-shrink');
    if (shrink) {
      shrink.addEventListener('click', function () {
        applyTextProp(function (t) {
          var next = Math.max(8, (t.fontSize || 18) - 2);
          t.set('fontSize', next);
          if (fontSize) fontSize.value = String(next);
        });
      });
    }
    document.addEventListener('pointerdown', function (event) {
      if (!root.contains(event.target)) return;
      if (event.target.closest && event.target.closest('.por-picker')) return;
      if (event.target.closest && event.target.closest('.por-ribbon__group--collapsible.is-open')) return;
      closePickers();
      closeRibbonCollapsePops();
    });
    enhanceRibbonCollapse();
    syncHistoryButtons();

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
    root.querySelector('#por-contour-toggle').addEventListener('click', toggleContour);
    root.querySelector('#por-bring-contour').addEventListener('click', function () { bringBackground('contour'); });
    root.querySelector('#por-import-bg').addEventListener('click', function () {
      if (state.readOnly) return;
      root.querySelector('#por-import-file').click();
    });
    root.querySelector('#por-insert-pic').addEventListener('click', function () {
      if (state.readOnly) return;
      root.querySelector('#por-pic-file').click();
    });
    root.querySelector('#por-pic-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file || state.readOnly) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (typeof reader.result === 'string') insertPictureFromDataUrl(reader.result, file.name || 'Picture');
      };
      reader.readAsDataURL(file);
    });
    root.querySelector('#por-export-selection').addEventListener('click', exportActiveAsPicture);
    root.querySelector('#por-export-page').addEventListener('click', exportPageAsPicture);
    root.addEventListener('paste', function (event) {
      if (state.readOnly || !state.fabricCanvas) return;
      var items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          event.preventDefault();
          var blob = items[i].getAsFile();
          if (!blob) return;
          var reader = new FileReader();
          reader.onload = function () {
            if (typeof reader.result === 'string') insertPictureFromDataUrl(reader.result, 'Pasted picture');
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
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
      // Lay out side-by-side inside the draw area (left of title block) so the
      // new detail does not cover the overall — RB defaultFrame is full-width.
      layoutPorViews(views);
      if (views[0]) views[0].camera = defaultViewCamera(1);
      if (views.length > 1) {
        var detail = views[views.length - 1];
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
      layoutPorViews(api.viewsFor(page) || []);
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
    var zoomSlider = root.querySelector('#por-zoom-slider');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', function () {
        state.zoomMode = 'user';
        state.userScale = clamp(Number(zoomSlider.value) / 100, 0.35, 2.4);
        applySheetScale();
      });
    }
    root.querySelectorAll('[data-por-align-marks]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        alignMarks(btn.getAttribute('data-por-align-marks'));
      });
    });
    root.querySelectorAll('[data-por-distribute]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        distributeMarks(btn.getAttribute('data-por-distribute'));
      });
    });
    var gridBtn = root.querySelector('#por-toggle-grid');
    if (gridBtn) {
      gridBtn.addEventListener('click', function () {
        state.showGrid = !state.showGrid;
        gridBtn.classList.toggle('is-on', state.showGrid);
        gridBtn.setAttribute('aria-pressed', state.showGrid ? 'true' : 'false');
        renderSheet();
      });
    }
    var rulersBtn = root.querySelector('#por-toggle-rulers');
    if (rulersBtn) {
      rulersBtn.addEventListener('click', function () {
        state.showRulers = !state.showRulers;
        rulersBtn.classList.toggle('is-on', state.showRulers);
        rulersBtn.setAttribute('aria-pressed', state.showRulers ? 'true' : 'false');
        renderSheet();
      });
    }
    var handBtn = root.querySelector('#por-hand');
    if (handBtn) {
      handBtn.addEventListener('click', function () {
        state.handTool = !state.handTool;
        handBtn.classList.toggle('is-on', state.handTool);
        handBtn.setAttribute('aria-pressed', state.handTool ? 'true' : 'false');
        stageEl.classList.toggle('por-stage--hand', state.handTool || state.spaceDown);
        setInkTool(null);
      });
    }
    stageEl.addEventListener('wheel', function (event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomAtPointer(event.deltaY > 0 ? (1 / 1.12) : 1.12, event.clientX, event.clientY);
    }, { passive: false });
    stageEl.addEventListener('pointerdown', function (event) {
      if (!(state.handTool || state.spaceDown) || event.button !== 0) return;
      event.preventDefault();
      state.sheetPan = {
        x: event.clientX,
        y: event.clientY,
        left: stageEl.scrollLeft,
        top: stageEl.scrollTop,
      };
      stageEl.setPointerCapture(event.pointerId);
    });
    stageEl.addEventListener('pointermove', function (event) {
      if (!state.sheetPan) return;
      stageEl.scrollLeft = state.sheetPan.left - (event.clientX - state.sheetPan.x);
      stageEl.scrollTop = state.sheetPan.top - (event.clientY - state.sheetPan.y);
    });
    stageEl.addEventListener('pointerup', function () { state.sheetPan = null; });
    stageEl.addEventListener('pointercancel', function () { state.sheetPan = null; });

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
    function onKeyUp(event) {
      if (event.code !== 'Space') return;
      state.spaceDown = false;
      if (!state.handTool) stageEl.classList.remove('por-stage--hand');
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    function onRibbonResize() {
      applySheetScale();
      fitRibbon();
    }
    window.addEventListener('resize', onRibbonResize);

    activeMount = {
      root: root,
      persistNow: persistNow,
      destroy: function () {
        if (state.saveTimer) clearTimeout(state.saveTimer);
        try { syncOverlaysFromFabric(); } catch (_) {}
        destroyFabric();
        closeShapeMenu();
        if (state.formatToolbar && state.formatToolbar.destroy) state.formatToolbar.destroy();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onRibbonResize);
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
      requestAnimationFrame(function () { fitRibbon(); });
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
    FABRIC_VERSION: (window.ToolboxPorFabric && window.ToolboxPorFabric.VERSION) || '5.3.0',
  };
})();
