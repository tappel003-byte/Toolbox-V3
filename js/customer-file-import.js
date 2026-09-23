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

  function zipEntryByPath(zip, path) {
    const wanted = normalizeZipPath(path).toLowerCase();
    const key = Object.keys(zip.files).find((name) => normalizeZipPath(name).toLowerCase() === wanted);
    return key ? zip.files[key] : null;
  }

  function zipEntriesEnding(zip, suffix) {
    const wanted = String(suffix).toLowerCase();
    return Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir && normalizeZipPath(name).toLowerCase().endsWith(wanted))
      .map((name) => zip.files[name]);
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
      sourcePins = JSON.parse(await pinEntries[0].async('text'));
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

    const firstNum = ordered.length && Number.isFinite(Number(ordered[0].pin.num))
      ? Number(ordered[0].pin.num)
      : 1;
    let expectedNum = firstNum;
    let attachedPhotoCount = 0;
    const pins = [];

    for (const entry of ordered) {
      const source = entry.pin;
      if (!source || typeof source !== 'object') throw new Error('pins.json contains an invalid observation.');
      const sourceNum = Number(source.num);
      if (!Number.isFinite(sourceNum) || sourceNum !== expectedNum) {
        throw new Error('Distress numbering is inconsistent in pins.json.');
      }
      if (!Array.isArray(source.photos)) throw new Error('A Distress observation has an invalid photos list.');
      const photos = [];
      for (const photoName of source.photos) {
        const safeName = normalizeZipPath(photoName).split('/').pop();
        const photoEntry = zipEntryByPath(zip, basePath + 'photos/' + safeName);
        if (!photoEntry) throw new Error('A referenced Distress photo is missing: ' + safeName);
        photos.push({
          sourceName: safeName,
          dataUrl: dataUrlFromBase64(await photoEntry.async('base64'), mimeForName(safeName)),
        });
      }
      attachedPhotoCount += photos.length;
      pins.push({
        sourceId: cleanText(source.id),
        num: sourceNum,
        xNormalized: parseNormalized(source.x, 'x'),
        yNormalized: parseNormalized(source.y, 'y'),
        description: cleanText(source.description),
        location: cleanText(source.room),
        importedLegacyDirection: cleanText(source.direction),
        isExterior: cleanText(source.type).toLowerCase() === 'exterior',
        photos,
      });
      expectedNum += Math.max(1, photos.length);
    }

    const quickPrefix = (basePath + 'quick-capture/').toLowerCase();
    const quickFiles = Object.keys(zip.files).filter((name) => {
      const normalized = normalizeZipPath(name).toLowerCase();
      return !zip.files[name].dir && normalized.startsWith(quickPrefix) &&
        !normalized.endsWith('/quick-capture.csv') && /\.(jpe?g|png|webp|gif)$/i.test(normalized);
    });
    const quickCsvEntry = zipEntryByPath(zip, basePath + 'quick-capture/quick-capture.csv');
    let quickMetadata = [];
    if (quickCsvEntry) {
      quickMetadata = parseCsv(await quickCsvEntry.async('text')).map((row) => ({
        file: cleanText(row.File || row.file),
        timestamp: cleanText(row.Timestamp || row.timestamp),
        latitude: cleanText(row.Latitude || row.latitude),
        longitude: cleanText(row.Longitude || row.longitude),
      }));
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
      startNum: firstNum,
      nextNum: expectedNum,
      pins,
      attachedPhotoCount,
      quickCapture: {
        count: quickFiles.length,
        metadataCount: quickMetadata.length,
        metadata: quickMetadata,
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
    const pins = parsed.pins.map((source) => {
      const photoIds = source.photos.map((photo) => {
        const id = newId('ph_import');
        photoEntries.push({ id, value: photo.dataUrl });
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

    record.distress.pins = pins;
    record.distress.drawings = [];
    record.distress.startNum = parsed.startNum;
    record.distress.nextNum = parsed.nextNum;
    record.distress.activeCanvasId = canvas.id;
    record.distress.updatedAt = new Date().toISOString();

    return {
      mediaEntries: [{ id: planId, value: parsed.planDataUrl }],
      photoEntries,
      canvasIds: [canvas.id],
      result: {
        kind: 'distress',
        observations: pins.length,
        photos: photoEntries.length,
        quickCaptureCount: parsed.quickCapture.count,
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

    const customerUpdates = applyCustomerFields(record, effectiveParsed, options);
    const prepared = parsed.kind === 'distress'
      ? prepareDistress(record, parsed, isNew)
      : prepareFloor(record, parsed, isNew, options);
    const now = new Date().toISOString();
    record.updatedAt = now;
    if ((customerUpdates && customerUpdates.length) || isNew || !record.customerUpdatedAt) {
      record.customerUpdatedAt = now;
    }
    if (!record.trashUpdatedAt) record.trashUpdatedAt = '1970-01-01T00:00:00.001Z';
    record.recoveryImports = recoveryImports(record).concat([{
      fingerprint: parsed.fingerprint,
      kind: parsed.kind,
      sourceName: parsed.fileName,
      importedAt: now,
      canvasIds: prepared.canvasIds,
    }]);

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
    return { record, customerUpdates, destinationId: record.id, ...prepared.result };
  }

  function summaryRows(parsed, context) {
    if (parsed.kind === 'distress') {
      return [
        ['Plan', 'Original plan found'],
        ['Observations', String(parsed.pins.length)],
        ['Attached photos', String(parsed.attachedPhotoCount)],
        ['Quick Capture', parsed.quickCapture.count + ' photo' + (parsed.quickCapture.count === 1 ? '' : 's') + ' found — not imported yet'],
        ['Destination', context && context.destinationLabel ? context.destinationLabel : '—'],
      ];
    }
    const notes = cleanText(parsed.bundle.project.notes);
    const surfaces = Array.isArray(parsed.bundle.project.customSurfaces) ? parsed.bundle.project.customSurfaces : [];
    const levelLabel = (parsed.levelNames || []).join(', ') || 'Recovered Floor';
    const customerLabel = [parsed.customerCandidates.firstName, parsed.customerCandidates.lastName].filter(Boolean).join(' ')
      || (parsed.unparsedClient ? parsed.unparsedClient + ' — enter name below' : 'Not provided');
    return [
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
      button.disabled = context.duplicate || context.blocksDistressMerge || unresolved ||
        floorConfirmNeeded || nameBlocked;
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

    function destinationPanelHtml() {
      if (!allowDestinationChoice) {
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

    function renderPreviewShell() {
      if (!parsed) return;
      if (!context) {
        preview.innerHTML =
          '<section class="cf-import__preview"><h2 tabindex="-1">Choose destination</h2>' +
          destinationPanelHtml() +
          '<p class="cf-import__note">Select Create new or an existing Customer File to continue.</p></section>';
        bindDestinationControls();
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
      preview.innerHTML =
        '<section class="cf-import__preview"><h2 tabindex="-1">Confirm ' + escapeHtml(parsed.label) + ' recovery</h2>' +
        destinationPanelHtml() +
        '<dl>' + rows + '</dl>' +
        clientNameHtml() +
        suggestion + conflicts + floorProtectionHtml() + canvasNoteHtml() + duplicate + blocked +
        '<div class="cf-import__actions"><button type="button" id="cf-import-confirm" class="btn btn--accent">Import</button></div></section>';
      bindDestinationControls();
      preview.querySelectorAll('select,input').forEach((control) => control.addEventListener('change', updateImportButton));
      preview.querySelectorAll('#cf-import-client-first,#cf-import-client-last').forEach(function (control) {
        control.addEventListener('input', updateImportButton);
      });
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
                result.photos + ' attached photos recovered',
                'Plan added to ' + result.canvasName,
                result.quickCaptureCount + ' Quick Capture photos found — not imported yet',
                ...(result.quickCaptureCount ? ['Keep the original ZIP as the recovery source for Quick Capture.'] : []),
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
          status.textContent = '';
          preview.innerHTML =
            '<section class="cf-import__result"><p class="eyebrow">Recovery complete</p><h2 tabindex="-1">' + escapeHtml(parsed.label) + ' imported</h2>' +
            '<ul>' + lines.map((line) => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul>' +
            '<button type="button" id="cf-import-open" class="btn btn--accent">Open ' + escapeHtml(parsed.label) + '</button></section>';
          preview.querySelector('h2').focus();
          preview.querySelector('#cf-import-open').addEventListener('click', function () {
            if (typeof options.onDone === 'function') options.onDone(result.kind, result.destinationId);
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
        destinations = allowDestinationChoice ? await listImportDestinations() : [];
        if (allowDestinationChoice) {
          destinationMode = '';
          selectedExistingId = '';
          pendingNewId = newId('cf');
          context = null;
          status.textContent = '';
          renderPreviewShell();
          return;
        }
        if (!presetCustomerFileId) pendingNewId = newId('cf');
        destinationMode = presetCustomerFileId ? 'existing' : 'new';
        selectedExistingId = presetCustomerFileId || '';
        await loadContextForDestination();
        status.textContent = '';
        renderPreviewShell();
      } catch (error) {
        console.error('Could not inspect recovery export:', error);
        status.textContent = error && error.message ? error.message : 'That recovery export could not be read.';
      }
    });
  }

  window.ToolboxCustomerFileImport = {
    inspectFile,
    getImportContext,
    applyImport,
    listImportDestinations,
    mount,
  };
})();
