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

  function parseNormalized(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
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
      const width = Number(source.planWidth) > 0 ? Number(source.planWidth) : intrinsic.width;
      const height = Number(source.planHeight) > 0 ? Number(source.planHeight) : intrinsic.height;
      requirePointArray(source.boundary || [], 'survey boundary');
      if (source.areas) source.areas.forEach((area) => requirePointArray(area.polygon || [], 'topo area'));
      if (source.exclusions) source.exclusions.forEach((area) => requirePointArray(area.polygon || [], 'exclusion'));
      floors.push({ source, width, height, sourceIndex });
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
    return {
      kind: 'floor',
      label: 'Floor Survey',
      fileName: file.name,
      fingerprint: packageFingerprint,
      bundle,
      floors,
      pointCount: bundle.points.length,
      transitionCount: floors.reduce((total, item) => total + (Array.isArray(item.source.transitions) ? item.source.transitions.length : 0), 0),
      customerCandidates: {
        firstName: client ? client.firstName : '',
        lastName: client ? client.lastName : '',
        propertyAddress: cleanText(bundle.project.address),
      },
      unparsedClient: client ? '' : cleanText(bundle.project.client),
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

  function fieldConflicts(record, parsed) {
    const candidates = parsed.customerCandidates || {};
    const conflicts = Object.keys(candidates).filter((field) => {
      const imported = cleanText(candidates[field]);
      const existing = cleanText(record[field]);
      return imported && existing && imported !== existing;
    }).map((field) => ({
      field,
      label: field,
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

  async function getImportContext(parsed, customerFileId) {
    const existing = await window.ToolboxDB.getCustomerFile(customerFileId);
    if (existing && existing.deletedAt) throw new Error('Restore this Customer File before importing into it.');
    const record = existing ? clone(existing) : window.ToolboxApp.blankCustomerFile(customerFileId);
    window.ToolboxPlanSetup.ensurePlanSetup(record);
    const duplicate = recoveryImports(record).some((entry) => entry && entry.fingerprint === parsed.fingerprint);
    const existingDistressPins = record.distress && Array.isArray(record.distress.pins)
      ? record.distress.pins.length
      : 0;
    const existingDistressDrawings = record.distress && Array.isArray(record.distress.drawings)
      ? record.distress.drawings.length
      : 0;
    return {
      isNew: !existing,
      record,
      targetUpdatedAt: existing ? existing.updatedAt : null,
      duplicate,
      conflicts: fieldConflicts(record, parsed),
      blocksDistressMerge: parsed.kind === 'distress' && (existingDistressPins > 0 || existingDistressDrawings > 0),
    };
  }

  function applyCustomerFields(record, parsed, options) {
    const candidates = parsed.customerCandidates || {};
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
      record.planSetup.canvases = canvases.concat(record.planSetup.canvases || []);
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
    const conflicts = fieldConflicts(record, parsed);
    conflicts.forEach((conflict) => {
      if (!['keep', 'import'].includes(options.fieldChoices && options.fieldChoices[conflict.field])) {
        throw new Error('Resolve the ' + conflict.field + ' conflict before importing.');
      }
    });
    if (parsed.kind === 'distress' &&
        ((record.distress.pins && record.distress.pins.length) ||
         (record.distress.drawings && record.distress.drawings.length))) {
      throw new Error('This Customer File already has Distress work. Use a new Customer File so existing work and historical numbering are not changed.');
    }

    const customerUpdates = applyCustomerFields(record, parsed, options);
    const prepared = parsed.kind === 'distress'
      ? prepareDistress(record, parsed, isNew)
      : prepareFloor(record, parsed, isNew, options);
    const now = new Date().toISOString();
    record.updatedAt = now;
    if ((customerUpdates && customerUpdates.length) || isNew || !record.customerUpdatedAt) {
      record.customerUpdatedAt = now;
    }
    if (!record.trashUpdatedAt) record.trashUpdatedAt = now;
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
    return { record, customerUpdates, ...prepared.result };
  }

  function summaryRows(parsed) {
    if (parsed.kind === 'distress') {
      return [
        ['Plan', 'Original plan found'],
        ['Observations', parsed.pins.length],
        ['Attached photos', parsed.attachedPhotoCount],
        ['Quick Capture', parsed.quickCapture.count + ' photo' + (parsed.quickCapture.count === 1 ? '' : 's') + ' found — not imported yet'],
      ];
    }
    return [
      ['Customer', [parsed.customerCandidates.firstName, parsed.customerCandidates.lastName].filter(Boolean).join(' ') ||
        (parsed.unparsedClient ? parsed.unparsedClient + ' — not mapped automatically' : 'Not provided')],
      ['Property', parsed.customerCandidates.propertyAddress || 'Not provided'],
      ['Survey date', cleanText(parsed.bundle.project.inspectionDate) || 'Not provided'],
      ['Inspector', cleanText(parsed.bundle.project.inspector) ?
        cleanText(parsed.bundle.project.inspector) + ' — no native Customer File field' : 'Not provided'],
      ['Plan', parsed.floors.length + ' floor plan' + (parsed.floors.length === 1 ? '' : 's')],
      ['Floor Survey', parsed.pointCount + ' readings'],
      ['Flooring corrections', parsed.transitionCount],
    ];
  }

  function mount(container, options) {
    const customerFileId = options.customerFileId;
    let parsed = null;
    let context = null;

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

    function choicesFromPreview() {
      const fieldChoices = {};
      preview.querySelectorAll('[data-import-conflict]').forEach((select) => {
        fieldChoices[select.getAttribute('data-import-conflict')] = select.value;
      });
      return {
        targetUpdatedAt: context.targetUpdatedAt,
        canvasChoice: context.isNew ? 'new' : (preview.querySelector('#cf-import-canvas-choice') || {}).value,
        fieldChoices,
        useSuggestedAddress: !!(preview.querySelector('#cf-import-suggested-address') || {}).checked,
      };
    }

    function updateImportButton() {
      const button = preview.querySelector('#cf-import-confirm');
      if (!button) return;
      const unresolved = [...preview.querySelectorAll('[data-import-conflict]')].some((select) => !select.value);
      const canvasUnresolved = !context.isNew && !(preview.querySelector('#cf-import-canvas-choice') || {}).value;
      button.disabled = context.duplicate || context.blocksDistressMerge || unresolved || canvasUnresolved;
    }

    function renderPreview() {
      const rows = summaryRows(parsed).map((row) =>
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
      const canvasChoice = context.isNew
        ? '<p class="cf-import__note">The recovered original plan will become this Customer File’s canvas.</p>'
        : '<label class="cf-import__conflict"><span>Recovered plan placement</span><select id="cf-import-canvas-choice">' +
          '<option value="">Choose…</option><option value="add">Add recovered original plan as new canvas' +
          (parsed.kind === 'floor' && parsed.floors.length > 1 ? 'es' : '') + '</option></select></label>';
      const duplicate = context.duplicate
        ? '<p class="cf-import__warning">This exact recovery package has already been imported into this Customer File.</p>'
        : '';
      const blocked = context.blocksDistressMerge
        ? '<p class="cf-import__warning">This Customer File already contains Distress work. Import into a new Customer File to preserve the existing work and historical numbering.</p>'
        : '';
      preview.innerHTML =
        '<section class="cf-import__preview"><h2 tabindex="-1">Import ' + escapeHtml(parsed.label) + '</h2><dl>' + rows + '</dl>' +
        suggestion + conflicts + canvasChoice + duplicate + blocked +
        '<div class="cf-import__actions"><button type="button" id="cf-import-confirm" class="btn btn--accent">Import</button></div></section>';
      preview.querySelectorAll('select,input').forEach((control) => control.addEventListener('change', updateImportButton));
      preview.querySelector('#cf-import-confirm').addEventListener('click', async function () {
        const button = this;
        button.disabled = true;
        status.textContent = 'Importing…';
        try {
          const result = await applyImport(parsed, customerFileId, choicesFromPreview());
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
            options.onDone(result.kind);
          });
        } catch (error) {
          console.error('Recovery import failed:', error);
          status.textContent = error && error.message ? error.message : 'Import failed safely. No completed recovery was saved.';
          button.disabled = false;
        }
      });
      updateImportButton();
    }

    input.addEventListener('change', async function () {
      const file = input.files && input.files[0];
      if (!file) return;
      preview.innerHTML = '';
      status.textContent = 'Inspecting export…';
      try {
        parsed = await inspectFile(file);
        context = await getImportContext(parsed, customerFileId);
        status.textContent = '';
        renderPreview();
        preview.querySelector('h2').focus();
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
    mount,
  };
})();
