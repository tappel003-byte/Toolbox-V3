// Toolbox — Stage A cross-device sync client.
//
// Local IndexedDB remains the working store. Sync Now exchanges independent
// Customer File components (+ required media) with the Sync API. This module
// does not redesign capture apps or split local storage.

(function () {
  'use strict';

  const COMPONENTS = ['customer', 'plans', 'distress', 'floor', 'diagnostics', 'report', 'trash'];

  function syncApiBase() {
    const cfg = window.ToolboxConfig || {};
    return typeof cfg.syncApiBase === 'string' ? cfg.syncApiBase.replace(/\/$/, '') : '';
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

  function buildIndex(record) {
    return {
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
    };
  }

  function planMediaIds(record) {
    const canvases = record && record.planSetup && Array.isArray(record.planSetup.canvases)
      ? record.planSetup.canvases
      : [];
    return canvases.map(function (c) { return c && c.plan && c.plan.id; }).filter(Boolean);
  }

  function distressPhotoIds(record) {
    const pins = record && record.distress && Array.isArray(record.distress.pins)
      ? record.distress.pins
      : [];
    const ids = [];
    pins.forEach(function (pin) {
      const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
      photos.forEach(function (id) {
        if (typeof id === 'string' && id.indexOf('ph_') === 0) ids.push(id);
      });
    });
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
      throw new SyncError('auth', 'Sign in required to sync.');
    }
    if (opts.allow404 && response.status === 404) {
      return response;
    }
    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch (_) {}
      throw new SyncError('sync', detail || ('Sync failed (' + response.status + ').'));
    }
    return response;
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

  async function listRemoteIndexes() {
    const response = await apiFetch('/files');
    const data = await response.json();
    return Array.isArray(data.files) ? data.files : [];
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

  async function deleteRemoteCustomerFile(id) {
    if (!id) return;
    await apiFetch('/files/' + encodeURIComponent(id), {
      method: 'DELETE',
      allow404: true,
    });
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
    if (payload == null) return;
    applyComponent(record, name, payload);
    const mediaIds = mediaIdsForComponent(record, name);
    const kind = name === 'distress' ? 'distress' : 'plan';
    for (let i = 0; i < mediaIds.length; i++) {
      await ensureLocalMedia(mediaIds[i], kind === 'distress' ? 'distress' : 'plan');
    }
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

  async function syncOneRecord(record, remoteIndex) {
    const localIndex = buildIndex(record);
    const remote = remoteIndex || null;
    let changed = false;

    for (let i = 0; i < COMPONENTS.length; i++) {
      const name = COMPONENTS[i];
      // Stage A recognizes future diagnostics/report without inventing empty product data.
      if ((name === 'diagnostics' || name === 'report') &&
          !componentRevision(record, name) && !indexRev(remote, name)) {
        continue;
      }
      const decision = chooseSide(componentRevision(record, name), indexRev(remote, name));
      if (decision === 'push') {
        await pushComponent(record, name);
        changed = true;
      } else if (decision === 'pull') {
        await pullComponent(record, name);
        changed = true;
      }
    }

    const nextIndex = buildIndex(record);
    if (changed || !remote) {
      await putRemoteIndex(nextIndex);
    }
    if (changed) {
      record.updatedAt = new Date().toISOString();
      await window.ToolboxDB.saveCustomerFile(record);
    }
    return { id: record.id, changed: changed };
  }

  async function syncNow(options) {
    options = options || {};
    if (typeof options.beforeSync === 'function') {
      await options.beforeSync();
    }
    const localRecords = await window.ToolboxDB.getAllCustomerFiles();
    localRecords.forEach(function (record) {
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(record);
    });
    const remoteIndexes = await listRemoteIndexes();
    const remoteById = {};
    remoteIndexes.forEach(function (idx) {
      if (idx && idx.id) remoteById[idx.id] = idx;
    });

    const results = [];
    for (let i = 0; i < localRecords.length; i++) {
      const record = localRecords[i];
      results.push(await syncOneRecord(record, remoteById[record.id] || null));
      delete remoteById[record.id];
    }

    // Pull Customer Files that exist only in the cloud.
    // Skip cloud copies already marked deleted — they belong in Trash sync, not Cabinet.
    const onlyRemoteIds = Object.keys(remoteById);
    for (let i = 0; i < onlyRemoteIds.length; i++) {
      const id = onlyRemoteIds[i];
      const remote = remoteById[id];
      if (remote && remote.deletedAt) {
        const shell = window.ToolboxApp.blankCustomerFile(id);
        if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(shell);
        if (remote.createdAt) shell.createdAt = remote.createdAt;
        await syncOneRecord(shell, remote);
        results.push({ id: id, changed: true, created: true, trashed: true });
        continue;
      }
      const shell = window.ToolboxApp.blankCustomerFile(id);
      if (window.ToolboxPlanSetup) window.ToolboxPlanSetup.ensurePlanSetup(shell);
      if (remote.createdAt) shell.createdAt = remote.createdAt;
      await syncOneRecord(shell, remote);
      results.push({ id: id, changed: true, created: true });
    }

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      results: results,
    };
  }

  window.ToolboxSync = {
    COMPONENTS: COMPONENTS,
    syncApiBase: syncApiBase,
    componentRevision: componentRevision,
    buildIndex: buildIndex,
    extractComponent: extractComponent,
    applyComponent: applyComponent,
    chooseSide: chooseSide,
    mediaIdsForComponent: mediaIdsForComponent,
    planMediaIds: planMediaIds,
    distressPhotoIds: distressPhotoIds,
    SyncError: SyncError,
    syncNow: syncNow,
    ensureAccessSession: ensureAccessSession,
    probeAccessSession: probeAccessSession,
    deleteRemoteCustomerFile: deleteRemoteCustomerFile,
    // test helpers
    _test: {
      pickCustomerFields: pickCustomerFields,
      newerIso: newerIso,
      dataUrlToBytes: dataUrlToBytes,
      bytesToDataUrl: bytesToDataUrl,
    },
  };
})();
