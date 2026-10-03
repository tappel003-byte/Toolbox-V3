// Toolbox — Report Builder annotation layer.
//
// A text box, circle, arrow or picture can be placed anywhere on any sheet to
// illustrate a point. These are free: they do not register to anything and
// they do not inherit a locked layout, because their job is to point at
// something on this page.
//
// Geometry is percentages of the sheet, like every other placed element in
// Report Builder, so an annotation holds its position when the sheet is
// scaled -- on screen at preview size and on paper at 17 x 11 in.
//
//   { id, kind: 'text' | 'ellipse' | 'arrow' | 'image',
//     x, y, w, h, color, mediaId, text }
//
// Text carries a rich-text model, the same one the rest of the report uses.

(function () {
  'use strict';

  var KINDS = { text: 1, ellipse: 1, arrow: 1, image: 1 };
  var COLORS = ['#c0392b', '#1a1a1a', '#e0a800'];
  var DEFAULT_COLOR = COLORS[0];
  var MIN_W = 3;
  var MIN_H = 2;

  function clamp(n, lo, hi, fallback) {
    var v = typeof n === 'number' && isFinite(n) ? n : fallback;
    return Math.max(lo, Math.min(hi, v));
  }

  function newId() {
    return 'ov-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  function normalizeOne(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = KINDS[raw.kind] ? raw.kind : 'text';
    var item = {
      id: raw.id || newId(),
      kind: kind,
      x: clamp(raw.x, 0, 97, 10),
      y: clamp(raw.y, 0, 97, 10),
      w: clamp(raw.w, MIN_W, 100, 22),
      h: clamp(raw.h, MIN_H, 100, 10),
      color: COLORS.indexOf(raw.color) !== -1 ? raw.color : DEFAULT_COLOR,
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

  // One layer over the whole sheet, above the page content.
  function renderLayer(list, options) {
    var layer = document.createElement('div');
    layer.className = 'rb-ov-layer';
    layer.setAttribute('data-rb-ov-layer', '1');
    normalize(list).forEach(function (item) {
      layer.appendChild(renderItem(item, options));
    });
    return layer;
  }

  window.ToolboxReportOverlay = {
    COLORS: COLORS,
    normalize: normalize,
    create: create,
    renderLayer: renderLayer,
    boxStyle: boxStyle,
    MIN_W: MIN_W,
    MIN_H: MIN_H,
  };
})();
