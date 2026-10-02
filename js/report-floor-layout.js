// Toolbox — Floor Survey report page layout (Import → place → Lock).
// Chrome-first page; topo/legend/pill are boxes. Book layout inherits when locked.

(function () {
  'use strict';

  var MIN_TOPO_W = 35;
  var MIN_TOPO_H = 35;
  var MIN_SCALE = 0.65;
  var MAX_SCALE = 1.85;

  function clamp(n, lo, hi) {
    var x = typeof n === 'number' && isFinite(n) ? n : lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function defaultLayout() {
    return {
      locked: false,
      topo: { x: 10, y: 6, w: 80, h: 88 },
      overlays: [
        { id: 'legend-0', kind: 'legend', statsIndex: 0, x: 2, y: 8, scale: 1 },
        { id: 'pill-0', kind: 'pill', statsIndex: 0, x: 2, y: 48, scale: 1 },
      ],
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
        x: clamp(topo.x, 0, 90),
        y: clamp(topo.y, 0, 90),
        w: clamp(topo.w, MIN_TOPO_W, 100),
        h: clamp(topo.h, MIN_TOPO_H, 100),
      },
      overlays: [],
    };
    var list = Array.isArray(src.overlays) ? src.overlays : base.overlays;
    list.forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;
      layout.overlays.push({
        id: item.id || ('overlay-' + index),
        kind: item.kind === 'pill' ? 'pill' : 'legend',
        statsIndex: typeof item.statsIndex === 'number' ? item.statsIndex : 0,
        x: clamp(item.x, 0, 92),
        y: clamp(item.y, 0, 92),
        scale: clamp(item.scale, MIN_SCALE, MAX_SCALE),
      });
    });
    if (!layout.overlays.length) layout.overlays = base.overlays.slice();
    return layout;
  }

  function layoutForStats(layout, statsCount) {
    var next = normalizeLayout(layout);
    var count = Math.max(1, statsCount || 1);
    var have = {};
    next.overlays.forEach(function (o) { have[o.kind + ':' + o.statsIndex] = true; });
    for (var i = 0; i < count; i += 1) {
      if (!have['legend:' + i]) {
        next.overlays.push({
          id: 'legend-' + i,
          kind: 'legend',
          statsIndex: i,
          x: i === 0 ? 2 : 78,
          y: 8,
          scale: 1,
        });
      }
      if (!have['pill:' + i]) {
        next.overlays.push({
          id: 'pill-' + i,
          kind: 'pill',
          statsIndex: i,
          x: i === 0 ? 2 : 70,
          y: 48,
          scale: 1,
        });
      }
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

  function boxShell(kind, id, locked) {
    var el = document.createElement('div');
    el.className = 'rb-floor-box rb-floor-box--' + kind + (locked ? ' is-locked' : '');
    el.setAttribute('data-rb-floor-box', id);
    el.setAttribute('data-rb-floor-kind', kind);
    if (!locked) {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Move ' + kind);
      var handle = document.createElement('span');
      handle.className = 'rb-floor-box__resize';
      handle.setAttribute('data-rb-floor-resize', id);
      handle.setAttribute('aria-hidden', 'true');
      el.appendChild(handle);
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
    var layout = layoutForStats(options && options.layout, statsList.length || 1);
    var locked = !!layout.locked;

    var root = document.createElement('div');
    root.className = 'rb-topo-page' + (imported ? ' rb-topo-page--imported' : ' rb-topo-page--chrome-only');
    root.setAttribute('data-rb-floor-locked', locked ? '1' : '0');

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
    var figureTitle = document.createElement('h1');
    figureTitle.className = 'rb-topo-page__figure-title';
    var scopeTitle = meta.scopeTitle || meta.levelName || 'Floor Level Survey';
    figureTitle.textContent = 'Floor Level Survey — ' + scopeTitle;
    left.appendChild(figureTitle);
    var dateLine = document.createElement('p');
    dateLine.className = 'rb-topo-page__survey-date';
    var dateText = '';
    if (typeof options.formatSurveyDate === 'function') {
      dateText = options.formatSurveyDate(meta.surveyDate || ev.surveyDate || '', true);
    }
    dateLine.textContent = dateText ? ('Survey Date: ' + dateText) : 'Survey Date:';
    left.appendChild(dateLine);
    var corrected = document.createElement('p');
    corrected.className = 'rb-topo-page__corrected';
    corrected.textContent = 'Corrected for Floor Differences';
    left.appendChild(corrected);
    header.appendChild(left);

    var right = document.createElement('div');
    right.className = 'rb-topo-page__header-right';
    var residence = document.createElement('p');
    residence.className = 'rb-topo-page__residence';
    residence.textContent = ev.residenceTitle || ev.customerName || '';
    right.appendChild(residence);
    var street = document.createElement('p');
    street.className = 'rb-topo-page__address';
    street.textContent = ev.address || '';
    right.appendChild(street);
    if (ev.addressCity) {
      var city = document.createElement('p');
      city.className = 'rb-topo-page__address-city';
      city.textContent = ev.addressCity;
      right.appendChild(city);
    }
    var door = document.createElement('div');
    door.className = 'rb-topo-page__front-door';
    if (typeof options.renderNorthArrow === 'function') {
      door.appendChild(options.renderNorthArrow());
    }
    var doorMeta = document.createElement('div');
    doorMeta.className = 'rb-topo-page__front-door-meta';
    var doorLabel = document.createElement('span');
    doorLabel.textContent = 'Front Door';
    var doorValue = document.createElement('strong');
    doorValue.textContent = meta.frontDoorFacing || ev.frontDoorFacing || '—';
    doorMeta.appendChild(doorLabel);
    doorMeta.appendChild(doorValue);
    door.appendChild(doorMeta);
    right.appendChild(door);
    header.appendChild(right);
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
      if (figure.dataUrl && figure.dataUrl.indexOf('data:image/') === 0) {
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

      layout.overlays.forEach(function (overlay) {
        var stats = statsList[overlay.statsIndex] || statsList[0];
        if (!stats) return;
        var box = boxShell(overlay.kind, overlay.id, locked);
        box.style.left = overlay.x + '%';
        box.style.top = overlay.y + '%';
        box.style.transform = 'scale(' + overlay.scale + ')';
        box.style.transformOrigin = 'top left';
        if (overlay.kind === 'legend') box.appendChild(renderLegend(stats));
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

    var footer = document.createElement('div');
    footer.className = 'rb-topo-page__footer';
    if (typeof options.brandMark === 'function') footer.appendChild(options.brandMark());
    if (imported && statsList.length && typeof options.renderRelativeReadings === 'function') {
      footer.appendChild(options.renderRelativeReadings(statsList));
    }
    root.appendChild(footer);
    return { root: root, layout: layout };
  }

  window.ToolboxReportFloorLayout = {
    defaultLayout: defaultLayout,
    cloneLayout: cloneLayout,
    normalizeLayout: normalizeLayout,
    layoutForStats: layoutForStats,
    renderPage: renderPage,
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,
    MIN_TOPO_W: MIN_TOPO_W,
    MIN_TOPO_H: MIN_TOPO_H,
  };
})();
