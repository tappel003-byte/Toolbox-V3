// Toolbox — shared Report Builder source and 11×17 page sequence.
//
// Issue #66 owns page types, order, and the table of contents.
// Issue #65 owns evidence plumbing (pins, photographs, stored topo figures).
//
// read() outlines the open Customer File: identity, one Distress level per
// canvas that already has observations, and Floor Survey topo figure pages
// per epoch/level/boundary (Combined when multiple closed boundaries, then
// each named boundary). Outline metadata only — figure pixels are composed
// later by ToolboxFloorSurvey for fixed Report Builder slots.
//
// #65 should enrich this same document — ToolboxReportEvidence.enrich(source,
// record) — instead of building a second outline. assemble() accepts either
// the outline or that enriched source and turns it into consecutive pages.
//
// Section titles are skeleton slots. The 1515 Los Nietos report is not in
// this repository, so these titles are not a transcription of that file.
// No findings, conclusions, or other narrative are generated.

(function () {
  'use strict';

  var SCHEMA = 'toolbox.report-source';
  var SCHEMA_VERSION = 1;
  var SEQUENCE_SCHEMA = 'toolbox.report-sequence';

  // Typical book after the title page: Discussion, then figures in slide order
  // (Floor Survey → Picture Locations → Pictures). Extra slides the investigator
  // adds also become figures. No separate Contents sheet.
  var DISCUSSION_SECTION = {
    id: 'discussion',
    title: 'Floor Level Survey Results - Discussion',
    note: 'Reserved section. No narrative is written here.',
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function customerName(record) {
    var name = (text(record && record.firstName) + ' ' + text(record && record.lastName)).trim();
    return name || 'New Customer File';
  }

  function propertyAddress(record) {
    var address = text(record && record.propertyAddress);
    if (!address) return '';
    return address.split('\n')[0].trim();
  }

  function propertyAddressFull(record) {
    return text(record && record.propertyAddress);
  }

  function canvasesOf(record) {
    var list = record && record.planSetup && Array.isArray(record.planSetup.canvases)
      ? record.planSetup.canvases
      : [];
    return list.map(function (canvas, index) {
      return {
        id: canvas && canvas.id ? String(canvas.id) : '',
        name: text(canvas && canvas.name) || 'Floor Plan',
        order: index,
        frontDoorFacing: text(canvas && canvas.frontDoorFacing),
      };
    }).filter(function (canvas) { return canvas.id; });
  }

  function canvasInfo(canvases) {
    var info = {};
    canvases.forEach(function (canvas) { info[canvas.id] = canvas; });
    return info;
  }

  function distressPresent(distress) {
    if (!distress || typeof distress !== 'object') return false;
    if (Array.isArray(distress.pins) && distress.pins.length) return true;
    if (Array.isArray(distress.drawings) && distress.drawings.length) return true;
    if (Array.isArray(distress.quickCapture) && distress.quickCapture.length) return true;
    if (Array.isArray(distress.voiceMemos) && distress.voiceMemos.length) return true;
    if (Array.isArray(distress.unassignedPhotos) && distress.unassignedPhotos.length) return true;
    if (Array.isArray(distress.generalPhotos) && distress.generalPhotos.length) return true;
    if (typeof distress.startNum === 'number' && distress.startNum !== 1) return true;
    if (typeof distress.nextNum === 'number' && distress.nextNum !== 1) return true;
    return false;
  }

  function photoCount(pin) {
    return pin && Array.isArray(pin.photos) ? pin.photos.length : 0;
  }

  function distressOutline(record) {
    var distress = record && record.distress;
    if (!distressPresent(distress)) return { status: 'absent', levels: [] };
    var info = canvasInfo(canvasesOf(record));
    var buckets = {};
    (Array.isArray(distress.pins) ? distress.pins : []).forEach(function (pin) {
      var canvasId = pin && typeof pin.canvasId === 'string' && pin.canvasId
        ? pin.canvasId
        : 'unassigned';
      var canvas = info[canvasId];
      if (!buckets[canvasId]) {
        buckets[canvasId] = {
          canvasId: canvasId,
          name: canvas ? canvas.name : (canvasId === 'unassigned' ? 'Unassigned' : canvasId),
          order: canvas ? canvas.order : 10000,
          pinCount: 0,
          photoCount: 0,
          pins: null,
        };
      }
      buckets[canvasId].pinCount += 1;
      buckets[canvasId].photoCount += photoCount(pin);
    });
    var levels = Object.keys(buckets).map(function (key) { return buckets[key]; });
    levels.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return { status: 'present', levels: levels };
  }

  function layerHasWork(layer) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return false;
    if (text(layer.recoveryPdfMediaId)) return true;
    if (Array.isArray(layer.points) && layer.points.length) return true;
    if (Array.isArray(layer.boundary) && layer.boundary.length) return true;
    if (Array.isArray(layer.areas) && layer.areas.length) return true;
    if (Array.isArray(layer.notes) && layer.notes.length) return true;
    if (Array.isArray(layer.transitions) && layer.transitions.length) return true;
    if (Array.isArray(layer.exclusions) && layer.exclusions.length) return true;
    if (layer.transitionGroupAverages && typeof layer.transitionGroupAverages === 'object' &&
        Object.keys(layer.transitionGroupAverages).length) return true;
    if (layer.scale) return true;
    if (layer.bp1Gps) return true;
    if (layer.planTransform) return true;
    return false;
  }

  function floorRootPresent(floor) {
    if (!floor || typeof floor !== 'object') return false;
    if (text(floor.inspectionDate) || text(floor.surveyNotes)) return true;
    if (Array.isArray(floor.customSurfaces) && floor.customSurfaces.length) return true;
    if (floor.lastExportedAt) return true;
    return false;
  }

  function closedAreasOf(layer) {
    var areas = layer && Array.isArray(layer.areas) ? layer.areas : [];
    var closed = areas.filter(function (area) {
      return area && Array.isArray(area.polygon) && area.polygon.length >= 3;
    });
    if (closed.length) return closed;
    var boundary = layer && Array.isArray(layer.boundary) ? layer.boundary : [];
    if (boundary.length >= 3) {
      return [{ id: 'legacy', name: 'Boundary 1', polygon: boundary }];
    }
    return [];
  }

  function frontDoorFacingOf(canvas) {
    var raw = canvas && typeof canvas.frontDoorFacing === 'string' ? canvas.frontDoorFacing.trim() : '';
    var map = {
      N: 'North', S: 'South', E: 'East', W: 'West',
      NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
    };
    var key = raw.toUpperCase();
    return map[key] || raw;
  }

  function figuresFromMap(byCanvasId, epoch, info) {
    var map = byCanvasId && typeof byCanvasId === 'object' && !Array.isArray(byCanvasId) ? byCanvasId : {};
    var canvasIds = Object.keys(map).filter(function (canvasId) {
      return layerHasWork(map[canvasId]);
    }).sort(function (a, b) {
      var canvasA = info[a];
      var canvasB = info[b];
      var orderA = canvasA ? canvasA.order : 10000;
      var orderB = canvasB ? canvasB.order : 10000;
      if (orderA !== orderB) return orderA - orderB;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var figures = [];
    canvasIds.forEach(function (canvasId) {
      var layer = map[canvasId] || {};
      var canvas = info[canvasId];
      var levelName = canvas ? canvas.name : (text(layer.name) || canvasId);
      var order = canvas ? canvas.order : 10000;
      var closed = closedAreasOf(layer);
      var readingCount = Array.isArray(layer.points) ? layer.points.length : 0;
      var figureMediaId = text(layer.recoveryPdfMediaId) || null;
      var facing = frontDoorFacingOf(canvas);
      var base = {
        epochId: epoch.id,
        epochLabel: epoch.label,
        surveyDate: epoch.surveyDate,
        canvasId: canvasId,
        levelName: levelName,
        order: order,
        figureMediaId: figureMediaId,
        readingCount: readingCount,
        areaCount: closed.length,
        frontDoorFacing: facing,
        compose: true,
      };
      if (closed.length >= 2) {
        figures.push(Object.assign({}, base, {
          id: epoch.id + '::' + canvasId + '::all',
          name: 'Combined',
          scope: 'all',
          areaId: null,
        }));
        closed.forEach(function (area) {
          var areaName = text(area.name) || 'Boundary';
          figures.push(Object.assign({}, base, {
            id: epoch.id + '::' + canvasId + '::' + (area.id || areaName),
            name: areaName,
            scope: 'area',
            areaId: area.id || null,
          }));
        });
      } else if (closed.length === 1) {
        var only = closed[0];
        var onlyName = text(only.name) || levelName;
        figures.push(Object.assign({}, base, {
          id: epoch.id + '::' + canvasId + '::' + (only.id || 'area'),
          name: onlyName,
          scope: 'area',
          areaId: only.id || null,
        }));
      } else {
        figures.push(Object.assign({}, base, {
          id: epoch.id + '::' + canvasId,
          name: levelName,
          scope: 'all',
          areaId: null,
          compose: !!readingCount,
        }));
      }
    });
    return figures;
  }

  function floorOutline(record) {
    var floor = record && record.floorSurvey;
    var info = canvasInfo(canvasesOf(record));
    var figures = [];
    if (floor && typeof floor === 'object') {
      var currentLevels = figuresFromMap(floor.byCanvasId, {
        id: floor.id || 'current',
        label: 'Current Floor Survey',
        surveyDate: text(floor.inspectionDate),
      }, info);
      figures = figures.concat(currentLevels);
      ['epochs', 'sessions', 'surveys'].forEach(function (group) {
        var list = floor[group];
        if (!Array.isArray(list)) return;
        list.forEach(function (entry, index) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
          var epoch = {
            id: entry.id || (group + '-' + (index + 1)),
            label: text(entry.label) || text(entry.name) || ('Survey ' + (index + 1)),
            surveyDate: text(entry.inspectionDate) || text(entry.surveyDate),
          };
          var by = entry.byCanvasId && typeof entry.byCanvasId === 'object' ? entry.byCanvasId : null;
          if (by) {
            figures = figures.concat(figuresFromMap(by, epoch, info));
          } else if (layerHasWork(entry)) {
            var canvasId = entry.canvasId || entry.id || ('level-' + (index + 1));
            figures = figures.concat(figuresFromMap(
              (function () { var map = {}; map[canvasId] = entry; return map; })(),
              epoch,
              info
            ));
          }
        });
      });
    }
    var present = figures.length > 0 || floorRootPresent(floor);
    return {
      status: present ? 'present' : 'absent',
      figures: figures,
    };
  }

  function diagnosticsOutline(record) {
    var raw = record && record.diagnostics;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { status: 'absent', figures: [] };
    }
    var figures = [];
    if (Array.isArray(raw.figures)) {
      raw.figures.forEach(function (figure, index) {
        if (!figure || typeof figure !== 'object') return;
        figures.push({
          id: figure.id || ('diagnostics-' + (index + 1)),
          title: text(figure.title) || ('Diagnostics ' + (index + 1)),
        });
      });
    }
    var extra = Object.keys(raw).some(function (key) {
      return key !== 'id' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'figures';
    });
    return {
      status: figures.length || extra ? 'present' : 'absent',
      figures: figures,
    };
  }

  function outline(record) {
    record = record && typeof record === 'object' ? record : {};
    var floor = record.floorSurvey && typeof record.floorSurvey === 'object' ? record.floorSurvey : {};
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      customerFileId: record.id || '',
      customerName: customerName(record),
      propertyAddress: propertyAddress(record),
      floorSurveyDate: text(floor.inspectionDate),
      customer: {
        name: customerName(record),
        address: propertyAddress(record),
        addressFull: propertyAddressFull(record),
        companyName: text(record.companyName),
        cellPhone: text(record.cellPhone),
        email: text(record.email),
      },
      distress: distressOutline(record),
      floor: floorOutline(record),
      diagnostics: diagnosticsOutline(record),
    };
  }

  function read(record) {
    var source = outline(record);
    var evidence = typeof window !== 'undefined' ? window.ToolboxReportEvidence : null;
    if (evidence && typeof evidence.enrich === 'function') {
      try {
        var enriched = evidence.enrich(source, record);
        if (enriched && enriched.schema === SCHEMA && enriched.schemaVersion === SCHEMA_VERSION) {
          return enriched;
        }
      } catch (err) {
        return source;
      }
    }
    return source;
  }

  function page(fields) {
    return {
      id: fields.id,
      type: fields.type,
      title: fields.title,
      tocTitle: fields.tocTitle || fields.title,
      railLabel: fields.railLabel || fields.title,
      note: fields.note || '',
      sourceKey: fields.sourceKey || null,
      sourceRef: fields.sourceRef || null,
      includeInToc: fields.includeInToc !== false,
      meta: fields.meta || null,
    };
  }

  function distressPages(source) {
    var block = source.distress || { status: 'absent', levels: [] };
    var levels = Array.isArray(block.levels) ? block.levels : [];
    if (!levels.length) {
      return [page({
        id: 'distress-reserved',
        type: 'distress',
        title: 'Distress Survey',
        railLabel: 'Distress Survey',
        sourceKey: 'distress',
        note: block.status === 'present'
          ? 'Distress Survey is stored. No level outline is available yet.'
          : 'No Distress Survey is stored on this Customer File.',
        meta: { reserved: true, pinCount: 0, photoCount: 0 },
      })];
    }
    var withPins = levels.filter(function (level) {
      return (level.pinCount || 0) > 0;
    });
    var multi = withPins.length > 1;
    return withPins.map(function (level) {
      var name = text(level.name) || 'Level';
      var toc = multi ? ('Picture Locations — ' + name) : 'Picture Locations';
      return page({
        id: 'distress-' + (level.canvasId || name),
        type: 'distress',
        title: 'Picture/Damage Locations — ' + name,
        tocTitle: toc,
        railLabel: 'Picture Locations · ' + name,
        sourceKey: 'distress',
        sourceRef: level.canvasId || null,
        note: '',
        meta: {
          reserved: false,
          penLog: true,
          pinCount: level.pinCount || 0,
          photoCount: level.photoCount || 0,
          levelName: name,
        },
      });
    });
  }

  function floorPages(source) {
    var block = source.floor || { status: 'absent', figures: [] };
    var figures = Array.isArray(block.figures) ? block.figures : [];
    if (!figures.length) {
      return [page({
        id: 'floor-reserved',
        type: 'floor',
        title: 'Floor Survey',
        railLabel: 'Floor Survey',
        sourceKey: 'floor',
        note: block.status === 'present'
          ? 'Floor Survey is stored. No topo figure is outlined yet.'
          : 'No Floor Survey is stored on this Customer File.',
        meta: { reserved: true, readingCount: 0, areaCount: 0, figureMediaId: null },
      })];
    }
    var epochIds = {};
    figures.forEach(function (figure) { if (figure && figure.epochId) epochIds[figure.epochId] = true; });
    var severalEpochs = Object.keys(epochIds).length > 1;
    return figures.map(function (figure) {
      var scopeTitle = text(figure.name) || 'Level';
      var levelName = text(figure.levelName) || scopeTitle;
      var epochLabel = text(figure.epochLabel);
      var sheetTitle = 'Floor Level Survey — ' + scopeTitle;
      if (severalEpochs && epochLabel) sheetTitle += ' — ' + epochLabel;
      var rail = scopeTitle;
      if (levelName && levelName !== scopeTitle && figure.scope === 'all' && scopeTitle === 'Combined') {
        rail = levelName + ' · Combined';
      } else if (levelName && figure.scope === 'area' && scopeTitle !== levelName) {
        rail = scopeTitle;
      }
      return page({
        id: 'floor-' + (figure.id || scopeTitle),
        type: 'floor',
        title: sheetTitle,
        tocTitle: sheetTitle,
        railLabel: 'Floor · ' + rail,
        sourceKey: 'floor',
        sourceRef: figure.id || figure.canvasId || null,
        note: figure.compose
          ? 'Composed topo figure with fixed report chrome.'
          : (figure.figureMediaId
            ? 'The stored topo figure for this survey is the evidence on this sheet.'
            : 'Topo figure reserved. Readings are not redrawn on this sheet.'),
        meta: {
          reserved: false,
          levelName: levelName,
          scopeTitle: scopeTitle,
          scope: figure.scope || 'all',
          areaId: figure.areaId || null,
          epochLabel: epochLabel,
          canvasId: figure.canvasId || null,
          epochId: figure.epochId || null,
          surveyDate: text(figure.surveyDate),
          readingCount: figure.readingCount || 0,
          areaCount: figure.areaCount || 0,
          figureMediaId: figure.figureMediaId || null,
          frontDoorFacing: text(figure.frontDoorFacing),
          compose: !!figure.compose,
        },
      });
    });
  }

  function diagnosticsPages(source) {
    var block = source.diagnostics || { status: 'absent', figures: [] };
    var figures = Array.isArray(block.figures) ? block.figures : [];
    if (!figures.length) {
      return [page({
        id: 'diagnostics-reserved',
        type: 'diagnostics',
        title: 'Diagnostics',
        railLabel: 'Diagnostics',
        sourceKey: 'diagnostics',
        note: block.status === 'present'
          ? 'Diagnostics output is stored. No figure is outlined yet.'
          : 'No Diagnostics output is stored on this Customer File.',
        meta: { reserved: true },
      })];
    }
    return figures.map(function (figure, index) {
      var title = text(figure.title) || ('Diagnostics ' + (index + 1));
      return page({
        id: 'diagnostics-' + (figure.id || (index + 1)),
        type: 'diagnostics',
        title: title,
        tocTitle: title.indexOf('Diagnostics') === 0 ? title : ('Diagnostics — ' + title),
        railLabel: 'Diagnostics · ' + title,
        sourceKey: 'diagnostics',
        sourceRef: figure.id || null,
        note: 'Reserved for Diagnostics output. No interpretation is written here.',
        meta: { reserved: false },
      });
    });
  }

  function sectionPage(section) {
    return page({
      id: 'section-' + section.id,
      type: 'section',
      title: section.title,
      railLabel: section.title,
      note: section.note,
      sourceKey: null,
      meta: { sectionId: section.id },
    });
  }

  function isDiscussionPage(item) {
    return !!(item && item.type === 'section' && item.meta && item.meta.sectionId === 'discussion');
  }

  /** Cover excluded. Discussion is listed but not a figure. Everything after Discussion is Figure N by slide order. */
  function assignFigureNumbers(pages) {
    var figureNumber = 0;
    (pages || []).forEach(function (item) {
      if (!item || item.type === 'cover' || item.type === 'toc') {
        if (item) item.includeInToc = false;
        return;
      }
      if (!item.meta || typeof item.meta !== 'object') item.meta = {};
      if (isDiscussionPage(item)) {
        item.includeInToc = true;
        item.title = DISCUSSION_SECTION.title;
        item.tocTitle = DISCUSSION_SECTION.title;
        item.railLabel = 'Discussion';
        item.meta.figureNumber = null;
        return;
      }
      figureNumber += 1;
      item.includeInToc = true;
      item.meta.figureNumber = figureNumber;
      if (item.type === 'pictures' && !item.tocTitle) {
        item.tocTitle = 'Pictures';
      }
    });
    return pages;
  }

  /**
   * Force typical book order for CONTENTS / figures, including older saved reports:
   * Cover → Discussion → Floor → Picture Locations → Pictures → anything else.
   */
  function normalizeBookOrder(pages, discussionTemplate) {
    var cover = [];
    var discussion = [];
    var floor = [];
    var distress = [];
    var pictures = [];
    var other = [];
    (pages || []).forEach(function (item) {
      if (!item || item.type === 'toc') return;
      if (item.type === 'cover') {
        cover.push(item);
        return;
      }
      if (isDiscussionPage(item)) {
        discussion.push(item);
        return;
      }
      if (item.type === 'floor') {
        floor.push(item);
        return;
      }
      if (item.type === 'distress') {
        distress.push(item);
        return;
      }
      if (item.type === 'pictures') {
        pictures.push(item);
        return;
      }
      other.push(item);
    });
    if (!cover.length) {
      cover.push(page({
        id: 'cover',
        type: 'cover',
        title: 'Customer File',
        railLabel: 'Cover',
        includeInToc: false,
        meta: {},
      }));
    }
    if (!discussion.length) {
      discussion.push(discussionTemplate || sectionPage(DISCUSSION_SECTION));
    }
    return assignFigureNumbers(cover.concat(discussion, floor, distress, pictures, other));
  }

  function assemble(source) {
    var src = source && source.schema === SCHEMA ? source : outline(null);
    var pages = [
      page({
        id: 'cover',
        type: 'cover',
        title: src.customerName || 'Customer File',
        railLabel: 'Cover',
        includeInToc: false,
        note: 'Assembled from this Customer File.',
        meta: {
          customerName: src.customerName || '',
          address: src.propertyAddress || '',
          addressFull: (src.customer && src.customer.addressFull) || src.propertyAddress || '',
          email: (src.customer && src.customer.email) || '',
          cellPhone: (src.customer && src.customer.cellPhone) || '',
          floorSurveyDate: src.floorSurveyDate || '',
        },
      }),
      sectionPage(DISCUSSION_SECTION),
    ];
    // Typical figure order: Floor Survey, then Picture Locations. Pictures drop in via Put on report.
    floorPages(src).forEach(function (item) { pages.push(item); });
    distressPages(src).forEach(function (item) {
      if (item && item.meta && item.meta.reserved) return;
      pages.push(item);
    });
    return {
      schema: SEQUENCE_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      pages: normalizeBookOrder(pages),
    };
  }

  function contents(pages) {
    var entries = [];
    (pages || []).forEach(function (item) {
      if (!item || item.includeInToc === false || item.type === 'cover' || item.type === 'toc') return;
      // A discussion that runs onto a second sheet is the same entry in the
      // contents, not a new one.
      if (item.meta && item.meta.continuation) return;
      var fig = item.meta && item.meta.figureNumber;
      entries.push({
        pageId: item.id,
        number: typeof fig === 'number' ? fig : null,
        title: item.tocTitle || item.title || 'Page',
        type: item.type || 'sheet',
        isDiscussion: isDiscussionPage(item),
        figureNumber: typeof fig === 'number' ? fig : null,
      });
    });
    return entries;
  }

  var api = {
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    read: read,
    assemble: assemble,
    contents: contents,
    assignFigureNumbers: assignFigureNumbers,
    normalizeBookOrder: normalizeBookOrder,
  };

  if (typeof window !== 'undefined') window.ToolboxReportSource = api;
  if (typeof globalThis !== 'undefined') globalThis.ToolboxReportSource = api;
})();
