// Toolbox — Title / cover page layout (Mitchell).
// Filled boxes drop in at defaults; investigator may move/resize, then Lock.

(function () {
  'use strict';

  var MIN_W = 12;
  var MIN_H = 8;

  function clamp(n, lo, hi) {
    var x = typeof n === 'number' && isFinite(n) ? n : lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function defaultBoxes() {
    return {
      prepared: { x: 5, y: 6, w: 42, h: 16 },
      identity: { x: 5, y: 28, w: 46, h: 30 },
      date: { x: 5, y: 62, w: 42, h: 14 },
      contents: { x: 54, y: 14, w: 40, h: 44 },
      overview: { x: 54, y: 62, w: 40, h: 30 },
    };
  }

  function defaultLayout() {
    return {
      locked: false,
      boxes: defaultBoxes(),
      overviewMediaId: '',
    };
  }

  function cloneLayout(layout) {
    return JSON.parse(JSON.stringify(layout || defaultLayout()));
  }

  function normalizeBox(raw, fallback) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var fb = fallback || { x: 0, y: 0, w: 20, h: 12 };
    return {
      x: clamp(typeof src.x === 'number' ? src.x : fb.x, 0, 92),
      y: clamp(typeof src.y === 'number' ? src.y : fb.y, 0, 92),
      w: clamp(typeof src.w === 'number' ? src.w : fb.w, MIN_W, 100),
      h: clamp(typeof src.h === 'number' ? src.h : fb.h, MIN_H, 100),
    };
  }

  function normalizeLayout(raw) {
    var base = defaultLayout();
    var src = raw && typeof raw === 'object' ? raw : {};
    var boxesIn = src.boxes && typeof src.boxes === 'object' ? src.boxes : {};
    var defaults = defaultBoxes();
    var boxes = {};
    Object.keys(defaults).forEach(function (id) {
      boxes[id] = normalizeBox(boxesIn[id], defaults[id]);
    });
    return {
      locked: !!src.locked,
      boxes: boxes,
      overviewMediaId: typeof src.overviewMediaId === 'string' ? src.overviewMediaId : '',
    };
  }

  function mapsSearchUrl(address) {
    var q = String(address || '').trim();
    if (!q) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function boxStyle(box) {
    return (
      'left:' + box.x + '%;' +
      'top:' + box.y + '%;' +
      'width:' + box.w + '%;' +
      'height:' + box.h + '%;'
    );
  }

  window.ToolboxReportCoverLayout = {
    defaultLayout: defaultLayout,
    cloneLayout: cloneLayout,
    normalizeLayout: normalizeLayout,
    mapsSearchUrl: mapsSearchUrl,
    boxStyle: boxStyle,
    MIN_W: MIN_W,
    MIN_H: MIN_H,
  };
})();
