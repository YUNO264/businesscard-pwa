
const CardDB = (() => {
  const DB_NAME = "business-card-pwa";
  const DB_VERSION = 1;
  const STORE = "cards";
  const SETTINGS = "settings";
  let db;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("updatedAt", "updatedAt");
          s.createIndex("company", "company");
        }
        if (!d.objectStoreNames.contains(SETTINGS)) {
          d.createObjectStore(SETTINGS, { keyPath: "key" });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function ready() { if (!db) await open(); }

  async function putCard(card) {
    await ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(card);
      tx.oncomplete = () => resolve(card);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getCard(id) {
    await ready();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllCards() {
    await ready();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteCard(id) {
    await ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearCards() {
    await ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function setSetting(key, value) {
    await ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS, "readwrite");
      tx.objectStore(SETTINGS).put({ key, value });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getSetting(key, fallback = null) {
    await ready();
    return new Promise((resolve, reject) => {
      const req = db.transaction(SETTINGS).objectStore(SETTINGS).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllSettings() {
    await ready();
    return new Promise((resolve, reject) => {
      const req = db.transaction(SETTINGS).objectStore(SETTINGS).getAll();
      req.onsuccess = () => {
        const out = {};
        (req.result || []).forEach(x => out[x.key] = x.value);
        resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }

  return { open, putCard, getCard, getAllCards, deleteCard, clearCards, setSetting, getSetting, getAllSettings };
})();
