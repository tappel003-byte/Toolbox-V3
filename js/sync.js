// Toolbox — Stage A cross-device sync client.
//
// Local IndexedDB remains the working store. Sync Now exchanges independent
// Customer File components (+ required media) with the Sync API. This module
// does not redesign capture apps or split local storage.

(function () {
  'use strict';

  const COMPONENTS = ['customer', 'plans', 'distress', 'floor', 'diagnostics', 'report', 'trash'];
  const SHELL_GUARD_COMPONENTS = { customer: true, plans: true, distress: true, floor: true };
  // Epoch sentinel: truthy so ensurePlanSetup will not backfill with "now".
  // .001Z avoids Date.parse(.000Z) === 0 colliding with missing-revision behavior.
  const REMOTE_PULL_EPOCH = '1970-01-01T00:00:00.001Z';
  const DEVICE_ID_KEY = 'toolboxDeviceId';

  function syncApiBase() {
    const cfg = window.ToolboxConfig || {};
    return typeof cfg.syncApiBase === 'string' ? cfg.syncApiBase.replace(/\/$/, '') : '';
  }

  function trimStr(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  /**
   * Stable opaque device id for this Toolbox installation / browser storage.
   * Created once; reused across sessions; not a device-management product.
   */
  function getDeviceId() {
    try {
      const existing = window.localStorage && window.localStorage.getItem(DEVICE_ID_KEY);
      if (existing && typeof existing === 'string' && existing.trim()) return existing.trim();
    } catch (_) {}

    let id = '';
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        id = window.crypto.randomUUID();
      }
    } catch (_) {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    }
    try {
      if (window.localStorage) window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (_) {}
    return id;
  }

  function displayNameFromRecord(record) {
    if (!record) return 'New Customer File';
    const name = [trimStr(record.firstName), trimStr(record.lastName)].filter(Boolean).join(' ');
    return name || 'New Customer File';
  }

  function checkoutOwnerMatches(checkout, email, deviceId) {
    if (!checkout) return false;
    return normalizeEmail(checkout.email) === normalizeEmail(email) &&
      trimStr(checkout.deviceId) === trimStr(deviceId);
  }

  function iso(value) {
    if (!value) return '';
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : '';
  }

  function newerIso(a, b) {
    const ta = Date.parse(a || '') || 0;
    const tb = Date.parse(b || '') || 0;
    if (ta === tb) return 0;
    return ta > tb ? 1 : -1;
  }

  function pickCustomerFields(record) {
    return {
      firstName: record.firstName || '',
      lastName: record.lastName || '',
      propertyAddress: record.propertyAddress || '',
      cellPhone: record.cellPhone || '',
      homePhone: record.homePhone || '',
      email: record.email || '',
      notes: record.notes || '',
      companyName: record.companyName || '',
      spouseName: record.spouseName || '',
      spouseCellPhone: record.spouseCellPhone || '',
      spouseHomePhone: record.spouseHomePhone || '',
      spouseEmail: record.spouseEmail || '',
      mailingSameAsProperty: !!record.mailingSameAsProperty,
      mailingAddress: record.mailingAddress || '',
      propertyAddressLat: record.propertyAddressLat == null ? null : record.propertyAddressLat,
      propertyAddressLon: record.propertyAddressLon == null ? null : record.propertyAddressLon,
      customerUpdatedAt: record.customerUpdatedAt || record.updatedAt || '',
    };
  }

  function applyCustomerFields(record, customer) {
    if (!customer || typeof customer !== 'object') return;
    Object.keys(pickCustomerFields({})).forEach(function (key) {
      if (key === 'customerUpdatedAt') return;
      if (Object.prototype.hasOwnProperty.call(customer, key)) {
        record[key] = customer[key];
      }
    });
    if (customer.customerUpdatedAt) record.customerUpdatedAt = customer.customerUpdatedAt;
  }

  function componentRevision(record, name) {
    if (!record) return '';
    if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
    switch (name) {
      case 'customer':
        return iso(record.customerUpdatedAt || record.updatedAt);
      case 'plans':
        return iso(record.planSetup && record.planSetup.updatedAt);
      case 'distress':
        return iso(record.distress && record.distress.updatedAt);
      case 'floor':
        return iso(record.floorSurvey && record.floorSurvey.updatedAt);
      case 'diagnostics':
        return iso(record.diagnostics && record.diagnostics.updatedAt);
      case 'report': {
        const report = record.reportBuilder || record.report;
        return iso(report && report.updatedAt);
      }
      case 'trash':
        return iso(record.trashUpdatedAt || record.deletedAt || '');
      default:
        return '';
    }
  }

  // Contact identifiers already stored on the Customer File. City and ZIP are
  // not separate columns — they live inside propertyAddress / mailingAddress.
  const CABINET_SEARCH_FIELDS = [
    'mailingAddress',
    'companyName',
    'spouseName',
    'email',
    'spouseEmail',
    'cellPhone',
    'homePhone',
    'spouseCellPhone',
    'spouseHomePhone',
  ];

  /**
   * A stored calendar/survey date. YYYY-MM-DD is the Floor Survey date input.
   * Full ISO is accepted only when the caller already knows the field is a
   * survey date. Revision clocks are never passed in.
   */
  function storedSurveyDate(value) {
    const text = trimStr(value);
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const parts = text.split('-');
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const day = Number(parts[2]);
      const utc = Date.UTC(year, month - 1, day);
      const check = new Date(utc);
      if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        return '';
      }
      return text;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? text : '';
  }

  function surveyDateTime(value) {
    const text = storedSurveyDate(value);
    if (!text) return null;
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function mostRecentSurveyDate(values) {
    let best = '';
    let bestTime = -Infinity;
    (values || []).forEach(function (value) {
      const time = surveyDateTime(value);
      if (time == null || time < bestTime) return;
      bestTime = time;
      best = storedSurveyDate(value);
    });
    return best;
  }

  function floorSurveyDates(floor) {
    const dates = [];
    if (!floor || typeof floor !== 'object') return dates;
    const root = storedSurveyDate(floor.inspectionDate);
    if (root) dates.push(root);
    const layers = floor.byCanvasId && typeof floor.byCanvasId === 'object'
      ? Object.values(floor.byCanvasId)
      : [];
    layers.forEach(function (layer) {
      const date = storedSurveyDate(layer && layer.inspectionDate);
      if (date) dates.push(date);
    });
    return dates;
  }

  /**
   * Distress capture has no survey-date field today (createdAt/updatedAt are
   * system clocks). Use a date only when an actual inspection/survey field
   * is stored on the distress component.
   */
  function distressSurveyDate(distress) {
    if (!distress || typeof distress !== 'object') return '';
    return storedSurveyDate(distress.inspectionDate) || storedSurveyDate(distress.surveyDate) || '';
  }

  /**
   * Most recent Floor Survey inspection date, else a real Distress survey
   * date. Empty when neither exists — callers fall back to Customer File
   * createdAt and must not substitute sync/checkout/updatedAt clocks.
   */
  function fieldWorkSurveyDate(record) {
    if (!record) return '';
    const floor = mostRecentSurveyDate(floorSurveyDates(record.floorSurvey));
    if (floor) return floor;
    return distressSurveyDate(record.distress);
  }

  function buildIndex(record) {
    const index = {
      id: record.id,
      createdAt: record.createdAt || '',
      updatedAt: record.updatedAt || '',
      customerUpdatedAt: componentRevision(record, 'customer'),
      plansUpdatedAt: componentRevision(record, 'plans'),
      distressUpdatedAt: componentRevision(record, 'distress'),
      floorUpdatedAt: componentRevision(record, 'floor'),
      diagnosticsUpdatedAt: componentRevision(record, 'diagnostics'),
      reportUpdatedAt: componentRevision(record, 'report'),
      trashUpdatedAt: componentRevision(record, 'trash'),
      deletedAt: record.deletedAt || null,
      purgeAfter: record.purgeAfter || null,
      // Lightweight Cabinet browse fields (not a full component download).
      displayName: displayNameFromRecord(record),
      propertyAddress: trimStr(record.propertyAddress),
    };
    const surveyDate = fieldWorkSurveyDate(record);
    if (surveyDate) index.fieldWorkDate = surveyDate;
    CABINET_SEARCH_FIELDS.forEach(function (key) {
      index[key] = trimStr(record[key]);
    });
    return index;
  }

  function planMediaIds(record) {
    const canvases = record && record.planSetup && Array.isArray(record.planSetup.canvases)
      ? record.planSetup.canvases
      : [];
    return canvases.map(function (c) { return c && c.plan && c.plan.id; }).filter(Boolean);
  }

  function collectDistressPhotoId(ids, id) {
    if (typeof id === 'string' && id.indexOf('ph_') === 0) ids.push(id);
  }

  function distressPhotoIds(record) {
    const distress = record && record.distress ? record.distress : {};
    const pins = Array.isArray(distress.pins) ? distress.pins : [];
    const ids = [];
    pins.forEach(function (pin) {
      const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
      photos.forEach(function (id) { collectDistressPhotoId(ids, id); });
    });
    const quick = Array.isArray(distress.quickCapture) ? distress.quickCapture : [];
    quick.forEach(function (item) { collectDistressPhotoId(ids, item && item.id); });
    return Array.from(new Set(ids));
  }

  function mediaIdsForComponent(record, name) {
    if (name === 'plans') return planMediaIds(record);
    if (name === 'distress') return distressPhotoIds(record);
    return [];
  }

  function extractComponent(record, name) {
    if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
    switch (name) {
      case 'customer':
        return pickCustomerFields(record);
      case 'plans':
        return record.planSetup || null;
      case 'distress':
        return record.distress || null;
      case 'floor':
        return record.floorSurvey || null;
      case 'diagnostics':
        return record.diagnostics || null;
      case 'report':
        return record.reportBuilder || record.report || null;
      case 'trash':
        return {
          trashUpdatedAt: record.trashUpdatedAt || '',
          deletedAt: record.deletedAt || null,
          purgeAfter: record.purgeAfter || null,
        };
      default:
        return null;
    }
  }

  function applyComponent(record, name, payload) {
    if (!payload) return;
    if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
    switch (name) {
      case 'customer':
        applyCustomerFields(record, payload);
        break;
      case 'plans':
        record.planSetup = payload;
        break;
      case 'distress':
        record.distress = payload;
        break;
      case 'floor':
        record.floorSurvey = payload;
        break;
      case 'diagnostics':
        record.diagnostics = payload;
        break;
      case 'report':
        record.reportBuilder = payload;
        break;
      case 'trash':
        record.trashUpdatedAt = payload.trashUpdatedAt || record.trashUpdatedAt || '';
        if (payload.deletedAt) record.deletedAt = payload.deletedAt;
        else delete record.deletedAt;
        if (payload.purgeAfter) record.purgeAfter = payload.purgeAfter;
        else delete record.purgeAfter;
        break;
      default:
        break;
    }
  }

  function chooseSide(localRev, remoteRev) {
    const cmp = newerIso(localRev, remoteRev);
    if (cmp > 0) return 'push';
    if (cmp < 0) return 'pull';
    if (!localRev && remoteRev) return 'pull';
    if (localRev && !remoteRev) return 'push';
    return 'skip';
  }

  /**
   * Narrow predicate: true only when a component matches Toolbox's manufactured
   * blank/default shell (blankCustomerFile / ensurePlanSetup). Uncertain or
   * partially edited state returns false — preservation wins.
   */
  function isDefaultCustomerShellFields(fields) {
    if (!fields || typeof fields !== 'object') return true;
    if (trimStr(fields.firstName) || trimStr(fields.lastName)) return false;
    if (trimStr(fields.propertyAddress) || trimStr(fields.mailingAddress)) return false;
    if (trimStr(fields.cellPhone) || trimStr(fields.homePhone) || trimStr(fields.email)) return false;
    if (trimStr(fields.notes) || trimStr(fields.companyName) || trimStr(fields.spouseName)) return false;
    if (trimStr(fields.spouseCellPhone) || trimStr(fields.spouseHomePhone) || trimStr(fields.spouseEmail)) return false;
    if (fields.mailingSameAsProperty) return false;
    if (fields.propertyAddressLat != null || fields.propertyAddressLon != null) return false;
    return true;
  }

  function isDefaultPlansShellPayload(planSetup) {
    if (!planSetup || typeof planSetup !== 'object') return true;
    if (planSetup.buildingType && planSetup.buildingType !== 'residential') return false;
    const canvases = Array.isArray(planSetup.canvases) ? planSetup.canvases : [];
    if (!canvases.length) return true;
    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      if (!c || typeof c !== 'object') continue;
      if (c.plan && c.plan.id) return false;
      if (Array.isArray(c.rooms) && c.rooms.length) return false;
      if (c.frontDoor && typeof c.frontDoor.x === 'number' && typeof c.frontDoor.y === 'number') return false;
    }
    return true;
  }

  function isDefaultDistressShellPayload(distress) {
    if (!distress || typeof distress !== 'object') return true;
    if (Array.isArray(distress.pins) && distress.pins.length) return false;
    if (Array.isArray(distress.drawings) && distress.drawings.length) return false;
    if (Array.isArray(distress.quickCapture) && distress.quickCapture.length) return false;
    if (distress.photoSources && typeof distress.photoSources === 'object' && Object.keys(distress.photoSources).length) return false;
    // Numbering advanced with no pins/drawings is unusual — do not classify as shell.
    if (typeof distress.startNum === 'number' && distress.startNum !== 1) return false;
    if (typeof distress.nextNum === 'number' && distress.nextNum !== 1) return false;
    return true;
  }

  function floorLayerHasWork(layer) {
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

  function isDefaultFloorShellPayload(floor) {
    if (!floor || typeof floor !== 'object') return true;
    if (trimStr(floor.inspectionDate) || trimStr(floor.surveyNotes)) return false;
    if (Array.isArray(floor.customSurfaces) && floor.customSurfaces.length) return false;
    if (floor.lastExportedAt) return false;
    const layers = floor.byCanvasId && typeof floor.byCanvasId === 'object'
      ? Object.values(floor.byCanvasId)
      : [];
    if (layers.some(floorLayerHasWork)) return false;
    return true;
  }

  function isMeaningfulComponentPayload(payload, name) {
    if (payload == null) return false;
    switch (name) {
      case 'customer':
        return !isDefaultCustomerShellFields(payload);
      case 'plans':
        return !isDefaultPlansShellPayload(payload);
      case 'distress':
        return !isDefaultDistressShellPayload(payload);
      case 'floor':
        return !isDefaultFloorShellPayload(payload);
      default:
        return false;
    }
  }

  function isDefaultShellComponent(record, name) {
    if (!record || !SHELL_GUARD_COMPONENTS[name]) return false;
    switch (name) {
      case 'customer':
        return isDefaultCustomerShellFields(record);
      case 'plans':
        return isDefaultPlansShellPayload(record.planSetup);
      case 'distress':
        return isDefaultDistressShellPayload(record.distress);
      case 'floor':
        return isDefaultFloorShellPayload(record.floorSurvey);
      default:
        return false;
    }
  }

  function mediaIdsFromPayload(payload, name) {
    if (!payload || typeof payload !== 'object') return [];
    if (name === 'plans') {
      const canvases = Array.isArray(payload.canvases) ? payload.canvases : [];
      return canvases.map(function (c) { return c && c.plan && c.plan.id; }).filter(Boolean);
    }
    if (name === 'distress') {
      const pins = Array.isArray(payload.pins) ? payload.pins : [];
      const ids = [];
      pins.forEach(function (pin) {
        const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
        photos.forEach(function (id) {
          if (typeof id === 'string' && id.indexOf('ph_') === 0) ids.push(id);
        });
      });
      return Array.from(new Set(ids));
    }
    return [];
  }

  function stampComponentRevision(record, name, revision) {
    const rev = iso(revision) || REMOTE_PULL_EPOCH;
    switch (name) {
      case 'customer':
        record.customerUpdatedAt = rev;
        break;
      case 'plans':
        if (!record.planSetup || typeof record.planSetup !== 'object') record.planSetup = {};
        record.planSetup.updatedAt = rev;
        break;
      case 'distress':
        if (!record.distress || typeof record.distress !== 'object') record.distress = {};
        record.distress.updatedAt = rev;
        break;
      case 'floor':
        if (!record.floorSurvey || typeof record.floorSurvey !== 'object') record.floorSurvey = {};
        record.floorSurvey.updatedAt = rev;
        break;
      default:
        break;
    }
  }

  function dataUrlToBytes(value) {
    if (typeof value !== 'string') return null;
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    const data = match[3] || '';
    let binary;
    if (isBase64) {
      binary = atob(data);
    } else {
      binary = decodeURIComponent(data);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes: bytes, contentType: mime, dataUrl: value };
  }

  function bytesToDataUrl(buffer, contentType) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return 'data:' + (contentType || 'application/octet-stream') + ';base64,' + btoa(binary);
  }

  async function openDistressPhotosDb() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains('photos')) {
          request.result.createObjectStore('photos');
        }
      };
      request.onerror = function () { reject(request.error); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }

  async function getDistressPhoto(id) {
    const db = await openDistressPhotosDb();
    try {
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction('photos', 'readonly');
        const req = tx.objectStore('photos').get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    } finally {
      db.close();
    }
  }

  async function putDistressPhoto(id, value) {
    const db = await openDistressPhotosDb();
    try {
      await new Promise(function (resolve, reject) {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(value, id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    } finally {
      db.close();
    }
  }

  async function getLocalMedia(id, kind) {
    if (kind === 'distress') return getDistressPhoto(id);
    return window.ToolboxDB.getMedia(id);
  }

  async function putLocalMedia(id, value, kind) {
    if (kind === 'distress') return putDistressPhoto(id, value);
    return window.ToolboxDB.putMedia(id, value);
  }

  class SyncError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SyncError';
      this.code = code;
    }
  }

  function looksLikeAccessChallenge(response) {
    if (!response) return true;
    if (response.type === 'opaqueredirect') return true;
    if (response.status === 401 || response.status === 403) return true;
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location') || '';
      return /cloudflareaccess\.com|cdn-cgi\/access\/login/i.test(loc);
    }
    return false;
  }

  function needsSameTabAccessLogin() {
    try {
      if (window.navigator && window.navigator.standalone === true) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (_) {}
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function accessLoginUrl() {
    const base = syncApiBase();
    // Do NOT use /cdn-cgi/access/login on the Worker host — that path 404s blank.
    // Hit a protected page instead; Access intercepts, then returns here after sign-in.
    return base + '/auth-done';
  }

  function ensureAccessSession() {
    return new Promise(function (resolve, reject) {
      const loginUrl = accessLoginUrl();
      try { sessionStorage.setItem('toolboxPendingSync', '1'); } catch (_) {}

      // iPhone Safari + home-screen PWA: popups use a different cookie jar.
      // Full-page Access sign-in keeps session and Sync Now in one jar.
      if (needsSameTabAccessLogin()) {
        window.location.assign(loginUrl);
        return;
      }

      let popup = null;
      try {
        popup = window.open(loginUrl, 'toolbox-sync-access', 'width=520,height=720');
      } catch (_) {
        popup = null;
      }
      if (!popup) {
        window.location.assign(loginUrl);
        return;
      }
      const started = Date.now();
      const timer = setInterval(function () {
        if (popup.closed) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > 180000) {
          clearInterval(timer);
          try { popup.close(); } catch (_) {}
          reject(new SyncError('auth', 'Sign in timed out.'));
        }
      }, 700);
    });
  }

  async function apiFetch(path, options) {
    const base = syncApiBase();
    if (!base) {
      throw new SyncError('config', 'Sync is not configured yet.');
    }
    if (!navigator.onLine) {
      throw new SyncError('offline', 'Offline — Sync Now needs a network connection.');
    }
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    if (!headers['x-toolbox-device-id'] && !headers['X-Toolbox-Device-Id']) {
      headers['x-toolbox-device-id'] = getDeviceId();
    }
    const attempt = async function () {
      return fetch(base + path, Object.assign({}, opts, {
        headers: headers,
        credentials: 'include',
        redirect: 'manual',
      }));
    };

    let response;
    try {
      response = await attempt();
    } catch (err) {
      throw new SyncError('network', 'Network error during sync.');
    }

    if (looksLikeAccessChallenge(response)) {
      if (opts.skipAccessPrompt) {
        throw new SyncError('auth', 'Sign in required to sync.');
      }
      await ensureAccessSession();
      try {
        response = await attempt();
      } catch (err) {
        throw new SyncError('network', 'Network error during sync.');
      }
      if (looksLikeAccessChallenge(response)) {
        throw new SyncError('auth', 'Sign in required to sync.');
      }
    }

    // Follow same-origin redirects only after Access has allowed the request.
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) {
        try {
          response = await fetch(new URL(loc, base).toString(), {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body,
            credentials: 'include',
            redirect: 'follow',
          });
        } catch (err) {
          throw new SyncError('network', 'Network error during sync.');
        }
      }
    }

    if (response.status === 401 || response.status === 403) {
      if (opts.allowForbidden) return response;
      let detail = '';
      try { detail = await response.clone().text(); } catch (_) {}
      if (response.status === 403 && /checked out/i.test(detail)) {
        throw new SyncError('checkout', detail || 'Customer File is checked out elsewhere.');
      }
      throw new SyncError('auth', 'Sign in required to sync.');
    }
    if (opts.allow404 && response.status === 404) {
      return response;
    }
    if (opts.allowConflict && response.status === 409) {
      return response;
    }
    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch (_) {}
      throw new SyncError('sync', detail || ('Sync failed (' + response.status + ').'));
    }
    return response;
  }

  async function fetchAccessIdentity() {
    const response = await apiFetch('/me');
    const data = await response.json();
    return {
      email: normalizeEmail(data && data.email),
      sub: data && typeof data.sub === 'string' ? data.sub : '',
    };
  }

  async function probeAccessSession() {
    const response = await apiFetch('/health', { skipAccessPrompt: true, method: 'GET' }).catch(function (err) {
      if (err && err.code === 'auth') return null;
      throw err;
    });
    if (!response) return false;
    try {
      const data = await response.json();
      return !!(data && data.ok);
    } catch (_) {
      return false;
    }
  }

  async function listRemoteCabinet() {
    const response = await apiFetch('/files');
    const data = await response.json();
    return {
      files: Array.isArray(data.files) ? data.files : [],
      purged: Array.isArray(data.purged) ? data.purged : [],
    };
  }

  async function listRemoteIndexes() {
    const cabinet = await listRemoteCabinet();
    return cabinet.files;
  }

  async function getRemoteIndex(id) {
    const response = await apiFetch('/files/' + encodeURIComponent(id) + '/index', { allow404: true });
    if (response.status === 404) return null;
    return response.json();
  }

  async function putRemoteIndex(index) {
    await apiFetch('/files/' + encodeURIComponent(index.id) + '/index', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(index),
    });
  }

  /**
   * Explicit permanent delete: remove cf/{id}/* and write a durable purge tombstone.
   * Soft Trash / ordinary Sync must never call this.
   */
  async function deleteRemoteCustomerFile(id) {
    if (!id) return;
    await apiFetch('/files/' + encodeURIComponent(id), {
      method: 'DELETE',
      allow404: true,
    });
  }

  async function acquireRemoteCheckout(id) {
    const deviceId = getDeviceId();
    const response = await apiFetch('/files/' + encodeURIComponent(id) + '/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-toolbox-device-id': deviceId,
      },
      body: JSON.stringify({ deviceId: deviceId }),
      allowConflict: true,
    });
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (response.status === 409) {
      const err = new SyncError('checkout', (data && data.message) || 'Customer File is checked out elsewhere.');
      err.checkout = data && data.checkout ? data.checkout : null;
      throw err;
    }
    if (!response.ok) {
      throw new SyncError('sync', (data && data.message) || ('Check Out failed (' + response.status + ').'));
    }
    return data;
  }

  async function releaseRemoteCheckout(id) {
    const deviceId = getDeviceId();
    const response = await apiFetch('/files/' + encodeURIComponent(id) + '/checkout/release', {
      method: 'POST',
      headers: { 'x-toolbox-device-id': deviceId },
      allowForbidden: true,
      allowConflict: true,
    });
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
      throw new SyncError(
        response.status === 403 ? 'checkout' : 'sync',
        (data && data.message) || ('Could not release checkout (' + response.status + ').'),
      );
    }
    return data;
  }

  /**
   * Explicit Check Out + materialize one cloud Customer File locally.
   * Acquire first; on materialization failure release the lease (same user+device).
   * Durable local marker checkedOutFromCabinet survives restart/offline so the
   * Customer Files ⋯ menu can offer Check In without a live Cabinet lookup.
   */
  async function checkOutCustomerFile(id) {
    if (!id) throw new SyncError('sync', 'Customer File id required.');
    const existingLocal = await window.ToolboxDB.getCustomerFile(id);
    if (existingLocal && !existingLocal.deletedAt) {
      // Already local: acquire ownership if possible, but do not re-shell.
      const acquired = await acquireRemoteCheckout(id);
      const marked = await ensureCheckedOutFromCabinetMarker(existingLocal);
      return {
        ok: true,
        id: id,
        alreadyLocal: true,
        idempotent: !!(acquired && acquired.idempotent),
        checkout: acquired && acquired.checkout,
        record: marked,
      };
    }

    const acquired = await acquireRemoteCheckout(id);
    const remote = (acquired && acquired.index) || await getRemoteIndex(id);
    if (!remote) {
      try { await releaseRemoteCheckout(id); } catch (_) {}
      throw new SyncError('sync', 'Checked out Customer File index missing.');
    }

    try {
      const shell = shellForRemotePull(id, remote);
      const synced = await syncOneRecord(shell, remote, {
        materializeOnly: true,
      });
      let saved = await window.ToolboxDB.getCustomerFile(id);
      if (!saved) {
        throw new SyncError('sync', 'Check Out materialization did not persist locally.');
      }
      // Required media integrity: plans/distress media must be present when referenced.
      const planIds = planMediaIds(saved);
      for (let i = 0; i < planIds.length; i++) {
        const media = await getLocalMedia(planIds[i], 'plan');
        if (media == null || media === '') {
          throw new SyncError('incomplete', 'Required plan media missing after Check Out.');
        }
      }
      const photoIds = distressPhotoIds(saved);
      for (let i = 0; i < photoIds.length; i++) {
        const media = await getLocalMedia(photoIds[i], 'distress');
        if (media == null || media === '') {
          throw new SyncError('incomplete', 'Required Distress media missing after Check Out.');
        }
      }
      saved = await ensureCheckedOutFromCabinetMarker(saved);
      return {
        ok: true,
        id: id,
        alreadyLocal: false,
        idempotent: !!(acquired && acquired.idempotent),
        checkout: acquired && acquired.checkout,
        record: saved,
        sync: synced,
      };
    } catch (err) {
      // Do not leave an invisible ownership lease after failed materialization.
      try { await releaseRemoteCheckout(id); } catch (_) {}
      throw err;
    }
  }

  function isCheckedOutFromCabinet(record) {
    return !!(record && record.checkedOutFromCabinet === true);
  }

  async function ensureCheckedOutFromCabinetMarker(record) {
    if (!record || !record.id) return record;
    if (record.checkedOutFromCabinet === true) return record;
    record.checkedOutFromCabinet = true;
    await window.ToolboxDB.saveCustomerFile(record);
    return record;
  }

  /**
   * After Sync write-back / first upload: confirm the Cabinet still holds this
   * Customer File index and required media. Fail closed — keep local.
   */
  async function verifyRemoteCabinetCopy(record) {
    if (!record || !record.id) {
      throw new SyncError('incomplete', 'Cannot verify Cabinet copy without a Customer File.');
    }
    const remote = await getRemoteIndex(record.id);
    if (!remote || remote.id !== record.id) {
      throw new SyncError('incomplete', 'Cabinet verification failed: remote index missing.');
    }
    const planIds = planMediaIds(record);
    for (let i = 0; i < planIds.length; i++) {
      if (!(await remoteMediaExists(planIds[i]))) {
        throw new SyncError('incomplete', 'Cabinet verification failed: plan media missing remotely.');
      }
    }
    const photoIds = distressPhotoIds(record);
    for (let i = 0; i < photoIds.length; i++) {
      if (!(await remoteMediaExists(photoIds[i]))) {
        throw new SyncError('incomplete', 'Cabinet verification failed: Distress media missing remotely.');
      }
    }
    return remote;
  }

  async function removeLocalWorkingCopyOnly(record) {
    if (!record || !record.id) return;
    if (!window.ToolboxDB || typeof window.ToolboxDB.removeLocalWorkingCopy !== 'function') {
      throw new SyncError('sync', 'Local-only removal is unavailable.');
    }
    // Intentionally does NOT call deleteRemoteCustomerFile / removeCloudCopies.
    await window.ToolboxDB.removeLocalWorkingCopy([record]);
  }

  function hasActiveCheckoutLease(remote) {
    return !!(remote && remote.checkout &&
      trimStr(remote.checkout.deviceId) &&
      normalizeEmail(remote.checkout.email));
  }

  async function releaseCheckoutAndVerify(id) {
    const released = await releaseRemoteCheckout(id);
    const afterRelease = await getRemoteIndex(id);
    if (!afterRelease) {
      throw new SyncError('incomplete', 'Verification failed: Cabinet index missing after lease release.');
    }
    if (hasActiveCheckoutLease(afterRelease)) {
      throw new SyncError('incomplete', 'Verification failed: checkout lease still present.');
    }
    return { released: released, remote: afterRelease };
  }

  /**
   * Place / clear working copy into the File Cabinet.
   *
   * - No remote: first-upload Sync, verify, local-only remove.
   * - Same-id remote, no lease: reconcile via existing syncOneRecord LWW, verify, local-only remove.
   * - Same-id remote, own lease (even without local checkedOutFromCabinet): Check In ceremony.
   * - Same-id remote, foreign lease: refuse; keep local.
   *
   * Never cloud-deletes. Local removal only after successful verification.
   */
  async function sendToFileCabinet(id) {
    if (!id) throw new SyncError('sync', 'Customer File id required.');
    const record = await window.ToolboxDB.getCustomerFile(id);
    if (!record || record.deletedAt) {
      throw new SyncError('sync', 'Customer File is not available on this device.');
    }
    if (isCheckedOutFromCabinet(record)) {
      throw new SyncError('sync', 'This Customer File is checked out from the Cabinet. Use Check In.');
    }
    if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);

    let remote = await getRemoteIndex(id);
    let synced = null;
    let released = null;
    let path = 'first-upload';

    if (!remote) {
      synced = await syncOneRecord(record, null);
      if (synced && synced.checkoutBlocked) {
        throw new SyncError('checkout', 'Could not write to the File Cabinet (checkout blocked).');
      }
      remote = await verifyRemoteCabinetCopy(record);
    } else if (hasActiveCheckoutLease(remote)) {
      let identity = null;
      try {
        identity = await fetchAccessIdentity();
      } catch (_) {
        identity = null;
      }
      const deviceId = getDeviceId();
      if (!identity || !checkoutOwnerMatches(remote.checkout, identity.email, deviceId)) {
        const err = new SyncError(
          'checkout',
          'This Customer File is checked out elsewhere and cannot be sent from this device.',
        );
        err.checkout = remote.checkout;
        throw err;
      }
      // Own lease without local provenance — complete Check In safety ceremony.
      path = 'own-lease';
      synced = await syncOneRecord(record, remote);
      if (synced && synced.checkoutBlocked) {
        throw new SyncError('checkout', 'Could not write checked-out changes (ownership blocked).');
      }
      await verifyRemoteCabinetCopy(record);
      const releaseResult = await releaseCheckoutAndVerify(id);
      released = releaseResult.released;
      remote = releaseResult.remote;
    } else {
      // Legacy already-synced: same id remote, no lease — reconcile then clear local.
      path = 'reconcile-existing';
      synced = await syncOneRecord(record, remote);
      if (synced && synced.checkoutBlocked) {
        throw new SyncError('checkout', 'Could not write to the File Cabinet (checkout blocked).');
      }
      remote = await verifyRemoteCabinetCopy(record);
    }

    await removeLocalWorkingCopyOnly(record);
    const stillLocal = await window.ToolboxDB.getCustomerFile(id);
    if (stillLocal) {
      throw new SyncError('sync', 'Cabinet copy verified, but local working copy could not be cleared.');
    }

    return {
      ok: true,
      id: id,
      action: 'send-to-file-cabinet',
      path: path,
      remote: remote,
      released: released,
      sync: synced,
    };
  }

  /**
   * Check In: Sync write-back, verify Cabinet copy, release lease, then remove
   * local working copy only (cloud/cabinet copy remains).
   */
  async function checkInCustomerFile(id) {
    if (!id) throw new SyncError('sync', 'Customer File id required.');
    const record = await window.ToolboxDB.getCustomerFile(id);
    if (!record || record.deletedAt) {
      throw new SyncError('sync', 'Customer File is not available on this device.');
    }
    if (!isCheckedOutFromCabinet(record)) {
      throw new SyncError('sync', 'This Customer File is not a checked-out Cabinet file. Use Send to File Cabinet.');
    }
    if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);

    let remote = await getRemoteIndex(id);
    if (!remote) {
      throw new SyncError('incomplete', 'Checked-out Customer File is missing from the File Cabinet.');
    }

    const synced = await syncOneRecord(record, remote);
    if (synced && synced.checkoutBlocked) {
      throw new SyncError('checkout', 'Could not write checked-out changes (ownership blocked).');
    }

    remote = await verifyRemoteCabinetCopy(record);

    const releaseResult = await releaseCheckoutAndVerify(id);
    remote = releaseResult.remote;

    await removeLocalWorkingCopyOnly(record);
    const stillLocal = await window.ToolboxDB.getCustomerFile(id);
    if (stillLocal) {
      throw new SyncError('sync', 'Check In verified remotely, but local working copy could not be cleared.');
    }

    return {
      ok: true,
      id: id,
      action: 'check-in',
      remote: remote,
      released: releaseResult.released,
      sync: synced,
    };
  }

  /**
   * Lightweight Cabinet browse: remote indexes + local presence, no materialize.
   */
  async function browseCabinet() {
    const deviceId = getDeviceId();
    let identity = null;
    try {
      identity = await fetchAccessIdentity();
    } catch (_) {
      identity = null;
    }
    const cabinet = await listRemoteCabinet();
    const localRecords = await window.ToolboxDB.getAllCustomerFiles();
    const localById = {};
    (localRecords || []).forEach(function (record) {
      if (record && record.id) localById[record.id] = record;
    });

    const entries = (cabinet.files || []).map(function (index) {
      const local = localById[index.id] || null;
      const checkout = index.checkout || null;
      const ownedHere = !!(identity && checkout &&
        checkoutOwnerMatches(checkout, identity.email, deviceId));
      let presence = 'cloud-only';
      if (local && !local.deletedAt) presence = 'local';
      else if (local && local.deletedAt) presence = 'local-trash';

      let availability = 'available';
      if (checkout && trimStr(checkout.deviceId) && normalizeEmail(checkout.email)) {
        availability = ownedHere ? 'checked-out-here' : 'checked-out-elsewhere';
      }

      const entry = {
        id: index.id,
        displayName: trimStr(index.displayName) || (local ? displayNameFromRecord(local) : 'Customer File'),
        propertyAddress: trimStr(index.propertyAddress) || (local ? trimStr(local.propertyAddress) : ''),
        deletedAt: index.deletedAt || null,
        createdAt: trimStr(index.createdAt) || (local ? trimStr(local.createdAt) : ''),
        // Survey date only. createdAt is the display fallback, never updatedAt
        // or checkout.checkedOutAt.
        fieldWorkDate: (local && !local.deletedAt)
          ? (fieldWorkSurveyDate(local) || '')
          : trimStr(index.fieldWorkDate),
        checkout: checkout,
        presence: presence,
        availability: availability,
        local: !!local,
      };
      CABINET_SEARCH_FIELDS.forEach(function (key) {
        const fromIndex = trimStr(index[key]);
        const fromLocal = local ? trimStr(local[key]) : '';
        if (fromIndex && fromLocal && fromIndex.toLowerCase() !== fromLocal.toLowerCase()) {
          entry[key] = fromIndex + '\n' + fromLocal;
        } else {
          entry[key] = fromIndex || fromLocal;
        }
      });
      const localName = local ? displayNameFromRecord(local) : '';
      const localAddress = local ? trimStr(local.propertyAddress) : '';
      if (localName && localName.toLowerCase() !== entry.displayName.toLowerCase()) {
        entry.displayNameSearch = entry.displayName + '\n' + localName;
      }
      if (localAddress && localAddress.toLowerCase() !== entry.propertyAddress.toLowerCase()) {
        entry.propertyAddressSearch = entry.propertyAddress + '\n' + localAddress;
      }
      return entry;
    });

    return {
      ok: true,
      deviceId: deviceId,
      identity: identity,
      entries: entries,
      purged: cabinet.purged || [],
    };
  }

  async function getRemoteComponent(id, name) {
    const response = await apiFetch(
      '/files/' + encodeURIComponent(id) + '/components/' + encodeURIComponent(name),
      { allow404: true },
    );
    if (response.status === 404) return null;
    return response.json();
  }

  async function putRemoteComponent(id, name, payload) {
    await apiFetch('/files/' + encodeURIComponent(id) + '/components/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload == null ? null : payload),
    });
  }

  async function remoteMediaExists(mediaId) {
    const response = await apiFetch('/media/' + encodeURIComponent(mediaId) + '/exists');
    const data = await response.json();
    return !!data.exists;
  }

  async function putRemoteMedia(mediaId, dataUrl) {
    const packed = dataUrlToBytes(dataUrl);
    if (!packed) throw new SyncError('sync', 'Unsupported media format for ' + mediaId);
    await apiFetch('/media/' + encodeURIComponent(mediaId), {
      method: 'PUT',
      headers: {
        'content-type': packed.contentType,
        'x-toolbox-encoding': 'raw',
      },
      body: packed.bytes,
    });
  }

  async function getRemoteMediaDataUrl(mediaId) {
    const response = await apiFetch('/media/' + encodeURIComponent(mediaId));
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();
    return bytesToDataUrl(buffer, contentType);
  }

  async function ensureRemoteMedia(mediaId, kind) {
    if (await remoteMediaExists(mediaId)) return;
    const local = await getLocalMedia(mediaId, kind);
    if (local == null) {
      throw new SyncError('sync', 'Missing local media required for sync: ' + mediaId);
    }
    const asDataUrl = typeof local === 'string' ? local : null;
    if (!asDataUrl) {
      throw new SyncError('sync', 'Media is not in a transferable form: ' + mediaId);
    }
    await putRemoteMedia(mediaId, asDataUrl);
  }

  async function ensureLocalMedia(mediaId, kind) {
    const existing = await getLocalMedia(mediaId, kind);
    if (existing != null && existing !== '') return;
    const dataUrl = await getRemoteMediaDataUrl(mediaId);
    await putLocalMedia(mediaId, dataUrl, kind);
  }

  async function pushComponent(record, name) {
    const payload = extractComponent(record, name);
    const mediaIds = mediaIdsForComponent(record, name);
    const kind = name === 'distress' ? 'distress' : 'plans';
    for (let i = 0; i < mediaIds.length; i++) {
      await ensureRemoteMedia(mediaIds[i], kind === 'distress' ? 'distress' : 'plan');
    }
    await putRemoteComponent(record.id, name, payload);
  }

  async function pullComponent(record, name) {
    const payload = await getRemoteComponent(record.id, name);
    if (payload == null) return { pulled: false, mediaOk: true };
    // Required media must be local before the component becomes authoritative.
    const mediaIds = mediaIdsFromPayload(payload, name);
    const kind = name === 'distress' ? 'distress' : 'plan';
    for (let i = 0; i < mediaIds.length; i++) {
      await ensureLocalMedia(mediaIds[i], kind === 'distress' ? 'distress' : 'plan');
    }
    applyComponent(record, name, payload);
    return { pulled: true, mediaOk: true };
  }

  function indexRev(index, name) {
    if (!index) return '';
    switch (name) {
      case 'customer': return iso(index.customerUpdatedAt);
      case 'plans': return iso(index.plansUpdatedAt);
      case 'distress': return iso(index.distressUpdatedAt);
      case 'floor': return iso(index.floorUpdatedAt);
      case 'diagnostics': return iso(index.diagnosticsUpdatedAt);
      case 'report': return iso(index.reportUpdatedAt);
      case 'trash': return iso(index.trashUpdatedAt);
      default: return '';
    }
  }

  /**
   * LWW with narrow manufactured-shell guard for customer/plans/distress/floor.
   * Trash/diagnostics/report stay pure clock comparison.
   */
  async function decideComponentAction(record, name, remote) {
    const localRev = componentRevision(record, name);
    const remoteRev = indexRev(remote, name);
    let decision = chooseSide(localRev, remoteRev);
    if (!SHELL_GUARD_COMPONENTS[name] || decision === 'skip' || !remote) {
      return decision;
    }

    const localIsShell = isDefaultShellComponent(record, name);

    if (decision === 'push' && localIsShell && remoteRev) {
      const remotePayload = await getRemoteComponent(record.id, name);
      if (isMeaningfulComponentPayload(remotePayload, name)) {
        return 'pull';
      }
      return decision;
    }

    if (decision === 'pull' && !localIsShell && remoteRev) {
      const remotePayload = await getRemoteComponent(record.id, name);
      if (remotePayload != null && !isMeaningfulComponentPayload(remotePayload, name) &&
          isMeaningfulComponentPayload(extractComponent(record, name), name)) {
        // Poisoned/default remote must not destroy meaningful older local data.
        return 'push';
      }
      return decision;
    }

    return decision;
  }

  async function syncOneRecord(record, remoteIndex, options) {
    options = options || {};
    const remote = remoteIndex || null;
    let changed = false;
    const componentResults = [];

    // Ownership gate: once a Cabinet file has explicit checkout metadata,
    // only the owning user+device may push. Local data is preserved.
    let mayPush = !options.materializeOnly;
    let checkoutBlocked = false;
    if (mayPush && remote && remote.checkout && trimStr(remote.checkout.deviceId) &&
        normalizeEmail(remote.checkout.email) && !options.bypassCheckoutPushGate) {
      let identity = null;
      try {
        identity = await fetchAccessIdentity();
      } catch (_) {
        identity = null;
      }
      const deviceId = getDeviceId();
      if (!identity || !checkoutOwnerMatches(remote.checkout, identity.email, deviceId)) {
        mayPush = false;
        checkoutBlocked = true;
      }
    }

    for (let i = 0; i < COMPONENTS.length; i++) {
      const name = COMPONENTS[i];
      // Stage A recognizes future diagnostics/report without inventing empty product data.
      if ((name === 'diagnostics' || name === 'report') &&
          !componentRevision(record, name) && !indexRev(remote, name)) {
        componentResults.push({ name: name, action: 'skip' });
        continue;
      }
      let decision = options.materializeOnly
        ? 'pull'
        : await decideComponentAction(record, name, remote);
      if (options.materializeOnly && decision === 'push') decision = 'skip';
      if (decision === 'push' && !mayPush) {
        componentResults.push({ name: name, action: 'blocked-checkout' });
        continue;
      }
      if (decision === 'push') {
        await pushComponent(record, name);
        changed = true;
        componentResults.push({ name: name, action: 'push' });
      } else if (decision === 'pull') {
        const pulled = await pullComponent(record, name);
        if (pulled.pulled) changed = true;
        componentResults.push({ name: name, action: 'pull' });
      } else {
        componentResults.push({ name: name, action: 'skip' });
      }
    }

    const nextIndex = buildIndex(record);
    if ((changed || !remote) && mayPush && !options.materializeOnly) {
      await putRemoteIndex(nextIndex);
    }
    if (changed) {
      record.updatedAt = new Date().toISOString();
      await window.ToolboxDB.saveCustomerFile(record);
    }
    return {
      id: record.id,
      changed: changed,
      components: componentResults,
      checkoutBlocked: checkoutBlocked,
    };
  }

  /**
   * Empty local shell for a Customer File that exists only in the cloud.
   *
   * blankCustomerFile + ensurePlanSetup stamp "now" on every component clock.
   * componentRevision() also calls ensurePlanSetup, which backfills empty clocks
   * with "now" again — so a naive shell would beat older remote revisions and
   * push empty data over real work.
   *
   * Use an epoch sentinel (truthy, so ensurePlanSetup will not backfill) that
   * is older than any real cloud revision, forcing the first sync to pull.
   */
  function shellForRemotePull(id, remote) {
    const shell = window.ToolboxApp.blankCustomerFile(id);
    if (remote && remote.createdAt) shell.createdAt = remote.createdAt;
    if (remote && remote.deletedAt) shell.deletedAt = remote.deletedAt;
    if (remote && remote.purgeAfter) shell.purgeAfter = remote.purgeAfter;
    if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(shell);
    shell.updatedAt = REMOTE_PULL_EPOCH;
    shell.customerUpdatedAt = REMOTE_PULL_EPOCH;
    shell.trashUpdatedAt = REMOTE_PULL_EPOCH;
    if (shell.planSetup) shell.planSetup.updatedAt = REMOTE_PULL_EPOCH;
    if (shell.distress) shell.distress.updatedAt = REMOTE_PULL_EPOCH;
    if (shell.floorSurvey) shell.floorSurvey.updatedAt = REMOTE_PULL_EPOCH;
    return shell;
  }

  function inventoryEntry(id, deletedAt) {
    return {
      id: id,
      trashed: !!deletedAt,
    };
  }

  /**
   * Selective-local inventory report (File Cabinet model).
   * Remote-only and local-only are NORMAL — they are not mismatches.
   * Only flags trash-state disagreement for IDs present on BOTH sides.
   */
  function compareInventories(localRecords, remoteFiles, purgedIds) {
    const localById = {};
    (localRecords || []).forEach(function (record) {
      if (!record || !record.id) return;
      if (purgedIds && purgedIds[record.id]) return;
      localById[record.id] = inventoryEntry(record.id, record.deletedAt);
    });
    const remoteById = {};
    (remoteFiles || []).forEach(function (idx) {
      if (!idx || !idx.id) return;
      if (purgedIds && purgedIds[idx.id]) return;
      remoteById[idx.id] = inventoryEntry(idx.id, idx.deletedAt);
    });

    const localOnly = [];
    const remoteOnly = [];
    const mismatches = [];

    Object.keys(localById).forEach(function (id) {
      const local = localById[id];
      const remote = remoteById[id];
      if (!remote) {
        localOnly.push(id);
        return;
      }
      if (local.trashed !== remote.trashed) {
        mismatches.push({ id: id, reason: 'trash-state-mismatch' });
      }
    });
    Object.keys(remoteById).forEach(function (id) {
      if (!localById[id]) remoteOnly.push(id);
    });

    return {
      // Selective local storage: unequal inventories are healthy.
      ok: mismatches.length === 0,
      mismatches: mismatches,
      localOnly: localOnly,
      remoteOnly: remoteOnly,
      localCount: Object.keys(localById).length,
      remoteCount: Object.keys(remoteById).length,
    };
  }

  async function retirePurgedLocal(record) {
    if (!record || !window.ToolboxDB || typeof window.ToolboxDB.permanentlyDeleteCustomerFiles !== 'function') {
      return;
    }
    await window.ToolboxDB.permanentlyDeleteCustomerFiles([record]);
  }

  /**
   * Sync Now — transition File Cabinet behavior.
   *
   * Processes this device's LOCAL working Customer Files only:
   * - retire locals that have a durable purge tombstone
   * - exchange components/media for each remaining local (LWW + shell guards)
   * - first-upload: local with no remote still pushes into the Cabinet
   *
   * Does NOT auto-materialize remote-only Cabinet entries.
   * Cloud-only files remaining remote is normal (future: Check Out).
   * Success = every local working file processed without component/media errors.
   * Does NOT mean local inventory equals cloud inventory.
   */
  async function syncNow(options) {
    options = options || {};
    if (typeof options.beforeSync === 'function') {
      await options.beforeSync();
    }
    const localRecords = await window.ToolboxDB.getAllCustomerFiles();
    localRecords.forEach(function (record) {
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
    });

    const cabinet = await listRemoteCabinet();
    const remoteIndexes = cabinet.files;
    const purgedList = cabinet.purged || [];
    const purgedIds = {};
    purgedList.forEach(function (entry) {
      const id = entry && (entry.id || entry);
      if (id) purgedIds[id] = true;
    });

    const remoteById = {};
    remoteIndexes.forEach(function (idx) {
      if (idx && idx.id) remoteById[idx.id] = idx;
    });

    const results = [];
    const errors = [];
    let remoteOnlySkipped = 0;
    const localIdSet = {};
    localRecords.forEach(function (record) {
      if (record && record.id) localIdSet[record.id] = true;
    });

    for (let i = 0; i < localRecords.length; i++) {
      const record = localRecords[i];
      try {
        if (purgedIds[record.id]) {
          await retirePurgedLocal(record);
          results.push({ id: record.id, changed: true, retired: true, purged: true });
          continue;
        }
        results.push(await syncOneRecord(record, remoteById[record.id] || null));
      } catch (err) {
        errors.push({
          id: record.id,
          code: err && err.code,
          message: (err && err.message) || String(err),
        });
      }
    }

    // File Cabinet model: remote-only entries stay remote until explicit Check Out.
    // Count them for diagnostics; do not materialize; do not fail Sync because of them.
    Object.keys(remoteById).forEach(function (id) {
      if (localIdSet[id]) return;
      if (purgedIds[id]) return;
      remoteOnlySkipped += 1;
      results.push({ id: id, skipped: true, remoteOnly: true });
    });

    const localAfter = await window.ToolboxDB.getAllCustomerFiles();
    const cabinetAfter = await listRemoteCabinet();
    const purgedAfter = {};
    (cabinetAfter.purged || []).forEach(function (entry) {
      const id = entry && (entry.id || entry);
      if (id) purgedAfter[id] = true;
    });
    const inventory = compareInventories(localAfter, cabinetAfter.files, purgedAfter);

    const syncedAt = new Date().toISOString();
    if (errors.length) {
      const detail = errors[0].message || 'component or media exchange failed';
      const err = new SyncError('incomplete', 'Sync incomplete: ' + detail);
      err.results = results;
      err.errors = errors;
      err.inventory = inventory;
      err.remoteOnlySkipped = remoteOnlySkipped;
      err.syncedAt = syncedAt;
      throw err;
    }

    // Trash-state disagreement on an ID present locally AND remotely is still a real problem.
    if (inventory.mismatches && inventory.mismatches.length) {
      const detail = inventory.mismatches.map(function (m) { return m.id + ':' + m.reason; }).join(', ');
      const err = new SyncError('incomplete', 'Sync incomplete: ' + detail);
      err.results = results;
      err.errors = errors;
      err.inventory = inventory;
      err.remoteOnlySkipped = remoteOnlySkipped;
      err.syncedAt = syncedAt;
      throw err;
    }

    return {
      ok: true,
      syncedAt: syncedAt,
      results: results,
      inventory: inventory,
      remoteOnlySkipped: remoteOnlySkipped,
      // Explicit: success is working-set sync, not full-cabinet agreement.
      scope: 'local-working-set',
    };
  }

  /**
   * File Explorer reads. These never check out, write IndexedDB, or upload.
   *
   * The live Sync Worker serves GET /files. GET /explore/files is 404 with
   * body "Not found" until that Worker build is deployed. A 404 must fall
   * back to the cabinet routes already in the field, or the screen shows
   * "Not found" instead of the Customer Files that are stored.
   */
  function exploreCustomerIdSafe(id) {
    return typeof id === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/.test(id) &&
      id.indexOf('..') === -1;
  }

  function exploreMediaIdSafe(id) {
    return typeof id === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(id) &&
      id.indexOf('..') === -1;
  }

  function rowFromCabinetIndex(index) {
    if (!exploreCustomerIdSafe(index && index.id)) return null;
    const row = { id: index.id, key: 'cf/' + index.id + '/index.json' };
    const name = trimStr(index.displayName);
    const address = trimStr(index.propertyAddress);
    if (name) row.displayName = name;
    if (address) row.propertyAddress = address;
    return row;
  }

  function compareKeys(a, b) {
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  }

  function noteUnsafeMedia(notes, source) {
    const text = 'Referenced media id in ' + source + ' is not a single storage key and was not fetched.';
    if (notes.indexOf(text) === -1) notes.push(text);
  }

  function mediaIdsForCabinetListing(plans, distress, notes) {
    const ids = [];
    mediaIdsFromPayload(plans, 'plans').forEach(function (id) {
      if (!exploreMediaIdSafe(id)) {
        noteUnsafeMedia(notes, 'plans.json');
        return;
      }
      ids.push(id);
    });
    distressPhotoIds({ distress: distress || {} }).forEach(function (id) {
      if (!exploreMediaIdSafe(id)) {
        noteUnsafeMedia(notes, 'distress.json');
        return;
      }
      ids.push(id);
    });
    const seen = Object.create(null);
    return ids.filter(function (id) {
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  async function listingFromCabinetIndexes() {
    const cabinet = await listRemoteCabinet();
    const files = [];
    (cabinet.files || []).forEach(function (index) {
      const row = rowFromCabinetIndex(index);
      if (row) files.push(row);
    });
    files.sort(compareKeys);
    return { files: files };
  }

  async function readCabinetComponent(id, name) {
    const response = await apiFetch(
      '/files/' + encodeURIComponent(id) + '/components/' + encodeURIComponent(name),
      { allow404: true },
    );
    if (response.status === 404) return { missing: true };
    try {
      return { payload: await response.json() };
    } catch (_) {
      return { unreadable: true };
    }
  }

  async function listingFromCabinetFile(id) {
    if (!exploreCustomerIdSafe(id)) throw new SyncError('sync', 'Not found');
    const index = await getRemoteIndex(id);
    if (!index) throw new SyncError('sync', 'Not found');
    const notes = [];
    const objects = [{
      key: 'cf/' + id + '/index.json',
      contentType: 'application/json',
    }];
    let plans = null;
    let distress = null;
    for (let i = 0; i < COMPONENTS.length; i++) {
      const name = COMPONENTS[i];
      const read = await readCabinetComponent(id, name);
      if (read.missing) continue;
      objects.push({
        key: 'cf/' + id + '/' + name + '.json',
        contentType: 'application/json',
      });
      if (read.unreadable) {
        notes.push('cf/' + id + '/' + name + '.json could not be read; its media references are not listed.');
        continue;
      }
      if (name === 'plans') plans = read.payload;
      if (name === 'distress') distress = read.payload;
    }
    const mediaIds = mediaIdsForCabinetListing(plans, distress, notes);
    for (let i = 0; i < mediaIds.length; i++) {
      const key = 'media/' + mediaIds[i];
      const exists = await remoteMediaExists(mediaIds[i]);
      if (exists) objects.push({ key: key });
      else objects.push({ key: key, missing: true });
    }
    objects.sort(compareKeys);
    return {
      id: id,
      prefix: 'cf/' + id + '/',
      objects: objects,
      referenceNotes: notes,
    };
  }

  async function fetchCabinetObject(id, key) {
    if (!exploreCustomerIdSafe(id)) throw new SyncError('sync', 'Not found');
    if (key === 'cf/' + id + '/index.json') {
      const response = await apiFetch('/files/' + encodeURIComponent(id) + '/index', { allow404: true });
      if (response.status === 404) throw new SyncError('sync', 'Not found');
      return response;
    }
    const prefix = 'cf/' + id + '/';
    if (typeof key === 'string' && key.indexOf(prefix) === 0) {
      const name = key.slice(prefix.length, -'.json'.length);
      if (key === prefix + name + '.json' && COMPONENTS.indexOf(name) !== -1) {
        const response = await apiFetch(
          '/files/' + encodeURIComponent(id) + '/components/' + encodeURIComponent(name),
          { allow404: true },
        );
        if (response.status === 404) throw new SyncError('sync', 'Not stored');
        return response;
      }
    }
    if (typeof key === 'string' && key.indexOf('media/') === 0) {
      const mediaId = key.slice('media/'.length);
      if (!exploreMediaIdSafe(mediaId)) throw new SyncError('sync', 'Not found');
      const response = await apiFetch('/media/' + encodeURIComponent(mediaId), { allow404: true });
      if (response.status === 404) throw new SyncError('sync', 'Not stored');
      return response;
    }
    throw new SyncError('sync', 'Not found');
  }

  async function archiveFromCabinet(id) {
    if (typeof JSZip !== 'function') throw new SyncError('sync', 'ZIP is unavailable.');
    const listing = await listingFromCabinetFile(id);
    const zip = new JSZip();
    const missing = [];
    const objects = listing.objects || [];
    for (let i = 0; i < objects.length; i++) {
      const entry = objects[i];
      if (!entry || !entry.key) continue;
      if (entry.missing) {
        missing.push(entry.key);
        continue;
      }
      const response = await fetchCabinetObject(id, entry.key);
      zip.file(entry.key, new Uint8Array(await response.arrayBuffer()));
    }
    zip.file('missing.txt', missing.length ? missing.join('\n') + '\n' : '');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return new Response(blob, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="cf-' + id + '.zip"',
      },
    });
  }

  async function exploreListFiles() {
    const response = await apiFetch('/explore/files', { allow404: true });
    if (response.status !== 404) return response.json();
    return listingFromCabinetIndexes();
  }

  async function exploreListCustomerFile(id) {
    const response = await apiFetch('/explore/files/' + encodeURIComponent(id), { allow404: true });
    if (response.status !== 404) return response.json();
    return listingFromCabinetFile(id);
  }

  async function exploreFetchObject(id, key) {
    const response = await apiFetch(
      '/explore/files/' + encodeURIComponent(id) + '/object?key=' + encodeURIComponent(key),
      { allow404: true },
    );
    if (response.status !== 404) return response;
    return fetchCabinetObject(id, key);
  }

  async function exploreFetchArchive(id) {
    const response = await apiFetch('/explore/files/' + encodeURIComponent(id) + '/archive', { allow404: true });
    if (response.status !== 404) return response;
    return archiveFromCabinet(id);
  }

  window.ToolboxSync = {
    COMPONENTS: COMPONENTS,
    REMOTE_PULL_EPOCH: REMOTE_PULL_EPOCH,
    syncApiBase: syncApiBase,
    getDeviceId: getDeviceId,
    componentRevision: componentRevision,
    buildIndex: buildIndex,
    extractComponent: extractComponent,
    applyComponent: applyComponent,
    chooseSide: chooseSide,
    isDefaultShellComponent: isDefaultShellComponent,
    isMeaningfulComponentPayload: isMeaningfulComponentPayload,
    mediaIdsForComponent: mediaIdsForComponent,
    planMediaIds: planMediaIds,
    distressPhotoIds: distressPhotoIds,
    SyncError: SyncError,
    syncNow: syncNow,
    browseCabinet: browseCabinet,
    checkOutCustomerFile: checkOutCustomerFile,
    sendToFileCabinet: sendToFileCabinet,
    checkInCustomerFile: checkInCustomerFile,
    isCheckedOutFromCabinet: isCheckedOutFromCabinet,
    acquireRemoteCheckout: acquireRemoteCheckout,
    releaseRemoteCheckout: releaseRemoteCheckout,
    fetchAccessIdentity: fetchAccessIdentity,
    ensureAccessSession: ensureAccessSession,
    probeAccessSession: probeAccessSession,
    deleteRemoteCustomerFile: deleteRemoteCustomerFile,
    exploreListFiles: exploreListFiles,
    exploreListCustomerFile: exploreListCustomerFile,
    exploreFetchObject: exploreFetchObject,
    exploreFetchArchive: exploreFetchArchive,
    // test helpers
    _test: {
      pickCustomerFields: pickCustomerFields,
      newerIso: newerIso,
      dataUrlToBytes: dataUrlToBytes,
      bytesToDataUrl: bytesToDataUrl,
      shellForRemotePull: shellForRemotePull,
      decideComponentAction: decideComponentAction,
      compareInventories: compareInventories,
      mediaIdsFromPayload: mediaIdsFromPayload,
      stampComponentRevision: stampComponentRevision,
      isDefaultCustomerShellFields: isDefaultCustomerShellFields,
      isDefaultPlansShellPayload: isDefaultPlansShellPayload,
      isDefaultDistressShellPayload: isDefaultDistressShellPayload,
      isDefaultFloorShellPayload: isDefaultFloorShellPayload,
      checkoutOwnerMatches: checkoutOwnerMatches,
      displayNameFromRecord: displayNameFromRecord,
      fieldWorkSurveyDate: fieldWorkSurveyDate,
      CABINET_SEARCH_FIELDS: CABINET_SEARCH_FIELDS,
      syncOneRecord: syncOneRecord,
    },
  };
})();
