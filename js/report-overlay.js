// Toolbox — Report Builder annotation layer.
//
// A text box, circle, arrow or picture can be placed anywhere on any sheet to
// illustrate a point. These are free: they do not register to anything and
// they do not inherit a locked layout, because their job is to point at
// something on this page.
//
// Geometry is percentages of the sheet, like every other placed element in
// Report Builder, so an annotation holds its position when the sheet is
// scaled -- on screen at preview size and on 11 x 17 paper.
//
//   { id, kind: 'text' | 'ellipse' | 'arrow' | 'image',
//     x, y, w, h, color, mediaId, text }
//
// Text carries a rich-text model, the same one the rest of the report uses.

(function () {
  'use strict';

  var KINDS = { text: 1, ellipse: 1, arrow: 1, image: 1 };
  // Distress Survey's five. A shape drawn on a report slide can sit on the page
  // next to a photograph circled in the field, so these have to be the same ink
  // -- its red is #c14a2b, not the #c0392b this used to offer.
  var COLORS = ['#c14a2b', '#111111', '#1d4ed8', '#16a34a', '#ea7317'];
  var DEFAULT_COLOR = COLORS[0];
  var HEX = /^#[0-9a-fA-F]{6}$/;

  // Distress Survey's ink. These carry their own geometry in percent of the
  // sheet rather than a bounding box: a resize grip on a scribble means
  // nothing, a per-item box stretches its own user space so one weight renders
  // differently on differently-shaped boxes, and a rectangle around a mostly
  // empty shape swallows clicks on whatever is behind it.
  var DRAWN_KINDS = { path: 1, rect: 1, circle: 1, arrow: 1 };
  var THICKS = { 1: 1, 2: 1, 3: 1 };
  var DEFAULT_THICK = 2;

  /**
   * Is this record drawn ink, or a placed box?
   *
   * `kind: 'arrow'` now covers two different shapes: the box-diagonal arrow
   * this file has always had, and Distress's free-angle one. Stored kinds are
   * NOT rewritten -- that would be a silent migration of exactly the data the
   * format check above protects. Geometry discriminates instead, and it is
   * unambiguous because a writer only ever emits one set of fields.
   */
  function isDrawn(raw) {
    if (!raw || !DRAWN_KINDS[raw.kind]) return false;
    return Array.isArray(raw.points) || typeof raw.x0 === 'number';
  }

  function pct(n, fallback) {
    var v = typeof n === 'number' && isFinite(n) ? n : fallback;
    // 2dp is 0.0017in on a 17in sheet -- far below print resolution, and it
    // keeps freehand strokes out of the undo snapshots and the autosave as
    // 17-digit floats.
    return Math.round(Math.max(-20, Math.min(120, v)) * 100) / 100;
  }
  var MIN_W = 3;
  var MIN_H = 2;

  function clamp(n, lo, hi, fallback) {
    var v = typeof n === 'number' && isFinite(n) ? n : fallback;
    return Math.max(lo, Math.min(hi, v));
  }

  function newId() {
    return 'ov-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  function normalizeDrawn(raw) {
    var item = {
      id: raw.id || newId(),
      kind: raw.kind,
      color: HEX.test(String(raw.color || '')) ? raw.color : DEFAULT_COLOR,
      thick: THICKS[raw.thick] ? raw.thick : DEFAULT_THICK,
    };
    if (raw.kind === 'path') {
      var pts = [];
      (Array.isArray(raw.points) ? raw.points : []).forEach(function (p) {
        if (!Array.isArray(p) || p.length < 2) return;
        pts.push([pct(p[0], 0), pct(p[1], 0)]);
      });
      if (pts.length < 2) return null;
      item.points = pts;
    } else {
      item.x0 = pct(raw.x0, 0);
      item.y0 = pct(raw.y0, 0);
      item.x1 = pct(raw.x1, 0);
      item.y1 = pct(raw.y1, 0);
    }
    return item;
  }

  function normalizeOne(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (isDrawn(raw)) return normalizeDrawn(raw);
    var kind = KINDS[raw.kind] ? raw.kind : 'text';
    var item = {
      id: raw.id || newId(),
      kind: kind,
      x: clamp(raw.x, 0, 97, 10),
      y: clamp(raw.y, 0, 97, 10),
      w: clamp(raw.w, MIN_W, 100, 22),
      h: clamp(raw.h, MIN_H, 100, 10),
      // Check the FORMAT, not membership of the current palette. A whitelist
      // meant every palette change silently rewrote records written by another
      // build to red -- including the three colours this file used to offer,
      // which are near but not equal to the five above. Annotations already on
      // a report keep the exact colour they were drawn in; the palette decides
      // only what the toolbar offers next.
      color: HEX.test(String(raw.color || '')) ? raw.color : DEFAULT_COLOR,
    };
    if (kind === 'image' && raw.mediaId) item.mediaId = String(raw.mediaId);
    if (kind === 'text') item.text = raw.text == null ? '' : raw.text;
    return item;
  }

  function normalize(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var item = normalizeOne(raw);
      if (item) out.push(item);
    });
    return out;
  }

  // Sensible starting geometry per kind, so an inserted annotation lands
  // somewhere usable rather than at a corner.
  function create(kind) {
    var base = { id: newId(), kind: KINDS[kind] ? kind : 'text', color: DEFAULT_COLOR };
    // Each kind lands in its own place. Dropping them on a shared default
    // stacked a circle under an arrow, and only the upper one could be
    // grabbed -- the lower one read as broken.
    if (base.kind === 'text') { base.x = 8; base.y = 68; base.w = 26; base.h = 8; base.text = ''; }
    else if (base.kind === 'ellipse') { base.x = 38; base.y = 20; base.w = 22; base.h = 14; }
    else if (base.kind === 'arrow') { base.x = 62; base.y = 52; base.w = 18; base.h = 14; }
    else { base.x = 10; base.y = 18; base.w = 28; base.h = 22; }
    return base;
  }

  function boxStyle(item) {
    return 'left:' + item.x + '%;top:' + item.y + '%;' +
      'width:' + item.w + '%;height:' + item.h + '%;';
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function renderEllipse(item) {
    var svg = svgEl('svg', {
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'none',
      class: 'rb-ov__art',
    });
    // Stroke scales with the box, so a circle keeps its weight when resized.
    svg.appendChild(svgEl('ellipse', {
      cx: 50, cy: 50, rx: 47, ry: 47,
      fill: 'none',
      stroke: item.color,
      'stroke-width': 3,
      'vector-effect': 'non-scaling-stroke',
    }));
    return svg;
  }

  function renderArrow(item) {
    var svg = svgEl('svg', {
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'none',
      class: 'rb-ov__art',
    });
    var head = 'head-' + item.id;
    var defs = svgEl('defs', {});
    var marker = svgEl('marker', {
      id: head, viewBox: '0 0 10 10', refX: 8, refY: 5,
      markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse',
      markerUnits: 'strokeWidth',
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: item.color }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    // The arrow runs corner to corner, so dragging the handle aims it.
    svg.appendChild(svgEl('line', {
      x1: 2, y1: 2, x2: 96, y2: 96,
      stroke: item.color,
      'stroke-width': 3,
      'vector-effect': 'non-scaling-stroke',
      'marker-end': 'url(#' + head + ')',
    }));
    return svg;
  }

  function renderItem(item, options) {
    var opts = options || {};
    var locked = !!opts.locked;
    var el = document.createElement('div');
    el.className = 'rb-ov rb-ov--' + item.kind + (locked ? ' is-locked' : '');
    el.setAttribute('data-rb-ov', item.id);
    el.setAttribute('data-rb-ov-kind', item.kind);
    el.style.cssText = boxStyle(item);

    if (item.kind === 'ellipse') el.appendChild(renderEllipse(item));
    else if (item.kind === 'arrow') el.appendChild(renderArrow(item));
    else if (item.kind === 'image') {
      var url = opts.mediaUrls && opts.mediaUrls[item.mediaId];
      if (url) {
        var img = document.createElement('img');
        img.className = 'rb-ov__img';
        img.src = url;
        img.alt = '';
        el.appendChild(img);
      } else if (!locked) {
        var hint = document.createElement('span');
        hint.className = 'rb-ov__hint';
        hint.textContent = 'Paste or add a picture';
        el.appendChild(hint);
      }
    } else {
      var text = document.createElement('div');
      text.className = 'rb-ov__text rb-rt';
      text.setAttribute('data-rb-ov-field', item.id);
      text.setAttribute('data-rb-rich', 'overlay:' + item.id);
      text.setAttribute('role', 'textbox');
      if (!locked) {
        text.setAttribute('contenteditable', 'true');
        text.setAttribute('spellcheck', 'true');
      }
      var api = window.ToolboxReportText;
      text.innerHTML = api ? api.toHtml(item.text) : '';
      el.appendChild(text);
    }

    if (!locked) {
      var grip = document.createElement('span');
      grip.className = 'rb-ov__resize';
      grip.setAttribute('data-rb-ov-resize', item.id);
      el.appendChild(grip);
      var kill = document.createElement('button');
      kill.type = 'button';
      kill.className = 'rb-ov__remove';
      kill.setAttribute('data-rb-ov-remove', item.id);
      kill.setAttribute('aria-label', 'Remove this annotation');
      kill.textContent = '×';
      el.appendChild(kill);
    }
    return el;
  }

  // ---- Drawn ink -------------------------------------------------------
  //
  // All drawn records share one <svg> spanning the sheet. Storage is percent of
  // the sheet, like everything else placed on a page; the viewBox is 170 x 110
  // so one user unit is 0.1 in on BOTH axes. That isotropy is the point: an
  // arrowhead, a round cap and a mitre come out undistorted with no
  // aspect-correction maths, even though the box stretches with
  // preserveAspectRatio="none".
  var INK_VBW = 170;
  var INK_VBH = 110;
  var ARROW_HEAD = { 1: 1.5, 2: 2.0, 3: 2.8 };

  function ux(x) { return (x / 100) * INK_VBW; }
  function uy(y) { return (y / 100) * INK_VBH; }

  function inkPathD(item) {
    if (item.kind === 'path') {
      return item.points.map(function (p, i) {
        return (i ? 'L' : 'M') + ux(p[0]).toFixed(2) + ' ' + uy(p[1]).toFixed(2);
      }).join(' ');
    }
    var x0 = ux(item.x0), y0 = uy(item.y0), x1 = ux(item.x1), y1 = uy(item.y1);
    if (item.kind === 'rect') {
      var rx = Math.min(x0, x1), ry = Math.min(y0, y1);
      var rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
      return 'M' + rx + ' ' + ry + 'h' + rw + 'v' + rh + 'h' + (-rw) + 'Z';
    }
    if (item.kind === 'circle') {
      // Distress draws an ellipse through the dragged corners.
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      var ax = Math.abs(x1 - x0) / 2, ay = Math.abs(y1 - y0) / 2;
      if (ax < 0.01 || ay < 0.01) return 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1;
      return 'M' + (cx - ax) + ' ' + cy +
        'a' + ax + ' ' + ay + ' 0 1 0 ' + (ax * 2) + ' 0' +
        'a' + ax + ' ' + ay + ' 0 1 0 ' + (-ax * 2) + ' 0';
    }
    return 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1;
  }

  // An explicit polygon rather than an SVG <marker>: a marker with
  // markerUnits="strokeWidth" is driven by the non-scaling (device-space)
  // width, so it would scale wrongly against the page.
  function arrowHeadD(item) {
    var x0 = ux(item.x0), y0 = uy(item.y0), x1 = ux(item.x1), y1 = uy(item.y1);
    var len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.4) return '';
    var h = ARROW_HEAD[item.thick] || ARROW_HEAD[2];
    var a = Math.atan2(y1 - y0, x1 - x0);
    var wing = 0.42;
    var p = function (ang, d) {
      return (x1 - Math.cos(ang) * d).toFixed(2) + ' ' + (y1 - Math.sin(ang) * d).toFixed(2);
    };
    return 'M' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
      'L' + p(a - wing, h) + 'L' + p(a + wing, h) + 'Z';
  }

  function svgPath(d, attrs) {
    var el = svgEl('path', attrs);
    el.setAttribute('d', d);
    return el;
  }

  function renderInk(item) {
    var g = svgEl('g', {});
    g.setAttribute('data-rb-ov', item.id);
    g.setAttribute('data-rb-ov-kind', item.kind);
    var d = inkPathD(item);

    // An invisible fat copy carries the hit area. pointer-events="stroke" means
    // the browser tests the drawn line only -- so a rectangle is grabbed by its
    // edges and not its interior, and the hole in a freehand "C" is not a
    // target. That is Distress's hit-testing, done by the browser.
    g.appendChild(svgPath(d, {
      fill: 'none',
      stroke: 'transparent',
      'stroke-width': 1.4,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'pointer-events': 'stroke',
      class: 'rb-ink__hit',
    }));

    g.appendChild(svgPath(d, {
      fill: 'none',
      stroke: item.color,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none',
      class: 'rb-ink rb-ink--t' + item.thick,
    }));

    if (item.kind === 'arrow') {
      var head = arrowHeadD(item);
      if (head) {
        g.appendChild(svgPath(head, {
          fill: item.color,
          stroke: 'none',
          'pointer-events': 'none',
          class: 'rb-ink__head',
        }));
      }
    }
    return g;
  }

  function renderInkLayer(items) {
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + INK_VBW + ' ' + INK_VBH,
      preserveAspectRatio: 'none',
      class: 'rb-ov-layer__ink',
    });
    svg.setAttribute('data-rb-ov-ink', '1');
    items.forEach(function (item) { svg.appendChild(renderInk(item)); });
    return svg;
  }

  // One layer over the whole sheet, above the page content.
  function renderLayer(list, options) {
    var layer = document.createElement('div');
    layer.className = 'rb-ov-layer';
    layer.setAttribute('data-rb-ov-layer', '1');
    var items = normalize(list);
    // Ink first so placed boxes keep sitting above it, the way they do today.
    layer.appendChild(renderInkLayer(items.filter(isDrawn)));
    items.forEach(function (item) {
      if (isDrawn(item)) return;
      layer.appendChild(renderItem(item, options));
    });
    return layer;
  }

  window.ToolboxReportOverlay = {
    COLORS: COLORS,
    isDrawn: isDrawn,
    renderInk: renderInk,
    inkPathD: inkPathD,
    arrowHeadD: arrowHeadD,
    DEFAULT_THICK: DEFAULT_THICK,
    normalize: normalize,
    create: create,
    renderLayer: renderLayer,
    boxStyle: boxStyle,
    MIN_W: MIN_W,
    MIN_H: MIN_H,
  };
})();
