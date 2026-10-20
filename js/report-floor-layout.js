// Toolbox — Floor Survey report page layout (Import → place → Lock).
// Chrome-first page; topo/legend/pill are boxes. Book layout inherits when locked.

(function () {
  'use strict';

  var MIN_TOPO_W = 35;
  var MIN_TOPO_H = 35;
  var MIN_OVERVIEW_W = 6;
  var MIN_OVERVIEW_H = 6;
  // The pieces a Floor Survey slide places on the page: the colour scale and
  // that boundary's H / L / delta. Each is its own box and each moves on its
  // own -- Tim: "those need to be movable separately... the high/low/delta
  // pill, the contour legend, those are all movable." They used to be
  // painted into the plan's own picture, so moving the plan carried them
  // along and neither could be put where the sheet wanted it. The High and
  // Low markers are NOT here: they point at a spot on the floor, so they
  // stay in the picture and are nudged on the drawing itself.
  //
  // `chrome` was a short-lived kind that held both at once; it is still read
  // so a report saved while it existed opens, and splits back into two.
  var OVERLAY_KINDS = { legend: 1, pill: 1, chrome: 1, 'pin-hi': 1, 'pin-lo': 1 };
  var MIN_SCALE = 0.65;
  var MAX_SCALE = 1.85;

  function clamp(n, lo, hi) {
    var x = typeof n === 'number' && isFinite(n) ? n : lo;
    return Math.max(lo, Math.min(hi, x));
  }

  /**
   * How tall a colour scale really is on the paper.
   *
   * The stylesheet draws it 20.5cqw tall -- a share of the sheet's WIDTH,
   * because that is how Floor Survey sizes it and it must not change with
   * the plan. These slots are in percentages of the sheet's HEIGHT, and an
   * 11 x 17 sheet is 17/11 wider than it is tall, so the same scale is 31.7%
   * of the height. The old numbers below were guessed at "about 21.6%", and
   * everything that followed was wrong because of it: the pill dropped 23%
   * landed INSIDE its own scale, and the next boundary started 31% down,
   * before the one above it had ended. Measured on a two-boundary sheet:
   * scale 0 from 13 to 44.7 with its pill at 36, scale 1 starting at 44.
   *
   * Tim, looking at exactly that on his own job: "the pen and the contour
   * legends are not right... they all should be able to line up exactly."
   */
  var LEGEND_TALL = 20.5 * (17 / 11);
  var PILL_TALL = 2.4;
  var GAP = 1.4;

  // The pill sits under its own scale, clear of it.
  var PILL_DROP = Math.round((LEGEND_TALL + GAP) * 10) / 10;
  // The next boundary's pair starts under the pill of the one above.
  var SCALE_PITCH = Math.round((PILL_DROP + PILL_TALL + GAP) * 10) / 10;

  // Where boundary i's colour scale and pill start. A pair is 36.5% of the
  // page tall, so two fit down a column and the third starts a second one.
  // One definition, used both for the very first layout and when more
  // boundaries turn up, because two copies of it meant index 0 kept a stale
  // position forever: layoutForStats only fills in what is missing, and
  // index 0 was never missing.
  var PER_COLUMN = 2;

  function scaleSlot(i) {
    var column = i < PER_COLUMN ? 8 : 76;
    var row = (i % PER_COLUMN) * SCALE_PITCH;
    return { x: column, legendY: 13 + row, pillY: 13 + row + PILL_DROP };
  }

  /**
   * A pair that was never placed by hand takes the corrected slot.
   *
   * The old slots overlapped, and a report saved under them carries those
   * positions for ever -- normalizeLayout keeps what is stored, which is
   * right for anything the investigator dragged and wrong for a position
   * nobody chose. The same repair the cover's identity box already uses: a
   * box sitting exactly on an old default was not placed, so it moves; a box
   * anywhere else is his and is left alone.
   */
  function oldSlot(i) {
    var column = i < 3 ? 8 : 76;
    var row = (i % 3) * 31;
    return { x: column, legendY: 13 + row, pillY: 13 + row + 23 };
  }

  function sameSpot(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.01;
  }

  function repairSlot(item) {
    if (!item || (item.kind !== 'legend' && item.kind !== 'pill')) return item;
    var at = typeof item.statsIndex === 'number' ? item.statsIndex : 0;
    var was = oldSlot(at);
    var now = scaleSlot(at);
    var wasY = item.kind === 'legend' ? was.legendY : was.pillY;
    var nowY = item.kind === 'legend' ? now.legendY : now.pillY;
    if (!sameSpot(item.x, was.x) || !sameSpot(item.y, wasY)) return item;
    item.x = now.x;
    item.y = nowY;
    return item;
  }

  /**
   * Which piece sits over which, before anything is sent anywhere.
   *
   * The drawing is the page, the aerial view sits on it, and the colour scale
   * and the readings sit on top of both so they can always be read. One scale
   * for every piece on the sheet, so "behind" and "in front" mean the same
   * thing whatever two pieces are being compared. Tim: "I need to be able to
   * right click and put images behind or in front."
   */
  var BASE_STACK = { topo: 1, overview: 2, legend: 3, pill: 3 };
  var MIN_STACK = -40;
  var MAX_STACK = 40;

  function stackOf(piece, kind) {
    var base = BASE_STACK[kind] || 1;
    var raw = piece && typeof piece.z === 'number' && isFinite(piece.z) ? piece.z : base;
    return Math.max(MIN_STACK, Math.min(MAX_STACK, raw));
  }

  function defaultLayout() {
    var slot = scaleSlot(0);
    return {
      locked: false,
      // The decks put the drawing at 8.82 / 8.33, 83.05 x 87.91 -- it fills
      // the page. The old 10/6/80/88 was invented and squeezed it into the
      // margin box, which is why the plan looked small and cropped.
      topo: { x: 8.82, y: 8.33, w: 83.05, h: 87.91 },
      // The aerial view of the property, where the decks put it: lower left,
      // clear of the rail down the right. Put on the cover once and it is on
      // every Floor Survey page; moved here, it moves on all of them; deleted
      // here, it is gone from this page only.
      overview: { x: 2.5, y: 74, w: 16, h: 18 },
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
    var over = src.overview && typeof src.overview === 'object' ? src.overview : base.overview;
    var layout = {
      locked: !!src.locked,
      topo: {
        z: stackOf(topo, 'topo'),
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
      overview: {
        z: stackOf(over, 'overview'),
        x: clamp(over.x, -300, 300),
        y: clamp(over.y, -300, 300),
        w: clamp(over.w, MIN_OVERVIEW_W, 300),
        h: clamp(over.h, MIN_OVERVIEW_H, 300),
      },
      overlays: [],
    };
    var list = Array.isArray(src.overlays) ? src.overlays : base.overlays;
    list.forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;
      var kind = OVERLAY_KINDS[item.kind] ? item.kind : 'legend';
      var at = typeof item.statsIndex === 'number' ? item.statsIndex : 0;
      var x = clamp(item.x, 0, 92);
      var y = clamp(item.y, 0, 92);
      // A report saved while the two were one box opens as two again: the
      // scale keeps the spot, the readings take the one under it.
      if (kind === 'chrome') {
        layout.overlays.push({ id: 'legend-' + at, kind: 'legend', statsIndex: at,
          x: x, y: y, z: stackOf(item, 'legend'),
          scale: clamp(item.scale, MIN_SCALE, MAX_SCALE) });
        layout.overlays.push({ id: 'pill-' + at, kind: 'pill', statsIndex: at,
          x: x, y: clamp(y + PILL_DROP, 0, 92), z: stackOf(item, 'pill'),
          scale: clamp(item.scale, MIN_SCALE, MAX_SCALE) });
        return;
      }
      layout.overlays.push(repairSlot({
        id: item.id || ('overlay-' + index),
        kind: kind,
        statsIndex: at,
        x: x,
        y: y,
        z: stackOf(item, kind),
        scale: clamp(item.scale, MIN_SCALE, MAX_SCALE),
      }));
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
          id: 'legend-' + i, kind: 'legend', statsIndex: i,
          x: slot.x, y: slot.legendY, z: BASE_STACK.legend, scale: 1,
        });
      }
      if (!have['pill:' + i]) {
        next.overlays.push({
          id: 'pill-' + i, kind: 'pill', statsIndex: i,
          x: slot.x, y: slot.pillY, z: BASE_STACK.pill, scale: 1,
        });
      }
      // The High and Low markers are NOT boxes on the page. They point at a
      // spot on the floor, so they are drawn into the picture and travel with
      // it when the plan is panned or zoomed -- which is the one thing the
      // scale and the readings must not do. They used to be placed here from
      // a composed figure's coordinates; the drawing carries them itself now.
    }
    return next;
  }

  function formatReading(value, dec) {
    var n = typeof value === 'number' && isFinite(value) ? value : null;
    if (n == null) return '';
    return n.toFixed(typeof dec === 'number' ? dec : 2);
  }

  // The pill and the High/Low markers, drawn as the report's own boxes.
  //
  // The colour scale used to be here too, built out of HTML. It is Floor
  // Survey's own now, painted by Floor Survey and placed as a picture -- see
  // renderLegendCard. renderPin is not called: the High and Low markers point
  // at a spot on the floor, so the drawing carries them, and this is what a
  // page of its own would be built from if that is ever wanted.

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

  /**
   * The colour scale and this boundary's readings, as one piece on the page.
   *
   * Both used to be drawn into the plan's own picture, so moving the plan
   * moved them with it and neither could be put where the sheet wanted it.
   * Tim: "putting the contour legend in the pill, one place, and being able
   * to move the floor plan with contours separately... those need to be able
   * to move just like they do on the FS page." So: one box, dragged by the
   * investigator, sized from its corner, and the drawing underneath pans and
   * zooms without touching it.
   */
  /**
   * How big the piece is drawn.
   *
   * The Floor Survey screen sizes its colour scale from Labels & layers and
   * moves it by dragging; a slide does the same, so there is one control for
   * the size and it is the one already in the panel. 1.5x is the scale's own
   * default there.
   */
  function legendScale(options) {
    var raw = options && options.settings && Number(options.settings.legendScale);
    var n = isFinite(raw) && raw > 0 ? raw : 1;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));
  }

  /**
   * The colour scale for a boundary, on the page.
   *
   * It is the Floor Survey screen's own colour scale, painted by Floor Survey
   * and placed here as a picture. Tim, looking at a sheet: "the Legend is not
   * right and it does not lock the size, its different than the FS legend",
   * and "the legend contour was incorrect." The sheet used to draw a scale of
   * its own out of HTML, from the band colours the live view happened to
   * report: no tick values at the contour lines, the high and the low where
   * those values belong, ELEV. at the top instead of the foot, and every
   * dimension in screen pixels, so its size on the paper changed with the
   * window. There is one colour scale in Toolbox; this shows that one.
   */
  function renderLegendCard(options, overlay) {
    var box = document.createElement('div');
    box.className = 'rb-topo-legend';
    var at = (overlay && typeof overlay.statsIndex === 'number') ? overlay.statsIndex : 0;
    box.setAttribute('data-rb-legend', String(at));
    var urls = (options && options.legendUrls) || null;
    var url = urls && urls[at] ? urls[at] : '';
    var image = document.createElement('img');
    image.className = 'rb-topo-legend__img';
    image.alt = 'Elevation colour scale';
    image.setAttribute('draggable', 'false');
    if (url) image.src = url;
    box.appendChild(image);
    return box;
  }

  /** How big the readings are drawn: the panel's Stats pill size, where 32
   *  is the size that has always been the default. */
  function pillScale(options) {
    var raw = options && Number(options.pillPx);
    var n = isFinite(raw) && raw > 0 ? raw : 32;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, n / 32));
  }

  /**
   * The site overview, as it appears on a Floor Survey page.
   *
   * Settled Oct 10, 2026: "once you put it in on the cover page it should
   * automatically go in there, and then if it's not right you just delete
   * it." So there is nothing to add here -- the picture is the cover's, and
   * this page either carries it or has had it taken off. Tim, Oct 16: "able
   * to delete on FS pages if too cluttered, and moveable by user."
   */
  function renderOverview(options, layout, locked) {
    var url = options && options.overviewUrl;
    if (!url || (options && options.overviewHidden)) return null;
    var box = boxShell('overview', 'overview', locked);
    box.style.left = layout.overview.x + '%';
    box.style.top = layout.overview.y + '%';
    box.style.zIndex = String(layout.overview.z);
    box.style.width = layout.overview.w + '%';
    box.style.height = layout.overview.h + '%';
    var image = document.createElement('img');
    image.className = 'rb-floor-overview__image';
    image.src = url;
    image.alt = 'Site overview';
    image.setAttribute('draggable', 'false');
    box.insertBefore(image, box.firstChild);
    if (!locked) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'rb-floor-overview__remove';
      remove.setAttribute('data-rb-floor-overview', 'remove');
      remove.setAttribute('aria-label', 'Remove the site overview from this page');
      remove.textContent = '\u00d7';
      box.appendChild(remove);
    }
    return box;
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
    // What the drawing is drawing right now, when it has said; the evidence
    // stored at import otherwise. The same rule the rail follows, so the
    // scale and the readings on the page cannot quote different numbers from
    // the pill the plan used to carry.
    var live = options && Array.isArray(options.stats) ? options.stats : null;
    var statsList = live && live.length ? live : (Array.isArray(ev.stats) ? ev.stats : []);
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
        bare.style.zIndex = String(layout.topo.z);
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
      // The colour scale and the readings: two pieces, each moved on its own.
      //
      // Each is dragged to move and sized from the control that has always
      // sized it -- Legend size for the scale, Stats pill size for the
      // readings -- which is how both behave on the Floor Survey screen.
      // Tim: "those need to be able to move just like they do on the FS
      // page." So neither carries corner handles: two controls for one size
      // is one too many.
      layout.overlays.forEach(function (overlay) {
        if (overlay.kind !== 'legend' && overlay.kind !== 'pill') return;
        var stats = statsList[overlay.statsIndex];
        if (!stats) return;
        var piece = boxShell(overlay.kind, overlay.id, true);
        piece.classList.remove('is-locked');
        piece.classList.add('rb-floor-box--chrome');
        if (!locked) {
          piece.setAttribute('tabindex', '0');
          piece.setAttribute('role', 'button');
          piece.setAttribute('aria-label',
            overlay.kind === 'legend' ? 'Move the colour scale' : 'Move the readings');
        }
        piece.style.left = overlay.x + '%';
        piece.style.top = overlay.y + '%';
        piece.style.zIndex = String(overlay.z);
        piece.style.transform = 'scale(' +
          (overlay.kind === 'legend' ? legendScale(options) : pillScale(options)) + ')';
        piece.style.transformOrigin = 'top left';
        piece.insertBefore(
          overlay.kind === 'legend' ? renderLegendCard(options, overlay) : renderPill(stats),
          piece.firstChild);
        bareStage.appendChild(piece);
      });
      var overviewBox = renderOverview(options, layout, locked);
      if (overviewBox) bareStage.appendChild(overviewBox);
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

    // Only a page that has not been imported reaches here: an imported sheet
    // is the drawing and nothing else, and returns above. What used to sit in
    // this spot was a second way of drawing the slide -- a topo box holding
    // the composed image, with the colour scale, the pill and the High/Low
    // markers as boxes of this page's own -- and it had been unreachable long
    // enough to have gone bad: it referred to a variable that no longer
    // exists, so it would have thrown had anything called it. The slide draws
    // its own chrome through the live Floor Survey view now, which is why
    // Import delivers the legend and the H/L/Δ it promises.
    {
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
    MIN_OVERVIEW_W: MIN_OVERVIEW_W,
    MIN_OVERVIEW_H: MIN_OVERVIEW_H,
    MIN_STACK: MIN_STACK,
    MAX_STACK: MAX_STACK,
  };
})();
