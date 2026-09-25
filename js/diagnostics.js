// Toolbox — Diagnostics capture boundary.
//
// Report Builder reads figures from the open Customer File.
// This module stores the selected Diagnostics view and reserves blank figure
// space on an 11×17 landscape Diagnostics sheet. It does not assemble
// a page, write a caption, or write a conclusion.
//
// Floor Survey readings are inches. That unit is the survey contract
// (SurveyPoint.value, the Review inch mark, and rawReadingInches). There is
// no second unit in the source, and the capture default of 9.0 is not a
// datum unless a base point with that value is stored.
//
// Floor Survey and Distress stay untouched. Opening Diagnostics does not call
// addFigure. Only an explicit Add to Report does.

(function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var MEDIA_PREFIX = 'dxfig_';
  var SHEET = '11x17-landscape';
  var SECTION = 'diagnostics';

  function reservedPlacement() {
    return {
      sheet: SHEET,
      section: SECTION,
      region: 'figure',
      // Fraction of the sheet. Margins and the lower band stay blank so
      // Report Builder can place the figure without inventing wording.
      box: { x: 0.06, y: 0.12, width: 0.88, height: 0.58 },
      narrative: null,
      caption: null,
    };
  }

  function newId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + window.crypto.randomUUID();
    }
    return prefix + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function isPngDataUrl(value) {
    return typeof value === 'string' && value.indexOf('data:image/png') === 0 && value.length > 32;
  }

  var SCALE_NOTICE = 'Vertical exaggeration. Visualization is not to scale.';
  var EVIDENCE_MESSAGE = 'Measured readings are evidence. This view does not infer heave, settlement, cause, or repair.';

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function roundHundredth(value) {
    return Math.round(value * 100) / 100;
  }

  function formatInches(value) {
    return roundHundredth(value).toFixed(2) + ' in';
  }

  function pointInPolygon(px, py, poly) {
    if (!poly || poly.length < 3) return false;
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x;
      var yi = poly[i].y;
      var xj = poly[j].x;
      var yj = poly[j].y;
      var intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function exclusionPolygon(exclusion) {
    if (!exclusion) return null;
    if (Array.isArray(exclusion)) return exclusion.length >= 3 ? exclusion : null;
    if (Array.isArray(exclusion.polygon) && exclusion.polygon.length >= 3) return exclusion.polygon;
    return null;
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  // High/low use the same readings the 3D surface uses: corrected values,
  // inside the boundary, and outside exclusion polygons. A stored base point
  // is the only reference. Nothing here writes back to the points.
  function summarizeReadings(input) {
    input = input || {};
    var levelName = typeof input.levelName === 'string' && input.levelName.trim()
      ? input.levelName.trim()
      : 'Level';
    var surveyDate = typeof input.surveyDate === 'string' ? input.surveyDate.trim() : '';
    var boundary = Array.isArray(input.boundary) ? input.boundary : [];
    var hasBoundary = boundary.length >= 3;
    var exclusionPolys = (Array.isArray(input.exclusions) ? input.exclusions : [])
      .map(exclusionPolygon)
      .filter(Boolean);
    var points = Array.isArray(input.points) ? input.points : [];
    var usable = [];
    var excludedPointCount = 0;
    var outsideBoundaryCount = 0;
    var correctedPointCount = 0;
    var references = [];

    points.forEach(function (point) {
      if (!point || typeof point !== 'object') return;
      var raw = finiteNumber(point.rawValue) ? point.rawValue : (finiteNumber(point.value) ? point.value : null);
      var corrected = finiteNumber(point.value) ? point.value : raw;
      if (point.isBasePoint === true && raw != null) {
        var label = typeof point.label === 'string' && point.label.trim() ? point.label.trim() : 'BP';
        references.push({ label: label, value: roundHundredth(raw), unit: 'in' });
      }
      if (corrected == null) return;
      var insideExclusion = exclusionPolys.some(function (poly) {
        return pointInPolygon(point.x, point.y, poly);
      });
      if (insideExclusion) {
        excludedPointCount += 1;
        return;
      }
      if (hasBoundary && !pointInPolygon(point.x, point.y, boundary)) {
        outsideBoundaryCount += 1;
        return;
      }
      if (raw != null && roundHundredth(raw) !== roundHundredth(corrected)) correctedPointCount += 1;
      usable.push(corrected);
    });

    var high = null;
    var low = null;
    var range = null;
    var unit = null;
    if (usable.length) {
      high = usable[0];
      low = usable[0];
      for (var i = 1; i < usable.length; i += 1) {
        if (usable[i] > high) high = usable[i];
        if (usable[i] < low) low = usable[i];
      }
      high = roundHundredth(high);
      low = roundHundredth(low);
      range = roundHundredth(high - low);
      unit = 'in';
    }

    var surface = 'ready';
    var surfaceMessage = null;
    if (!hasBoundary && usable.length < 3) {
      surface = 'missing-boundary';
      surfaceMessage = 'Boundary is missing. Too few survey points for a surface.';
    } else if (!hasBoundary) {
      surface = 'missing-boundary';
      surfaceMessage = 'Boundary is missing. No surface.';
    } else if (usable.length < 3) {
      surface = 'too-few-points';
      surfaceMessage = 'Too few survey points for a surface.';
    }

    var referenceMessage = 'No base-point reference recorded.';
    if (references.length === 1) {
      referenceMessage = 'Base point ' + references[0].label + ' ' + formatInches(references[0].value);
    } else if (references.length > 1) {
      referenceMessage = 'Base points ' + references.map(function (ref) {
        return ref.label + ' ' + formatInches(ref.value);
      }).join(' · ');
    }

    return {
      levelName: levelName,
      surveyDate: surveyDate || null,
      usablePointCount: usable.length,
      excludedPointCount: excludedPointCount,
      outsideBoundaryCount: outsideBoundaryCount,
      correctedPointCount: correctedPointCount,
      surface: surface,
      surfaceMessage: surfaceMessage,
      high: high,
      low: low,
      range: range,
      unit: unit,
      reference: references.length ? references : null,
      referenceMessage: referenceMessage,
      readingsMessage: unit
        ? (correctedPointCount > 0
          ? 'High and low include flooring corrections.'
          : 'High and low are measured readings.')
        : null,
      scaleNotice: SCALE_NOTICE,
      evidenceMessage: EVIDENCE_MESSAGE,
    };
  }

  function contextLines(summary, exaggeration) {
    summary = summary || {};
    var lines = [];
    lines.push(summary.levelName || 'Level');
    lines.push(summary.surveyDate ? ('Survey date ' + summary.surveyDate) : 'Survey date not recorded');
    lines.push(plural(summary.usablePointCount || 0, 'usable survey point', 'usable survey points'));
    if (summary.excludedPointCount) {
      lines.push(plural(summary.excludedPointCount, 'excluded reading', 'excluded readings'));
    }
    if (summary.outsideBoundaryCount) {
      lines.push(plural(summary.outsideBoundaryCount, 'reading outside the boundary', 'readings outside the boundary'));
    }
    if (summary.surfaceMessage) lines.push(summary.surfaceMessage);
    if (summary.unit === 'in' && summary.high != null && summary.low != null) {
      lines.push(
        'High ' + formatInches(summary.high) +
        ' · Low ' + formatInches(summary.low) +
        ' · Range ' + formatInches(summary.range)
      );
      if (summary.readingsMessage) lines.push(summary.readingsMessage);
    }
    if (summary.referenceMessage) lines.push(summary.referenceMessage);
    var factor = Number(exaggeration);
    if (isFinite(factor)) lines.push('Vertical exaggeration ' + factor.toFixed(1) + '×');
    lines.push(summary.scaleNotice || SCALE_NOTICE);
    lines.push(summary.evidenceMessage || EVIDENCE_MESSAGE);
    return lines;
  }

  function captureContext(summary, extras) {
    extras = extras || {};
    summary = summary || {};
    var factor = Number(extras.exaggeration);
    var exaggeration = isFinite(factor) ? Math.round(factor * 10) / 10 : null;
    return {
      levelName: summary.levelName || '',
      canvasId: extras.canvasId || '',
      surveyDate: summary.surveyDate || null,
      usablePointCount: summary.usablePointCount || 0,
      excludedPointCount: summary.excludedPointCount || 0,
      outsideBoundaryCount: summary.outsideBoundaryCount || 0,
      correctedPointCount: summary.correctedPointCount || 0,
      surface: summary.surface || '',
      surfaceMessage: summary.surfaceMessage || null,
      high: summary.high == null ? null : summary.high,
      low: summary.low == null ? null : summary.low,
      range: summary.range == null ? null : summary.range,
      unit: summary.unit || null,
      reference: summary.reference || null,
      referenceMessage: summary.referenceMessage || '',
      readingsMessage: summary.readingsMessage || null,
      exaggeration: exaggeration,
      palette: extras.palette || '',
      reversePalette: !!extras.reversePalette,
      legendLow: summary.surface === 'ready' ? summary.low : null,
      legendHigh: summary.surface === 'ready' ? summary.high : null,
      legendColors: Array.isArray(extras.legendColors) ? extras.legendColors.slice() : [],
      scaleNotice: summary.scaleNotice || SCALE_NOTICE,
      evidenceMessage: summary.evidenceMessage || EVIDENCE_MESSAGE,
      lines: contextLines(summary, exaggeration),
    };
  }

  function cloneContext(value) {
    if (!value || typeof value !== 'object') return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return null;
    }
  }

  function figureList(source) {
    var diagnostics = source && Array.isArray(source.figures)
      ? source
      : (source && source.diagnostics && typeof source.diagnostics === 'object' ? source.diagnostics : null);
    var figures = diagnostics && Array.isArray(diagnostics.figures) ? diagnostics.figures : [];
    return figures.filter(function (fig) {
      return fig && typeof fig === 'object' && typeof fig.id === 'string' && typeof fig.mediaId === 'string';
    });
  }

  function figureMediaIds(source) {
    var ids = [];
    figureList(source).forEach(function (fig) {
      if (fig.mediaId.indexOf(MEDIA_PREFIX) === 0) ids.push(fig.mediaId);
    });
    return ids;
  }

  function listReportFigures(record) {
    return figureList(record).map(function (fig) {
      var placement = fig.reportPlacement && typeof fig.reportPlacement === 'object'
        ? fig.reportPlacement
        : reservedPlacement();
      return {
        id: fig.id,
        sequence: fig.sequence,
        kind: fig.kind || '3d-elevation',
        createdAt: fig.createdAt || '',
        canvasId: fig.canvasId || '',
        canvasName: fig.canvasName || '',
        mediaId: fig.mediaId,
        mimeType: fig.mimeType || 'image/png',
        reportPlacement: placement,
        source: fig.source || null,
        context: fig.context && typeof fig.context === 'object' ? fig.context : null,
      };
    });
  }

  function addFigure(options) {
    options = options || {};
    var customerFileId = options.customerFileId;
    if (!customerFileId) return Promise.reject(new Error('Customer File is missing.'));
    if (!isPngDataUrl(options.dataUrl)) {
      return Promise.reject(new Error('This view could not be captured.'));
    }
    if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function') {
      return Promise.reject(new Error('Add to Report is not available in this session.'));
    }
    return window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (!record || record.deletedAt) {
        throw new Error('Customer File is not on this device.');
      }
      var mediaId = newId(MEDIA_PREFIX);
      return window.ToolboxDB.putMedia(mediaId, options.dataUrl).then(function () {
        return window.ToolboxDB.getCustomerFile(customerFileId);
      }).then(function (fresh) {
        var current = fresh || record;
        var existing = current.diagnostics && typeof current.diagnostics === 'object' ? current.diagnostics : {};
        var figures = Array.isArray(existing.figures) ? existing.figures.slice() : [];
        var now = new Date().toISOString();
        var figure = {
          id: newId('dxf_'),
          sequence: figures.length + 1,
          kind: '3d-elevation',
          createdAt: now,
          canvasId: options.canvasId || '',
          canvasName: options.canvasName || '',
          mediaId: mediaId,
          mimeType: 'image/png',
          source: {
            workspace: 'diagnostics',
            engine: 'floor-survey-3d',
            customerFileId: customerFileId,
          },
          reportPlacement: reservedPlacement(),
          context: cloneContext(options.context),
        };
        figures.push(figure);
        var next = {};
        Object.keys(existing).forEach(function (key) {
          next[key] = existing[key];
        });
        next.schemaVersion = SCHEMA_VERSION;
        next.updatedAt = now;
        next.figures = figures;
        current.diagnostics = next;
        current.updatedAt = now;
        return window.ToolboxDB.saveCustomerFile(current).then(function () {
          return { figure: figure, diagnostics: next };
        });
      });
    });
  }

  window.ToolboxDiagnostics = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MEDIA_PREFIX: MEDIA_PREFIX,
    reservedPlacement: reservedPlacement,
    listReportFigures: listReportFigures,
    figureMediaIds: figureMediaIds,
    addFigure: addFigure,
    summarizeReadings: summarizeReadings,
    contextLines: contextLines,
    captureContext: captureContext,
    formatInches: formatInches,
  };
})();
