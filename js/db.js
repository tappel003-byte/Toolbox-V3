// Toolbox — Customer File + Plan Setup / Distress media persistence.
//
// Milestone 1 needs local, offline-durable storage that survives reload and
// close/reopen on one device. It does not need cross-device sync (that is
// Milestone 4). IndexedDB is the smallest storage mechanism that meets the
// actual requirement: structured records, async, and reliable inside an
// installed offline PWA (unlike localStorage, which some browsers treat as
// more disposable under storage pressure).
//
// This module is the only place that knows storage is IndexedDB. Callers
// work with plain Customer File objects and opaque media ids.
//
// DB_VERSION 2 adds a media object store for Plan Setup plan images (and
// later Distress photo bytes). Plan metadata (id/width/height) lives on the
// shared planSetup canvases on the Customer File record; the image bytes
// live here so large dataURLs do not inflate every CF write beyond what is
// necessary, matching the proven field-reporter-pro split.

const DB_NAME = 'toolbox';
const DB_VERSION = 2;
const STORE_CUSTOMER_FILES = 'customerFiles';
const STORE_MEDIA = 'media';
const TRASH_RETENTION_DAYS = 120;
const DISTRESS_MEDIA_DB = 'pgg_photos_v1';
const DISTRESS_MEDIA_STORE = 'photos';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CUSTOMER_FILES)) {
        db.createObjectStore(STORE_CUSTOMER_FILES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function runTransaction(storeName, mode, work) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = work(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function saveCustomerFile(record) {
  return runTransaction(STORE_CUSTOMER_FILES, 'readwrite', (store) => {
    store.put(record);
    return record;
  });
}

function getCustomerFile(id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CUSTOMER_FILES, 'readonly');
    const request = tx.objectStore(STORE_CUSTOMER_FILES).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

function getAllCustomerFiles() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CUSTOMER_FILES, 'readonly');
    const request = tx.objectStore(STORE_CUSTOMER_FILES).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
}

function putMedia(id, value) {
  return runTransaction(STORE_MEDIA, 'readwrite', (store) => {
    store.put(value, id);
    return id;
  });
}

function getMedia(id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const request = tx.objectStore(STORE_MEDIA).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

function deleteMedia(id) {
  return runTransaction(STORE_MEDIA, 'readwrite', (store) => {
    store.delete(id);
    return true;
  });
}

function moveCustomerFileToTrash(id) {
  return getCustomerFile(id).then((record) => {
    if (!record) return null;
    const deletedAt = new Date();
    const purgeAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    record.deletedAt = deletedAt.toISOString();
    record.purgeAfter = purgeAt.toISOString();
    record.trashUpdatedAt = deletedAt.toISOString();
    record.updatedAt = deletedAt.toISOString();
    return saveCustomerFile(record);
  });
}

function restoreCustomerFile(id) {
  return getCustomerFile(id).then((record) => {
    if (!record) return null;
    delete record.deletedAt;
    delete record.purgeAfter;
    const now = new Date().toISOString();
    record.trashUpdatedAt = now;
    record.updatedAt = now;
    return saveCustomerFile(record);
  });
}

function planMediaIds(record) {
  const canvases = record && record.planSetup && Array.isArray(record.planSetup.canvases)
    ? record.planSetup.canvases
    : [];
  return canvases.map((canvas) => canvas && canvas.plan && canvas.plan.id).filter(Boolean);
}

function collectDistressPhotoId(ids, id) {
  if (typeof id === 'string' && id.indexOf('ph_') === 0) ids.push(id);
}

function distressPhotoIds(record) {
  const distress = record && record.distress ? record.distress : {};
  const pins = Array.isArray(distress.pins) ? distress.pins : [];
  const ids = [];
  pins.forEach((pin) => {
    const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
    photos.forEach((id) => collectDistressPhotoId(ids, id));
  });
  const quick = Array.isArray(distress.quickCapture) ? distress.quickCapture : [];
  quick.forEach((item) => collectDistressPhotoId(ids, item && item.id));
  return ids;
}

function diagnosticsFigureIds(record) {
  const diagnostics = record && record.diagnostics && typeof record.diagnostics === 'object'
    ? record.diagnostics
    : {};
  const figures = Array.isArray(diagnostics.figures) ? diagnostics.figures : [];
  const ids = [];
  figures.forEach((fig) => {
    const id = fig && fig.mediaId;
    if (typeof id !== 'string' || id.indexOf('dxfig_') !== 0) return;
    if (id.indexOf('/') !== -1 || id.indexOf('\\') !== -1 || id.indexOf('..') !== -1) return;
    ids.push(id);
  });
  return ids;
}

function recoveryPdfIds(record) {
  const floor = record && record.floorSurvey ? record.floorSurvey : {};
  const layers = floor.byCanvasId && typeof floor.byCanvasId === 'object' ? floor.byCanvasId : {};
  const ids = [];
  Object.keys(layers).forEach((key) => {
    const id = layers[key] && layers[key].recoveryPdfMediaId;
    if (typeof id !== 'string' || id.indexOf('fsrec_') !== 0) return;
    if (id.indexOf('/') !== -1 || id.indexOf('\\') !== -1 || id.indexOf('..') !== -1) return;
    ids.push(id);
  });
  return ids;
}

function deleteDistressMedia(ids) {
  const unique = Array.from(new Set(ids || []));
  if (!unique.length) return Promise.resolve(0);
  return new Promise((resolve) => {
    const request = indexedDB.open(DISTRESS_MEDIA_DB);
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DISTRESS_MEDIA_STORE)) {
        db.close();
        resolve(0);
        return;
      }
      const tx = db.transaction(DISTRESS_MEDIA_STORE, 'readwrite');
      const store = tx.objectStore(DISTRESS_MEDIA_STORE);
      unique.forEach((id) => store.delete(id));
      tx.oncomplete = () => {
        db.close();
        resolve(unique.length);
      };
      tx.onerror = () => {
        db.close();
        resolve(0);
      };
      tx.onabort = () => {
        db.close();
        resolve(0);
      };
    };
  });
}

