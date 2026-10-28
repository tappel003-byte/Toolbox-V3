/**
 * What a component HOLDS, said in words, rather than what it is made of.
 *
 * Tim, after pressing Open on a Floor Survey in File Explorer and getting the
 * stored JSON: "who in the world is this helpful?" He is right. A back door
 * whose answer to "what is in this job" is a wall of record syntax is a
 * developer's folder, not a file cabinet. What he asked for instead reads
 * like this:
 *
 *   Floor Survey — 2 levels · Main Level 48 readings · surveyed Sep 29, 2026
 *
 * So this module turns a stored component into a headline and a short list of
 * figures, and it builds the real archive files — the readings CSV Tim asked
 * for, the pin list, the customer details, and the cover sheet that explains a
 * folder someone opens in 2031. The raw record is still stored, still
 * downloadable, and still behind Technical details. Nothing here writes
 * anything: it only reads what the Cabinet already holds.
 *
 * Pure functions on plain objects, so they can be tested without a browser
 * and without the Cabinet.
 *
 * HONESTY RULE, and it is the whole point of the module: a figure is shown
 * only when the stored component actually carries it. Nothing here estimates,
 * fills in, or rounds a missing value into an existing-looking one. Where an
 * artifact does not exist, the caller is told it does not exist rather than
 * handed a plausible-looking blank.
 */
