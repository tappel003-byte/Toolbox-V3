// Toolbox — Floor Survey report page layout (Import → place → Lock).
// Chrome-first page; topo/legend/pill are boxes. Book layout inherits when locked.

(function () {
  'use strict';

  var MIN_TOPO_W = 35;
  var MIN_TOPO_H = 35;
  var OVERLAY_KINDS = { legend: 1, pill: 1, 'pin-hi': 1, 'pin-lo': 1 };
  var MIN_SCALE = 0.65;
  var MAX_SCALE = 1.85;

  function clamp(n, lo, hi) {
    var x = typeof n === 'number' && isFinite(n) ? n : lo;
    return Math.max(lo, Math.min(hi, x));
  }

  // A colour scale is about 21.6% of the page tall, measured, and its pill
  // sits under it, so each boundary needs this much room down the side.
  var SCALE_PITCH = 31;
  var PILL_DROP = 23;

  // Where boundary i's colour scale and pill start. Down the left for the
  // first three, then down the right. One definition, used both for the very
  // first layout and when more boundaries turn up, because two copies of it
  // meant index 0 kept a stale position forever: layoutForStats only fills in
  // what is missing, and index 0 was never missing.
  function scaleSlot(i) {
    var column = i < 3 ? 2 : 86;
    var row = (i % 3) * SCALE_PITCH;
    return { x: column, legendY: 6 + row, pillY: 6 + row + PILL_DROP };
  }

  function defaultLayout() {
    var slot = scaleSlot(0);
    return {
      locked: false,
      // The decks put the drawing at 8.82 / 8.33, 83.05 x 87.91 -- it fills
      // the page. The old 10/6/80/88 was invented and squeezed it into the
      // margin box, which is why the plan looked small and cropped.
      topo: { x: 8.82, y: 8.33, w: 83.05, h: 87.91 },
      overlays: [
        { id: 'legend-0', kind: 'legend', statsIndex: 0, x: slot.x, y: slot.legendY, scale: 1 },
        { id: 'pill-0', kind: 'pill', statsIndex: 0, x: slot.x, y: slot.pillY, scale: 1 },
      ],
    };
  }

  // A frame shaped like the page shows a plan shaped like something else with
  // white down the sides -- the drawing fit inside it, letterboxed. Given the
  // plan's own proportion the frame takes that shape and fills the page as far
  // as it can, so the drawing fills the frame and the only white left is
  // whatever the plan image itself carries.
  var SHEET_ASPECT = 17 / 11;
  function frameForPlan(planWidth, planHeight) {
    var pw = Number(planWidth) > 0 ? Number(planWidth) : 1000;
    var ph = Number(planHeight) > 0 ? Number(planHeight) : 750;
    var planAspect = pw / ph;
    var w = 100;
    var h = 100;
    if (planAspect > SHEET_ASPECT) h = 100 * (SHEET_ASPECT / planAspect);
    else w = 100 * (planAspect / SHEET_ASPECT);
    return {
      x: (100 - w) / 2,
      y: (100 - h) / 2,
      w: w,
      h: h,
    };
  }

  function cloneLayout(layout) {
    return JSON.parse(JSON.stringify(layout || defaultLayout()));
  }

  function normalizeLayout(raw) {
    var base = defaultLayout();
    var src = raw && typeof raw === 'object' ? raw : {};
    var topo = src.topo && typeof src.topo === 'object' ? src.topo : {};
    var layout = {
      locked: !!src.locked,
      topo: {
        // The frame goes where it is put and is as big as it is made,
        // including off the page and larger than it. Clamping x and y to 0 and
        // w and h to 100 meant it could not be moved past the top or left edge
        // and could not be made bigger than the sheet -- so the plan image's
        // own white margins could never be pushed off, which is the whole
        // point of being able to size and place it.
        x: clamp(topo.x, -300, 300),
        y: clamp(topo.y, -300, 300),
        w: clamp(topo.w, MIN_TOPO_W, 600),
        h: clamp(topo.h, MIN_TOPO_H, 600),
      },
      overlays: [],
    };
    var list = Array.isArray(src.overlays) ? src.overlays : base.overlays;
    list.forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;
      layout.overlays.push({
        id: item.id || ('overlay-' + index),
        kind: OVERLAY_KINDS[item.kind] ? item.kind : 'legend',
        statsIndex: typeof item.statsIndex === 'number' ? item.statsIndex : 0,
        x: clamp(item.x, 0, 92),
        y: clamp(item.y, 0, 92),
        scale: clamp(item.scale, MIN_SCALE, MAX_SCALE),
      });
    });
    if (!layout.overlays.length) layout.overlays = base.overlays.slice();
    return layout;
  }

  // One colour scale and one H/L/delta pill per boundary, however many there
  // are. The placement used to branch on i === 0, so with three or more areas
  // every scale after the first landed on the same spot and all but one were
  // hidden underneath. They step down the side instead.
  function layoutForStats(layout, statsCount, statsList) {
    var next = normalizeLayout(layout);
    var count = Math.max(1, statsCount || 1);
    var stats = Array.isArray(statsList) ? statsList : [];
    var have = {};
    next.overlays.forEach(function (o) { have[o.kind + ':' + o.statsIndex] = true; });
    for (var i = 0; i < count; i += 1) {
      var slot = scaleSlot(i);
      if (!have['legend:' + i]) {
        next.overlays.push({
          id: 'legend-' + i,
          kind: 'legend',
          statsIndex: i,
          x: slot.x,
          y: slot.legendY,
          scale: 1,
        });
      }
      if (!have['pill:' + i]) {
        next.overlays.push({
          id: 'pill-' + i,
          kind: 'pill',
          statsIndex: i,
          x: slot.x,
          y: slot.pillY,
          scale: 1,
        });
      }
      // The High and Low markers start where the readings are and are then
      // moved like anything else. The composer hands back their position as a
      // fraction of the figure, so they land on the right reading whatever
      // frame or scale the figure was drawn at.
      var st = stats[i];
      ['hi', 'lo'].forEach(function (which) {
        var key = 'pin-' + which + ':' + i;
        if (have[key]) return;
        var src = st && (which === 'hi' ? st.hiPin : st.loPin);
        if (!src) return;
        next.overlays.push({
          id: 'pin-' + which + '-' + i,
          kind: 'pin-' + which,
          statsIndex: i,
          x: clamp(next.topo.x + src.fx * next.topo.w, 0, 92),
          y: clamp(next.topo.y + src.fy * next.topo.h, 0, 92),
          scale: 1,
        });
      });
    }
    return next;
  }

  function formatReading(value, dec) {
    var n = typeof value === 'number' && isFinite(value) ? value : null;
    if (n == null) return '';
    return n.toFixed(typeof dec === 'number' ? dec : 2);
  }

  function renderLegend(stats) {
    var box = document.createElement('div');
    box.className = 'rb-topo-legend';
    var elev = document.createElement('div');
    elev.className = 'rb-topo-legend__elev';
    elev.textContent = 'ELEV.';
    box.appendChild(elev);
    var bar = document.createElement('div');
    bar.className = 'rb-topo-legend__bar';
    var legend = stats.legend || { min: 0, max: 0, stops: [] };
    var stops = Array.isArray(legend.stops) ? legend.stops.slice() : [];
    for (var i = stops.length - 1; i >= 0; i -= 1) {
      var seg = document.createElement('span');
      seg.style.background = stops[i].color || '#ccc';
      bar.appendChild(seg);
    }
    box.appendChild(bar);
    var labels = document.createElement('div');
    labels.className = 'rb-topo-legend__labels';
    var hiLabel = document.createElement('span');
    hiLabel.textContent = formatReading(legend.max, stats.decimalPlaces) || '—';
    var loLabel = document.createElement('span');
    loLabel.textContent = formatReading(legend.min, stats.decimalPlaces) || '—';
    labels.appendChild(hiLabel);
    labels.appendChild(loLabel);
    box.appendChild(labels);
    return box;
  }

  function renderPill(stats) {
    var pill = document.createElement('div');
    pill.className = 'rb-topo-stats';
    if (stats.name) {
      var label = document.createElement('span');
      label.className = 'rb-topo-stats__label';
      label.textContent = stats.name;
      pill.appendChild(label);
    }
    function coloredStat(className, letter, value) {
      var el = document.createElement('span');
      el.className = className;
      var bold = document.createElement('b');
      bold.textContent = letter;
      el.appendChild(bold);
      el.appendChild(document.createTextNode(' ' + (value || '—')));
      return el;
    }
    pill.appendChild(coloredStat('rb-topo-stats__hi', 'H', formatReading(stats.hi, stats.decimalPlaces)));
    pill.appendChild(coloredStat('rb-topo-stats__lo', 'L', formatReading(stats.lo, stats.decimalPlaces)));
    pill.appendChild(coloredStat('rb-topo-stats__delta', '\u0394', formatReading(stats.delta, stats.decimalPlaces)));
    return pill;
  }

  // The High and Low markers. They used to be drawn into the composed PNG,
  // which froze them: a pin landing on a wall or a doorway could not be moved
  // off it. They come back from the composer as fractions of the figure now,
  // so they are placed here, over the drawing, and nudged like anything else.
  function renderPin(kind, stats) {
    var pin = document.createElement('span');
    pin.className = 'rb-topo-pin rb-topo-pin--' + kind;
    var dot = document.createElement('b');
    dot.className = 'rb-topo-pin__dot';
    dot.textContent = kind === 'hi' ? 'H' : 'L';
    pin.appendChild(dot);
    var value = document.createElement('span');
    value.className = 'rb-topo-pin__value';
    var raw = kind === 'hi' ? stats.hiPin : stats.loPin;
    value.textContent = formatReading(raw && raw.value, stats.decimalPlaces);
    pin.appendChild(value);
    return pin;
  }

  function boxShell(kind, id, locked) {
    var el = document.createElement('div');
    el.className = 'rb-floor-box rb-floor-box--' + kind + (locked ? ' is-locked' : '');
    el.setAttribute('data-rb-floor-box', id);
    el.setAttribute('data-rb-floor-kind', kind);
    if (!locked) {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Move ' + kind);
      // A handle on every corner, not just the bottom right. One corner meant
      // that if the frame was dragged so that corner left the page -- or simply
      // sat where it was hard to find -- there was no way to resize at all.
      ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
        var handle = document.createElement('span');
        handle.className = 'rb-floor-box__resize rb-floor-box__resize--' + corner;
        handle.setAttribute('data-rb-floor-resize', id);
        handle.setAttribute('data-rb-floor-corner', corner);
        handle.setAttribute('aria-hidden', 'true');
        el.appendChild(handle);
      });
    }
    return el;
  }

  /**
   * Render Floor Survey report page.
   * options: { layout, imported }
   * evidence: chrome fields + optional figure/stats when imported
   */
  function renderPage(page, evidence, options) {
    var meta = page && page.meta || {};
    var ev = evidence || {};
    var imported = !!(options && options.imported);
    var statsList = Array.isArray(ev.stats) ? ev.stats : [];
    var layout = layoutForStats(options && options.layout, statsList.length || 1, statsList);
    var locked = !!layout.locked;

    var root = document.createElement('div');
    root.className = 'rb-topo-page' + (imported ? ' rb-topo-page--imported' : ' rb-topo-page--chrome-only');
    root.setAttribute('data-rb-floor-locked', locked ? '1' : '0');

    // Rebuilding this page from the decks, drawing first.
    //
    // An imported slide is the plan and nothing else: no figure block, no
    // residence block, no readings box, no logo, no editor toolbar, and the
    // drawing is full bleed so zooming can fill the slide instead of filling a
    // box inside a margin. Every one of those pieces comes back deliberately,
    // at its own measured position, once the drawing is right. Judging the
    // drawing underneath a pile of chrome that is itself in the wrong place is
    // how this page stayed wrong all day.
    if (imported) {
      // The frame is positioned against a stage, and the drag handler measures
      // that stage: without it the frame could neither be moved nor resized,
      // which is what happened when this branch was first stripped back.
      var bareStage = document.createElement('div');
      bareStage.className = 'rb-topo-page__body rb-floor-stage rb-floor-stage--bare';
      bareStage.setAttribute('data-rb-floor-stage', '1');
      // The drawing is the slide. The plan is placed inside it by dragging and
      // zooming, exactly as in Floor Survey -- including off the edge -- so
      // there is no frame to size and nothing to letterbox the plan into.
      // One drawing, or two of the same level side by side. Tim: "it's a long
      // narrow house... our space allows, maybe I can just put another floor
      // plan that shows the data points." The second is not a second slide:
      // it is the same level drawn another way, on the paper the first one is
      // not using.
      var slots = Math.max(1, Math.min(2, Number(options.topoSlots) || 1));
      var activeSlot = Math.max(0, Math.min(slots - 1, Number(options.topoActiveSlot) || 0));
      var GUTTER = 2; // percent of the stage's width, between the two
      var share = (100 - (slots - 1) * GUTTER) / slots;
      for (var slot = 0; slot < slots; slot += 1) {
        var bare = boxShell('topo', slots > 1 ? ('topo-' + slot) : 'topo', true);
        bare.setAttribute('data-rb-topo-frame', String(slot));
        if (slots > 1 && slot === activeSlot) bare.classList.add('is-active');
        bare.style.left = (slot * (share + GUTTER)) + '%';
        bare.style.top = '0%';
        bare.style.width = share + '%';
        bare.style.height = '100%';
        var bareDraw = document.createElement('div');
        bareDraw.className = 'rb-topo-page__drawing rb-topo-page__drawing--live';
        var bareView = typeof options.mountTopo === 'function'
          ? options.mountTopo(page, slot)
          : null;
        if (bareView) {
          bareDraw.appendChild(bareView);
        } else {
          var bareNote = document.createElement('p');
          bareNote.className = 'rb-sheet__note';
          bareNote.textContent = 'Floor Survey level is not available for this slide.';
          bareDraw.appendChild(bareNote);
        }
        bare.insertBefore(bareDraw, bare.firstChild);
        bareStage.appendChild(bare);
      }
      root.appendChild(bareStage);
      return { root: root, layout: layout };
    }

    var toolbar = document.createElement('div');
    toolbar.className = 'rb-floor-toolbar';
    if (!imported) {
      var importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'btn btn--accent';
      importBtn.setAttribute('data-rb-floor-import', page.id || '');
      importBtn.textContent = 'Import Floor Survey';
      toolbar.appendChild(importBtn);
      var hint = document.createElement('span');
      hint.className = 'rb-floor-toolbar__hint';
      hint.textContent = 'Loads topo, legend, and H/L/Δ onto this slide.';
      toolbar.appendChild(hint);
    } else {
      var lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = locked ? 'btn btn--secondary' : 'btn btn--accent';
      lockBtn.setAttribute('data-rb-floor-lock', locked ? 'unlock' : 'lock');
      lockBtn.textContent = locked ? 'Unlock layout' : 'Lock layout';
      toolbar.appendChild(lockBtn);
      var status = document.createElement('span');
      status.className = 'rb-floor-toolbar__hint';
      status.textContent = locked
        ? 'Layout locked for this report’s Floor Survey pages.'
        : 'Drag boxes to place. Resize from the corner. Then Lock.';
      toolbar.appendChild(status);
    }
    root.appendChild(toolbar);

    var header = document.createElement('div');
    header.className = 'rb-topo-page__header';
    var left = document.createElement('div');
    left.className = 'rb-topo-page__header-left';
    var figureNum = document.createElement('p');
    figureNum.className = 'rb-topo-page__figure-num';
    figureNum.textContent = meta.figureNumber ? ('Figure ' + meta.figureNumber) : 'Figure';
    left.appendChild(figureNum);
    // The drawing title, the survey date and the corrected-for note used to
    // sit here too, and the residence, the address, the compass and the front
    // door sat opposite. They are all in the rail now, which is the whole
    // point of it: one place for everything that is not the drawing. Figure N
    // stays, because that is what the eye looks for first on a sheet.
    header.appendChild(left);

    root.appendChild(header);

    var body = document.createElement('div');
    body.className = 'rb-topo-page__body rb-floor-stage';
    body.setAttribute('data-rb-floor-stage', '1');

    if (imported) {
      var topo = boxShell('topo', 'topo', locked);
      topo.style.left = layout.topo.x + '%';
      topo.style.top = layout.topo.y + '%';
      topo.style.width = layout.topo.w + '%';
      topo.style.height = layout.topo.h + '%';
      var drawing = document.createElement('div');
      drawing.className = 'rb-topo-page__drawing';
      var figure = ev.figure || {};
      // The live Floor Survey view, when Report Builder hands one over. It is
      // the same component and the same canvas the investigator draws on, so
      // there is no second renderer to drift. The composed image below is the
      // fallback for a report saved before this.
      var liveView = typeof options.mountTopo === 'function' ? options.mountTopo(page, 0) : null;
      if (liveView) {
        drawing.classList.add('rb-topo-page__drawing--live');
        drawing.appendChild(liveView);
      } else if (figure.dataUrl && figure.dataUrl.indexOf('data:image/') === 0) {
        var img = document.createElement('img');
        img.className = 'rb-topo-page__image';
        img.src = figure.dataUrl;
        img.alt = scopeTitle;
        drawing.appendChild(img);
      } else {
        var miss = document.createElement('p');
        miss.className = 'rb-sheet__note';
        miss.textContent = 'Topo figure could not be composed from Floor Survey readings.';
        drawing.appendChild(miss);
      }
      topo.insertBefore(drawing, topo.firstChild);
      body.appendChild(topo);

      // Rebuilding this page from the decks. Until the drawing itself is
      // right, the slide carries the plan and nothing else -- the colour
      // scale, the pill and the High/Low markers come back one at a time,
      // placed at the deck's own coordinates, once there is something correct
      // to place them against.
      var SHOW_CHROME = false;
      if (SHOW_CHROME) layout.overlays.forEach(function (overlay) {
        var stats = statsList[overlay.statsIndex] || statsList[0];
        if (!stats) return;
        var box = boxShell(overlay.kind, overlay.id, locked);
        box.style.left = overlay.x + '%';
        box.style.top = overlay.y + '%';
        box.style.transform = 'scale(' + overlay.scale + ')';
        box.style.transformOrigin = 'top left';
        if (overlay.kind === 'legend') box.appendChild(renderLegend(stats));
        else if (overlay.kind === 'pin-hi') box.appendChild(renderPin('hi', stats));
        else if (overlay.kind === 'pin-lo') box.appendChild(renderPin('lo', stats));
        else box.appendChild(renderPill(stats));
        body.appendChild(box);
      });
    } else {
      var empty = document.createElement('div');
      empty.className = 'rb-floor-empty';
      empty.textContent = 'Floor Survey graphics are not on this slide yet. Import when ready.';
      body.appendChild(empty);
    }

    root.appendChild(body);

    // The readings box that used to sit here is in the rail, listed per
    // level rather than rolled into one high and one low.
    var footer = document.createElement('div');
    footer.className = 'rb-topo-page__footer';
    if (typeof options.brandMark === 'function') footer.appendChild(options.brandMark());
    root.appendChild(footer);
    return { root: root, layout: layout };
  }

  window.ToolboxReportFloorLayout = {
    defaultLayout: defaultLayout,
    cloneLayout: cloneLayout,
    normalizeLayout: normalizeLayout,
    layoutForStats: layoutForStats,
    frameForPlan: frameForPlan,
    renderPage: renderPage,
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,
    MIN_TOPO_W: MIN_TOPO_W,
    MIN_TOPO_H: MIN_TOPO_H,
  };
})();