function permanentlyDeleteCustomerFiles(records) {
  // Hard-delete local Customer File + required local media.
  // Callers that also intend to destroy the cloud copy must invoke cloud
  // deletion separately (e.g. removeCloudCopies). Prefer removeLocalWorkingCopy
  // for Check In / Send to File Cabinet — those must never cloud-delete.
  return removeLocalWorkingCopy(records);
}

/**
 * Remove a local working Customer File from this device only.
 * Does NOT write Trash metadata, does NOT call the Sync Worker, and must
 * never be paired with deleteRemoteCustomerFile / removeCloudCopies when used
 * for Check In or Send to File Cabinet completion.
 */
function removeLocalWorkingCopy(records) {
  const list = (records || []).filter((record) => record && record.id);
  if (!list.length) return Promise.resolve({ deletedCount: 0, mediaDeletedCount: 0 });
  const planIds = Array.from(new Set(
    list.flatMap(planMediaIds).concat(list.flatMap(recoveryPdfIds)).concat(list.flatMap(diagnosticsFigureIds))
  ));
  const photoIds = Array.from(new Set(list.flatMap(distressPhotoIds)));

  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CUSTOMER_FILES, STORE_MEDIA], 'readwrite');
    const files = tx.objectStore(STORE_CUSTOMER_FILES);
    const media = tx.objectStore(STORE_MEDIA);
    list.forEach((record) => files.delete(record.id));
    planIds.forEach((id) => media.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  })).then(() => deleteDistressMedia(photoIds)).then((photoCount) => ({
    deletedCount: list.length,
    mediaDeletedCount: planIds.length + photoCount,
  }));
}

