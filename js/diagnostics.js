// Toolbox — Diagnostics capture boundary.
//
// Report Builder (#65 / #66) reads figures from the open Customer File.
// This module stores the selected Diagnostics view and reserves blank figure
// space on a future 11×17 landscape Diagnostics sheet. It does not assemble
// a page, write a caption, or write a conclusion.
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
  };
})();
