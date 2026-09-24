// Toolbox — permanent standalone recovery import into a Customer File.
//
// Translation is one-way and native:
//   legacy export -> Customer File canvas/media + native app-owned data.
// The original package is not retained as a second survey representation.

(function () {
  'use strict';

  const FLOOR_KIND = 'floor-survey-bundle';
  const FLOOR_VERSION = 1;
  const DISTRESS_DB = 'pgg_photos_v1';
  const DISTRESS_STORE = 'photos';

  function newId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '-' + window.crypto.randomUUID();
    }
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function hex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function fingerprint(bytes) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('This browser cannot verify recovery-package identity.');
    }
    return hex(await window.crypto.subtle.digest('SHA-256', bytes));
  }

  function mimeForName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  function dataUrlFromBase64(base64, mime) {
    return 'data:' + mime + ';base64,' + base64;
  }

  function imageDimensions(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('The recovered plan has invalid dimensions.'));
          return;
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => reject(new Error('The recovered plan image could not be read.'));
      image.src = dataUrl;
    });
  }

  function normalizeZipPath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // macOS zips the export with __MACOSX resource forks whose names still end in
  // pins.json (._pins.json). Those are not a second survey.
  function isIgnoredZipEntry(name, entry) {
    if (entry && entry.dir) return true;
    const normalized = normalizeZipPath(name);
    if (!normalized) return true;
    const parts = normalized.split('/');
    return parts.some((part) => part === '__MACOSX' || part.indexOf('._') === 0);
  }

  function zipEntryByPath(zip, path) {
    const wanted = normalizeZipPath(path).toLowerCase();
    const key = Object.keys(zip.files).find((name) => {
      if (isIgnoredZipEntry(name, zip.files[name])) return false;
      return normalizeZipPath(name).toLowerCase() === wanted;
    });
    return key ? zip.files[key] : null;
  }

  function zipEntriesEnding(zip, suffix) {
    const wanted = String(suffix).toLowerCase();
    return Object.keys(zip.files)
      .filter((name) => !isIgnoredZipEntry(name, zip.files[name]) && normalizeZipPath(name).toLowerCase().endsWith(wanted))
      .map((name) => zip.files[name]);
  }

  function stripBom(text) {
    const value = String(text || '');
    return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
  }

  function photoFileName(photoName) {
    let raw = '';
    if (typeof photoName === 'string') raw = photoName;
    else if (photoName && typeof photoName === 'object') {
      raw = photoName.file || photoName.name || photoName.path || photoName.src || photoName.filename || '';
    }
    const base = normalizeZipPath(raw).split('/').pop();
    return base && base !== '.' && base !== '..' ? base : '';
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (char === '"') {
        if (quoted && source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if (char === '\n' && !quoted) {
        row.push(cell);
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map((value) => value.trim());
    return rows.map((values) => {
      const item = {};
      headers.forEach((header, index) => { item[header] = values[index] || ''; });
      return item;
    });
  }

  function suggestedAddress(fileName, basePath) {
    let raw = basePath ? basePath.replace(/\/$/, '').split('/').pop() : '';
    if (!raw) raw = String(fileName || '').replace(/\.zip$/i, '');
    raw = raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw || /^(distress|survey|export|project)$/i.test(raw)) return '';
    return raw;
  }

  // Standalone export writes x/y as plan-relative fractions and does not clamp
  // a pin to the image. A pin above or below the plan is a real coordinate
  // (y < 0 or y > 1). Keep that fraction and scale it back to pixels.
  function parseNormalized(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error('A Distress observation has an invalid ' + label + ' coordinate.');
    }
    return parsed;
  }

  function observationHeading(source, index) {
    if (!source || typeof source !== 'object') return 'Item ' + (index + 1) + ' in the export';
    const num = Number(source.num);
    const description = cleanText(source.description);
    const head = Number.isFinite(num) ? ('Observation ' + num) : ('Item ' + (index + 1) + ' in the export');
    return description ? (head + ' — ' + description) : head;
  }

  function excludeObservation(excluded, source, index, reason) {
    const num = source && typeof source === 'object' ? Number(source.num) : NaN;
    excluded.push({
      index: index,
      sourceId: source && typeof source === 'object' ? cleanText(source.id) : '',
      num: Number.isFinite(num) ? num : null,
      description: source && typeof source === 'object' ? cleanText(source.description) : '',
      heading: observationHeading(source, index),
      reason: reason,
    });
  }

  async function parseDistress(file, bytes, packageFingerprint) {
    if (!window.JSZip) throw new Error('ZIP recovery support is unavailable.');
    let zip;
    try {
      zip = await window.JSZip.loadAsync(bytes);
    } catch (_) {
      throw new Error('That ZIP could not be read.');
    }

    const pinEntries = zipEntriesEnding(zip, 'pins.json');
    if (pinEntries.length !== 1) {
      throw new Error(pinEntries.length ? 'The ZIP contains more than one pins.json file.' : 'This is not a Distress Survey export (pins.json is missing).');
    }
    const pinsPath = normalizeZipPath(pinEntries[0].name);
    const basePath = pinsPath.slice(0, pinsPath.length - 'pins.json'.length);
    const planEntry = zipEntryByPath(zip, basePath + 'plan.png');
    if (!planEntry) throw new Error('The Distress export does not contain its original plan.png.');

    let sourcePins;
    try {
      sourcePins = JSON.parse(stripBom(await pinEntries[0].async('text')));
    } catch (_) {
      throw new Error('pins.json is malformed.');
    }
    if (!Array.isArray(sourcePins)) throw new Error('pins.json must contain an observation list.');

    const planDataUrl = dataUrlFromBase64(await planEntry.async('base64'), 'image/png');
    const dimensions = await imageDimensions(planDataUrl);
    const ordered = sourcePins.map((pin, index) => ({ pin, index })).sort((a, b) => {
      const aNum = Number(a.pin && a.pin.num);
      const bNum = Number(b.pin && b.pin.num);
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
      return a.index - b.index;
    });

    const firstNum = ordered.length && ordered[0].pin && Number.isFinite(Number(ordered[0].pin.num))
      ? Number(ordered[0].pin.num)
      : 1;
    let expectedNum = firstNum;
    let attachedPhotoCount = 0;
    const pins = [];
    const excludedObservations = [];

    for (const entry of ordered) {
      const source = entry.pin;
      const index = entry.index;
      if (!source || typeof source !== 'object') {
        excludeObservation(excludedObservations, source, index, 'This entry is not a Distress observation.');
        continue;
      }

      const sourceNum = Number(source.num);
      const photoNames = Array.isArray(source.photos) ? source.photos : null;
      let reason = '';
      const photos = [];
      if (!photoNames) {
        reason = 'This observation has an invalid photos list.';
      } else {
        for (const photoName of photoNames) {
          const safeName = photoFileName(photoName);
          if (!safeName) {
            reason = 'This observation references a photo without a file name.';
            break;
          }
          const photoEntry = zipEntryByPath(zip, basePath + 'photos/' + safeName);
          if (!photoEntry) {
            reason = 'A referenced Distress photo is missing: ' + safeName;
            break;
          }
          photos.push({
            sourceName: safeName,
            dataUrl: dataUrlFromBase64(await photoEntry.async('base64'), mimeForName(safeName)),
          });
        }
      }

      let xNormalized = null;
      let yNormalized = null;
      if (!reason) {
        try {
          xNormalized = parseNormalized(source.x, 'x');
          yNormalized = parseNormalized(source.y, 'y');
        } catch (error) {
          reason = error && error.message ? error.message : 'This observation has an invalid coordinate.';
        }
      }
      if (!reason && !Number.isFinite(sourceNum)) {
        reason = 'This observation has no usable number.';
      } else if (!reason && sourceNum !== expectedNum) {
        reason = 'Distress numbering is inconsistent here (expected ' + expectedNum + ', found ' + sourceNum + ').';
      }

      if (reason) {
        excludeObservation(excludedObservations, source, index, reason);
        // The photo list still says how many numbers this slot used, so a later
        // valid observation keeps the number from the export.
        if (photoNames) expectedNum += Math.max(1, photoNames.length);
        continue;
      }

      attachedPhotoCount += photos.length;
      pins.push({
        sourceId: cleanText(source.id),
        num: sourceNum,
        xNormalized: xNormalized,
        yNormalized: yNormalized,
        description: cleanText(source.description),
        location: cleanText(source.room),
        importedLegacyDirection: cleanText(source.direction),
        isExterior: cleanText(source.type).toLowerCase() === 'exterior',
        photos: photos,
      });
      expectedNum += Math.max(1, photos.length);
    }

    const quickPrefix = (basePath + 'quick-capture/').toLowerCase();
    const quickFiles = Object.keys(zip.files).filter((name) => {
      if (isIgnoredZipEntry(name, zip.files[name])) return false;
      const normalized = normalizeZipPath(name).toLowerCase();
      return normalized.startsWith(quickPrefix) &&
        !normalized.endsWith('/quick-capture.csv') && /\.(jpe?g|png|webp|gif)$/i.test(normalized);
    }).sort((a, b) => normalizeZipPath(a).localeCompare(normalizeZipPath(b), undefined, { numeric: true }));
    const quickCsvEntry = zipEntryByPath(zip, basePath + 'quick-capture/quick-capture.csv');
    let quickMetadata = [];
    if (quickCsvEntry) {
      quickMetadata = parseCsv(stripBom(await quickCsvEntry.async('text'))).map((row) => ({
        file: cleanText(row.File || row.file),
        timestamp: cleanText(row.Timestamp || row.timestamp),
        latitude: cleanText(row.Latitude || row.latitude),
        longitude: cleanText(row.Longitude || row.longitude),
      }));
    }
    const quickItems = [];
    for (const name of quickFiles) {
      const sourceName = normalizeZipPath(name).split('/').pop();
      const meta = quickMetadata.find((row) => row.file.toLowerCase() === sourceName.toLowerCase()) || {};
      quickItems.push({
        sourceName: sourceName,
        timestamp: meta.timestamp || '',
        latitude: meta.latitude || '',
        longitude: meta.longitude || '',
        dataUrl: dataUrlFromBase64(await zip.files[name].async('base64'), mimeForName(sourceName)),
      });
    }

    return {
      kind: 'distress',
      label: 'Distress Survey',
      fileName: file.name,
      fingerprint: packageFingerprint,
      planDataUrl,
      planWidth: dimensions.width,
      planHeight: dimensions.height,
      canvasName: 'Recovered Plan',
      startNum: pins.length ? pins[0].num : firstNum,
      nextNum: pins.length
        ? pins[pins.length - 1].num + Math.max(1, pins[pins.length - 1].photos.length)
        : firstNum,
      pins,
      excludedObservations,
      attachedPhotoCount,
      quickCapture: {
        count: quickItems.length,
        metadataCount: quickMetadata.length,
        metadata: quickMetadata,
        files: quickItems,
      },
      suggestedPropertyAddress: suggestedAddress(file.name, basePath),
      ignoredDerivativeCount: ['map.png', 'pinlog.pdf', 'pins.csv'].filter((name) => !!zipEntryByPath(zip, basePath + name)).length,
    };
  }

  function parseClientName(value) {
    const parts = cleanText(value).split(/\s+/).filter(Boolean);
    if (parts.length !== 2) return null;
    return { firstName: parts[0], lastName: parts[1] };
  }

  function isPoint(value) {
    return value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));
  }

  function requirePointArray(value, label) {
    if (!Array.isArray(value) || value.some((point) => !isPoint(point))) {
      throw new Error('The Floor Survey bundle has an invalid ' + label + '.');
    }
  }

  /** Declared plan size must match image pixels (1px rounding only). */
  function dimensionMismatchMessage(floorName, declared, intrinsic) {
    return 'The recovered plan dimensions do not match the coordinate space recorded in the survey, so Toolbox cannot safely guarantee point placement.'
      + (floorName ? ' Level: “' + floorName + '”.' : '')
      + ' Declared ' + declared.width + '×' + declared.height
      + ', image ' + intrinsic.width + '×' + intrinsic.height + '.';
  }

  async function parseFloor(file, bytes, packageFingerprint) {
    let bundle;
    try {
      bundle = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      throw new Error('That file is not valid JSON.');
    }
    if (!bundle || bundle.kind !== FLOOR_KIND || bundle.bundleVersion !== FLOOR_VERSION ||
        !bundle.project || !Array.isArray(bundle.floors) || !Array.isArray(bundle.points)) {
      throw new Error('That is not a supported Floor Survey bundle v1.');
    }
    if (!bundle.floors.length) throw new Error('The Floor Survey bundle contains no floors.');

    const floorIds = new Set();
    const floors = [];
    for (let sourceIndex = 0; sourceIndex < bundle.floors.length; sourceIndex += 1) {
      const source = bundle.floors[sourceIndex];
      if (!source || !cleanText(source.id) || floorIds.has(source.id)) {
        throw new Error('The Floor Survey bundle has invalid floor identities.');
      }
      floorIds.add(source.id);
      if (!cleanText(source.planDataUrl) || !/^data:image\//i.test(source.planDataUrl)) {
        throw new Error('A Floor Survey floor is missing its original embedded plan.');
      }
      const intrinsic = await imageDimensions(source.planDataUrl);
      const declaredW = Number(source.planWidth);
      const declaredH = Number(source.planHeight);
      const hasDeclared = declaredW > 0 && declaredH > 0;
      if (hasDeclared &&
          (Math.abs(declaredW - intrinsic.width) > 1 || Math.abs(declaredH - intrinsic.height) > 1)) {
        throw new Error(dimensionMismatchMessage(
          cleanText(source.name),
          { width: declaredW, height: declaredH },
          intrinsic
        ));
      }
      const width = hasDeclared ? declaredW : intrinsic.width;
      const height = hasDeclared ? declaredH : intrinsic.height;
      requirePointArray(source.boundary || [], 'survey boundary');
      if (source.areas) source.areas.forEach((area) => requirePointArray(area.polygon || [], 'topo area'));
      if (source.exclusions) source.exclusions.forEach((area) => requirePointArray(area.polygon || [], 'exclusion'));
      floors.push({
        source,
        width,
        height,
        sourceIndex,
        intrinsicWidth: intrinsic.width,
        intrinsicHeight: intrinsic.height,
        hasBoundary: Array.isArray(source.boundary) && source.boundary.length >= 3,
        transitionCount: Array.isArray(source.transitions) ? source.transitions.length : 0,
      });
    }
    floors.sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.source.order)) ? Number(a.source.order) : a.sourceIndex;
      const bOrder = Number.isFinite(Number(b.source.order)) ? Number(b.source.order) : b.sourceIndex;
      return aOrder - bOrder || a.sourceIndex - b.sourceIndex;
    });
    bundle.points.forEach((point) => {
      if (!point || !floorIds.has(point.floorId) || !isPoint(point) || !Number.isFinite(Number(point.value))) {
        throw new Error('The Floor Survey bundle contains an invalid reading.');
      }
    });

    const client = parseClientName(bundle.project.client);
    const bp1 = bundle.points.find((point) => point && point.isBasePoint);
    return {
      kind: 'floor',
      label: 'Floor Survey',
      fileName: file.name,
      fingerprint: packageFingerprint,
      bundle,
      floors,
      pointCount: bundle.points.length,
      transitionCount: floors.reduce((total, item) => total + item.transitionCount, 0),
      hasBoundary: floors.some((item) => item.hasBoundary),
      hasBp1: !!(bp1),
      levelNames: floors.map((item) => cleanText(item.source.name) || 'Recovered Floor'),
      customerCandidates: {
        firstName: client ? client.firstName : '',
        lastName: client ? client.lastName : '',
        propertyAddress: cleanText(bundle.project.address),
      },
      unparsedClient: client ? '' : cleanText(bundle.project.client),
      needsClientNameEntry: !client && !!cleanText(bundle.project.client),
    };
  }

  async function inspectFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose a recovery export first.');
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength) throw new Error('The selected recovery export is empty.');
    const packageFingerprint = await fingerprint(bytes);
    const lower = String(file.name || '').toLowerCase();
    if (lower.endsWith('.zip')) return parseDistress(file, bytes, packageFingerprint);
    if (lower.endsWith('.json')) return parseFloor(file, bytes, packageFingerprint);
    throw new Error('Choose a Distress ZIP or Floor Survey JSON bundle.');
  }

  function recoveryImports(record) {
    return record && Array.isArray(record.recoveryImports) ? record.recoveryImports : [];
  }

  function layerHasFloorWork(layer) {
    if (!layer || typeof layer !== 'object') return false;
    if (Array.isArray(layer.points) && layer.points.length) return true;
    if (Array.isArray(layer.boundary) && layer.boundary.length >= 3) return true;
    if (Array.isArray(layer.transitions) && layer.transitions.length) return true;
    if (Array.isArray(layer.areas) && layer.areas.length) return true;
    if (Array.isArray(layer.exclusions) && layer.exclusions.length) return true;
    return false;
  }

  function recordHasFloorWork(record) {
    const byCanvas = record && record.floorSurvey && record.floorSurvey.byCanvasId;
    if (!byCanvas || typeof byCanvas !== 'object') return false;
    return Object.keys(byCanvas).some(function (id) {
      return layerHasFloorWork(byCanvas[id]);
    });
  }

  function isMeaninglessBlankCanvas(canvas, record) {
    if (!canvas) return false;
    if (canvas.plan && canvas.plan.id) return false;
    if (Array.isArray(canvas.rooms) && canvas.rooms.length) return false;
    if (canvas.frontDoor) return false;
    const layer = record.floorSurvey && record.floorSurvey.byCanvasId
      ? record.floorSurvey.byCanvasId[canvas.id]
      : null;
    if (layerHasFloorWork(layer)) return false;
    const pins = record.distress && Array.isArray(record.distress.pins) ? record.distress.pins : [];
    if (pins.some(function (pin) { return pin && pin.canvasId === canvas.id; })) return false;
    return true;
  }

  function displayCustomerLabel(record) {
    if (!record) return 'Customer File';
    if (window.ToolboxApp && window.ToolboxApp.customerIdentity) {
      const name = window.ToolboxApp.customerIdentity.displayName(record);
      const address = window.ToolboxApp.customerIdentity.displayAddress(record);
      if (name && address && address !== 'No property address yet') return name + ' — ' + address;
      return name || address || 'Untitled Customer File';
    }
    const name = [cleanText(record.firstName), cleanText(record.lastName)].filter(Boolean).join(' ');
    const address = cleanText(record.propertyAddress);
    return name && address ? name + ' — ' + address : (name || address || 'Untitled Customer File');
  }

  function sourcePropertyAddress(parsed) {
    if (!parsed) return '';
    if (parsed.kind === 'floor') {
      return cleanText(parsed.customerCandidates && parsed.customerCandidates.propertyAddress);
    }
    return cleanText(parsed.suggestedPropertyAddress);
  }

  function normalizeAddress(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function addressMismatch(parsed, record) {
    const source = sourcePropertyAddress(parsed);
    const destination = cleanText(record && record.propertyAddress);
    if (!source || !destination) return null;
    if (normalizeAddress(source) === normalizeAddress(destination)) return null;
    return { source: source, destination: destination };
  }

  function uniqueIds(ids) {
    const seen = {};
    const list = [];
    (ids || []).forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      list.push(id);
    });
    return list;
  }

  function planMediaRefCount(records, planId) {
    let count = 0;
    (records || []).forEach(function (record) {
      const canvases = record && record.planSetup && Array.isArray(record.planSetup.canvases)
        ? record.planSetup.canvases
        : [];
      canvases.forEach(function (canvas) {
        if (canvas && canvas.plan && canvas.plan.id === planId) count += 1;
      });
    });
    return count;
  }

  function photoRefCount(records, photoId) {
    let count = 0;
    (records || []).forEach(function (record) {
      const pins = record && record.distress && Array.isArray(record.distress.pins)
        ? record.distress.pins
        : [];
      pins.forEach(function (pin) {
        const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
        photos.forEach(function (id) {
          if (id === photoId) count += 1;
        });
      });
      const quick = record && record.distress && Array.isArray(record.distress.quickCapture)
        ? record.distress.quickCapture
        : [];
      quick.forEach(function (item) {
        if (item && item.id === photoId) count += 1;
      });
    });
    return count;
  }

  function canvasHasInvestigatorPlanWork(canvas) {
    if (!canvas) return true;
    if (Array.isArray(canvas.rooms) && canvas.rooms.length) return true;
    if (canvas.frontDoor && typeof canvas.frontDoor.x === 'number' && typeof canvas.frontDoor.y === 'number') return true;
    if (cleanText(canvas.frontDoorFacing)) return true;
    return false;
  }

  function canvasRetentionReason(record, canvas) {
    if (canvasHasInvestigatorPlanWork(canvas)) return 'plan details on this Customer File still use it';
    const pins = record.distress && Array.isArray(record.distress.pins) ? record.distress.pins : [];
    if (pins.some(function (pin) { return pin && pin.canvasId === canvas.id; })) {
      return 'Distress observations still use it';
    }
    const layer = record.floorSurvey && record.floorSurvey.byCanvasId
      ? record.floorSurvey.byCanvasId[canvas.id]
      : null;
    if (layerHasFloorWork(layer)) return 'Floor Survey still uses it';
    const drawings = record.distress && Array.isArray(record.distress.drawings) ? record.distress.drawings : [];
    if (drawings.length && drawings.some(function (drawing) {
      return drawing && (!drawing.canvasId || drawing.canvasId === canvas.id);
    })) {
      return 'Distress drawings still use it';
    }
    return '';
  }

  function fieldConflicts(record, parsed) {
    const candidates = parsed.customerCandidates || {};
    const conflicts = Object.keys(candidates).filter((field) => {
      const imported = cleanText(candidates[field]);
      const existing = cleanText(record[field]);
      return imported && existing && imported !== existing;
    }).map((field) => ({
      field,
      label: field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : field === 'propertyAddress' ? 'Property address' : field,
      existing: cleanText(record[field]),
      imported: cleanText(candidates[field]),
    }));
    if (parsed.kind === 'floor') {
      const metadata = [
        {
          field: 'floorSurvey.inspectionDate',
          label: 'Floor Survey inspection date',
          existing: cleanText(record.floorSurvey.inspectionDate),
          imported: cleanText(parsed.bundle.project.inspectionDate),
        },
        {
          field: 'floorSurvey.surveyNotes',
          label: 'Floor Survey notes',
          existing: cleanText(record.floorSurvey.surveyNotes),
          imported: cleanText(parsed.bundle.project.notes),
        },
        {
          field: 'floorSurvey.customSurfaces',
          label: 'Floor Survey custom surfaces',
          existing: Array.isArray(record.floorSurvey.customSurfaces) ? record.floorSurvey.customSurfaces.join(', ') : '',
          imported: Array.isArray(parsed.bundle.project.customSurfaces) ? parsed.bundle.project.customSurfaces.join(', ') : '',
        },
      ];
      metadata.forEach((item) => {
        if (item.imported && item.existing && item.imported !== item.existing) conflicts.push(item);
      });
    }
    return conflicts;
  }

  async function listImportDestinations() {
    const all = await window.ToolboxDB.getAllCustomerFiles();
    return all
      .filter(function (record) { return record && !record.deletedAt; })
      .sort(function (a, b) {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      })
      .map(function (record) {
        return {
          id: record.id,
          label: displayCustomerLabel(record),
          hasFloorWork: recordHasFloorWork(record),
        };
      });
  }

  async function getImportContext(parsed, customerFileId) {
    const existing = customerFileId ? await window.ToolboxDB.getCustomerFile(customerFileId) : null;
    if (existing && existing.deletedAt) throw new Error('Restore this Customer File before importing into it.');
    const record = existing ? clone(existing) : window.ToolboxApp.blankCustomerFile(customerFileId || newId('cf'));
    window.ToolboxPlanSetup.ensurePlanSetup(record);
    const duplicate = recoveryImports(record).some((entry) => entry && entry.fingerprint === parsed.fingerprint);
    const existingDistressPins = record.distress && Array.isArray(record.distress.pins)
      ? record.distress.pins.length
      : 0;
    const existingDistressDrawings = record.distress && Array.isArray(record.distress.drawings)
      ? record.distress.drawings.length
      : 0;
    const hasFloorWork = recordHasFloorWork(record);
    return {
      isNew: !existing,
      record,
      destinationId: record.id,
      destinationLabel: existing ? displayCustomerLabel(existing) : 'New Customer File',
      targetUpdatedAt: existing ? existing.updatedAt : null,
      duplicate,
      conflicts: fieldConflicts(record, parsed),
      blocksDistressMerge: parsed.kind === 'distress' && (existingDistressPins > 0 || existingDistressDrawings > 0),
      hasFloorWork: hasFloorWork,
      requiresFloorAddConfirm: parsed.kind === 'floor' && !!existing && hasFloorWork,
      addressWarning: addressMismatch(parsed, record),
    };
  }

  function applyCustomerFields(record, parsed, options) {
    const candidates = Object.assign({}, parsed.customerCandidates || {});
    if (options.clientFirstName != null || options.clientLastName != null) {
      candidates.firstName = cleanText(options.clientFirstName);
      candidates.lastName = cleanText(options.clientLastName);
    }
    const choices = options.fieldChoices || {};
    const updates = [];
    Object.keys(candidates).forEach((field) => {
      const imported = cleanText(candidates[field]);
      if (!imported) return;
      const existing = cleanText(record[field]);
      if (!existing) {
        record[field] = imported;
        updates.push({ field, value: imported, action: 'added' });
      } else if (existing !== imported && choices[field] === 'import') {
        record[field] = imported;
        updates.push({ field, value: imported, action: 'updated' });
      }
    });
    if (parsed.kind === 'distress' && options.useSuggestedAddress && parsed.suggestedPropertyAddress) {
      const existing = cleanText(record.propertyAddress);
      if (!existing || options.fieldChoices.propertyAddress === 'import') {
        record.propertyAddress = parsed.suggestedPropertyAddress;
        updates.push({ field: 'propertyAddress', value: parsed.suggestedPropertyAddress, action: existing ? 'updated' : 'added' });
      }
    }
    return updates;
  }

  function openDistressDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DISTRESS_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DISTRESS_STORE)) {
          request.result.createObjectStore(DISTRESS_STORE);
        }
      };
      request.onerror = () => reject(request.error || new Error('Distress photo storage could not be opened.'));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function writeDistressPhotos(entries) {
    if (!entries.length) return;
    const db = await openDistressDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DISTRESS_STORE, 'readwrite');
        const store = tx.objectStore(DISTRESS_STORE);
        entries.forEach((entry) => store.put(entry.value, entry.id));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('A recovered Distress photo could not be stored.'));
        tx.onabort = () => reject(tx.error || new Error('Recovered Distress photo staging was cancelled.'));
      });
    } finally {
      db.close();
    }
  }

  async function deleteDistressPhotos(ids) {
    if (!ids.length) return;
    const db = await openDistressDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DISTRESS_STORE, 'readwrite');
        const store = tx.objectStore(DISTRESS_STORE);
        ids.forEach((id) => store.delete(id));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Staged Distress photo cleanup failed.'));
        tx.onabort = () => reject(tx.error || new Error('Staged Distress photo cleanup was cancelled.'));
      });
    } finally {
      db.close();
    }
  }

  function importedCanvas(name, planId, width, height) {
    const canvas = window.ToolboxPlanSetup.blankCanvas(name || 'Recovered Plan');
    canvas.plan = { id: planId, width, height };
    canvas.rooms = [];
    // Legacy Distress exports do not include reliable orientation/origin.
    canvas.frontDoorFacing = '';
    canvas.frontDoor = null;
    return canvas;
  }

  function addImportedCanvases(record, canvases, isNew) {
    if (isNew) {
      record.planSetup.canvases = canvases;
    } else {
      const importedIds = {};
      canvases.forEach(function (canvas) { importedIds[canvas.id] = true; });
      const kept = (record.planSetup.canvases || []).filter(function (canvas) {
        return importedIds[canvas.id] || !isMeaninglessBlankCanvas(canvas, record);
      });
      record.planSetup.canvases = canvases.concat(kept);
    }
    record.planSetup.activeCanvasId = canvases[0].id;
    record.planSetup.updatedAt = new Date().toISOString();
  }

  function prepareDistress(record, parsed, isNew) {
    const planId = newId('plan-import');
    const canvas = importedCanvas(parsed.canvasName, planId, parsed.planWidth, parsed.planHeight);
    addImportedCanvases(record, [canvas], isNew);

    const photoEntries = [];
    const photoSources = {};
    const pins = parsed.pins.map((source) => {
      const photoIds = source.photos.map((photo) => {
        const id = newId('ph_import');
        photoEntries.push({ id, value: photo.dataUrl });
        if (photo.sourceName) photoSources[id] = photo.sourceName;
        return id;
      });
      return {
        id: newId('pin-import'),
        num: source.num,
        x: source.xNormalized * parsed.planWidth,
        y: source.yNormalized * parsed.planHeight,
        photos: photoIds,
        description: source.description,
        location: source.location || null,
        category: null,
        extPhotoCount: 0,
        isExterior: source.isExterior,
        canvasId: canvas.id,
        importedLegacyDirection: source.importedLegacyDirection || '',
      };
    });
    const quickFiles = parsed.quickCapture && Array.isArray(parsed.quickCapture.files)
      ? parsed.quickCapture.files
      : [];
    const quickCapture = quickFiles.map((photo) => {
      const id = newId('ph_import');
      photoEntries.push({ id, value: photo.dataUrl });
      if (photo.sourceName) photoSources[id] = photo.sourceName;
      return {
        id: id,
        sourceName: photo.sourceName || '',
        timestamp: photo.timestamp || '',
        latitude: photo.latitude || '',
        longitude: photo.longitude || '',
      };
    });

    record.distress.pins = pins;
    record.distress.drawings = [];
    record.distress.startNum = parsed.startNum;
    record.distress.nextNum = parsed.nextNum;
    record.distress.activeCanvasId = canvas.id;
    record.distress.quickCapture = quickCapture;
    record.distress.photoSources = photoSources;
    record.distress.updatedAt = new Date().toISOString();

    return {
      mediaEntries: [{ id: planId, value: parsed.planDataUrl }],
      photoEntries,
      pinIds: pins.map(function (pin) { return pin.id; }),
      canvasIds: [canvas.id],
      result: {
        kind: 'distress',
        observations: pins.length,
        photos: pins.reduce((total, pin) => total + pin.photos.length, 0),
        quickCaptureCount: quickCapture.length,
        canvasName: canvas.name,
      },
    };
  }

  function mappedFloorLayer(parsed, floorItem, canvasId) {
    const source = floorItem.source;
    const now = Date.now();
    const transitionIds = {};
    (source.transitions || []).forEach((transition) => {
      transitionIds[transition.id] = newId('transition-import');
    });
    const transitions = (source.transitions || []).map((transition) => ({
      ...clone(transition),
      id: transitionIds[transition.id],
      parentId: transition.parentId ? transitionIds[transition.parentId] : undefined,
    }));
    const points = parsed.bundle.points.filter((point) => point.floorId === source.id).map((point) => ({
      ...clone(point),
      id: newId('point-import'),
      floorId: canvasId,
      transitionId: point.transitionId ? transitionIds[point.transitionId] : undefined,
      createdAt: Number.isFinite(Number(point.createdAt)) ? Number(point.createdAt) : now,
    }));
    const layer = {
      canvasId,
      boundary: clone(source.boundary || []),
      points,
      createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : now,
      updatedAt: now,
    };
    if (Array.isArray(source.areas)) {
      layer.areas = source.areas.map((area) => ({ ...clone(area), id: newId('area-import') }));
    }
    if (source.scale) layer.scale = clone(source.scale);
    if (source.highPinDx != null) layer.highPinDx = source.highPinDx;
    if (source.highPinDy != null) layer.highPinDy = source.highPinDy;
    if (source.lowPinDx != null) layer.lowPinDx = source.lowPinDx;
    if (source.lowPinDy != null) layer.lowPinDy = source.lowPinDy;
    if (Array.isArray(source.notes)) {
      layer.notes = source.notes.map((note) => ({ ...clone(note), id: newId('note-import') }));
    }
    if (transitions.length) layer.transitions = transitions;
    if (source.transitionGroupAverages) layer.transitionGroupAverages = clone(source.transitionGroupAverages);
    if (Array.isArray(source.exclusions)) {
      layer.exclusions = source.exclusions.map((item) => ({ ...clone(item), id: newId('exclusion-import') }));
    }
    if (source.planTransform) layer.planTransform = clone(source.planTransform);
    if (source.bp1Gps) layer.bp1Gps = clone(source.bp1Gps);
    return layer;
  }

  function applyFloorMetadata(record, parsed, choices) {
    const project = parsed.bundle.project;
    const date = cleanText(project.inspectionDate);
    const notes = cleanText(project.notes);
    const surfaces = Array.isArray(project.customSurfaces) ? clone(project.customSurfaces) : [];
    if (date && (!cleanText(record.floorSurvey.inspectionDate) || choices['floorSurvey.inspectionDate'] === 'import')) {
      record.floorSurvey.inspectionDate = date;
    }
    if (notes && (!cleanText(record.floorSurvey.surveyNotes) || choices['floorSurvey.surveyNotes'] === 'import')) {
      record.floorSurvey.surveyNotes = notes;
    }
    if (surfaces.length &&
        ((!Array.isArray(record.floorSurvey.customSurfaces) || !record.floorSurvey.customSurfaces.length) ||
         choices['floorSurvey.customSurfaces'] === 'import')) {
      record.floorSurvey.customSurfaces = surfaces;
    }
  }

  function floorMetadataSnapshot(record) {
    const floor = record && record.floorSurvey ? record.floorSurvey : {};
    return {
      inspectionDate: cleanText(floor.inspectionDate),
      surveyNotes: cleanText(floor.surveyNotes),
      customSurfaces: Array.isArray(floor.customSurfaces) ? floor.customSurfaces.slice() : [],
    };
  }

  function sameSurfaceList(left, right) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    return a.length === b.length && a.every(function (item, index) { return item === b[index]; });
  }

  // Restore date/notes/surfaces only when this import was the last Floor Survey
  // and the investigator has not edited those shared fields since.
  function maybeRestoreFloorMetadata(record, entry) {
    if (!entry || !entry.floorMetadataBefore || !entry.floorMetadataWritten) return false;
    if (recordHasFloorWork(record)) return false;
    if (recoveryImports(record).some(function (item) { return item && item.kind === 'floor'; })) return false;
    const before = entry.floorMetadataBefore;
    const written = entry.floorMetadataWritten;
    const floor = record.floorSurvey;
    if (cleanText(floor.inspectionDate) === cleanText(written.inspectionDate)) {
      floor.inspectionDate = before.inspectionDate || '';
    }
    if (cleanText(floor.surveyNotes) === cleanText(written.surveyNotes)) {
      floor.surveyNotes = before.surveyNotes || '';
    }
    const currentSurfaces = Array.isArray(floor.customSurfaces) ? floor.customSurfaces : [];
    if (sameSurfaceList(currentSurfaces, written.customSurfaces)) {
      floor.customSurfaces = Array.isArray(before.customSurfaces) ? before.customSurfaces.slice() : [];
    }
    return true;
  }

  function prepareFloor(record, parsed, isNew, options) {
    const mediaEntries = [];
    const canvases = parsed.floors.map((floorItem, index) => {
      const planId = newId('plan-import');
      mediaEntries.push({ id: planId, value: floorItem.source.planDataUrl });
      return importedCanvas(floorItem.source.name || 'Recovered Floor ' + (index + 1), planId, floorItem.width, floorItem.height);
    });
    addImportedCanvases(record, canvases, isNew);
    if (isNew) record.distress.activeCanvasId = canvases[0].id;
    parsed.floors.forEach((floorItem, index) => {
      const canvasId = canvases[index].id;
      record.floorSurvey.byCanvasId[canvasId] = mappedFloorLayer(parsed, floorItem, canvasId);
    });
    applyFloorMetadata(record, parsed, options.fieldChoices || {});
    record.floorSurvey.updatedAt = new Date().toISOString();
    return {
      mediaEntries,
      photoEntries: [],
      canvasIds: canvases.map((canvas) => canvas.id),
      result: {
        kind: 'floor',
        readings: parsed.pointCount,
        transitions: parsed.transitionCount,
        floorCount: canvases.length,
        canvasName: canvases[0].name,
      },
    };
  }

  async function applyImport(parsed, customerFileId, options) {
    options = options || {};
    if (!cleanText(customerFileId)) throw new Error('Choose where the recovered work should go.');
    const current = await window.ToolboxDB.getCustomerFile(customerFileId);
    if (current && current.deletedAt) throw new Error('Restore this Customer File before importing into it.');
    const isNew = !current;
    if (!isNew && options.targetUpdatedAt !== current.updatedAt) {
      throw new Error('This Customer File changed after the preview. Reopen Import and review it again.');
    }
    const record = current ? clone(current) : window.ToolboxApp.blankCustomerFile(customerFileId);
    window.ToolboxPlanSetup.ensurePlanSetup(record);
    if (recoveryImports(record).some((entry) => entry && entry.fingerprint === parsed.fingerprint)) {
      throw new Error('This recovery package has already been imported into this Customer File.');
    }
    if (!isNew && options.canvasChoice !== 'add') {
      throw new Error('Choose how the recovered original plan should be added.');
    }
    if (parsed.kind === 'floor' && !isNew && recordHasFloorWork(record) && !options.confirmAddFloorLevels) {
      throw new Error('This Customer File already has Floor Survey work. Confirm adding the recovered survey as additional level(s).');
    }
    if (parsed.needsClientNameEntry) {
      const first = cleanText(options.clientFirstName);
      const last = cleanText(options.clientLastName);
      if (!first && !last) {
        throw new Error('Enter the customer first and last name before importing.');
      }
    }
    const effectiveParsed = Object.assign({}, parsed, {
      customerCandidates: Object.assign({}, parsed.customerCandidates || {}),
    });
    if (options.clientFirstName != null || options.clientLastName != null) {
      effectiveParsed.customerCandidates.firstName = cleanText(options.clientFirstName);
      effectiveParsed.customerCandidates.lastName = cleanText(options.clientLastName);
    }
    const resolvedConflicts = fieldConflicts(record, effectiveParsed);
    resolvedConflicts.forEach((conflict) => {
      if (!['keep', 'import'].includes(options.fieldChoices && options.fieldChoices[conflict.field])) {
        throw new Error('Resolve the ' + conflict.field + ' conflict before importing.');
      }
    });
    if (parsed.kind === 'distress' &&
        ((record.distress.pins && record.distress.pins.length) ||
         (record.distress.drawings && record.distress.drawings.length))) {
      throw new Error('This Customer File already has Distress work. Use a new Customer File so existing work and historical numbering are not changed.');
    }
    const excludedObservations = parsed.kind === 'distress' && Array.isArray(parsed.excludedObservations)
      ? parsed.excludedObservations
      : [];
    if (excludedObservations.length && !parsed.pins.length) {
      throw new Error('No Distress observations in this export can be imported. The original file was not changed.');
    }
    if (excludedObservations.length && !options.acknowledgeExcludedObservations) {
      throw new Error('Review the observations that cannot be imported before continuing.');
    }

    const customerUpdates = applyCustomerFields(record, effectiveParsed, options);
    const floorMetadataBefore = parsed.kind === 'floor' ? floorMetadataSnapshot(record) : null;
    const prepared = parsed.kind === 'distress'
      ? prepareDistress(record, parsed, isNew)
      : prepareFloor(record, parsed, isNew, options);
    const now = new Date().toISOString();
    record.updatedAt = now;
    if ((customerUpdates && customerUpdates.length) || isNew || !record.customerUpdatedAt) {
      record.customerUpdatedAt = now;
    }
    if (!record.trashUpdatedAt) record.trashUpdatedAt = '1970-01-01T00:00:00.001Z';
    const recoveryEntry = {
      fingerprint: parsed.fingerprint,
      kind: parsed.kind,
      sourceName: parsed.fileName,
      importedAt: now,
      canvasIds: prepared.canvasIds,
      planMediaIds: prepared.mediaEntries.map(function (entry) { return entry.id; }),
      pinIds: prepared.pinIds || [],
      photoIds: prepared.photoEntries.map(function (entry) { return entry.id; }),
    };
    if (excludedObservations.length) {
      recoveryEntry.excludedObservations = excludedObservations.map(function (item) {
        return {
          num: item.num,
          description: item.description,
          sourceId: item.sourceId,
          heading: item.heading,
          reason: item.reason,
        };
      });
    }
    if (floorMetadataBefore) {
      recoveryEntry.floorMetadataBefore = floorMetadataBefore;
      recoveryEntry.floorMetadataWritten = floorMetadataSnapshot(record);
    }
    record.recoveryImports = recoveryImports(record).concat([recoveryEntry]);

    const stagedPhotoIds = prepared.photoEntries.map((entry) => entry.id);
    try {
      await writeDistressPhotos(prepared.photoEntries);
      await window.ToolboxDB.importCustomerFileRecovery(
        record,
        prepared.mediaEntries,
        current ? current.updatedAt : null,
        isNew,
      );
    } catch (error) {
      try {
        await deleteDistressPhotos(stagedPhotoIds);
      } catch (cleanupError) {
        throw new Error((error && error.message ? error.message : 'Import failed.') +
          ' Staged photo cleanup also failed; no completed Customer File was saved.');
      }
      throw error;
    }
    return {
      record,
      customerUpdates,
      destinationId: record.id,
      fingerprint: parsed.fingerprint,
      ...prepared.result,
    };
  }

  function removalSummaryLines(plan) {
    const lines = [];
    if (plan.kind === 'distress') {
      lines.push(plan.observationsRemoved + ' recovered observation' + (plan.observationsRemoved === 1 ? '' : 's'));
      lines.push(plan.photosRemoved + ' recovered photo' + (plan.photosRemoved === 1 ? '' : 's') + ' will be deleted');
      if (plan.photosKeptShared) {
        lines.push(plan.photosKeptShared + ' photo' + (plan.photosKeptShared === 1 ? '' : 's') +
          ' will stay because another Customer File still uses ' + (plan.photosKeptShared === 1 ? 'it' : 'them'));
      }
      if (plan.keptObservations) {
        lines.push(plan.keptObservations + ' observation' + (plan.keptObservations === 1 ? '' : 's') +
          ' added after this import will stay');
      }
      lines.push('Floor Survey will not be changed.');
    } else {
      lines.push(plan.readingsRemoved + ' recovered reading' + (plan.readingsRemoved === 1 ? '' : 's'));
      lines.push(plan.layersRemoved + ' recovered level' + (plan.layersRemoved === 1 ? '' : 's'));
      lines.push('Distress Survey will not be changed.');
      lines.push(plan.floorMetadataRestored
        ? 'Floor Survey date, notes, and custom surfaces return to what they were before this import, where they were not edited afterward.'
        : 'Floor Survey date, notes, and custom surfaces stay. They are shared on the Customer File.');
    }
    if (plan.canvasesRemoved) {
      lines.push(plan.canvasesRemoved + ' recovered plan' + (plan.canvasesRemoved === 1 ? '' : 's') + ' will be removed');
    }
    (plan.canvasNamesKept || []).forEach(function (line) { lines.push(line); });
    lines.push('Customer information will not be changed' +
      (plan.customerLabel ? ' (' + plan.customerLabel + ').' : '.'));
    return lines;
  }

  // Prove which pins, photos, and plan bytes belong to one recoveryImports
  // entry, then build the Customer File that remains. Nothing is written here.
  // Legacy entries recorded only canvas ids. New entries also record pin,
  // photo, and plan media ids. Media bytes are deleted only when no Customer
  // File, including Trash, still references them.
  function planImportedRemoval(record, entry, allRecords) {
    const plan = {
      fingerprint: entry && entry.fingerprint,
      kind: entry && entry.kind,
      label: entry && entry.kind === 'floor' ? 'Floor Survey' : 'Distress Survey',
      sourceName: entry && entry.sourceName ? entry.sourceName : '',
      blocked: false,
      blockReason: '',
      observationsRemoved: 0,
      keptObservations: 0,
      photosOnComponent: 0,
      photosRemoved: 0,
      photosKeptShared: 0,
      readingsRemoved: 0,
      layersRemoved: 0,
      canvasesRemoved: 0,
      canvasNamesKept: [],
      planMediaIdsToDelete: [],
      photoIdsToDelete: [],
      floorMetadataRestored: false,
      customerLabel: displayCustomerLabel(record),
      nextRecord: null,
    };
    if (!record || !entry || (entry.kind !== 'distress' && entry.kind !== 'floor')) {
      plan.blocked = true;
      plan.blockReason = 'This recovered import cannot be identified.';
      return plan;
    }
    const canvasIds = Array.isArray(entry.canvasIds) ? entry.canvasIds.filter(Boolean) : [];
    if (!canvasIds.length) {
      plan.blocked = true;
      plan.blockReason = 'This import did not record which canvas it created, so Toolbox will not guess what to remove.';
      return plan;
    }

    const next = clone(record);
    window.ToolboxPlanSetup.ensurePlanSetup(next);
    const canvasIdSet = {};
    canvasIds.forEach(function (id) { canvasIdSet[id] = true; });
    const photoCandidates = [];

    if (entry.kind === 'distress') {
      const explicit = Array.isArray(entry.pinIds) && Array.isArray(entry.photoIds);
      const ownedPhotoIds = {};
      if (explicit) entry.photoIds.forEach(function (id) { if (id) ownedPhotoIds[id] = true; });
      const ownedPinIds = {};
      if (explicit) entry.pinIds.forEach(function (id) { if (id) ownedPinIds[id] = true; });
      const pins = next.distress && Array.isArray(next.distress.pins) ? next.distress.pins : [];
      const ownedPins = [];
      const otherPins = [];
      let foreignOnImportedCanvas = false;
      pins.forEach(function (pin) {
        if (!pin) return;
        const onCanvas = !!canvasIdSet[pin.canvasId];
        const importedId = typeof pin.id === 'string' && pin.id.indexOf('pin-import-') === 0;
        const owned = explicit ? !!ownedPinIds[pin.id] : onCanvas && importedId;
        if (owned) ownedPins.push(pin);
        else {
          otherPins.push(pin);
          if (!explicit && onCanvas && !importedId) foreignOnImportedCanvas = true;
        }
      });
      if (!explicit && !ownedPins.length && foreignOnImportedCanvas) {
        plan.blocked = true;
        plan.blockReason = 'Toolbox cannot prove which Distress observations belong to this import, so nothing was removed.';
        return plan;
      }
      const laterPhotos = [];
      ownedPins.forEach(function (pin) {
        (pin.photos || []).forEach(function (id) {
          if (typeof id !== 'string' || id.indexOf('ph_') !== 0) return;
          const ownedPhoto = explicit ? !!ownedPhotoIds[id] : id.indexOf('ph_import-') === 0;
          if (!ownedPhoto) laterPhotos.push(id);
          else photoCandidates.push(id);
        });
      });
      if (laterPhotos.length) {
        plan.blocked = true;
        plan.blockReason = 'Photographs were added to this recovered Distress Survey after import. Toolbox will not remove it, because those photographs are later field work.';
        return plan;
      }
      const quickItems = next.distress && Array.isArray(next.distress.quickCapture) ? next.distress.quickCapture : [];
      const keptQuick = [];
      const laterQuick = [];
      quickItems.forEach(function (item) {
        const id = item && item.id;
        if (typeof id !== 'string' || id.indexOf('ph_') !== 0) {
          keptQuick.push(item);
          return;
        }
        const ownedPhoto = explicit ? !!ownedPhotoIds[id] : id.indexOf('ph_import-') === 0;
        if (!ownedPhoto) laterQuick.push(id);
        else photoCandidates.push(id);
      });
      if (laterQuick.length) {
        plan.blocked = true;
        plan.blockReason = 'Photographs were added to this recovered Distress Survey after import. Toolbox will not remove it, because those photographs are later field work.';
        return plan;
      }
      next.distress.quickCapture = keptQuick;
      if (next.distress.photoSources && typeof next.distress.photoSources === 'object') {
        const sources = {};
        Object.keys(next.distress.photoSources).forEach(function (id) {
          if (photoCandidates.indexOf(id) === -1) sources[id] = next.distress.photoSources[id];
        });
        next.distress.photoSources = sources;
      }
      next.distress.pins = otherPins;
      if (!otherPins.length) {
        const drawings = next.distress.drawings || [];
        if (!drawings.length) {
          next.distress.startNum = 1;
          next.distress.nextNum = 1;
        } else {
          next.distress.nextNum = next.distress.startNum || 1;
        }
      } else {
        let nextNum = next.distress.startNum || 1;
        otherPins.forEach(function (pin) {
          pin.num = nextNum;
          nextNum += Math.max(1, (pin.photos || []).length);
        });
        next.distress.nextNum = nextNum;
      }
      plan.observationsRemoved = ownedPins.length;
      plan.keptObservations = otherPins.length;
    } else {
      canvasIds.forEach(function (id) {
        const layer = next.floorSurvey && next.floorSurvey.byCanvasId
          ? next.floorSurvey.byCanvasId[id]
          : null;
        if (!layer) return;
        plan.readingsRemoved += Array.isArray(layer.points) ? layer.points.length : 0;
        plan.layersRemoved += 1;
        delete next.floorSurvey.byCanvasId[id];
      });
    }

    const planIdByCanvas = {};
    canvasIds.forEach(function (id) {
      const canvas = (record.planSetup && record.planSetup.canvases || []).find(function (item) {
        return item && item.id === id;
      });
      if (canvas && canvas.plan && canvas.plan.id) planIdByCanvas[id] = canvas.plan.id;
    });
    const removeCanvasIds = [];
    canvasIds.forEach(function (id) {
      const canvas = (next.planSetup.canvases || []).find(function (item) { return item && item.id === id; });
      if (!canvas) return;
      const reason = canvasRetentionReason(next, canvas);
      if (reason) {
        plan.canvasNamesKept.push((canvas.name || 'Recovered plan') + ' stays because ' + reason + '.');
        return;
      }
      removeCanvasIds.push(id);
    });
    if (removeCanvasIds.length) {
      const removing = {};
      removeCanvasIds.forEach(function (id) { removing[id] = true; });
      next.planSetup.canvases = (next.planSetup.canvases || []).filter(function (canvas) {
        return canvas && !removing[canvas.id];
      });
    }
    next.recoveryImports = recoveryImports(next).filter(function (item) {
      return !item || item.fingerprint !== entry.fingerprint;
    });
    if (entry.kind === 'floor') {
      plan.floorMetadataRestored = maybeRestoreFloorMetadata(next, entry);
    }

    const now = new Date().toISOString();
    window.ToolboxPlanSetup.ensurePlanSetup(next);
    next.updatedAt = now;
    if (entry.kind === 'distress' && next.distress) next.distress.updatedAt = now;
    if (entry.kind === 'floor' && next.floorSurvey) next.floorSurvey.updatedAt = now;
    const originalCanvases = record.planSetup && record.planSetup.canvases ? record.planSetup.canvases : [];
    const canvasesChanged = next.planSetup.canvases.length !== originalCanvases.length ||
      next.planSetup.activeCanvasId !== record.planSetup.activeCanvasId;
    if (canvasesChanged && next.planSetup) next.planSetup.updatedAt = now;

    const universe = (allRecords || [record]).filter(function (item) {
      return item && item.id !== record.id;
    }).concat([next]);
    const planCandidates = [];
    removeCanvasIds.forEach(function (id) {
      if (planIdByCanvas[id]) planCandidates.push(planIdByCanvas[id]);
    });
    if (Array.isArray(entry.planMediaIds)) {
      entry.planMediaIds.forEach(function (id) {
        if (id && planMediaRefCount(universe, id) === 0) planCandidates.push(id);
      });
    }
    const photoList = uniqueIds(photoCandidates);
    plan.photosOnComponent = photoList.length;
    plan.photoIdsToDelete = photoList.filter(function (id) { return photoRefCount(universe, id) === 0; });
    plan.photosRemoved = plan.photoIdsToDelete.length;
    plan.photosKeptShared = photoList.length - plan.photoIdsToDelete.length;
    plan.planMediaIdsToDelete = uniqueIds(planCandidates).filter(function (id) {
      return planMediaRefCount(universe, id) === 0;
    });
    plan.canvasesRemoved = removeCanvasIds.length;
    plan.nextRecord = next;
    return plan;
  }

  async function removeImportedComponent(customerFileId, fingerprint) {
    const current = await window.ToolboxDB.getCustomerFile(customerFileId);
    if (!current) throw new Error('Customer File was not found.');
    if (current.deletedAt) throw new Error('Restore this Customer File before changing a recovered import.');
    const entry = recoveryImports(current).find(function (item) {
      return item && item.fingerprint === fingerprint;
    });
    if (!entry) throw new Error('That recovered import is no longer on this Customer File.');
    const all = await window.ToolboxDB.getAllCustomerFiles();
    const plan = planImportedRemoval(current, entry, all);
    if (plan.blocked) throw new Error(plan.blockReason);
    const expectedUpdatedAt = current.updatedAt;
    await window.ToolboxDB.commitCustomerFileRecoveryUpdate(
      plan.nextRecord,
      expectedUpdatedAt,
      plan.planMediaIdsToDelete,
    );
    try {
      await deleteDistressPhotos(plan.photoIdsToDelete);
    } catch (cleanupError) {
      throw new Error('The imported ' + plan.label + ' was removed, but photo cleanup failed. Unrelated media was not deleted.');
    }
    return plan;
  }

  function summaryRows(parsed, context) {
    const sourceFile = parsed.fileName || 'Unnamed file';
    if (parsed.kind === 'distress') {
      return [
        ['Import', 'Distress Survey'],
        ['Source file', sourceFile],
        ['Property address', parsed.suggestedPropertyAddress || 'Not in this export'],
        ['Customer', 'Not in this export'],
        ['Survey date', 'Not in this export'],
        ['Plan', 'Original plan found'],
        ['Observations', parsed.excludedObservations && parsed.excludedObservations.length
          ? (parsed.pins.length + ' ready, ' + parsed.excludedObservations.length + ' left out')
          : String(parsed.pins.length)],
        ['Attached photos', String(parsed.attachedPhotoCount)],
        ['Quick Capture', parsed.quickCapture.count + ' photo' + (parsed.quickCapture.count === 1 ? '' : 's') + ' — separate folder, not placed on the plan'],
        ['Destination', context && context.destinationLabel ? context.destinationLabel : '—'],
      ];
    }
    const notes = cleanText(parsed.bundle.project.notes);
    const surfaces = Array.isArray(parsed.bundle.project.customSurfaces) ? parsed.bundle.project.customSurfaces : [];
    const levelLabel = (parsed.levelNames || []).join(', ') || 'Recovered Floor';
    const customerLabel = [parsed.customerCandidates.firstName, parsed.customerCandidates.lastName].filter(Boolean).join(' ')
      || (parsed.unparsedClient ? parsed.unparsedClient + ' — enter name below' : 'Not provided');
    return [
      ['Import', 'Floor Survey'],
      ['Source file', sourceFile],
      ['Customer', customerLabel],
      ['Property', parsed.customerCandidates.propertyAddress || 'Not provided'],
      ['Survey date', cleanText(parsed.bundle.project.inspectionDate) || 'Not provided'],
      ['Destination', context && context.destinationLabel ? context.destinationLabel : '—'],
      ['Recovered level', levelLabel],
      ['Plan recovered', parsed.floors.length ? 'Yes' : 'No'],
      ['Boundary recovered', parsed.hasBoundary ? 'Yes' : 'No'],
      ['Survey readings', String(parsed.pointCount)],
      ['BP1 recovered', parsed.hasBp1 ? 'Yes' : 'No'],
      ['Transitions / corrections', String(parsed.transitionCount)],
      ['Notes', notes ? 'Yes' : 'None'],
      ['Custom surfaces', surfaces.length ? surfaces.join(', ') : 'None'],
    ];
  }

  function mount(container, options) {
    options = options || {};
    const allowDestinationChoice = !!options.allowDestinationChoice;
    let presetCustomerFileId = cleanText(options.customerFileId) || null;
    let parsed = null;
    let context = null;
    let destinations = [];
    let destinationMode = allowDestinationChoice ? '' : (presetCustomerFileId ? 'existing' : 'new');
    let selectedExistingId = allowDestinationChoice ? '' : (presetCustomerFileId || '');
    let pendingNewId = allowDestinationChoice ? '' : (presetCustomerFileId || newId('cf'));
    let recoveryCustomerFileId = presetCustomerFileId;
    let lastImport = null;
    let removalReturn = 'idle';
    // Once a recovery in this visit succeeds, later files stay in that Customer File.
    let lockedCustomerFileId = presetCustomerFileId;
    let lockedDestinationLabel = '';

    container.innerHTML =
      '<section class="cf-import">' +
      '  <header class="cf-import__head"><p class="eyebrow">Standalone recovery</p><h1>Import completed field work</h1>' +
      '    <p>Choose a Distress Survey ZIP or Floor Survey JSON export. Toolbox will show what it found before writing anything.</p></header>' +
      '  <label class="cf-import__picker"><span>Legacy export</span><input id="cf-import-file" type="file" accept=".zip,.json,application/zip,application/json"></label>' +
      '  <p class="file-status" id="cf-import-status" role="status" aria-live="polite"></p>' +
      '  <div id="cf-import-preview"></div>' +
      '</section>';

    const input = container.querySelector('#cf-import-file');
    const status = container.querySelector('#cf-import-status');
    const preview = container.querySelector('#cf-import-preview');

    function activeDestinationId() {
      if (destinationMode === 'new') return pendingNewId;
      if (destinationMode === 'existing') return selectedExistingId;
      return '';
    }

    function choicesFromPreview() {
      const fieldChoices = {};
      preview.querySelectorAll('[data-import-conflict]').forEach((select) => {
        fieldChoices[select.getAttribute('data-import-conflict')] = select.value;
      });
      const firstInput = preview.querySelector('#cf-import-client-first');
      const lastInput = preview.querySelector('#cf-import-client-last');
      return {
        targetUpdatedAt: context.targetUpdatedAt,
        canvasChoice: context.isNew ? 'new' : 'add',
        fieldChoices,
        useSuggestedAddress: !!(preview.querySelector('#cf-import-suggested-address') || {}).checked,
        confirmAddFloorLevels: !!(preview.querySelector('#cf-import-confirm-floor-add') || {}).checked,
        acknowledgeExcludedObservations: !!(preview.querySelector('#cf-import-ack-excluded') || {}).checked,
        clientFirstName: firstInput ? firstInput.value : undefined,
        clientLastName: lastInput ? lastInput.value : undefined,
      };
    }

    function updateImportButton() {
      const button = preview.querySelector('#cf-import-confirm');
      if (!button || !context) return;
      const unresolved = [...preview.querySelectorAll('[data-import-conflict]')].some((select) => !select.value);
      const floorConfirmNeeded = context.requiresFloorAddConfirm &&
        !(preview.querySelector('#cf-import-confirm-floor-add') || {}).checked;
      let nameBlocked = false;
      if (parsed && parsed.needsClientNameEntry) {
        const first = cleanText((preview.querySelector('#cf-import-client-first') || {}).value);
        const last = cleanText((preview.querySelector('#cf-import-client-last') || {}).value);
        nameBlocked = !first && !last;
      }
      const excluded = parsed && parsed.kind === 'distress' && parsed.excludedObservations
        ? parsed.excludedObservations.length
        : 0;
      const exclusionUnacked = excluded > 0 &&
        !(preview.querySelector('#cf-import-ack-excluded') || {}).checked;
      button.disabled = context.duplicate || context.blocksDistressMerge || unresolved ||
        floorConfirmNeeded || nameBlocked || exclusionUnacked;
    }

    async function loadContextForDestination() {
      const destinationId = activeDestinationId();
      if (!destinationId) {
        context = null;
        return;
      }
      context = await getImportContext(parsed, destinationMode === 'new' ? destinationId : destinationId);
      if (destinationMode === 'new') {
        context.destinationLabel = 'New Customer File';
      }
    }

    function lockToCustomerFile(destinationId, record) {
      const id = cleanText(destinationId);
      if (!id) return;
      lockedCustomerFileId = id;
      recoveryCustomerFileId = id;
      presetCustomerFileId = id;
      destinationMode = 'existing';
      selectedExistingId = id;
      pendingNewId = '';
      lockedDestinationLabel = record ? displayCustomerLabel(record) : lockedDestinationLabel;
    }

    async function resetChooserForSameFile() {
      parsed = null;
      context = null;
      input.value = '';
      const label = lockedDestinationLabel || 'this Customer File';
      status.textContent = 'Choose another legacy export for ' + label + '.';
      await renderRecovered();
      input.focus();
    }

    function destinationPanelHtml() {
      if (!allowDestinationChoice || lockedCustomerFileId) {
        return '<p class="cf-import__note">Destination: ' + escapeHtml(context.destinationLabel) +
          (context.isNew
            ? ' — recovered work becomes this new Customer File.'
            : ' — recovered plan(s) will be added as new canvas/level(s).') +
          '</p>';
      }
      const optionsHtml = destinations.map(function (item) {
        return '<option value="' + escapeHtml(item.id) + '"' +
          (item.id === selectedExistingId ? ' selected' : '') + '>' +
          escapeHtml(item.label) + '</option>';
      }).join('');
      return '<fieldset class="cf-import__destination">' +
        '<legend>Where should this recovered work go?</legend>' +
        '<label class="cf-import__dest-option"><input type="radio" name="cf-import-dest-mode" value="new"' +
        (destinationMode === 'new' ? ' checked' : '') + '> Create new Customer File</label>' +
        '<label class="cf-import__dest-option"><input type="radio" name="cf-import-dest-mode" value="existing"' +
        (destinationMode === 'existing' ? ' checked' : '') + '> Add to existing Customer File</label>' +
        (destinationMode === 'existing'
          ? '<label class="cf-import__conflict"><span>Existing Customer File</span>' +
            '<select id="cf-import-dest-file"><option value="">Choose…</option>' + optionsHtml + '</select></label>'
          : '') +
        '</fieldset>';
    }

    function floorProtectionHtml() {
      if (!context.requiresFloorAddConfirm) return '';
      return '<div class="cf-import__warning cf-import__warning--action">' +
        '<p>This Customer File already has Floor Survey work (readings, boundary, transitions, areas, or exclusions). ' +
        'Toolbox will not overwrite or merge into that existing survey.</p>' +
        '<label class="cf-import__confirm-check"><input type="checkbox" id="cf-import-confirm-floor-add"> ' +
        'Add recovered survey as additional level(s)</label></div>';
    }

    function clientNameHtml() {
      if (!parsed.needsClientNameEntry) return '';
      return '<div class="cf-import__client-name">' +
        '<p class="cf-import__note">Client name “' + escapeHtml(parsed.unparsedClient) +
        '” could not be split into first and last name. Enter them below.</p>' +
        '<label class="cf-import__conflict"><span>First name</span>' +
        '<input id="cf-import-client-first" type="text" autocomplete="given-name"></label>' +
        '<label class="cf-import__conflict"><span>Last name</span>' +
        '<input id="cf-import-client-last" type="text" autocomplete="family-name"></label></div>';
    }

    function canvasNoteHtml() {
      if (context.isNew) {
        return '<p class="cf-import__note">The recovered original plan' +
          (parsed.kind === 'floor' && parsed.floors.length > 1 ? 's' : '') +
          ' will become this Customer File’s canvas' +
          (parsed.kind === 'floor' && parsed.floors.length > 1 ? 'es' : '') +
          '. Empty default canvases will not be kept.</p>';
      }
      return '<p class="cf-import__note">Recovered plan' +
        (parsed.kind === 'floor' && parsed.floors.length > 1 ? 's are' : ' is') +
        ' added as new canvas/level' +
        (parsed.kind === 'floor' && parsed.floors.length > 1 ? 's' : '') +
        '. Existing meaningful canvases stay; an empty default blank canvas may be removed.</p>';
    }

    function exclusionStatusText() {
      const excluded = parsed && parsed.excludedObservations ? parsed.excludedObservations : [];
      if (!excluded.length) return '';
      if (!parsed.pins.length) {
        return excluded.length === 1
          ? '1 observation cannot be imported. Nothing was written. The original ZIP is unchanged.'
          : excluded.length + ' observations cannot be imported. Nothing was written. The original ZIP is unchanged.';
      }
      return excluded.length === 1
        ? '1 observation cannot be imported. Review it below before continuing.'
        : excluded.length + ' observations cannot be imported. Review them below before continuing.';
    }

    function excludedListHtml(includeChoice) {
      const excluded = parsed && parsed.excludedObservations ? parsed.excludedObservations : [];
      if (!excluded.length) return '';
      const count = excluded.length;
      const recoverable = parsed.pins ? parsed.pins.length : 0;
      const items = excluded.map(function (item) {
        return '<li><span class="cf-import__excluded-title">' + escapeHtml(item.heading) + '</span>' +
          '<span class="cf-import__excluded-reason">' + escapeHtml(item.reason) + '</span></li>';
      }).join('');
      if (!recoverable) {
        return '<div class="cf-import__warning cf-import__warning--action">' +
          '<p><strong>No observations in this export can be imported.</strong> ' +
          'The original ZIP was not changed, and nothing was written to this Customer File. ' +
          'Locations were not guessed.</p>' +
          '<ul class="cf-import__excluded">' + items + '</ul>' +
          '<p>Use Back to return to the Customer File, or choose a different export above.</p></div>';
      }
      const choice = includeChoice
        ? '<label class="cf-import__confirm-check"><input type="checkbox" id="cf-import-ack-excluded"> ' +
          'Import the observations that can be recovered and leave ' +
          (count === 1 ? 'this one' : 'these') + ' out</label>'
        : '';
      return '<div class="cf-import__warning cf-import__warning--action">' +
        '<p><strong>' + count + ' ' + (count === 1 ? 'observation' : 'observations') +
        ' cannot be imported.</strong> ' +
        (count === 1 ? 'It stays' : 'They stay') +
        ' in the original ZIP and ' + (count === 1 ? 'is' : 'are') +
        ' not placed on the plan. Toolbox did not guess a location.</p>' +
        '<ul class="cf-import__excluded">' + items + '</ul>' + choice + '</div>';
    }

    function addressWarningHtml() {
      if (!context || !context.addressWarning) return '';
      const warning = context.addressWarning;
      return '<p class="cf-import__warning">The property address in this export (“' + escapeHtml(warning.source) +
        '”) does not match this Customer File (“' + escapeHtml(warning.destination) +
        '”). Nothing has been written. Import only if this is the correct file.</p>';
    }

    function distressAddressNoteHtml() {
      if (!parsed || parsed.kind !== 'distress' || !parsed.suggestedPropertyAddress) return '';
      return '<p class="cf-import__note">Property address is the folder name inside the Distress export.</p>';
    }

    function componentCountText(plan) {
      if (!plan || plan.blocked) return '';
      if (plan.kind === 'distress') {
        return plan.observationsRemoved + ' observation' + (plan.observationsRemoved === 1 ? '' : 's') +
          ', ' + plan.photosOnComponent + ' photo' + (plan.photosOnComponent === 1 ? '' : 's');
      }
      return plan.readingsRemoved + ' reading' + (plan.readingsRemoved === 1 ? '' : 's') +
        ', ' + plan.layersRemoved + ' level' + (plan.layersRemoved === 1 ? '' : 's');
    }

    async function returnFromRemoval() {
      status.textContent = '';
      if (removalReturn === 'result' && lastImport) {
        showImportResult(lastImport);
        return;
      }
      await renderRecovered();
    }

    function showImportResult(info) {
      lastImport = info;
      recoveryCustomerFileId = info.destinationId;
      preview.innerHTML =
        '<section class="cf-import__result"><p class="eyebrow">Recovery complete</p><h2 tabindex="-1">' + escapeHtml(info.label) + ' imported</h2>' +
        '<ul>' + info.lines.map(function (line) { return '<li>' + escapeHtml(line) + '</li>'; }).join('') + '</ul>' +
        (info.excludedHtml || '') +
        '<p class="cf-import__note">This import stays in this Customer File.</p>' +
        '<div class="cf-import__actions">' +
        '<button type="button" id="cf-import-another" class="btn btn--secondary">Import another legacy file</button>' +
        '<button type="button" id="cf-import-replace" class="btn btn--secondary">Replace imported ' + escapeHtml(info.label) + '</button>' +
        '<button type="button" id="cf-import-remove" class="btn btn--secondary">Remove imported ' + escapeHtml(info.label) + '</button>' +
        '<button type="button" id="cf-import-open" class="btn btn--accent">Open ' + escapeHtml(info.label) + '</button>' +
        '</div></section>';
      preview.querySelector('h2').focus();
      preview.querySelector('#cf-import-another').addEventListener('click', function () {
        resetChooserForSameFile();
      });
      preview.querySelector('#cf-import-open').addEventListener('click', function () {
        if (typeof options.onDone === 'function') options.onDone(info.kind, info.destinationId);
      });
      preview.querySelector('#cf-import-replace').addEventListener('click', function () {
        removalReturn = 'result';
        openRemovalConfirm(info.fingerprint, 'replace');
      });
      preview.querySelector('#cf-import-remove').addEventListener('click', function () {
        removalReturn = 'result';
        openRemovalConfirm(info.fingerprint, 'remove');
      });
    }

    async function openRemovalConfirm(fingerprint, mode) {
      const id = recoveryCustomerFileId;
      const record = id ? await window.ToolboxDB.getCustomerFile(id) : null;
      const entry = record && recoveryImports(record).find(function (item) {
        return item && item.fingerprint === fingerprint;
      });
      if (!record || !entry) {
        status.textContent = 'That recovered import is no longer on this Customer File.';
        parsed = null;
        await renderRecovered();
        return;
      }
      const all = await window.ToolboxDB.getAllCustomerFiles();
      const plan = planImportedRemoval(record, entry, all);
      if (plan.blocked) {
        preview.innerHTML =
          '<section class="cf-import__preview"><h2 tabindex="-1">Cannot remove imported ' + escapeHtml(plan.label) + '</h2>' +
          '<p class="cf-import__warning">' + escapeHtml(plan.blockReason) + '</p>' +
          '<div class="cf-import__actions"><button type="button" id="cf-import-removal-cancel" class="btn btn--ghost">Back</button></div></section>';
        preview.querySelector('#cf-import-removal-cancel').addEventListener('click', returnFromRemoval);
        preview.querySelector('h2').focus();
        return;
      }
      const verb = mode === 'replace' ? 'Replace' : 'Remove';
      const lines = removalSummaryLines(plan);
      preview.innerHTML =
        '<section class="cf-import__preview"><h2 tabindex="-1">' + escapeHtml(verb + ' imported ' + plan.label) + '?</h2>' +
        (plan.sourceName ? '<p class="cf-import__note">Source file: ' + escapeHtml(plan.sourceName) + '</p>' : '') +
        '<ul>' + lines.map(function (line) { return '<li>' + escapeHtml(line) + '</li>'; }).join('') + '</ul>' +
        '<div class="cf-import__actions">' +
        '<button type="button" id="cf-import-removal-cancel" class="btn btn--ghost">Cancel</button>' +
        '<button type="button" id="cf-import-removal-confirm" class="btn btn--danger">' + escapeHtml(verb + ' imported ' + plan.label) + '</button>' +
        '</div></section>';
      preview.querySelector('h2').focus();
      preview.querySelector('#cf-import-removal-cancel').addEventListener('click', returnFromRemoval);
      preview.querySelector('#cf-import-removal-confirm').addEventListener('click', async function () {
        const button = this;
        button.disabled = true;
        status.textContent = 'Removing imported ' + plan.label + '…';
        try {
          const removed = await removeImportedComponent(id, fingerprint);
          parsed = null;
          context = null;
          input.value = '';
          lastImport = null;
          status.textContent = mode === 'replace'
            ? 'Removed the imported ' + removed.label + '. Choose the correct export for this Customer File.'
            : 'Removed the imported ' + removed.label + '. This Customer File was kept.';
          await renderRecovered();
          if (mode === 'replace') input.focus();
        } catch (error) {
          console.error('Could not remove recovered import:', error);
          status.textContent = error && error.message ? error.message : 'Nothing was removed.';
          button.disabled = false;
        }
      });
    }

    async function renderRecovered() {
      if (parsed) return;
      const id = recoveryCustomerFileId;
      if (!id) {
        preview.innerHTML = '';
        return;
      }
      const record = await window.ToolboxDB.getCustomerFile(id);
      if (parsed) return;
      if (!record || record.deletedAt || !recoveryImports(record).length) {
        preview.innerHTML = '';
        return;
      }
      const all = await window.ToolboxDB.getAllCustomerFiles();
      if (parsed) return;
      const cards = recoveryImports(record).map(function (entry) {
        const plan = planImportedRemoval(record, entry, all);
        const title = entry.kind === 'floor' ? 'Floor Survey' : 'Distress Survey';
        const count = componentCountText(plan);
        const actions = plan.blocked
          ? '<p class="cf-import__warning">' + escapeHtml(plan.blockReason) + '</p>'
          : '<div class="cf-import__actions">' +
            '<button type="button" class="btn btn--secondary" data-recovery-action="replace" data-recovery-fingerprint="' + escapeHtml(entry.fingerprint) + '">Replace imported ' + escapeHtml(title) + '</button>' +
            '<button type="button" class="btn btn--secondary" data-recovery-action="remove" data-recovery-fingerprint="' + escapeHtml(entry.fingerprint) + '">Remove imported ' + escapeHtml(title) + '</button>' +
            '</div>';
        return '<article class="cf-import__recovered">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<p class="cf-import__note">' + escapeHtml(entry.sourceName || 'Unnamed file') +
          (count ? ' · ' + escapeHtml(count) : '') + '</p>' +
          actions + '</article>';
      }).join('');
      preview.innerHTML =
        '<section class="cf-import__recovered-list"><h2>Recovered imports</h2>' +
        '<p class="cf-import__note">Wrong file? Remove or replace only that recovered survey. The Customer File stays.</p>' +
        cards + '</section>';
      preview.querySelectorAll('[data-recovery-action]').forEach(function (button) {
        button.addEventListener('click', function () {
          removalReturn = 'idle';
          openRemovalConfirm(button.getAttribute('data-recovery-fingerprint'), button.getAttribute('data-recovery-action'));
        });
      });
    }

    async function cancelPreview() {
      parsed = null;
      context = null;
      input.value = '';
      status.textContent = 'Nothing was imported.';
      await renderRecovered();
    }

    function renderPreviewShell() {
      if (!parsed) return;
      const announced = exclusionStatusText();
      if (announced) status.textContent = announced;
      if (parsed.kind === 'distress' && !(parsed.pins && parsed.pins.length) &&
          parsed.excludedObservations && parsed.excludedObservations.length) {
        preview.innerHTML =
          '<section class="cf-import__preview"><h2 tabindex="-1">Distress observations left out</h2>' +
          excludedListHtml(false) +
          '</section>';
        preview.querySelector('h2').focus();
        return;
      }
      if (!context) {
        preview.innerHTML =
          '<section class="cf-import__preview"><h2 tabindex="-1">Choose destination</h2>' +
          destinationPanelHtml() +
          excludedListHtml(false) +
          '<p class="cf-import__note">Select Create new or an existing Customer File to continue.</p>' +
          '<div class="cf-import__actions"><button type="button" id="cf-import-cancel" class="btn btn--ghost">Cancel</button></div></section>';
        bindDestinationControls();
        preview.querySelector('#cf-import-cancel').addEventListener('click', cancelPreview);
        preview.querySelector('h2').focus();
        return;
      }
      const rows = summaryRows(parsed, context).map((row) =>
        '<div class="cf-import__row"><dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd></div>'
      ).join('');
      const conflicts = context.conflicts.map((conflict) =>
        '<label class="cf-import__conflict"><span>' + escapeHtml(conflict.label || conflict.field) + ': keep “' + escapeHtml(conflict.existing) +
        '” or use “' + escapeHtml(conflict.imported) + '”?</span><select data-import-conflict="' + escapeHtml(conflict.field) + '">' +
        '<option value="">Choose…</option><option value="keep">Keep existing</option><option value="import">Use imported</option></select></label>'
      ).join('');
      const existingAddress = cleanText(context.record.propertyAddress);
      const suggestion = parsed.kind === 'distress' && parsed.suggestedPropertyAddress
        ? '<label class="cf-import__suggestion"><input type="checkbox" id="cf-import-suggested-address"' +
          (existingAddress ? ' disabled' : '') + '> ' +
          (existingAddress ? 'Lower-confidence property suggestion (existing address will be kept): ' : 'Use lower-confidence property suggestion: ') +
          escapeHtml(parsed.suggestedPropertyAddress) + '</label>'
        : '';
      const duplicate = context.duplicate
        ? '<p class="cf-import__warning">This exact recovery package has already been imported into this Customer File.</p>'
        : '';
      const blocked = context.blocksDistressMerge
        ? '<p class="cf-import__warning">This Customer File already contains Distress work. Import into a new Customer File to preserve the existing work and historical numbering.</p>'
        : '';
      const importLabel = parsed.kind === 'distress' && parsed.excludedObservations && parsed.excludedObservations.length
        ? 'Import valid observations'
        : 'Import';
      preview.innerHTML =
        '<section class="cf-import__preview"><h2 tabindex="-1">Confirm ' + escapeHtml(parsed.label) + ' recovery</h2>' +
        destinationPanelHtml() +
        '<dl>' + rows + '</dl>' +
        excludedListHtml(true) +
        clientNameHtml() +
        distressAddressNoteHtml() +
        suggestion + conflicts + floorProtectionHtml() + canvasNoteHtml() +
        addressWarningHtml() + duplicate + blocked +
        '<div class="cf-import__actions">' +
        '<button type="button" id="cf-import-cancel" class="btn btn--ghost">Cancel</button>' +
        '<button type="button" id="cf-import-confirm" class="btn btn--accent">' + importLabel + '</button></div></section>';
      bindDestinationControls();
      preview.querySelectorAll('select,input').forEach((control) => control.addEventListener('change', updateImportButton));
      preview.querySelectorAll('#cf-import-client-first,#cf-import-client-last').forEach(function (control) {
        control.addEventListener('input', updateImportButton);
      });
      preview.querySelector('#cf-import-cancel').addEventListener('click', cancelPreview);
      preview.querySelector('#cf-import-confirm').addEventListener('click', async function () {
        const button = this;
        button.disabled = true;
        status.textContent = 'Importing…';
        try {
          const destinationId = activeDestinationId();
          const result = await applyImport(parsed, destinationId, choicesFromPreview());
          const lines = result.kind === 'distress'
            ? [
                result.observations + ' observations recovered',
                result.photos + ' attached photo' + (result.photos === 1 ? '' : 's') + ' recovered',
                'Plan added to ' + result.canvasName,
                result.quickCaptureCount + ' Quick Capture photo' + (result.quickCaptureCount === 1 ? '' : 's') + ' saved in Photo folders',
              ]
            : [
                result.readings + ' readings recovered',
                result.transitions + ' flooring corrections recovered',
                result.floorCount + ' original floor plan' + (result.floorCount === 1 ? '' : 's') + ' added',
              ];
          result.customerUpdates.forEach((update) => {
            if (update.field === 'propertyAddress') {
              lines.push('Property address ' + (update.action === 'updated' ? 'updated' : 'added'));
            }
            if (update.field === 'firstName' || update.field === 'lastName') {
              const label = 'Customer name ' + (update.action === 'updated' ? 'updated' : 'added');
              if (!lines.some((line) => line.indexOf('Customer name ') === 0)) lines.push(label);
            }
          });
          const leftOut = parsed.kind === 'distress' && parsed.excludedObservations
            ? parsed.excludedObservations
            : [];
          if (leftOut.length) {
            lines.push(leftOut.length + ' observation' + (leftOut.length === 1 ? '' : 's') +
              ' left out — not placed on the plan');
            lines.push('The original ZIP was not changed.');
          }
          lockToCustomerFile(result.destinationId, result.record);
          status.textContent = '';
          showImportResult({
            kind: result.kind,
            label: parsed.label,
            destinationId: result.destinationId,
            fingerprint: result.fingerprint,
            lines: lines,
            excludedHtml: leftOut.length ? excludedListHtml(false) : '',
          });
        } catch (error) {
          console.error('Recovery import failed:', error);
          status.textContent = error && error.message ? error.message : 'Import failed safely. No completed recovery was saved.';
          button.disabled = false;
        }
      });
      updateImportButton();
      preview.querySelector('h2').focus();
    }

    function bindDestinationControls() {
      preview.querySelectorAll('input[name="cf-import-dest-mode"]').forEach(function (radio) {
        radio.addEventListener('change', async function () {
          destinationMode = radio.value;
          if (destinationMode === 'new') {
            if (!pendingNewId) pendingNewId = newId('cf');
            selectedExistingId = '';
          }
          status.textContent = 'Updating destination…';
          try {
            if (destinationMode === 'existing' && !selectedExistingId) {
              context = null;
              status.textContent = '';
              renderPreviewShell();
              return;
            }
            await loadContextForDestination();
            status.textContent = '';
            renderPreviewShell();
          } catch (error) {
            console.error('Could not load import destination:', error);
            status.textContent = error && error.message ? error.message : 'That destination could not be opened.';
          }
        });
      });
      const destSelect = preview.querySelector('#cf-import-dest-file');
      if (destSelect) {
        destSelect.addEventListener('change', async function () {
          selectedExistingId = destSelect.value || '';
          status.textContent = 'Updating destination…';
          try {
            if (!selectedExistingId) {
              context = null;
              status.textContent = '';
              renderPreviewShell();
              return;
            }
            await loadContextForDestination();
            status.textContent = '';
            renderPreviewShell();
          } catch (error) {
            console.error('Could not load import destination:', error);
            status.textContent = error && error.message ? error.message : 'That destination could not be opened.';
          }
        });
      }
    }

    input.addEventListener('change', async function () {
      const file = input.files && input.files[0];
      if (!file) return;
      preview.innerHTML = '';
      status.textContent = 'Inspecting export…';
      try {
        parsed = await inspectFile(file);
        const stayWithFile = cleanText(lockedCustomerFileId);
        if (allowDestinationChoice && !stayWithFile) {
          destinations = await listImportDestinations();
          destinationMode = '';
          selectedExistingId = '';
          pendingNewId = newId('cf');
          context = null;
          status.textContent = '';
          renderPreviewShell();
          return;
        }
        destinations = [];
        if (stayWithFile) {
          destinationMode = 'existing';
          selectedExistingId = stayWithFile;
          pendingNewId = '';
        } else {
          if (!presetCustomerFileId) pendingNewId = newId('cf');
          destinationMode = presetCustomerFileId ? 'existing' : 'new';
          selectedExistingId = presetCustomerFileId || '';
        }
        await loadContextForDestination();
        status.textContent = '';
        renderPreviewShell();
      } catch (error) {
        console.error('Could not inspect recovery export:', error);
        status.textContent = error && error.message ? error.message : 'That recovery export could not be read.';
      }
    });

    renderRecovered();
  }

  window.ToolboxCustomerFileImport = {
    inspectFile,
    getImportContext,
    applyImport,
    listImportDestinations,
    planImportedRemoval,
    removeImportedComponent,
    mount,
  };
})();