function purgeExpiredCustomerFiles(now) {
  // Data preservation: do not auto-hard-delete on the 120-day timer.
  // Silent local purge left cloud Trash state able to return on Sync, and
  // creating a permanent cloud purge tombstone from a background heuristic
  // is not an explicit owner permanent-delete action.
  // The 120-day mark is not an automatic delete. Expired rows stay until a person
  // permanently deletes them from File Cabinet Trash, or a local-only file is deleted.
  void now;
  return Promise.resolve({ deletedCount: 0, mediaDeletedCount: 0, deferred: true });
}

// Recovery import commits the complete Customer File record and all recovered
// Customer File plan bytes in one IndexedDB transaction. Distress photos live
// in their proven separate database and are staged/rolled back by the importer.
function importCustomerFileRecovery(record, mediaEntries, expectedUpdatedAt, expectMissing) {
  if (!record || !record.id) return Promise.reject(new Error('Customer File is required.'));
  const entries = Array.isArray(mediaEntries) ? mediaEntries : [];
  if (entries.some((entry) => !entry || !entry.id || typeof entry.value !== 'string')) {
    return Promise.reject(new Error('Recovered plan media is incomplete.'));
  }
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CUSTOMER_FILES, STORE_MEDIA], 'readwrite');
    const files = tx.objectStore(STORE_CUSTOMER_FILES);
    const media = tx.objectStore(STORE_MEDIA);
    let guardError = null;
    const currentRequest = files.get(record.id);
    currentRequest.onsuccess = () => {
      const current = currentRequest.result || null;
      if ((expectMissing && current) ||
          (!expectMissing && (!current || current.updatedAt !== expectedUpdatedAt))) {
        guardError = new Error('This Customer File changed during import. Nothing was imported; review it again.');
        tx.abort();
        return;
      }
      entries.forEach((entry) => media.put(entry.value, entry.id));
      files.put(record);
    };
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(guardError || tx.error || new Error('Recovery import transaction failed.'));
    tx.onabort = () => reject(guardError || tx.error || new Error('Recovery import transaction was cancelled.'));
  }));
}

// Remove or replace a recovered component: write the updated Customer File
// and drop only the plan media ids the caller has already proved are
// unreferenced. Distress photo bytes stay in their own database.
function commitCustomerFileRecoveryUpdate(record, expectedUpdatedAt, mediaIdsToDelete) {
  if (!record || !record.id) return Promise.reject(new Error('Customer File is required.'));
  const deleteIds = Array.isArray(mediaIdsToDelete) ? mediaIdsToDelete.filter(Boolean) : [];
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CUSTOMER_FILES, STORE_MEDIA], 'readwrite');
    const files = tx.objectStore(STORE_CUSTOMER_FILES);
    const media = tx.objectStore(STORE_MEDIA);
    let guardError = null;
    const currentRequest = files.get(record.id);
    currentRequest.onsuccess = () => {
      const current = currentRequest.result || null;
      if (!current || current.updatedAt !== expectedUpdatedAt) {
        guardError = new Error('This Customer File changed. Nothing was removed; review it again.');
        tx.abort();
        return;
      }
      deleteIds.forEach((id) => media.delete(id));
      files.put(record);
    };
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(guardError || tx.error || new Error('Recovery update failed.'));
    tx.onabort = () => reject(guardError || tx.error || new Error('Recovery update was cancelled.'));
  }));
}

window.ToolboxDB = {
  saveCustomerFile,
  getCustomerFile,
  getAllCustomerFiles,
  putMedia,
  getMedia,
  deleteMedia,
  moveCustomerFileToTrash,
  restoreCustomerFile,
  permanentlyDeleteCustomerFiles,
  removeLocalWorkingCopy,
  purgeExpiredCustomerFiles,
  importCustomerFileRecovery,
  commitCustomerFileRecoveryUpdate,
  TRASH_RETENTION_DAYS,
};
