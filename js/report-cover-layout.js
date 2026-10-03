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

  // Measured from the shipped decks (Mitchell / 1515 / Ross / Sipert title
  // slides), as percentages of the full 17x11 in slide. PowerPoint positions
  // against the whole slide, so the cover stage is the whole sheet -- not the
  // inset .rb-sheet__margin the other page types use.
  //
  //   prepared  TextBox 24   7.94%, 6.61%   41.18 x 12.24
  //   identity  TextBox 28   7.94%, 31.36%  (FLOOR LEVEL SURVEY)
  //             TextBox 30   7.94%, 35.91%  (street, 60pt)
  //             TextBox 33   7.94%, 46.10%  (city, 32pt)
  //   rule      Rectangle 35 7.94%, 57.45%  18.82 x 0.41  solid #8B5E3C
  //   date      TextBox 37   7.94%, 60.18%  41.18 x 5.71
  //   contents  Rectangle 40 59.12%, 31.82% 32.94 x 31.82  3pt #C8C0B4 frame
  //
  // The identity box spans FLOOR LEVEL SURVEY through the city line, and the
  // date box starts at the rule so the two travel together when moved.
  function defaultBoxes() {
    return {
      prepared: { x: 7.94, y: 6.61, w: 41.18, h: 12.24 },
      identity: { x: 7.94, y: 31.36, w: 58.82, h: 20.55 },
      date: { x: 7.94, y: 57.45, w: 41.18, h: 8.44 },
      contents: { x: 59.12, y: 31.82, w: 32.94, h: 31.82 },
      overview: { x: 59.12, y: 66.5, w: 32.94, h: 25.5 },
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
