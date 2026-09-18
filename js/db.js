// Toolbox — Customer File persistence.
//
// Milestone 1 needs local, offline-durable storage that survives reload and
// close/reopen on one device. It does not need cross-device sync (that is
// Milestone 4). IndexedDB is the smallest storage mechanism that meets the
// actual requirement: structured records, async, and reliable inside an
// installed offline PWA (unlike localStorage, which some browsers treat as
// more disposable under storage pressure).
//
// This module is the only place that knows storage is IndexedDB. Callers
// work with plain Customer File objects.

const DB_NAME = 'toolbox';
const DB_VERSION = 1;
const STORE_CUSTOMER_FILES = 'customerFiles';

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

window.ToolboxDB = {
  saveCustomerFile,
  getCustomerFile,
  getAllCustomerFiles,
};
