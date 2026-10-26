// Toolbox — Floor Survey report sheet views (flexible compose Checkpoint 1).
// Views of survey evidence on one sheet: source, settings, frame, link, chrome.
// Migrates legacy floorTwoUp / floorView2. Does not authorize field capture changes.

(function () {
  'use strict';

  var FRAME_GUTTER = 2;
  var SNAP_PX = 8; // percent-of-stage threshold ≈ light snap
  var MIN_FRAME_W = 18;
  var MIN_FRAME_H = 25;

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function frameShare(slots) {
    var n = Math.max(1, Number(slots) || 1);
    return (100 - (n - 1) * FRAME_GUTTER) / n;
  }

  function defaultFrame(index, count) {
    var n = Math.max(1, count | 0);
    var i = Math.max(0, Math.min(n - 1, index | 0));
    var share = frameShare(n);
    return {
      x: i * (share + FRAME_GUTTER),
      y: 0,
      w: share,
      h: 100,
      z: 1,
    };
  }

  function normalizeFrame(raw) {
    var f = raw && typeof raw === 'object' ? raw : {};
    var w = Math.max(MIN_FRAME_W, Math.min(100, Number(f.w) || 100));
    var h = Math.max(MIN_FRAME_H, Math.min(100, Number(f.h) || 100));
    var x = Number(f.x);
    var y = Number(f.y);
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    x = Math.max(0, Math.min(100 - w, x));
    y = Math.max(0, Math.min(100 - h, y));
    return {
      x: x,
      y: y,
      w: w,
      h: h,
      z: isFinite(Number(f.z)) ? Number(f.z) : 1,
    };
  }

  function newViewId(views) {
    var used = Object.create(null);
    (views || []).forEach(function (v) {
      if (v && v.id) used[v.id] = 1;
    });
    var i = 0;
    while (used['v' + i]) i += 1;
    return 'v' + i;
  }

  function sourceFromMeta(meta) {
    meta = meta || {};
    return {
      canvasId: meta.canvasId || '',
      epochId: meta.epochId || null,
      areaId: meta.areaId || null,
      scope: meta.scope || 'all',
    };
  }

  /**
   * Write normalized fields onto an existing view object (or a fresh one).
   * Stable object identity is required: callers hold view refs across
   * viewsFor/ensurePageViews, and replacing the object dropped camera/link writes (GPT-027).
   */
  function writeNormalized(target, raw, meta, index, count, multi) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var fromMeta = sourceFromMeta(meta);
    var showDefault = !multi;
    var out = target && typeof target === 'object' ? target : {};
    out.id = typeof src.id === 'string' && src.id ? src.id : ('v' + index);
    out.canvasId = src.canvasId != null && src.canvasId !== '' ? src.canvasId : fromMeta.canvasId;
    out.epochId = src.epochId != null ? src.epochId : fromMeta.epochId;
    out.scope = src.scope || fromMeta.scope || 'all';
    // Combined (scope=all) must keep areaId null. `!= null` treated intentional
    // null as missing and fell back to page.meta.areaId, so Combined never stuck
    // (GPT-030).
    if (out.scope === 'all') {
      out.areaId = null;
    } else if (src.areaId != null && src.areaId !== '') {
      out.areaId = src.areaId;
    } else {
      out.areaId = fromMeta.areaId;
    }
    out.settings = src.settings != null ? src.settings : null;
    // Keep frame object identity when present so live drag state is not orphaned mid-gesture.
    var nextFrame = normalizeFrame(src.frame || defaultFrame(index, count));
    if (out.frame && typeof out.frame === 'object') {
      out.frame.x = nextFrame.x;
      out.frame.y = nextFrame.y;
      out.frame.w = nextFrame.w;
      out.frame.h = nextFrame.h;
      out.frame.z = nextFrame.z;
    } else {
      out.frame = nextFrame;
    }
    out.linkGroup = src.linkGroup == null || src.linkGroup === '' ? null : String(src.linkGroup);
    out.showLegend = typeof src.showLegend === 'boolean' ? src.showLegend : showDefault;
    out.showPill = typeof src.showPill === 'boolean' ? src.showPill : showDefault;
    if (src.camera && typeof src.camera === 'object') {
      if (out.camera && typeof out.camera === 'object') {
        out.camera.cx = src.camera.cx;
        out.camera.cy = src.camera.cy;
        out.camera.zoom = src.camera.zoom;
        out.camera.rel = !!src.camera.rel;
      } else {
        out.camera = clone(src.camera);
      }
    } else {
      out.camera = null;
    }
    return out;
  }

  function normalizeView(raw, meta, index, count, multi) {
    return writeNormalized({}, raw, meta, index, count, multi);
  }

  /**
   * Ensure page.meta.views exists. Migrates floorTwoUp / floorView / floorView2.
   * Single-view reports keep chrome visible by default (GPT-026).
   * Multi-view reports start with legend/pill hidden per view.
   */
  function ensurePageViews(page) {
    if (!page) return [];
    page.meta = page.meta || {};
    var meta = page.meta;
    if (Array.isArray(meta.views) && meta.views.length) {
      var multiExisting = meta.views.length > 1;
      var n = meta.views.length;
      for (var i = 0; i < n; i += 1) {
        var existing = meta.views[i];
        if (!existing || typeof existing !== 'object') {
          meta.views[i] = writeNormalized({}, {}, meta, i, n, multiExisting);
        } else {
          writeNormalized(existing, existing, meta, i, n, multiExisting);
        }
      }
      return meta.views;
    }
    var multi = !!meta.floorTwoUp;
    var count = multi ? 2 : 1;
    var views = [];
    for (var j = 0; j < count; j += 1) {
      var settings = null;
      if (j === 1) settings = meta.floorView2 || meta.floorView || null;
      else settings = meta.floorView || null;
      views.push(writeNormalized({}, {
        id: 'v' + j,
        settings: settings ? clone(settings) : null,
        frame: defaultFrame(j, count),
        linkGroup: multi ? 'g0' : null,
        showLegend: !multi,
        showPill: !multi,
      }, meta, j, count, multi));
    }
    meta.views = views;
    return views;
  }

  function viewsFor(page) {
    return ensurePageViews(page);
  }

  function viewCount(page) {
    return viewsFor(page).length;
  }

  function viewAt(page, index) {
    var list = viewsFor(page);
    var i = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    return list[i] || null;
  }

  function viewIndexById(page, id) {
    var list = viewsFor(page);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return i;
    }
    return 0;
  }

  function sameSource(a, b) {
    if (!a || !b) return false;
    return String(a.canvasId || '') === String(b.canvasId || '') &&
      String(a.epochId || '') === String(b.epochId || '') &&
      String(a.areaId || '') === String(b.areaId || '') &&
      String(a.scope || 'all') === String(b.scope || 'all');
  }

  /** Same-source companions that share this view's size/camera link group. */
  function linkedSameSourceIndexes(views, sourceIndex) {
    var list = views || [];
    var src = list[sourceIndex];
    var out = [];
    if (!src || !src.linkGroup) return out;
    list.forEach(function (v, i) {
      if (i === sourceIndex || !v) return;
      if (v.linkGroup === src.linkGroup && sameSource(src, v)) out.push(i);
    });
    return out;
  }

  function applyLinkedGeometry(views, sourceIndex, frame) {
    var list = views || [];
    var src = list[sourceIndex];
    if (!src || !src.linkGroup) return;
    var next = normalizeFrame(frame);
    list.forEach(function (v, i) {
      if (i === sourceIndex) return;
      if (!v || v.linkGroup !== src.linkGroup) return;
      // Size/align link is source-agnostic (GPT-027): matched height + top/bottom.
      if (v.frame && typeof v.frame === 'object') {
        v.frame.y = next.y;
        v.frame.h = next.h;
      } else {
        v.frame = normalizeFrame({
          x: 0,
          y: next.y,
          w: MIN_FRAME_W,
          h: next.h,
          z: 1,
        });
      }
    });
    if (src.frame && typeof src.frame === 'object') {
      src.frame.x = next.x;
      src.frame.y = next.y;
      src.frame.w = next.w;
      src.frame.h = next.h;
      src.frame.z = next.z;
    } else {
      src.frame = next;
    }
  }

  function snapFrame(frame, views, selfIndex) {
    var f = normalizeFrame(frame);
    var edgesX = [0, 100];
    var edgesY = [0, 100];
    (views || []).forEach(function (v, i) {
      if (i === selfIndex || !v || !v.frame) return;
      var o = v.frame;
      edgesX.push(o.x, o.x + o.w);
      edgesY.push(o.y, o.y + o.h);
    });
    function snapVal(val, edges, size) {
      var best = val;
      var bestD = SNAP_PX;
      edges.forEach(function (e) {
        var d0 = Math.abs(val - e);
        if (d0 < bestD) { bestD = d0; best = e; }
        var d1 = Math.abs(val + size - e);
        if (d1 < bestD) { bestD = d1; best = e - size; }
      });
      return best;
    }
    f.x = snapVal(f.x, edgesX, f.w);
    f.y = snapVal(f.y, edgesY, f.h);
    return normalizeFrame(f);
  }

  function addView(page, fromIndex) {
    var list = viewsFor(page);
    var base = list[Math.max(0, Math.min(list.length - 1, Number(fromIndex) || 0))] || list[0];
    var multiWas = list.length > 1;
    var copy = writeNormalized({}, {
      id: newViewId(list),
      canvasId: base.canvasId,
      epochId: base.epochId,
      areaId: base.areaId,
      scope: base.scope,
      settings: base.settings ? clone(base.settings) : null,
      frame: defaultFrame(list.length, list.length + 1),
      linkGroup: list.length === 1 ? 'g0' : null,
      showLegend: false,
      showPill: false,
      camera: base.camera ? clone(base.camera) : null,
    }, page.meta, list.length, list.length + 1, true);
    // Relayout existing frames into equal shares when going 1→2 linked.
    if (list.length === 1) {
      list[0].frame = defaultFrame(0, 2);
      list[0].linkGroup = 'g0';
      list[0].showLegend = false;
      list[0].showPill = false;
      copy.frame = defaultFrame(1, 2);
      copy.linkGroup = 'g0';
    } else {
      // Keep existing frames; place new one in remaining right strip if possible.
      copy.frame = normalizeFrame({
        x: Math.min(70, (base.frame.x + base.frame.w + FRAME_GUTTER)),
        y: base.frame.y,
        w: Math.max(MIN_FRAME_W, Math.min(30, 100 - (base.frame.x + base.frame.w + FRAME_GUTTER))),
        h: base.frame.h,
      });
      copy.linkGroup = null;
    }
    list.push(copy);
    page.meta.views = list;
    page.meta.floorTwoUp = list.length > 1;
    void multiWas;
    return copy;
  }

  function copyView(page, index) {
    return addView(page, index);
  }

  function removeView(page, index) {
    var list = viewsFor(page);
    if (list.length <= 1) return list[0];
    var i = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    list.splice(i, 1);
    if (list.length === 1) {
      list[0].frame = defaultFrame(0, 1);
      list[0].linkGroup = null;
      // Restoring single-view: do not force chrome off (GPT-026).
      if (typeof list[0].showLegend !== 'boolean') list[0].showLegend = true;
      if (typeof list[0].showPill !== 'boolean') list[0].showPill = true;
    }
    page.meta.views = list;
    page.meta.floorTwoUp = list.length > 1;
    return list[Math.max(0, Math.min(list.length - 1, i))] || list[0];
  }

  /**
   * Size/align link — source-agnostic (GPT-027).
   * Camera sharing stays separate: only same-source linked companions share pan/zoom.
   */
  function setViewLink(page, index, linked) {
    var list = viewsFor(page);
    var at = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    var v = list[at];
    if (!v) return;
    if (!linked) {
      v.linkGroup = null;
      return;
    }
    var group = 'g0';
    v.linkGroup = group;
    list.forEach(function (other) {
      if (!other || other === v) return;
      other.linkGroup = group;
    });
    applyLinkedGeometry(list, at, v.frame);
  }

  window.ToolboxReportFloorViews = {
    FRAME_GUTTER: FRAME_GUTTER,
    MIN_FRAME_W: MIN_FRAME_W,
    MIN_FRAME_H: MIN_FRAME_H,
    frameShare: frameShare,
    defaultFrame: defaultFrame,
    normalizeFrame: normalizeFrame,
    ensurePageViews: ensurePageViews,
    viewsFor: viewsFor,
    viewCount: viewCount,
    viewAt: viewAt,
    viewIndexById: viewIndexById,
    sameSource: sameSource,
    linkedSameSourceIndexes: linkedSameSourceIndexes,
    applyLinkedGeometry: applyLinkedGeometry,
    snapFrame: snapFrame,
    addView: addView,
    copyView: copyView,
    removeView: removeView,
    setViewLink: setViewLink,
    clone: clone,
  };
})();
