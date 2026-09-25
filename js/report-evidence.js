// Toolbox — read-only Report Builder evidence payloads.
//
// Read-only. This module does not save the Customer File, does not sync,
// and does not edit Distress or Floor Survey.
//
// Contract for the report skeleton (issue #66): call assemble(record, deps).
// Consume pages in order. Do not read pins or floor points to draw a second
// figure. Distress levels stay one page each, in canvas order, with the
// continuous photograph sequence. Floor pages are stored renderings only.
// readingsRebuilt is always false. Keep separate epochs, levels, and stored
// area renderings as consecutive pages.
//
// Diagnostics capture pages are not produced here (issue #67). Page kinds
// this module emits: distress-level, floor-topo.

(function () {
  'use strict';

  var SOURCE_VERSION = 1;
  var DISTRESS_MEDIA_DB = 'pgg_photos_v1';
  var DISTRESS_MEDIA_STORE = 'photos';
  var NUMBERING_NOTE = 'Distress photograph numbers are one sequence across all levels. A pin number is the first photograph on that pin. Further photographs on the pin take the following numbers. Removing a photograph closes the gap. A level change does not restart the sequence.';
  var FLOOR_MISSING_NOTE = 'The finished Floor Survey rendering is not stored for this level. Readings were not redrawn here.';
  var LAYER_FIGURE_KEYS = ['recoveryPdfMediaId', 'figureMediaId', 'topoFigureMediaId', 'renderedFigureMediaId'];
  var AREA_FIGURE_KEYS = ['figureMediaId', 'recoveryPdfMediaId', 'renderedFigureMediaId', 'topoFigureMediaId'];

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function displayName(record) {
    var api = window.ToolboxApp && window.ToolboxApp.customerIdentity;
    if (api && typeof api.displayName === 'function') return api.displayName(record);
    var name = ((record && record.firstName) || '') + ' ' + ((record && record.lastName) || '');
    return name.trim() || 'Customer File';
  }

  function displayAddress(record) {
    var api = window.ToolboxApp && window.ToolboxApp.customerIdentity;
    if (api && typeof api.displayAddress === 'function') {
      var shown = api.displayAddress(record);
      if (!shown || shown === 'No property address yet') return '';
      return shown;
    }
    var addr = trim(record && record.propertyAddress);
    if (!addr) return '';
    return addr.split('\n')[0].trim();
  }

  function dateOnly(value) {
    var text = trim(value);
    if (!text) return '';
    var day = text.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : text;
  }

  function identityFrom(record) {
    return {
      customerFileId: record && record.id || '',
      name: displayName(record || {}),
      address: displayAddress(record || {}),
      companyName: trim(record && record.companyName),
      createdAt: record && record.createdAt || '',
      updatedAt: record && record.updatedAt || '',
      fileDate: dateOnly(record && (record.updatedAt || record.createdAt)),
    };
  }

  function canvasesOf(record) {
    var list = record && record.planSetup && Array.isArray(record.planSetup.canvases)
      ? record.planSetup.canvases
      : [];
    return list.filter(function (canvas) { return canvas && canvas.id; });
  }

  function canvasOrder(canvases) {
    var order = {};
    canvases.forEach(function (canvas, index) { order[canvas.id] = index; });
    return order;
  }

  function photoRef(entry) {
    if (typeof entry === 'string') {
      if (entry.indexOf('data:') === 0) return { id: null, inline: entry };
      return { id: entry, inline: null };
    }
    if (entry && typeof entry === 'object') {
      var inline = typeof entry.dataUrl === 'string' ? entry.dataUrl : (typeof entry.inline === 'string' ? entry.inline : null);
      var id = typeof entry.id === 'string' ? entry.id : null;
      if (id && id.indexOf('data:') === 0) return { id: null, inline: id };
      return { id: id, inline: inline };
    }
    return { id: null, inline: null };
  }

  function assignPinNumbers(pins, mode, startNum) {
    var external = mode === 'external';
    var n = typeof startNum === 'number' && isFinite(startNum) ? startNum : 1;
    return (pins || []).map(function (pin) {
      var photoCount = pin && Array.isArray(pin.photos) ? pin.photos.length : 0;
      var take = external ? Math.max(1, (pin && pin.extPhotoCount) || 0) : Math.max(1, photoCount);
      var num = n;
      var photoNumbers = [];
      for (var i = 0; i < photoCount; i += 1) photoNumbers.push(num + i);
      n += take;
      return { num: num, end: num + take - 1, photoNumbers: photoNumbers };
    });
  }

  function observationText(pin) {
    var parts = [];
    ['description', 'comment', 'comments', 'notes'].forEach(function (key) {
      var value = pin && pin[key];
      if (typeof value === 'string' && trim(value)) parts.push(trim(value));
      else if (Array.isArray(value)) {
        value.forEach(function (item) {
          if (typeof item === 'string' && trim(item)) parts.push(trim(item));
        });
      }
    });
    var seen = {};
    return parts.filter(function (part) {
      if (seen[part]) return false;
      seen[part] = 1;
      return true;
    }).join('\n');
  }

  function pinPosition(pin, plan) {
    if (pin && typeof pin.xNormalized === 'number' && typeof pin.yNormalized === 'number') {
      return { x: pin.xNormalized, y: pin.yNormalized };
    }
    if (pin && plan && plan.width && plan.height && typeof pin.x === 'number' && typeof pin.y === 'number') {
      return { x: pin.x / plan.width, y: pin.y / plan.height };
    }
    return null;
  }

  function mediaKind(value) {
    if (typeof value !== 'string') return null;
    if (value.indexOf('data:application/pdf') === 0) return 'pdf';
    if (value.indexOf('data:image/') === 0) return 'image';
    return null;
  }

  async function resolveMedia(id, inline, getter) {
    if (inline && mediaKind(inline)) return inline;
    if (!id) return null;
    if (id.indexOf('data:') === 0) return mediaKind(id) ? id : null;
    if (typeof getter !== 'function') return null;
    try {
      var value = await getter(id);
      return typeof value === 'string' && mediaKind(value) ? value : null;
    } catch (err) {
      return null;
    }
  }

  function layerFigure(layer) {
    if (!layer) return null;
    for (var i = 0; i < LAYER_FIGURE_KEYS.length; i += 1) {
      var id = layer[LAYER_FIGURE_KEYS[i]];
      if (typeof id === 'string' && trim(id)) {
        return { mediaId: trim(id), scope: 'canvas' };
      }
    }
    return null;
  }

  function areaFigure(area) {
    if (!area) return null;
    for (var i = 0; i < AREA_FIGURE_KEYS.length; i += 1) {
      var id = area[AREA_FIGURE_KEYS[i]];
      if (typeof id === 'string' && trim(id)) {
        return { mediaId: trim(id), scope: 'area', area: area };
      }
    }
    return null;
  }

  function layerHasOutput(layer) {
    if (!layer || typeof layer !== 'object') return false;
    if (layerFigure(layer)) return true;
    var areas = Array.isArray(layer.areas) ? layer.areas : [];
    if (areas.some(function (area) { return !!areaFigure(area); })) return true;
    if (Array.isArray(layer.points) && layer.points.length) return true;
    if (Array.isArray(layer.boundary) && layer.boundary.length) return true;
    if (areas.some(function (area) { return area && Array.isArray(area.polygon) && area.polygon.length; })) return true;
    if (Array.isArray(layer.notes) && layer.notes.length) return true;
    if (Array.isArray(layer.transitions) && layer.transitions.length) return true;
    if (Array.isArray(layer.exclusions) && layer.exclusions.length) return true;
    if (layer.scale || layer.bp1Gps || layer.planTransform) return true;
    return false;
  }

  function readingCount(layer) {
    return layer && Array.isArray(layer.points) ? layer.points.length : 0;
  }

  function areaNames(layer) {
    var areas = layer && Array.isArray(layer.areas) ? layer.areas : [];
    return areas.map(function (area) { return trim(area && area.name); }).filter(Boolean);
  }

  function levelsFromMap(byCanvasId, info, order) {
    var map = byCanvasId && typeof byCanvasId === 'object' && !Array.isArray(byCanvasId) ? byCanvasId : {};
    return Object.keys(map).filter(function (id) {
      return layerHasOutput(map[id]);
    }).sort(function (a, b) {
      var ao = order[a] == null ? 10000 : order[a];
      var bo = order[b] == null ? 10000 : order[b];
      if (ao !== bo) return ao - bo;
      return a < b ? -1 : a > b ? 1 : 0;
    }).map(function (id) {
      var canvas = info[id] || null;
      return {
        canvasId: id,
        name: (canvas && canvas.name) || trim(map[id] && map[id].name) || id,
        layer: map[id],
      };
    });
  }

  function collectEpochs(floor, info, order) {
    var epochs = [];
    ['epochs', 'sessions', 'surveys'].forEach(function (group) {
      var list = floor && floor[group];
      if (!Array.isArray(list)) return;
      list.forEach(function (entry, index) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        var by = entry.byCanvasId && typeof entry.byCanvasId === 'object' ? entry.byCanvasId : null;
        var levels = by ? levelsFromMap(by, info, order) : [];
        if (!by && layerHasOutput(entry)) {
          var onlyId = entry.canvasId || entry.id || ('level-' + (index + 1));
          var canvas = info[onlyId] || null;
          levels = [{
            canvasId: onlyId,
            name: (canvas && canvas.name) || trim(entry.name) || onlyId,
            layer: entry,
          }];
        }
        if (!levels.length) return;
        epochs.push({
          id: entry.id || (group + '-' + (index + 1)),
          label: trim(entry.label) || trim(entry.name) || ('Survey ' + (index + 1)),
          surveyDate: dateOnly(entry.inspectionDate || entry.surveyDate),
          levels: levels,
        });
      });
    });
    var currentLevels = levelsFromMap(floor && floor.byCanvasId, info, order);
    if (currentLevels.length) {
      epochs.unshift({
        id: (floor && floor.id) || 'current',
        label: 'Current Floor Survey',
        surveyDate: dateOnly(floor && floor.inspectionDate),
        levels: currentLevels,
      });
    }
    return epochs;
  }

  async function distressSlides(record, deps) {
    var distress = record && record.distress && typeof record.distress === 'object' ? record.distress : {};
    var pins = Array.isArray(distress.pins) ? distress.pins : [];
    if (!pins.length) {
      return { status: 'absent', numbering: NUMBERING_NOTE, slides: [] };
    }
    var canvases = canvasesOf(record);
    var order = canvasOrder(canvases);
    var info = {};
    canvases.forEach(function (canvas) { info[canvas.id] = canvas; });
    var numbers = assignPinNumbers(pins, distress.mode, distress.startNum);
    var groups = [];
    var groupIndex = {};

    function groupFor(pin) {
      var canvasId = pin && pin.canvasId ? pin.canvasId : '';
      var key = canvasId || 'unassigned';
      if (!groupIndex[key]) {
        var canvas = canvasId ? info[canvasId] : null;
        groupIndex[key] = {
          canvasId: canvasId || null,
          levelName: canvas ? (canvas.name || canvasId) : (canvasId || 'Unassigned level'),
          order: canvasId && order[canvasId] != null ? order[canvasId] : 10000,
          plan: canvas && canvas.plan ? canvas.plan : null,
          pins: [],
        };
        groups.push(groupIndex[key]);
      }
      return groupIndex[key];
    }

    pins.forEach(function (pin, index) {
      groupFor(pin).pins.push({ pin: pin, numbering: numbers[index] });
    });
    groups.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.levelName < b.levelName ? -1 : a.levelName > b.levelName ? 1 : 0;
    });

    var slides = [];
    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      var plan = group.plan;
      var planUrl = await resolveMedia(plan && plan.id, null, deps.getMedia);
      var slidePins = [];
      for (var p = 0; p < group.pins.length; p += 1) {
        var item = group.pins[p];
        var pin = item.pin;
        var photos = [];
        var entries = Array.isArray(pin.photos) ? pin.photos : [];
        for (var i = 0; i < entries.length; i += 1) {
          var ref = photoRef(entries[i]);
          var dataUrl = await resolveMedia(ref.id, ref.inline, deps.getDistressMedia);
          if (!dataUrl && ref.id) dataUrl = await resolveMedia(ref.id, null, deps.getMedia);
          photos.push({
            id: ref.id,
            displayNumber: item.numbering.photoNumbers[i],
            dataUrl: dataUrl,
            missing: !dataUrl,
          });
        }
        slidePins.push({
          id: pin.id || null,
          number: item.numbering.num,
          numberEnd: item.numbering.end,
          photoNumbers: item.numbering.photoNumbers.slice(),
          position: pinPosition(pin, plan),
          location: trim(pin.location),
          category: trim(pin.category),
          text: observationText(pin),
          isExterior: !!pin.isExterior,
          photos: photos,
        });
      }
      slides.push({
        id: 'distress:' + (group.canvasId || 'unassigned'),
        kind: 'distress-level',
        title: 'Distress Survey — ' + group.levelName,
        sourceKey: 'distress',
        canvasId: group.canvasId,
        levelName: group.levelName,
        plan: {
          mediaId: plan && plan.id || null,
          width: plan && plan.width || null,
          height: plan && plan.height || null,
          dataUrl: planUrl,
          missing: !planUrl,
        },
        pins: slidePins,
      });
    }
    return { status: 'present', numbering: NUMBERING_NOTE, slides: slides };
  }

  async function floorSlides(record, deps) {
    var floor = record && record.floorSurvey && typeof record.floorSurvey === 'object' ? record.floorSurvey : null;
    var canvases = canvasesOf(record);
    var order = canvasOrder(canvases);
    var info = {};
    canvases.forEach(function (canvas) { info[canvas.id] = canvas; });
    var epochs = floor ? collectEpochs(floor, info, order) : [];
    var slides = [];
    var used = {};

    function pageId(base) {
      var id = base;
      var n = 2;
      while (used[id]) {
        id = base + ':' + n;
        n += 1;
      }
      used[id] = 1;
      return id;
    }

    for (var e = 0; e < epochs.length; e += 1) {
      var epoch = epochs[e];
      for (var l = 0; l < epoch.levels.length; l += 1) {
        var level = epoch.levels[l];
        var layer = level.layer || {};
        var outputs = [];
        var canvasFig = layerFigure(layer);
        if (canvasFig) outputs.push(canvasFig);
        var areas = Array.isArray(layer.areas) ? layer.areas : [];
        areas.forEach(function (area) {
          var fig = areaFigure(area);
          if (fig) outputs.push(fig);
        });
        if (!outputs.length) outputs.push(null);
        for (var o = 0; o < outputs.length; o += 1) {
          var output = outputs[o];
          var names = output && output.scope === 'area'
            ? [trim(output.area && output.area.name)].filter(Boolean)
            : areaNames(layer);
          var areaId = output && output.scope === 'area' ? (output.area.id || ('area-' + (o + 1))) : null;
          var areaName = output && output.scope === 'area' ? (trim(output.area.name) || 'Area') : '';
          var title = 'Floor Survey — ' + level.name;
          if (areaName) title += ' — ' + areaName;
          if (epochs.length > 1 && epoch.label && epoch.label !== 'Current Floor Survey') {
            title += ' — ' + epoch.label;
          }
          var dataUrl = output ? await resolveMedia(output.mediaId, null, deps.getMedia) : null;
          var baseId = 'floor:' + epoch.id + ':' + level.canvasId + (areaId ? ':' + areaId : '');
          slides.push({
            id: pageId(baseId),
            kind: 'floor-topo',
            title: title,
            sourceKey: 'floor',
            canvasId: level.canvasId,
            levelName: level.name,
            epochId: epoch.id,
            epochLabel: epoch.label,
            surveyDate: epoch.surveyDate || '',
            areaId: areaId,
            areaName: areaName,
            areaNames: names,
            readingCount: readingCount(layer),
            readingsRebuilt: false,
            figure: output && dataUrl ? {
              kind: 'stored-rendering',
              mediaId: output.mediaId,
              dataUrl: dataUrl,
              mime: mediaKind(dataUrl),
            } : {
              kind: 'unavailable',
              mediaId: output ? output.mediaId : null,
              dataUrl: null,
              mime: null,
            },
            note: output && dataUrl ? '' : FLOOR_MISSING_NOTE,
          });
        }
      }
    }
    return {
      status: slides.length ? 'present' : 'absent',
      slides: slides,
    };
  }

  function readDistressMedia(id) {
    return new Promise(function (resolve) {
      if (!id || !window.indexedDB) {
        resolve(null);
        return;
      }
      var openExisting = function () {
        var request;
        try {
          request = window.indexedDB.open(DISTRESS_MEDIA_DB);
        } catch (err) {
          resolve(null);
          return;
        }
        request.onerror = function () { resolve(null); };
        request.onsuccess = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(DISTRESS_MEDIA_STORE)) {
            db.close();
            resolve(null);
            return;
          }
          var tx = db.transaction(DISTRESS_MEDIA_STORE, 'readonly');
          var get = tx.objectStore(DISTRESS_MEDIA_STORE).get(id);
          get.onsuccess = function () {
            db.close();
            resolve(get.result || null);
          };
          get.onerror = function () {
            db.close();
            resolve(null);
          };
        };
      };
      if (typeof window.indexedDB.databases === 'function') {
        window.indexedDB.databases().then(function (list) {
          var exists = (list || []).some(function (entry) { return entry && entry.name === DISTRESS_MEDIA_DB; });
          if (!exists) resolve(null);
          else openExisting();
        }).catch(function () { openExisting(); });
        return;
      }
      openExisting();
    });
  }

  function defaultGetMedia(id) {
    if (!id || !window.ToolboxDB || typeof window.ToolboxDB.getMedia !== 'function') return Promise.resolve(null);
    return window.ToolboxDB.getMedia(id).catch(function () { return null; });
  }

  async function assemble(record, deps) {
    var options = Object.assign({
      getMedia: defaultGetMedia,
      getDistressMedia: readDistressMedia,
    }, deps || {});
    var identity = identityFrom(record || {});
    var distress = await distressSlides(record, options);
    var floor = await floorSlides(record, options);
    var pages = distress.slides.concat(floor.slides).map(function (slide) {
      slide.identity = identity;
      return slide;
    });
    return {
      sourceVersion: SOURCE_VERSION,
      identity: identity,
      distress: distress,
      floor: floor,
      pages: pages,
    };
  }

  window.ToolboxReportEvidence = {
    SOURCE_VERSION: SOURCE_VERSION,
    NUMBERING_NOTE: NUMBERING_NOTE,
    FLOOR_MISSING_NOTE: FLOOR_MISSING_NOTE,
    assemble: assemble,
  };
})();