(function () {
  'use strict';

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : (many || one + 's'));
  }

  /** A stored survey date (yyyy-mm-dd or ISO) as a person writes it. */
  function readableDate(value) {
    const text = trim(value);
    if (!text) return '';
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    let date;
    if (day) date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    else {
      const parsed = Date.parse(text);
      if (!isFinite(parsed)) return '';
      date = new Date(parsed);
    }
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** yyyy-mm-dd, for a filename that sorts. */
  function fileDate(value) {
    const text = trim(value);
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = Date.parse(text);
    if (!isFinite(parsed)) return '';
    const d = new Date(parsed);
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function inches(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
  }

  // ---------------------------------------------------------------- levels

  /**
   * The levels of a job, in one shape, from the two components that know.
   *
   * `plans` names them — a level IS a Plan Setup canvas — and `floor` carries
   * the readings against the same canvas id. Reading both and joining on that
   * id is what lets a reading count sit under the name of the storey it was
   * taken on, instead of under a canvas id nobody can read.
   */
  function levelsOf(plans, floor) {
    const byId = Object.create(null);
    const order = [];
    const canvases = isObject(plans) && Array.isArray(plans.canvases) ? plans.canvases : [];
    canvases.forEach(function (canvas, i) {
      if (!isObject(canvas)) return;
      const id = trim(canvas.id);
      if (!id) return;
      byId[id] = {
        id: id,
        name: trim(canvas.name) || ('Level ' + (i + 1)),
        hasPlan: !!(isObject(canvas.plan) && trim(canvas.plan.id)),
        hasContour: !!(isObject(canvas.contourLayer) && trim(canvas.contourLayer.id)),
        readings: 0,
        basePoints: 0,
        areas: 0,
        transitions: 0,
        surveyDate: '',
        hasScale: false,
        high: null,
        low: null,
      };
      order.push(id);
    });

    const layers = isObject(floor) && isObject(floor.byCanvasId) ? floor.byCanvasId : {};
    Object.keys(layers).forEach(function (canvasId) {
      const layer = layers[canvasId];
      if (!isObject(layer)) return;
      // A level with readings but no plan canvas is still a level. It happens
      // when a canvas was removed and the readings outlived it, and hiding it
      // would hide real measurements.
      let level = byId[canvasId];
      if (!level) {
        level = {
          id: canvasId,
          name: trim(layer.name) || 'Level',
          hasPlan: false,
          hasContour: false,
          readings: 0,
          basePoints: 0,
          areas: 0,
          transitions: 0,
          surveyDate: '',
          hasScale: false,
          high: null,
          low: null,
          orphaned: true,
        };
        byId[canvasId] = level;
        order.push(canvasId);
      }
      const points = Array.isArray(layer.points) ? layer.points.filter(isObject) : [];
      level.readings = points.length;
      level.basePoints = points.filter(function (p) { return !!p.isBasePoint; }).length;
      level.areas = Array.isArray(layer.areas) ? layer.areas.length : 0;
      level.transitions = Array.isArray(layer.transitions) ? layer.transitions.length : 0;
      level.surveyDate = trim(layer.inspectionDate);
      level.hasScale = !!(isObject(layer.scale) && typeof layer.scale.lengthInches === 'number'
        && isFinite(layer.scale.lengthInches) && layer.scale.lengthInches > 0);
      const spread = elevationSpread(layer);
      level.high = spread.high;
      level.low = spread.low;
      level.corrected = spread.corrected;
      level.points = points;
      level.layer = layer;
    });

    return order.map(function (id) { return byId[id]; });
  }

  /**
   * Highest and lowest CORRECTED elevation on a level.
   *
   * Corrected, because that is the floor the investigator is looking at — a
   * raw reading on carpet is not comparable with a raw reading on tile until
   * its transition correction is applied. And corrected by Floor Survey's own
   * withCorrectedValues, reached through window.ToolboxFloorSurvey, NOT by
   * arithmetic repeated here: a second implementation of the correction could
   * disagree with the topo and nothing would say which was right.
   *
   * Without that function (a page that never loaded the Floor Survey bundle,
   * or a unit test) the spread is reported from the RAW readings and says so,
   * rather than silently presenting raw numbers as corrected ones.
   */
  function elevationSpread(layer) {
    const raw = isObject(layer) && Array.isArray(layer.points)
      ? layer.points.filter(function (p) { return isObject(p) && typeof p.value === 'number' && isFinite(p.value); })
      : [];
    if (!raw.length) return { high: null, low: null, corrected: false };
    const api = (typeof window !== 'undefined' && window.ToolboxFloorSurvey) || null;
    let points = raw;
    let corrected = false;
    if (api && typeof api.withCorrectedValues === 'function') {
      try {
        points = api.withCorrectedValues(raw, layer.transitions, layer.transitionGroupAverages);
        corrected = true;
      } catch (_) {
        points = raw;
        corrected = false;
      }
    }
    let high = null;
    let low = null;
    points.forEach(function (p) {
      const v = p && typeof p.value === 'number' && isFinite(p.value) ? p.value : null;
      if (v === null) return;
      if (high === null || v > high) high = v;
      if (low === null || v < low) low = v;
    });
    return { high: high, low: low, corrected: corrected };
  }

  /**
   * The biggest fall on any one level, in inches.
   *
   * The drawings show this as "2.4 in over 31 ft". The span needs a scale,
   * and most levels do not have one set, so the distance is reported only
   * where the level actually carries a scale calibration. The inches are real
   * either way — see TODO.md on what X and Y mean.
   */
  function maxDrop(levels) {
    let best = null;
    (levels || []).forEach(function (level) {
      if (!level || level.high === null || level.low === null) return;
      const drop = level.high - level.low;
      if (!isFinite(drop)) return;
      if (!best || drop > best.drop) {
        best = {
          drop: drop,
          level: level.name,
          scaled: level.hasScale,
          // Whether the readings it was measured from had their flooring
          // corrections applied. A fall measured across a carpet/tile
          // doorway WITHOUT them is a different number, and calling it the
          // same thing would be the quiet kind of wrong.
          corrected: level.corrected !== false || !level.transitions,
        };
      }
    });
    return best;
  }

  // ------------------------------------------------------------- distress

  function distressFacts(distress, levels) {
    const pins = isObject(distress) && Array.isArray(distress.pins)
      ? distress.pins.filter(isObject) : [];
    const quick = isObject(distress) && Array.isArray(distress.quickCapture)
      ? distress.quickCapture.filter(isObject) : [];
    const unassigned = isObject(distress) && Array.isArray(distress.unassignedPhotos)
      ? distress.unassignedPhotos.length : 0;
    const general = isObject(distress) && Array.isArray(distress.generalPhotos)
      ? distress.generalPhotos.length : 0;
    let pinPhotos = 0;
    const canvasIds = Object.create(null);
    pins.forEach(function (pin) {
      pinPhotos += Array.isArray(pin.photos) ? pin.photos.length : 0;
      const canvasId = trim(pin.canvasId);
      if (canvasId) canvasIds[canvasId] = 1;
    });
    const named = Object.create(null);
    (levels || []).forEach(function (level) { named[level.id] = level.name; });
    return {
      pins: pins.length,
      pinPhotos: pinPhotos,
      quick: quick.length,
      unassigned: unassigned,
      general: general,
      photographs: pinPhotos + quick.length + unassigned + general,
      levels: Object.keys(canvasIds).map(function (id) { return named[id] || 'Level'; }),
      surveyDate: trim(distress && distress.inspectionDate) || trim(distress && distress.surveyDate),
    };
  }

  // ------------------------------------------------- the readable summary

  /**
   * One component, as a headline plus figures.
   *
   * `context` carries the other components where a component cannot describe
   * itself alone: a Floor Survey needs the plans to name its levels, and
   * Distress needs them too.
   */
  function componentSummary(name, payload, context) {
    const ctx = context || {};
    if (name === 'customer') return customerSummary(payload, ctx);
    if (name === 'plans') return plansSummary(payload, ctx);
    if (name === 'floor') return floorSummary(payload, ctx);
    if (name === 'distress') return distressSummary(payload, ctx);
    if (name === 'report') return reportSummary(payload, ctx);
    if (name === 'diagnostics') return diagnosticsSummary(payload, ctx);
    if (name === 'trash') return trashSummary(payload, ctx);
    if (name === 'index') return indexSummary(payload, ctx);
    return null;
  }

  function customerSummary(customer) {
    if (!isObject(customer)) return null;
    const name = [trim(customer.firstName), trim(customer.lastName)]
      .filter(Boolean).join(' ');
    const figures = [];
    if (trim(customer.propertyAddress)) {
      figures.push({ label: 'Property', value: trim(customer.propertyAddress) });
    }
    if (trim(customer.cellPhone)) figures.push({ label: 'Cell', value: trim(customer.cellPhone) });
    if (trim(customer.homePhone)) figures.push({ label: 'Home', value: trim(customer.homePhone) });
    if (trim(customer.email)) figures.push({ label: 'Email', value: trim(customer.email) });
    if (trim(customer.companyName)) figures.push({ label: 'Company', value: trim(customer.companyName) });
    if (trim(customer.spouseName)) figures.push({ label: 'Also', value: trim(customer.spouseName) });
    const headline = name || trim(customer.propertyAddress) || 'Customer information';
    return { headline: headline, figures: figures, notes: [] };
  }

  function plansSummary(plans, ctx) {
    if (!isObject(plans)) return null;
    const levels = levelsOf(plans, ctx.floor);
    const named = levels.filter(function (l) { return !l.orphaned; });
    const withPlan = named.filter(function (l) { return l.hasPlan; }).length;
    const withContour = named.filter(function (l) { return l.hasContour; }).length;
    const parts = [plural(named.length, 'level')];
    if (named.length) parts.push(named.map(function (l) { return l.name; }).join(', '));
    const figures = [];
    figures.push({ label: 'Plan images', value: withPlan + ' of ' + named.length });
    if (withContour) {
      figures.push({ label: 'Contour layers', value: String(withContour) });
    }
    const notes = [];
    const missing = named.filter(function (l) { return !l.hasPlan; });
    if (missing.length) {
      notes.push('No plan picture on ' + missing.map(function (l) { return l.name; }).join(', ') + '.');
    }
    return { headline: parts.join(' · '), figures: figures, notes: notes };
  }

  function floorSummary(floor, ctx) {
    if (!isObject(floor)) return null;
    const levels = levelsOf(ctx.plans, floor).filter(function (l) { return l.readings > 0 || l.layer; });
    const readings = levels.reduce(function (n, l) { return n + l.readings; }, 0);
    if (!levels.length) {
      return { headline: 'No readings stored', figures: [], notes: [] };
    }
    const head = [plural(levels.length, 'level')];
    head.push(levels.map(function (l) { return l.name + ' ' + l.readings; }).join(', '));
    const date = mostRecent(levels.map(function (l) { return l.surveyDate; })
      .concat([trim(floor.inspectionDate)]));
    if (date) head.push('surveyed ' + readableDate(date));
    const figures = [{ label: 'Readings', value: String(readings) }];
    const drop = maxDrop(levels);
    if (drop) {
      figures.push({
        label: drop.corrected ? 'Biggest fall' : 'Biggest fall (uncorrected)',
        value: inches(drop.drop) + ' in on ' + drop.level,
      });
    }
    const transitions = levels.reduce(function (n, l) { return n + l.transitions; }, 0);
    if (transitions) {
      figures.push({ label: 'Flooring transitions', value: String(transitions) });
    }
    const notes = [];
    const unscaled = levels.filter(function (l) { return !l.hasScale; });
    if (unscaled.length) {
      // Why no distance sits beside the fall. The elevations are real inches;
      // the plan positions have no length until a level's scale is set.
      notes.push('No scale is set on ' + unscaled.map(function (l) { return l.name; }).join(', ') +
        ', so the distance a fall runs over is not stored. The elevations are inches either way.');
    }
    return { headline: head.join(' · '), figures: figures, notes: notes };
  }

  function distressSummary(distress, ctx) {
    if (!isObject(distress)) return null;
    const levels = levelsOf(ctx.plans, ctx.floor);
    const facts = distressFacts(distress, levels);
    if (!facts.photographs && !facts.pins) {
      return { headline: 'No pins or photographs stored', figures: [], notes: [] };
    }
    const head = [];
    if (facts.photographs) head.push(plural(facts.photographs, 'photograph'));
    if (facts.pins) head.push('on ' + plural(facts.pins, 'pin'));
    if (facts.levels.length) head.push('across ' + facts.levels.join(', '));
    if (facts.surveyDate) head.push(readableDate(facts.surveyDate));
    const figures = [];
    if (facts.pins) figures.push({ label: 'Numbered pins', value: String(facts.pins) });
    if (facts.pinPhotos) figures.push({ label: 'Pin photographs', value: String(facts.pinPhotos) });
    if (facts.quick) figures.push({ label: 'Quick Capture', value: String(facts.quick) });
    if (facts.unassigned) figures.push({ label: 'Unassigned', value: String(facts.unassigned) });
    if (facts.general) figures.push({ label: 'General', value: String(facts.general) });
    return { headline: head.join(' · '), figures: figures, notes: [] };
  }

  function reportSummary(report) {
    if (!isObject(report)) return null;
    const pages = Array.isArray(report.pages) ? report.pages.filter(isObject) : [];
    if (!pages.length) {
      return { headline: 'No report pages stored', figures: [], notes: [] };
    }
    const kinds = Object.create(null);
    pages.forEach(function (page) {
      const type = trim(page.type) || 'sheet';
      kinds[type] = (kinds[type] || 0) + 1;
    });
    const head = [plural(pages.length, 'page')];
    const names = Object.keys(kinds).sort();
    if (names.length) {
      head.push(names.map(function (k) { return kinds[k] + ' ' + k; }).join(', '));
    }
    const figures = [{ label: 'Pages', value: String(pages.length) }];
    if (trim(report.updatedAt)) {
      figures.push({ label: 'Last edited', value: readableDate(report.updatedAt) });
    }
    // The report Toolbox can rebuild is this record. A finished PDF is a
    // separate artifact and this is NOT it -- saying otherwise would be the
    // fabricated report the brief forbids.
    return {
      headline: head.join(' · '),
      figures: figures,
      notes: ['This is the report Toolbox can rebuild, not a finished PDF.'],
    };
  }

  function diagnosticsSummary(diagnostics) {
    if (!isObject(diagnostics)) return null;
    const figures = [];
    const entries = Array.isArray(diagnostics.entries) ? diagnostics.entries.filter(isObject) : [];
    if (entries.length) figures.push({ label: 'Entries', value: String(entries.length) });
    const head = entries.length ? plural(entries.length, 'entry', 'entries') : 'Stored, with no entries';
    return { headline: head, figures: figures, notes: [] };
  }

  function trashSummary(trash) {
    if (!isObject(trash)) return null;
    const deleted = trim(trash.deletedAt);
    if (!deleted) {
      return { headline: 'Not in File Cabinet Trash', figures: [], notes: [] };
    }
    const figures = [{ label: 'Moved to Trash', value: readableDate(deleted) }];
    if (trim(trash.purgeAfter)) {
      figures.push({ label: 'Eligible for cleanup', value: readableDate(trash.purgeAfter) });
    }
    return { headline: 'In File Cabinet Trash', figures: figures, notes: [] };
  }

  function indexSummary(index) {
    if (!isObject(index)) return null;
    const figures = [];
    if (trim(index.fieldWorkDate)) {
      figures.push({ label: 'Field work', value: readableDate(index.fieldWorkDate) });
    }
    if (trim(index.createdAt)) {
      figures.push({ label: 'Created', value: readableDate(index.createdAt) });
    }
    const checkout = isObject(index.checkout) ? index.checkout : null;
    if (checkout && trim(checkout.email)) {
      figures.push({ label: 'Checked out by', value: trim(checkout.email) });
    }
    const headline = trim(index.displayName) || trim(index.propertyAddress) || 'Cabinet index';
    return {
      headline: headline,
      figures: figures,
      notes: ['How the Cabinet finds this job. Not a survey and not a document.'],
    };
  }

  function mostRecent(dates) {
    let best = '';
    let bestMs = -Infinity;
    (dates || []).forEach(function (value) {
      const text = trim(value);
      if (!text) return;
      const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T00:00:00Z' : text);
      if (!isFinite(ms)) return;
      if (ms > bestMs) { bestMs = ms; best = text; }
    });
    return best;
  }

  // -------------------------------------------- the figures for one job

  /**
   * What the drawings' details pane carries: levels, readings, pins,
   * photographs, the survey date and the biggest fall. Computed from the
   * survey, never typed, and omitted where the component is not stored.
   */
  function jobFigures(components) {
    const parts = components || {};
    const levels = levelsOf(parts.plans, parts.floor);
    const surveyLevels = levels.filter(function (l) { return l.readings > 0; });
    const readings = levels.reduce(function (n, l) { return n + l.readings; }, 0);
    const facts = distressFacts(parts.distress, levels);
    const figures = [];
    const date = surveyDateOf(parts);
    if (date) figures.push({ label: 'Survey', value: readableDate(date) });
    if (levels.length) figures.push({ label: 'Levels', value: String(levels.length) });
    if (readings) figures.push({ label: 'Readings', value: String(readings) });
    if (facts.pins) figures.push({ label: 'Pins', value: String(facts.pins) });
    if (facts.photographs) figures.push({ label: 'Photographs', value: String(facts.photographs) });
    const drop = maxDrop(surveyLevels);
    if (drop) {
      figures.push({
        label: drop.corrected ? 'Biggest fall' : 'Biggest fall (uncorrected)',
        value: inches(drop.drop) + ' in on ' + drop.level,
      });
    }
    const pages = isObject(parts.report) && Array.isArray(parts.report.pages)
      ? parts.report.pages.length : 0;
    if (pages) figures.push({ label: 'Report pages', value: String(pages) });
    return figures;
  }

  /**
   * The date this job is filed under: the floor survey date, else the distress
   * survey date, and no third fallback (Tim, Oct 18, 2026: "if there is
   * neither, well then we're probably not using this app"). Same rule
   * js/sync.js fieldWorkSurveyDate already applies to the Cabinet index.
   */
  function surveyDateOf(components) {
    const parts = components || {};
    const floor = parts.floor;
    const dates = [];
    if (isObject(floor)) {
      if (trim(floor.inspectionDate)) dates.push(trim(floor.inspectionDate));
      const layers = isObject(floor.byCanvasId) ? floor.byCanvasId : {};
      Object.keys(layers).forEach(function (id) {
        const layer = layers[id];
        if (isObject(layer) && trim(layer.inspectionDate)) dates.push(trim(layer.inspectionDate));
      });
    }
    const floorDate = mostRecent(dates);
    if (floorDate) return floorDate;
    const distress = parts.distress;
    if (isObject(distress)) {
      return trim(distress.inspectionDate) || trim(distress.surveyDate) || '';
    }
    return '';
  }

  // ------------------------------------------------- the archive's own files

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function csvRows(rows) {
    return rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n') + '\r\n';
  }

  /**
   * The readings, as Tim asked: "in the floor survey folder we should have a
   * CSV file of the XY&Z points."
   *
   * Both numbers are carried, because they answer different questions and a
   * dispute years later wants both. `Reading (in)` is what the instrument
   * showed and is what the Customer File stores — raw, untouched, the record
   * of what was measured. `Elevation (in)` is that reading with its flooring
   * transition correction applied, which is the comparable floor the topo
   * draws. The correction that was applied sits between them so the
   * arithmetic is visible rather than asserted.
   *
   * The corrected column comes from Floor Survey's own withCorrectedValues.
   * Where that is not reachable the column is left empty and the header says
   * so — an empty cell is honest, a raw number labelled "corrected" is not.
   *
   * X and Y are plan-image positions against the level's base point, which is
   * a named origin. They are a true layout; only the units of distance are
   * missing until a level's scale is set, and the header says that too.
   */
  function readingsCsv(floor, plans) {
    const levels = levelsOf(plans, floor).filter(function (l) { return l.readings > 0; });
    if (!levels.length) return '';
    const api = (typeof window !== 'undefined' && window.ToolboxFloorSurvey) || null;
    const canCorrect = !!(api && typeof api.withCorrectedValues === 'function');
    const rows = [[
      'Level',
      'Point',
      'Label',
      'X (plan)',
      'Y (plan)',
      'Reading (in)',
      'Correction (in)',
      canCorrect ? 'Elevation (in)' : 'Elevation (in) — not computed',
      'Base point',
      'Transition',
      'Notes',
    ]];
    levels.forEach(function (level) {
      const layer = level.layer || {};
      const raw = Array.isArray(level.points) ? level.points : [];
      let corrected = raw;
      if (canCorrect) {
        try {
          corrected = api.withCorrectedValues(raw, layer.transitions, layer.transitionGroupAverages);
        } catch (_) { corrected = raw; }
      }
      const byId = Object.create(null);
      corrected.forEach(function (p) {
        if (isObject(p) && trim(p.id)) byId[trim(p.id)] = p;
      });
      const ordered = raw.slice().sort(function (a, b) {
        const ai = typeof a.index === 'number' ? a.index : 0;
        const bi = typeof b.index === 'number' ? b.index : 0;
        return ai - bi;
      });
      ordered.forEach(function (point) {
        const fixed = byId[trim(point.id)];
        const elevation = canCorrect && fixed && typeof fixed.value === 'number'
          ? fixed.value : null;
        const correction = elevation !== null && typeof point.value === 'number'
          ? Math.round((elevation - point.value) * 100) / 100
          : null;
        const label = transitionNameFor(point, layer, api);
        rows.push([
          level.name,
          point.index == null ? '' : point.index,
          trim(point.label),
          typeof point.x === 'number' ? point.x : '',
          typeof point.y === 'number' ? point.y : '',
          inches(point.value),
          correction === null ? '' : inches(correction),
          elevation === null ? '' : inches(elevation),
          point.isBasePoint ? 'yes' : '',
          label,
          trim(point.notes),
        ]);
      });
    });
    return csvRows(rows);
  }

  /** The named correction a point sits under, in Floor Survey's own words. */
  function transitionNameFor(point, layer, api) {
    const id = isObject(point) ? trim(point.transitionId) : '';
    if (!id) return '';
    const list = isObject(layer) && Array.isArray(layer.transitions) ? layer.transitions : [];
    let found = null;
    list.forEach(function (t) { if (isObject(t) && trim(t.id) === id) found = t; });
    if (!found) return '';
    if (point.isTransitionAnchor) {
      return 'reference side of ' + (trim(found.surfaceA) || 'transition');
    }
    if (api && typeof api.transitionLabel === 'function') {
      try { return api.transitionLabel(found, layer.transitionGroupAverages); } catch (_) {}
    }
    return trim(found.surfaceB) || 'transition';
  }

  /**
   * The pins as a readable file: number, level, room, the note, and which
   * photographs belong to it. The same material the report's Picture/Damage
   * Locations page carries, and what makes "find the half-inch cracks" work
   * years later without opening Toolbox.
   */
  function pinsCsv(distress, plans, floor) {
    const pins = isObject(distress) && Array.isArray(distress.pins)
      ? distress.pins.filter(isObject) : [];
    if (!pins.length) return '';
    const levels = levelsOf(plans, floor);
    const named = Object.create(null);
    levels.forEach(function (level) { named[level.id] = level.name; });
    const rows = [['Pin', 'Level', 'Room', 'Description', 'Photographs', 'Photograph files']];
    pins.slice().sort(function (a, b) {
      const an = typeof a.num === 'number' ? a.num : 0;
      const bn = typeof b.num === 'number' ? b.num : 0;
      return an - bn;
    }).forEach(function (pin) {
      const photos = Array.isArray(pin.photos) ? pin.photos.filter(function (id) {
        return typeof id === 'string' && id;
      }) : [];
      rows.push([
        pin.num == null ? '' : pin.num,
        named[trim(pin.canvasId)] || '',
        trim(pin.location),
        trim(pin.description),
        photos.length,
        photos.join(' '),
      ]);
    });
    return csvRows(rows);
  }

  /** The customer, as a person reads it. */
  function customerDetailsText(customer, index) {
    const lines = [];
    const source = isObject(customer) ? customer : {};
    const idx = isObject(index) ? index : {};
    const name = [trim(source.firstName), trim(source.lastName)].filter(Boolean).join(' ')
      || trim(idx.displayName);
    if (name) lines.push(name);
    if (trim(source.companyName)) lines.push(trim(source.companyName));
    const address = trim(source.propertyAddress) || trim(idx.propertyAddress);
    if (address) {
      lines.push('');
      lines.push('Property');
      address.split('\n').forEach(function (part) {
        if (trim(part)) lines.push('  ' + trim(part));
      });
    }
    if (!source.mailingSameAsProperty && trim(source.mailingAddress)) {
      lines.push('');
      lines.push('Mailing');
      trim(source.mailingAddress).split('\n').forEach(function (part) {
        if (trim(part)) lines.push('  ' + trim(part));
      });
    }
    const contact = [];
    if (trim(source.cellPhone)) contact.push('Cell    ' + trim(source.cellPhone));
    if (trim(source.homePhone)) contact.push('Home    ' + trim(source.homePhone));
    if (trim(source.email)) contact.push('Email   ' + trim(source.email));
    if (contact.length) {
      lines.push('');
      lines.push('Contact');
      contact.forEach(function (line) { lines.push('  ' + line); });
    }
    const spouse = [];
    if (trim(source.spouseName)) spouse.push(trim(source.spouseName));
    if (trim(source.spouseCellPhone)) spouse.push('Cell    ' + trim(source.spouseCellPhone));
    if (trim(source.spouseHomePhone)) spouse.push('Home    ' + trim(source.spouseHomePhone));
    if (trim(source.spouseEmail)) spouse.push('Email   ' + trim(source.spouseEmail));
    if (spouse.length) {
      lines.push('');
      lines.push('Also');
      spouse.forEach(function (line) { lines.push('  ' + line); });
    }
    if (trim(source.notes)) {
      lines.push('');
      lines.push('Notes');
      trim(source.notes).split('\n').forEach(function (part) { lines.push('  ' + part); });
    }
    if (!lines.length) return '';
    return lines.join('\n') + '\n';
  }

  /**
   * The cover sheet, for a folder opened years from now on a machine that has
   * never heard of Toolbox.
   *
   * It says what the job was, what each file in the folder is, and — the part
   * that matters — what is NOT here. A recovery copy that quietly omits the
   * report reads exactly like a recovery copy that never had one.
   */
  function coverSheet(info) {
    const data = info || {};
    const lines = [];
    const name = trim(data.name) || 'Customer File';
    lines.push(name);
    if (trim(data.address)) lines.push(trim(data.address));
    const date = surveyDateOf(data.components);
    if (date) lines.push('Field work ' + readableDate(date));
    lines.push('');
    lines.push('A copy of one job from the Toolbox File Cabinet, taken ' +
      readableDate(new Date().toISOString()) + '.');
    lines.push('');

    const figures = jobFigures(data.components);
    if (figures.length) {
      lines.push('What the survey records');
      figures.forEach(function (figure) {
        lines.push('  ' + pad(figure.label, 16) + figure.value);
      });
      lines.push('');
    }

    const folders = Array.isArray(data.folders) ? data.folders : [];
    if (folders.length) {
      lines.push('What is in this folder');
      folders.forEach(function (entry) {
        lines.push('  ' + pad(entry.name, 34) + (entry.what || ''));
      });
      lines.push('');
    }

    const missing = Array.isArray(data.missing) ? data.missing.filter(Boolean) : [];
    lines.push('What is NOT in this folder');
    if (missing.length) {
      missing.forEach(function (line) { lines.push('  ' + line); });
    } else {
      lines.push('  Everything the File Cabinet holds for this job is here.');
    }
    lines.push('');

    lines.push('Reading the readings file');
    lines.push('  Reading (in) is what the instrument showed and is what Toolbox');
    lines.push('  stores. Elevation (in) is that reading with its flooring');
    lines.push('  transition correction applied, which is the comparable floor;');
    lines.push('  the correction between them shows the arithmetic. X and Y are');
    lines.push('  positions on the level\'s plan image measured from its base');
    lines.push('  point, so they are a true layout — the shape of the floor and');
    lines.push('  which corner is low. They become distances on the ground only');
    lines.push('  once a level\'s scale is set.');
    lines.push('');
    lines.push('The Technical folder holds the records Toolbox itself writes.');
    lines.push('They are the only thing that could rebuild this job inside');
    lines.push('Toolbox, and they are not meant to be read by a person.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  function pad(text, width) {
    let out = String(text == null ? '' : text);
    while (out.length < width) out += ' ';
    return out;
  }

  /** A folder name a person can read, and a filesystem will accept. */
  function safeName(text, fallback) {
    const cleaned = String(text == null ? '' : text)
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 80)
      .trim();
    return cleaned || (fallback || 'Customer File');
  }

  /**
   * What the copy is called: who it was for, where, and the field work date,
   * so a drive full of them sorts and reads.
   */
  function archiveFolderName(info) {
    const data = info || {};
    const bits = [];
    const name = safeName(data.name, '');
    if (name) bits.push(name);
    const address = safeName(firstLine(data.address), '');
    if (address) bits.push(address);
    const date = fileDate(surveyDateOf(data.components) || data.fallbackDate);
    const stem = bits.join(' - ') || 'Customer File';
    return date ? stem + ' (' + date + ')' : stem;
  }

  function firstLine(text) {
    const parts = String(text == null ? '' : text).split('\n');
    return trim(parts[0]);
  }

  window.ToolboxExplorerSummary = {
    componentSummary: componentSummary,
    jobFigures: jobFigures,
    surveyDateOf: surveyDateOf,
    levelsOf: levelsOf,
    elevationSpread: elevationSpread,
    maxDrop: maxDrop,
    distressFacts: distressFacts,
    readingsCsv: readingsCsv,
    pinsCsv: pinsCsv,
    customerDetailsText: customerDetailsText,
    coverSheet: coverSheet,
    archiveFolderName: archiveFolderName,
    safeName: safeName,
    readableDate: readableDate,
    fileDate: fileDate,
  };
})();
