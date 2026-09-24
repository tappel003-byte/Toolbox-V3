// Toolbox — Report Builder AI package v1.
//
// Read-only export of the Customer File open in Report Builder.
// One ZIP for upload to a model. This module does not save the Customer File,
// does not call Sync, and does not send anything to an AI service.

(function () {
  'use strict';

  var SCHEMA = 'toolbox.ai-package';
  var SCHEMA_VERSION = 1;
  var DISTRESS_MEDIA_DB = 'pgg_photos_v1';
  var DISTRESS_MEDIA_STORE = 'photos';

  var LIMITS = [
    'Distress pin photos and Quick Capture are separate collections. Quick Capture is not placed on the plan. Stored bytes are copied as stored and are not rewritten.',
    'A photo is included only when its bytes are already stored. Missing bytes are listed. This package does not invent them.',
    'Original photo file names are included when the Customer File recorded them.',
    'This package does not render new diagnostic plots. Diagnostics are included only when already stored.',
    'Report Builder shell pages are not saved on the Customer File. Only stored report state is included.',
  ];

  var NUMBERING_NOTE = 'Distress photograph numbers are one sequence across all levels. A pin number is the first photograph on that pin. Further photographs on the pin take the following numbers. Removing a photograph closes the gap. A level change does not restart the sequence.';

  var CONTACT_KEYS = [
    'firstName', 'lastName', 'propertyAddress', 'cellPhone', 'homePhone', 'email', 'notes',
    'companyName', 'spouseName', 'spouseCellPhone', 'spouseHomePhone', 'spouseEmail',
    'mailingSameAsProperty', 'mailingAddress', 'propertyAddressLat', 'propertyAddressLon',
  ];

  var RESERVED_KEYS = {
    id: 1,
    planSetup: 1,
    distress: 1,
    floorSurvey: 1,
    diagnostics: 1,
    report: 1,
    reportBuilder: 1,
    recoveryImports: 1,
    createdAt: 1,
    updatedAt: 1,
    customerUpdatedAt: 1,
    trashUpdatedAt: 1,
    deletedAt: 1,
    purgeAfter: 1,
    checkedOutFromCabinet: 1,
  };

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function displayName(record) {
    var name = [trim(record && record.firstName), trim(record && record.lastName)].filter(Boolean).join(' ');
    return name || 'New Customer File';
  }

  function omitKey(key) {
    var folded = String(key || '').toLowerCase();
    if (folded === 'deviceid' || folded === 'checkout' || folded === 'checkedoutfromcabinet') return true;
    if (folded === 'syncapibase' || folded === 'geoapifyapikey' || folded === 'authorization') return true;
    if (folded === 'cookie' || folded === 'accesstoken' || folded === 'refreshtoken' || folded === 'idtoken') return true;
    return /token|secret|password|apikey|api_key|credential/.test(folded);
  }

  function stripSecrets(value, path, omitted) {
    if (Array.isArray(value)) {
      return value.map(function (item, index) {
        return stripSecrets(item, path + '[' + index + ']', omitted);
      });
    }
    if (!value || typeof value !== 'object') return value;
    var out = {};
    Object.keys(value).forEach(function (key) {
      var nextPath = path ? path + '.' + key : key;
      if (omitKey(key)) {
        omitted.push(nextPath);
        return;
      }
      out[key] = stripSecrets(value[key], nextPath, omitted);
    });
    return out;
  }

  function slug(value, fallback) {
    var text = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return text || fallback;
  }

  function uniqueSlug(used, value, fallback) {
    var base = slug(value, fallback);
    var name = base;
    var n = 2;
    while (used[name]) {
      name = base + '-' + n;
      n += 1;
    }
    used[name] = true;
    return name;
  }

  function csvField(value) {
    if (value == null) return '';
    var text = String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCsv(headers, rows) {
    var lines = [headers.map(csvField).join(',')];
    rows.forEach(function (row) {
      lines.push(headers.map(function (header) { return csvField(row[header]); }).join(','));
    });
    return lines.join('\n') + '\n';
  }

  function extFromMime(mime) {
    var type = String(mime || '').toLowerCase().split(';')[0].trim();
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/gif') return 'gif';
    if (type === 'image/svg+xml') return 'svg';
    if (type === 'audio/webm') return 'webm';
    if (type === 'audio/mp4' || type === 'audio/m4a' || type === 'audio/x-m4a') return 'm4a';
    if (type === 'application/pdf') return 'pdf';
    return 'bin';
  }

  function bytesFromDataUrl(dataUrl) {
    var match = /^data:([^;,]+)?((?:;charset=[^;,]+)?(?:;base64)?)?,([\s\S]*)$/.exec(dataUrl);
    if (!match) return null;
    var mime = match[1] || 'application/octet-stream';
    var flags = match[2] || '';
    var payload = match[3] || '';
    try {
      if (flags.indexOf('base64') !== -1) {
        var binary = atob(payload.replace(/\s/g, ''));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return { bytes: bytes, mime: mime };
      }
      var text = decodeURIComponent(payload);
      var raw = new Uint8Array(text.length);
      for (var j = 0; j < text.length; j += 1) raw[j] = text.charCodeAt(j) & 255;
      return { bytes: raw, mime: mime };
    } catch (err) {
      return null;
    }
  }

  function normalizeMedia(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      if (value.indexOf('data:') === 0) return bytesFromDataUrl(value);
      return null;
    }
    if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
      return { bytes: value, mime: value.mime || 'application/octet-stream' };
    }
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      return { bytes: new Uint8Array(value), mime: 'application/octet-stream' };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return value.arrayBuffer().then(function (buffer) {
        return { bytes: new Uint8Array(buffer), mime: value.type || 'application/octet-stream' };
      });
    }
    return null;
  }

  async function mediaBytes(value) {
    var normalized = normalizeMedia(value);
    if (normalized && typeof normalized.then === 'function') return normalized;
    return normalized;
  }

  function layerHasWork(layer) {
    if (!layer || typeof layer !== 'object') return false;
    return (
      (Array.isArray(layer.points) && layer.points.length > 0) ||
      (Array.isArray(layer.boundary) && layer.boundary.length > 0) ||
      (Array.isArray(layer.areas) && layer.areas.length > 0) ||
      (Array.isArray(layer.notes) && layer.notes.length > 0) ||
      (Array.isArray(layer.transitions) && layer.transitions.length > 0) ||
      (Array.isArray(layer.exclusions) && layer.exclusions.length > 0) ||
      (layer.transitionGroupAverages && Object.keys(layer.transitionGroupAverages).length > 0) ||
      !!layer.scale ||
      !!layer.bp1Gps ||
      !!layer.planTransform
    );
  }

  function floorRootHasMeta(floor) {
    if (!floor || typeof floor !== 'object') return false;
    if (trim(floor.inspectionDate) || trim(floor.surveyNotes)) return true;
    if (Array.isArray(floor.customSurfaces) && floor.customSurfaces.length) return true;
    if (floor.lastExportedAt) return true;
    return false;
  }

  function distressIsPresent(distress) {
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

  function containerPresent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(value).some(function (key) {
      return key !== 'id' && key !== 'createdAt' && key !== 'updatedAt';
    });
  }

  function canvasInfoMap(canvases) {
    var info = {};
    (canvases || []).forEach(function (canvas, index) {
      if (canvas && canvas.id) info[canvas.id] = { canvas: canvas, order: index };
    });
    return info;
  }

  function levelFromLayer(layer, canvasId, infoMap) {
    var info = infoMap[canvasId];
    var canvas = info && info.canvas;
    var omitted = [];
    var source = stripSecrets(clone(layer || {}), 'floor.' + canvasId, omitted);
    return {
      canvasId: canvasId,
      name: (canvas && canvas.name) || (source && source.name) || canvasId,
      order: info ? info.order : null,
      matchedCanvas: !!canvas,
      planRef: canvas && canvas.plan ? {
        mediaId: canvas.plan.id || null,
        width: canvas.plan.width || null,
        height: canvas.plan.height || null,
      } : null,
      source: source || {},
      omitted: omitted,
    };
  }

  function levelsFromMap(byCanvasId, infoMap) {
    var map = byCanvasId && typeof byCanvasId === 'object' && !Array.isArray(byCanvasId) ? byCanvasId : {};
    return Object.keys(map).sort(function (a, b) {
      var ao = infoMap[a] ? infoMap[a].order : 10000;
      var bo = infoMap[b] ? infoMap[b].order : 10000;
      if (ao !== bo) return ao - bo;
      return a < b ? -1 : a > b ? 1 : 0;
    }).map(function (id) {
      return levelFromLayer(map[id], id, infoMap);
    }).filter(function (level) {
      return layerHasWork(level.source);
    });
  }

  function epochFromEntry(entry, index, group, infoMap) {
    var by = entry.byCanvasId && typeof entry.byCanvasId === 'object' ? entry.byCanvasId : null;
    var levels = by ? levelsFromMap(by, infoMap) : [];
    if (!by && layerHasWork(entry)) {
      var onlyId = entry.canvasId || entry.id || ('level-' + (index + 1));
      levels = [levelFromLayer(entry, onlyId, infoMap)];
    }
    return {
      id: entry.id || (group + '-' + (index + 1)),
      label: entry.label || entry.name || ('Survey ' + (index + 1)),
      surveyDate: entry.inspectionDate || entry.surveyDate || '',
      notes: entry.notes || entry.surveyNotes || '',
      customSurfaces: Array.isArray(entry.customSurfaces) ? entry.customSurfaces.slice() : [],
      sourceKind: group,
      levels: levels,
    };
  }

  function collectEpochs(floor, infoMap) {
    var epochs = [];
    ['epochs', 'sessions', 'surveys'].forEach(function (group) {
      var list = floor && floor[group];
      if (!Array.isArray(list)) return;
      list.forEach(function (entry, index) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        epochs.push(epochFromEntry(entry, index, group, infoMap));
      });
    });
    var currentLevels = levelsFromMap(floor && floor.byCanvasId, infoMap);
    var includeCurrent = currentLevels.length > 0 || (!epochs.length && floorRootHasMeta(floor));
    if (includeCurrent) {
      epochs.unshift({
        id: (floor && floor.id) || 'current',
        label: 'Current Floor Survey',
        surveyDate: (floor && floor.inspectionDate) || '',
        notes: (floor && floor.surveyNotes) || '',
        customSurfaces: floor && Array.isArray(floor.customSurfaces) ? floor.customSurfaces.slice() : [],
        sourceKind: 'current-dataset',
        levels: currentLevels,
      });
    }
    return epochs;
  }

  function groupAverage(level, transition) {
    var averages = level.source && level.source.transitionGroupAverages;
    if (!averages || !transition) return '';
    var key = String(transition.surfaceA || '') + '\u2192' + String(transition.surfaceB || '');
    return averages[key] == null ? '' : averages[key];
  }

  function floorFiles(epochs, usedSlugs) {
    var readingRows = [];
    var correctionRows = [];
    var files = [];
    var summaries = [];
    epochs.forEach(function (epoch) {
      var epochSlug = uniqueSlug(usedSlugs, epoch.id, 'epoch');
      var levelSlugs = {};
      var epochSummary = {
        id: epoch.id,
        label: epoch.label,
        surveyDate: epoch.surveyDate || '',
        sourceKind: epoch.sourceKind,
        levels: [],
      };
      (epoch.levels || []).forEach(function (level, levelIndex) {
        var levelSlug = uniqueSlug(levelSlugs, level.canvasId || level.name, 'level-' + (levelIndex + 1));
        var base = 'floor-survey/epochs/' + epochSlug + '/levels/' + levelSlug;
        var points = Array.isArray(level.source.points) ? level.source.points : [];
        var transitions = Array.isArray(level.source.transitions) ? level.source.transitions : [];
        var pointRows = points.map(function (point) {
          return {
            epochId: epoch.id,
            surveyDate: epoch.surveyDate || '',
            levelId: level.canvasId,
            levelName: level.name,
            pointId: point && point.id || '',
            index: point && point.index != null ? point.index : '',
            x: point && point.x != null ? point.x : '',
            y: point && point.y != null ? point.y : '',
            rawReadingInches: point && point.value != null ? point.value : '',
            isBasePoint: !!(point && point.isBasePoint),
            label: point && point.label || '',
            notes: point && point.notes || '',
            transitionId: point && point.transitionId || '',
            isTransitionAnchor: !!(point && point.isTransitionAnchor),
            createdAt: point && point.createdAt != null ? point.createdAt : '',
          };
        });
        var transitionRows = transitions.map(function (transition) {
          return {
            epochId: epoch.id,
            surveyDate: epoch.surveyDate || '',
            levelId: level.canvasId,
            levelName: level.name,
            transitionId: transition && transition.id || '',
            x: transition && transition.x != null ? transition.x : '',
            y: transition && transition.y != null ? transition.y : '',
            surfaceA: transition && transition.surfaceA || '',
            surfaceB: transition && transition.surfaceB || '',
            readingA: transition && transition.readingA != null ? transition.readingA : '',
            readingB: transition && transition.readingB != null ? transition.readingB : '',
            readingARawOnParent: transition && transition.readingARawOnParent != null ? transition.readingARawOnParent : '',
            manualDeltaOverride: transition && transition.manualDeltaOverride != null ? transition.manualDeltaOverride : '',
            useGroupAverage: !!(transition && transition.useGroupAverage),
            parentId: transition && transition.parentId || '',
            groupAverage: groupAverage(level, transition),
            createdAt: transition && transition.createdAt != null ? transition.createdAt : '',
          };
        });
        readingRows = readingRows.concat(pointRows);
        correctionRows = correctionRows.concat(transitionRows);
        files.push({
          path: base + '/readings.csv',
          text: toCsv([
            'epochId', 'surveyDate', 'levelId', 'levelName', 'pointId', 'index', 'x', 'y',
            'rawReadingInches', 'isBasePoint', 'label', 'notes', 'transitionId', 'isTransitionAnchor', 'createdAt',
          ], pointRows),
        });
        files.push({
          path: base + '/corrections.csv',
          text: toCsv([
            'epochId', 'surveyDate', 'levelId', 'levelName', 'transitionId', 'x', 'y',
            'surfaceA', 'surfaceB', 'readingA', 'readingB', 'readingARawOnParent',
            'manualDeltaOverride', 'useGroupAverage', 'parentId', 'groupAverage', 'createdAt',
          ], transitionRows),
        });
        var levelSummary = {
          canvasId: level.canvasId,
          name: level.name,
          matchedCanvas: level.matchedCanvas,
          planRef: level.planRef,
          readingCount: pointRows.length,
          correctionCount: transitionRows.length,
          areaCount: Array.isArray(level.source.areas) ? level.source.areas.length : 0,
          exclusionCount: Array.isArray(level.source.exclusions) ? level.source.exclusions.length : 0,
          boundaryPointCount: Array.isArray(level.source.boundary) ? level.source.boundary.length : 0,
          readingsFile: base + '/readings.csv',
          correctionsFile: base + '/corrections.csv',
        };
        epochSummary.levels.push(levelSummary);
        level.summary = levelSummary;
      });
      summaries.push(epochSummary);
    });
    return { files: files, summaries: summaries, readingCount: readingRows.length, correctionCount: correctionRows.length };
  }

  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  var GENERIC_ROOM_WORDS = {
    room: 1, rooms: 1, area: 1, areas: 1, notes: 1, note: 1, label: 1, labels: 1,
    space: 1, spaces: 1, zone: 1, zones: 1, section: 1, sections: 1, plan: 1, plans: 1,
    floor: 1, floors: 1, level: 1, levels: 1, unit: 1, units: 1, tbd: 1, 'n/a': 1, na: 1,
  };

  function orientationOffset(facing) {
    if (!facing || BEARINGS[facing] == null) return null;
    return (BEARINGS[facing] + 180) % 360;
  }

  function cardinalForPin(pin, canvas) {
    if (!canvas || !canvas.plan || !canvas.plan.width || !canvas.plan.height) {
      return { direction: (pin && pin.importedLegacyDirection) || '', source: pin && pin.importedLegacyDirection ? 'imported' : 'none' };
    }
    var offset = orientationOffset(canvas.frontDoorFacing);
    if (offset == null) {
      return { direction: (pin && pin.importedLegacyDirection) || '', source: pin && pin.importedLegacyDirection ? 'imported' : 'none' };
    }
    var origin = canvas.frontDoor && typeof canvas.frontDoor.x === 'number' && typeof canvas.frontDoor.y === 'number'
      ? canvas.frontDoor
      : { x: 0.5, y: 0.5 };
    var dx = (pin.x / canvas.plan.width) - origin.x;
    var dy = (pin.y / canvas.plan.height) - origin.y;
    if (Math.hypot(dx, dy) < 0.03) return { direction: 'Center', source: 'front-door' };
    var alpha = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    var bearing = (alpha + offset) % 360;
    return { direction: DIRS[Math.round(bearing / 45) % 8], source: 'front-door' };
  }

  function genericRoom(name) {
    var text = trim(name).toLowerCase();
    if (!text) return true;
    var core = text.replace(/[\s\-#_.:]*\d+$/, '').trim();
    if (!core) return true;
    return !!GENERIC_ROOM_WORDS[core];
  }

  function derivedRoom(pin, canvas) {
    var rooms = canvas && Array.isArray(canvas.rooms) ? canvas.rooms : [];
    if (!rooms.length || !canvas.plan || !canvas.plan.width || !canvas.plan.height) return '';
    var px = pin.x / canvas.plan.width;
    var py = pin.y / canvas.plan.height;
    var scored = [];
    rooms.forEach(function (room, index) {
      if (!room || genericRoom(room.name) || typeof room.x !== 'number' || typeof room.y !== 'number') return;
      scored.push({ index: index, d: Math.hypot(room.x - px, room.y - py), name: room.name });
    });
    if (!scored.length) return '';
    scored.sort(function (a, b) { return a.d - b.d; });
    if (scored[0].d > 0.28) return '';
    if (scored.length > 1 && scored[0].d > 0.02 && scored[1].d < scored[0].d * 1.25) return '';
    return scored[0].name;
  }

  function recordedFileName(distress, ref, source) {
    if (source && typeof source.sourceName === 'string' && source.sourceName.trim()) return source.sourceName.trim();
    var sources = distress && distress.photoSources;
    if (ref && ref.id && sources && typeof sources[ref.id] === 'string' && sources[ref.id].trim()) return sources[ref.id].trim();
    return '';
  }

  function photoRef(entry) {
    if (typeof entry === 'string') {
      if (entry.indexOf('data:') === 0) return { inline: entry, id: null };
      return { id: entry, inline: null };
    }
    if (entry && typeof entry === 'object') {
      return {
        id: typeof entry.id === 'string' ? entry.id : null,
        inline: typeof entry.dataUrl === 'string' ? entry.dataUrl : (typeof entry.inline === 'string' ? entry.inline : null),
      };
    }
    return { id: null, inline: null };
  }

  function assignPinNumbers(pins, mode, startNum) {
    var external = mode === 'external';
    var n = typeof startNum === 'number' && isFinite(startNum) ? startNum : 1;
    return (pins || []).map(function (pin) {
      var storedStart = pin && typeof pin.num === 'number' ? pin.num : null;
      var photoCount = pin && Array.isArray(pin.photos) ? pin.photos.length : 0;
      var num = n;
      var photoNumbers = [];
      for (var i = 0; i < photoCount; i += 1) photoNumbers.push(num + i);
      n += external ? Math.max(1, (pin && pin.extPhotoCount) || 0) : Math.max(1, photoCount);
      return { num: num, photoNumbers: photoNumbers, storedNum: storedStart };
    });
  }

  function padWidth(total) {
    return String(Math.max(total, 1)).length >= 3 ? 3 : 2;
  }

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  async function resolvePhoto(ref, deps) {
    if (ref.inline) return mediaBytes(ref.inline);
    if (ref.id && ref.id.indexOf('data:') === 0) return mediaBytes(ref.id);
    if (ref.id && deps.getDistressMedia) {
      try {
        return mediaBytes(await deps.getDistressMedia(ref.id));
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  function collectionEntries(list) {
    if (!Array.isArray(list)) return [];
    return list.map(photoRef).filter(function (ref) { return ref.id || ref.inline; });
  }

  async function buildDistress(record, infoMap, deps, gaps) {
    var distress = record.distress && typeof record.distress === 'object' ? record.distress : {};
    var surveyPresent = distressIsPresent(record.distress);
    var generalOnFile = Array.isArray(record.generalPhotos) && record.generalPhotos.length > 0;
    if (!surveyPresent && !generalOnFile) {
      return {
        document: {
          status: 'absent',
          note: 'No Distress Survey is stored on this Customer File.',
          numbering: NUMBERING_NOTE,
          pins: [],
          drawings: [],
          levels: [],
        },
        csv: '',
        photos: [],
        photoByteMap: {},
        summary: { status: 'absent', pinCount: 0, photoCount: 0, levels: [] },
        counts: { 'pin-linked': 0, 'quick-capture': 0, unassigned: 0, general: 0, missing: 0 },
      };
    }
    var canvases = record.planSetup && Array.isArray(record.planSetup.canvases) ? record.planSetup.canvases : [];
    var canvasById = {};
    canvases.forEach(function (canvas) { if (canvas && canvas.id) canvasById[canvas.id] = canvas; });
    var pins = Array.isArray(distress.pins) ? distress.pins : [];
    var numbers = assignPinNumbers(pins, distress.mode, distress.startNum);
    var photoTotal = 0;
    numbers.forEach(function (item) { photoTotal += item.photoNumbers.length; });
    var width = padWidth(photoTotal);
    var omitted = [];
    var exportedPins = [];
    var photoJobs = [];
    var levelBuckets = {};

    pins.forEach(function (pin, index) {
      var numbering = numbers[index];
      var canvas = pin && canvasById[pin.canvasId] || null;
      var roomStored = trim(pin && pin.location);
      var roomDerived = roomStored ? '' : derivedRoom(pin || {}, canvas);
      var direction = cardinalForPin(pin || {}, canvas);
      var plan = canvas && canvas.plan;
      var xNorm = plan && plan.width ? pin.x / plan.width : null;
      var yNorm = plan && plan.height ? pin.y / plan.height : null;
      var cleaned = stripSecrets(clone(pin || {}), 'distress.pins[' + index + ']', omitted);
      if (cleaned.photos) {
        cleaned.photoIds = (pin.photos || []).map(function (entry) {
          var ref = photoRef(entry);
          return ref.id || null;
        });
        delete cleaned.photos;
      }
      cleaned.number = numbering.num;
      cleaned.photoNumbers = numbering.photoNumbers.slice();
      cleaned.room = roomStored || roomDerived || '';
      cleaned.roomSource = roomStored ? 'stored' : (roomDerived ? 'derived' : 'none');
      cleaned.direction = direction.direction;
      cleaned.directionSource = direction.source;
      cleaned.importedLegacyDirection = (pin && pin.importedLegacyDirection) || '';
      cleaned.type = pin && pin.isExterior ? 'Exterior' : 'Interior';
      cleaned.category = (pin && pin.category) || '';
      cleaned.xNormalized = xNorm;
      cleaned.yNormalized = yNorm;
      cleaned.levelName = canvas && canvas.name || (pin && pin.canvasId) || 'Unknown level';
      cleaned.photoFiles = [];
      exportedPins.push(cleaned);

      var bucketKey = (pin && pin.canvasId) || 'unknown-level';
      if (!levelBuckets[bucketKey]) {
        levelBuckets[bucketKey] = {
          canvasId: pin && pin.canvasId || null,
          name: cleaned.levelName,
          pinIds: [],
        };
      }
      levelBuckets[bucketKey].pinIds.push(cleaned.id || null);

      (pin && pin.photos || []).forEach(function (entry, photoIndex) {
        var ref = photoRef(entry);
        var displayNumber = numbering.photoNumbers[photoIndex];
        var baseName = distress.mode === 'external'
          ? 'pin-' + numbering.num + '-' + pad(photoIndex + 1, 2)
          : 'photo-' + pad(displayNumber, width);
        var sourceFileName = recordedFileName(distress, ref, entry);
        photoJobs.push({
          role: 'pin-linked',
          ref: ref,
          baseName: baseName,
          displayNumber: displayNumber,
          pinId: pin && pin.id || null,
          pinIndex: index,
          canvasId: pin && pin.canvasId || null,
          levelName: cleaned.levelName,
          meta: sourceFileName ? { sourceFileName: sourceFileName } : {},
        });
      });
    });

    collectionEntries(distress.quickCapture).forEach(function (ref, index) {
      var source = distress.quickCapture[index] || {};
      var sourceFileName = recordedFileName(distress, ref, source);
      photoJobs.push({
        role: 'quick-capture',
        ref: ref,
        baseName: 'quick-' + pad(index + 1, padWidth(distress.quickCapture.length)),
        displayNumber: null,
        pinId: null,
        canvasId: null,
        levelName: '',
        meta: {
          timestamp: source.ts || source.timestamp || null,
          latitude: source.lat != null ? source.lat : (source.latitude != null ? source.latitude : null),
          longitude: source.lng != null ? source.lng : (source.longitude != null ? source.longitude : null),
          sourceFileName: sourceFileName || null,
        },
      });
    });

    function pushCollection(list, role, prefix) {
      collectionEntries(list).forEach(function (ref, index) {
        var source = list[index] || {};
        photoJobs.push({
          role: role,
          ref: ref,
          baseName: prefix + '-' + pad(index + 1, padWidth(list.length)),
          displayNumber: null,
          pinId: null,
          canvasId: source.canvasId || null,
          levelName: '',
          meta: {
            subject: source.subject || source.folder || null,
            timestamp: source.ts || source.timestamp || source.takenAt || null,
            note: source.note || source.description || null,
          },
        });
      });
    }
    pushCollection(distress.unassignedPhotos, 'unassigned', 'unassigned');
    pushCollection(distress.generalPhotos, 'general', 'general');
    pushCollection(record.generalPhotos, 'general', 'general-file');

    var resolved = await Promise.all(photoJobs.map(function (job) {
      return resolvePhoto(job.ref, deps);
    }));

    var photos = [];
    var photoByteMap = {};
    var counts = { 'pin-linked': 0, 'quick-capture': 0, unassigned: 0, general: 0, missing: 0 };
    resolved.forEach(function (media, index) {
      var job = photoJobs[index];
      var photoId = job.ref.id && job.ref.id.indexOf('data:') !== 0 ? job.ref.id : null;
      if (!media || !media.bytes) {
        counts.missing += 1;
        var missing = {
          role: job.role,
          photoId: photoId,
          pinId: job.pinId,
          canvasId: job.canvasId,
          displayNumber: job.displayNumber,
          reason: 'Referenced photo bytes are not stored on this device.',
        };
        photos.push(Object.assign({ stored: false, path: null }, missing, job.meta));
        gaps.push('Missing ' + job.role + ' photo' + (photoId ? ' ' + photoId : '') + (job.pinId ? ' on pin ' + job.pinId : '') + '.');
        return;
      }
      var path = 'photos/' + job.role + '/' + job.baseName + '.' + extFromMime(media.mime);
      counts[job.role] += 1;
      var recordPhoto = {
        stored: true,
        role: job.role,
        path: path,
        photoId: photoId,
        pinId: job.pinId,
        canvasId: job.canvasId,
        levelName: job.levelName,
        displayNumber: job.displayNumber,
        mime: media.mime,
        bytes: media.bytes.length,
      };
      Object.keys(job.meta).forEach(function (key) {
        if (job.meta[key] != null) recordPhoto[key] = job.meta[key];
      });
      photos.push(recordPhoto);
      photoByteMap[path] = media.bytes;
      if (job.role === 'pin-linked' && exportedPins[job.pinIndex]) {
        exportedPins[job.pinIndex].photoFiles.push(path);
      }
    });

    var csvRows = exportedPins.map(function (pin) {
      return {
        levelId: pin.canvasId || '',
        levelName: pin.levelName || '',
        pinId: pin.id || '',
        number: pin.number,
        photoNumbers: (pin.photoNumbers || []).join(' '),
        x: pin.x != null ? pin.x : '',
        y: pin.y != null ? pin.y : '',
        xNormalized: pin.xNormalized == null ? '' : pin.xNormalized,
        yNormalized: pin.yNormalized == null ? '' : pin.yNormalized,
        room: pin.room || '',
        roomSource: pin.roomSource || '',
        direction: pin.direction || '',
        directionSource: pin.directionSource || '',
        type: pin.type || '',
        category: pin.category || '',
        description: pin.description || '',
        isExterior: !!pin.isExterior,
        photoFiles: (pin.photoFiles || []).join(' '),
      };
    });

    var levels = Object.keys(levelBuckets).map(function (key) { return levelBuckets[key]; });
    levels.sort(function (a, b) {
      var ao = a.canvasId && infoMap[a.canvasId] ? infoMap[a.canvasId].order : 10000;
      var bo = b.canvasId && infoMap[b.canvasId] ? infoMap[b.canvasId].order : 10000;
      return ao - bo;
    });

    return {
      document: {
        status: surveyPresent ? 'present' : 'absent',
        note: surveyPresent
          ? 'Distress observations stay in capture order. Level groups are an index only and do not renumber photographs.'
          : 'No Distress Survey is stored on this Customer File.',
        numbering: NUMBERING_NOTE,
        id: distress.id || null,
        startNum: distress.startNum,
        nextNum: distress.nextNum,
        activeCanvasId: distress.activeCanvasId || null,
        mode: distress.mode || 'internal',
        createdAt: distress.createdAt || null,
        updatedAt: distress.updatedAt || null,
        pins: exportedPins,
        drawings: stripSecrets(clone(distress.drawings || []), 'distress.drawings', omitted),
        levels: levels,
        quickCaptureCount: Array.isArray(distress.quickCapture) ? distress.quickCapture.length : 0,
        omittedFields: omitted,
      },
      csv: exportedPins.length ? toCsv([
        'levelId', 'levelName', 'pinId', 'number', 'photoNumbers', 'x', 'y', 'xNormalized', 'yNormalized',
        'room', 'roomSource', 'direction', 'directionSource', 'type', 'category', 'description', 'isExterior', 'photoFiles',
      ], csvRows) : '',
      photos: photos,
      photoByteMap: photoByteMap,
      summary: {
        status: surveyPresent ? 'present' : 'absent',
        pinCount: exportedPins.length,
        photoCount: counts['pin-linked'],
        levels: levels.map(function (level) {
          return { canvasId: level.canvasId, name: level.name, pinCount: level.pinIds.length };
        }),
      },
      counts: counts,
    };
  }

  function extractDataUrls(value, binaries, hint) {
    if (typeof value === 'string') {
      if (value.indexOf('data:') !== 0 || value.length < 32) return value;
      var media = bytesFromDataUrl(value);
      if (!media) return value;
      var path = hint + '/' + (binaries.length + 1) + '.' + extFromMime(media.mime);
      binaries.push({ path: path, bytes: media.bytes });
      return { extractedFile: path, mime: media.mime };
    }
    if (Array.isArray(value)) {
      return value.map(function (item) { return extractDataUrls(item, binaries, hint); });
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        value[key] = extractDataUrls(value[key], binaries, hint);
      });
    }
    return value;
  }

  function contactsFrom(record) {
    var contacts = { customerName: displayName(record) };
    CONTACT_KEYS.forEach(function (key) {
      if (key === 'mailingSameAsProperty') contacts[key] = !!record[key];
      else if (key === 'propertyAddressLat' || key === 'propertyAddressLon') contacts[key] = record[key] == null ? null : record[key];
      else contacts[key] = record[key] || '';
    });
    return contacts;
  }

  function additionalFields(record, omitted) {
    var extra = {};
    Object.keys(record || {}).forEach(function (key) {
      if (RESERVED_KEYS[key] || CONTACT_KEYS.indexOf(key) !== -1) return;
      if (omitKey(key)) {
        omitted.push(key);
        return;
      }
      extra[key] = record[key];
    });
    return Object.keys(extra).length ? stripSecrets(extra, 'customer', omitted) : null;
  }

  function renderInventory(inventory) {
    var lines = [];
    lines.push('Toolbox AI package');
    lines.push('schema: ' + inventory.schema);
    lines.push('schemaVersion: ' + inventory.schemaVersion);
    lines.push('customerFileId: ' + inventory.customerFileId);
    lines.push('exportedAt: ' + inventory.exportedAt);
    lines.push('customerName: ' + inventory.customerName);
    lines.push('propertyAddress: ' + (inventory.propertyAddress || ''));
    lines.push('');
    lines.push('This ZIP is only the Customer File that was open in Report Builder.');
    lines.push('Absent surveys are missing data, not a failed export.');
    lines.push('Floor Survey epochs and levels are separate. Do not merge readings across them.');
    lines.push(NUMBERING_NOTE);
    lines.push('');

    function section(title) {
      lines.push('[' + title + ']');
    }

    var floor = inventory.components.floorSurvey;
    var distress = inventory.components.distress;
    var plans = inventory.components.plans;
    var photos = inventory.components.photos;

    section('Customer');
    lines.push('status: present');
    lines.push('');
    section('Plans');
    lines.push('status: ' + plans.status);
    lines.push('canvases: ' + plans.canvasCount);
    lines.push('plan images stored: ' + plans.imagesStored);
    lines.push('plan images missing: ' + plans.imagesMissing);
    lines.push('');
    section('Floor Survey');
    lines.push('status: ' + floor.status);
    if (floor.status === 'absent') {
      lines.push('No Floor Survey is stored on this Customer File.');
    } else {
      lines.push('epochs: ' + floor.epochCount);
      lines.push('levels: ' + floor.levelCount);
      lines.push('readings: ' + floor.readingCount);
      (floor.epochs || []).forEach(function (epoch) {
        lines.push('- epoch ' + epoch.id + ' | ' + (epoch.surveyDate || 'no survey date') + ' | ' + epoch.label + ' | levels: ' + epoch.levels.length);
        epoch.levels.forEach(function (level) {
          lines.push('  - level ' + level.canvasId + ' | ' + level.name + ' | readings: ' + level.readingCount + ' | corrections: ' + level.correctionCount + ' | file: ' + level.readingsFile);
        });
      });
    }
    lines.push('');
    section('Distress Survey');
    lines.push('status: ' + distress.status);
    if (distress.status === 'absent') {
      lines.push('No Distress Survey is stored on this Customer File.');
    } else {
      lines.push('pins: ' + distress.pinCount);
      lines.push('pin photos stored: ' + distress.photoCount);
      (distress.levels || []).forEach(function (level) {
        lines.push('- level ' + (level.canvasId || 'unknown') + ' | ' + level.name + ' | pins: ' + level.pinCount);
      });
    }
    lines.push('');
    section('Photos');
    lines.push('pin-linked: ' + photos.pinLinked);
    lines.push('quick-capture: ' + photos.quickCapture);
    lines.push('unassigned: ' + photos.unassigned);
    lines.push('general: ' + photos.general);
    lines.push('missing bytes: ' + photos.missingBytes);
    lines.push('');
    section('Diagnostics');
    lines.push('status: ' + inventory.components.diagnostics.status);
    lines.push('');
    section('Report Builder');
    lines.push('status: ' + inventory.components.reportBuilder.status);
    lines.push('');
    section('Provenance');
    lines.push('recovery imports: ' + inventory.components.provenance.recoveryImportCount);
    lines.push('observations left out of recovery: ' + (inventory.components.provenance.excludedObservationCount || 0));
    lines.push('');
    section('Limits');
    inventory.limits.forEach(function (limit) { lines.push('- ' + limit); });
    lines.push('');
    section('Gaps');
    if (!inventory.gaps.length) lines.push('- none');
    else inventory.gaps.forEach(function (gap) { lines.push('- ' + gap); });
    lines.push('');
    return lines.join('\n');
  }

  function fileNameFor(record, exportedAt) {
    var name = displayName(record).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Customer-File';
    var day = String(exportedAt || '').slice(0, 10) || 'export';
    return 'Toolbox-AI-' + name.slice(0, 48) + '-' + day + '.zip';
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

  function defaultDeps() {
    return {
      now: function () { return new Date().toISOString(); },
      getPlanMedia: function (id) {
        if (!id || !window.ToolboxDB || typeof window.ToolboxDB.getMedia !== 'function') return Promise.resolve(null);
        return window.ToolboxDB.getMedia(id).catch(function () { return null; });
      },
      getDistressMedia: function (id) { return readDistressMedia(id); },
    };
  }

  async function buildPackage(record, deps) {
    if (!record || typeof record !== 'object' || !record.id) {
      throw new Error('This Customer File is not on this device.');
    }
    if (typeof window.JSZip !== 'function') {
      throw new Error('Export for AI could not build the ZIP in this session.');
    }
    var source;
    try {
      source = clone(record);
    } catch (err) {
      throw new Error('This Customer File could not be read for export.');
    }
    var options = Object.assign(defaultDeps(), deps || {});
    var exportedAt = options.now();
    var gaps = [];
    var omitted = [];
    var binaries = [];
    var textFiles = [];
    var infoMap = canvasInfoMap(source.planSetup && source.planSetup.canvases);
    var canvases = source.planSetup && Array.isArray(source.planSetup.canvases) ? source.planSetup.canvases : [];

    var planDocuments = canvases.map(function (canvas, index) {
      var plan = canvas && canvas.plan && typeof canvas.plan === 'object' ? canvas.plan : null;
      return {
        id: canvas && canvas.id || null,
        name: canvas && canvas.name || 'Floor Plan',
        order: index,
        rooms: canvas && Array.isArray(canvas.rooms) ? canvas.rooms : [],
        frontDoorFacing: canvas && canvas.frontDoorFacing || '',
        frontDoor: canvas && canvas.frontDoor || null,
        plan: plan ? { mediaId: plan.id || null, width: plan.width || null, height: plan.height || null, file: null } : null,
      };
    });

    var storedImages = 0;
    var missingImages = 0;
    await Promise.all(planDocuments.map(async function (canvas) {
      if (!canvas.plan || !canvas.plan.mediaId) return;
      var media = null;
      try {
        media = await mediaBytes(await options.getPlanMedia(canvas.plan.mediaId));
      } catch (err) {
        media = null;
      }
      if (!media || !media.bytes) {
        missingImages += 1;
        gaps.push('Plan image ' + canvas.plan.mediaId + ' for ' + canvas.name + ' is not stored on this device.');
        return;
      }
      var path = 'plans/images/' + slug(canvas.id, 'plan-' + (canvas.order + 1)) + '.' + extFromMime(media.mime);
      canvas.plan.file = path;
      storedImages += 1;
      binaries.push({ path: path, bytes: media.bytes });
    }));

    var floor = source.floorSurvey && typeof source.floorSurvey === 'object' ? source.floorSurvey : null;
    var epochs = floor ? collectEpochs(floor, infoMap) : [];
    var floorPresent = epochs.length > 0;
    var slugUse = {};
    var floorPacked = floorFiles(floorPresent ? epochs : [], slugUse);
    floorPacked.files.forEach(function (file) { textFiles.push(file); });
    var floorDocument = floorPresent ? {
      status: 'present',
      note: 'Each epoch is a separate survey. Each level inside an epoch is separate. Readings are not merged.',
      schemaVersion: floor.schemaVersion || null,
      id: floor.id || null,
      updatedAt: floor.updatedAt || null,
      epochs: epochs.map(function (epoch) {
        return {
          id: epoch.id,
          label: epoch.label,
          surveyDate: epoch.surveyDate || '',
          notes: epoch.notes || '',
          customSurfaces: epoch.customSurfaces || [],
          sourceKind: epoch.sourceKind,
          levels: (epoch.levels || []).map(function (level) {
            return {
              canvasId: level.canvasId,
              name: level.name,
              order: level.order,
              matchedCanvas: level.matchedCanvas,
              planRef: level.planRef,
              summary: level.summary || null,
              source: level.source,
            };
          }),
        };
      }),
    } : {
      status: 'absent',
      note: 'No Floor Survey is stored on this Customer File.',
      epochs: [],
    };
    extractDataUrls(floorDocument, binaries, 'floor-survey/images');

    var distressBuilt = await buildDistress(source, infoMap, options, gaps);
    extractDataUrls(distressBuilt.document, binaries, 'distress/images');

    var diagnosticsRaw = source.diagnostics && typeof source.diagnostics === 'object' ? source.diagnostics : null;
    var diagnosticsPresent = containerPresent(diagnosticsRaw);
    var diagnosticsDocument = diagnosticsPresent
      ? stripSecrets(clone(diagnosticsRaw), 'diagnostics', omitted)
      : { status: 'absent', note: 'No Diagnostics data is stored on this Customer File.' };
    if (diagnosticsPresent) {
      diagnosticsDocument.status = 'present';
      extractDataUrls(diagnosticsDocument, binaries, 'diagnostics/images');
      var figureSlugUse = {};
      var figures = Array.isArray(diagnosticsDocument.figures) ? diagnosticsDocument.figures : [];
      for (var fi = 0; fi < figures.length; fi += 1) {
        var figure = figures[fi];
        if (!figure || typeof figure.mediaId !== 'string' || !figure.mediaId) continue;
        var figMedia = null;
        try {
          figMedia = await mediaBytes(await options.getPlanMedia(figure.mediaId));
        } catch (err) {
          figMedia = null;
        }
        if (!figMedia || !figMedia.bytes) {
          gaps.push('Diagnostics figure ' + figure.mediaId + ' is not stored on this device.');
          continue;
        }
        var figPath = 'diagnostics/images/' + uniqueSlug(figureSlugUse, figure.id || figure.mediaId, 'figure-' + (fi + 1)) + '.' + extFromMime(figMedia.mime);
        figure.file = figPath;
        binaries.push({ path: figPath, bytes: figMedia.bytes });
      }
    }

    var reportRaw = source.reportBuilder || source.report || null;
    var reportPresent = containerPresent(reportRaw);
    var reportDocument = reportPresent
      ? stripSecrets(clone(reportRaw), 'reportBuilder', omitted)
      : { status: 'absent', note: 'No Report Builder state is stored on this Customer File.' };
    if (reportPresent) {
      reportDocument.status = 'present';
      extractDataUrls(reportDocument, binaries, 'report-builder/images');
    }

    var imports = Array.isArray(source.recoveryImports) ? source.recoveryImports : [];
    var provenance = stripSecrets(clone(imports), 'recoveryImports', omitted);
    var leftOutCount = 0;
    imports.forEach(function (entry) {
      if (entry && Array.isArray(entry.excludedObservations)) leftOutCount += entry.excludedObservations.length;
    });
    if (imports.some(function (entry) { return entry && entry.kind === 'distress'; })) {
      var quickCount = distressBuilt.document && distressBuilt.document.quickCaptureCount || 0;
      if (!quickCount) {
        gaps.push('This Customer File has a Distress recovery import and no stored Quick Capture collection. Quick Capture photos are included only when their bytes are already on the file.');
      }
    }
    if (leftOutCount) {
      gaps.push(leftOutCount + ' Distress observation' + (leftOutCount === 1 ? ' was' : 's were') +
        ' left out of recovery and ' + (leftOutCount === 1 ? 'is' : 'are') +
        ' listed in provenance/recovery-imports.json. This package does not invent pins or photos for ' +
        (leftOutCount === 1 ? 'it' : 'them') + '.');
    }

    var photoCounts = distressBuilt.counts || { 'pin-linked': 0, 'quick-capture': 0, unassigned: 0, general: 0, missing: 0 };
    var customer = contactsFrom(source);
    var extra = additionalFields(source, omitted);
    var customerDocument = {
      customerFileId: source.id,
      createdAt: source.createdAt || null,
      updatedAt: source.updatedAt || null,
      customerUpdatedAt: source.customerUpdatedAt || null,
      contacts: customer,
    };
    if (extra) customerDocument.additionalFields = extra;

    var plansDocument = {
      status: canvases.length ? 'present' : 'absent',
      buildingType: source.planSetup && source.planSetup.buildingType || null,
      activeCanvasId: source.planSetup && source.planSetup.activeCanvasId || null,
      canvases: planDocuments,
    };

    var photoIndex = {
      status: 'present',
      photos: distressBuilt.photos.map(function (photo) {
        var copy = Object.assign({}, photo);
        delete copy.bytes;
        return copy;
      }),
    };

    (epochs || []).forEach(function (epoch) {
      (epoch.levels || []).forEach(function (level) {
        (level.omitted || []).forEach(function (path) { omitted.push(path); });
      });
    });
    (distressBuilt.document && distressBuilt.document.omittedFields || []).forEach(function (path) {
      omitted.push(path);
    });
    if (omitted.length) {
      gaps.push('Omitted ' + omitted.length + ' non-report field' + (omitted.length === 1 ? '' : 's') + ' whose names look like credentials.');
    }

    var inventory = {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      customerFileId: source.id,
      exportedAt: exportedAt,
      customerName: customer.customerName,
      propertyAddress: customer.propertyAddress || '',
      components: {
        customer: { status: 'present' },
        plans: {
          status: plansDocument.status,
          canvasCount: canvases.length,
          imagesStored: storedImages,
          imagesMissing: missingImages,
        },
        floorSurvey: {
          status: floorDocument.status,
          epochCount: floorPresent ? epochs.length : 0,
          levelCount: floorPacked.summaries.reduce(function (total, epoch) { return total + epoch.levels.length; }, 0),
          readingCount: floorPacked.readingCount,
          epochs: floorPacked.summaries,
        },
        distress: distressBuilt.summary,
        photos: {
          pinLinked: photoCounts['pin-linked'],
          quickCapture: photoCounts['quick-capture'],
          unassigned: photoCounts.unassigned,
          general: photoCounts.general,
          missingBytes: photoCounts.missing,
        },
        diagnostics: { status: diagnosticsPresent ? 'present' : 'absent' },
        reportBuilder: { status: reportPresent ? 'present' : 'absent' },
        provenance: {
          recoveryImportCount: imports.length,
          excludedObservationCount: leftOutCount,
        },
      },
      limits: LIMITS.slice(),
      gaps: gaps,
    };

    textFiles.push({ path: 'customer.json', text: JSON.stringify(customerDocument, null, 2) });
    textFiles.push({ path: 'plans/plans.json', text: JSON.stringify(plansDocument, null, 2) });
    textFiles.push({ path: 'floor-survey/survey.json', text: JSON.stringify(floorDocument, null, 2) });
    textFiles.push({ path: 'distress/survey.json', text: JSON.stringify(distressBuilt.document, null, 2) });
    if (distressBuilt.csv) textFiles.push({ path: 'distress/pins.csv', text: distressBuilt.csv });
    textFiles.push({ path: 'photos/index.json', text: JSON.stringify(photoIndex, null, 2) });
    textFiles.push({ path: 'diagnostics/diagnostics.json', text: JSON.stringify(diagnosticsDocument, null, 2) });
    textFiles.push({ path: 'report-builder/state.json', text: JSON.stringify(reportDocument, null, 2) });
    textFiles.push({ path: 'provenance/recovery-imports.json', text: JSON.stringify(provenance, null, 2) });

    var inventoryText = renderInventory(inventory);
    textFiles.push({ path: 'INVENTORY.txt', text: inventoryText });
    textFiles.push({ path: 'inventory.json', text: JSON.stringify(inventory, null, 2) });

    binaries.forEach(function (file) {
      textFiles.push({ path: file.path, bytes: file.bytes });
    });

    var manifest = {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      customerFileId: source.id,
      exportedAt: exportedAt,
      customerName: customer.customerName,
      propertyAddress: customer.propertyAddress || '',
      contacts: customer,
      sourceInventory: {
        plans: inventory.components.plans,
        floorSurvey: {
          status: inventory.components.floorSurvey.status,
          epochCount: inventory.components.floorSurvey.epochCount,
          levelCount: inventory.components.floorSurvey.levelCount,
          readingCount: inventory.components.floorSurvey.readingCount,
        },
        distress: inventory.components.distress,
        photos: inventory.components.photos,
        diagnostics: inventory.components.diagnostics,
        reportBuilder: inventory.components.reportBuilder,
        provenance: inventory.components.provenance,
        gaps: inventory.gaps,
      },
      files: [],
    };

    var zip = new window.JSZip();
    var packed = [];
    textFiles.forEach(function (file) {
      if (file.bytes) packed.push({ path: file.path, bytes: file.bytes });
      else packed.push({ path: file.path, text: file.text });
    });
    return finalizePackage(zip, packed, manifest, inventory, inventoryText, fileNameFor(source, exportedAt), distressBuilt);
  }

  function finalizePackage(zip, packed, manifest, inventory, inventoryText, filename, distressBuilt) {
    var photoByteMap = distressBuilt.photoByteMap || {};
    distressBuilt.photos.forEach(function (photo) {
      if (photo.stored && photo.path && photoByteMap[photo.path]) {
        var already = packed.some(function (entry) { return entry.path === photo.path; });
        if (!already) packed.push({ path: photo.path, bytes: photoByteMap[photo.path] });
      }
    });
    manifest.files = packed.map(function (entry) { return entry.path; }).concat(['manifest.json']).filter(function (path, index, list) {
      return list.indexOf(path) === index;
    }).sort();
    packed.push({ path: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
    packed.forEach(function (entry) {
      if (entry.bytes) zip.file(entry.path, entry.bytes, { compression: 'STORE' });
      else zip.file(entry.path, entry.text);
    });
    return {
      zip: zip,
      filename: filename,
      manifest: manifest,
      inventory: inventory,
      inventoryText: inventoryText,
    };
  }

  async function exportCheckedOutFile(customerFileId) {
    if (!customerFileId) throw new Error('Open a Customer File before exporting.');
    if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function') {
      throw new Error('This Customer File is not on this device.');
    }
    var record = await window.ToolboxDB.getCustomerFile(customerFileId);
    if (!record) throw new Error('This Customer File is not on this device.');
    if (record.deletedAt) throw new Error('Restore this Customer File from Trash before exporting.');
    var built = await buildPackage(record);
    var blob = await built.zip.generateAsync({ type: 'blob' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = built.filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return { filename: built.filename, manifest: built.manifest };
  }

  window.ToolboxAiExport = {
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    buildPackage: buildPackage,
    exportCheckedOutFile: exportCheckedOutFile,
  };
})();
