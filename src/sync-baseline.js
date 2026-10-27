// IndexedDB avoids using localStorage quota for a second image-heavy notebook.
export function createSyncBaselineStore(key, indexedDB = globalThis.indexedDB) {
  let cached = null, loaded = false, database = null;
  async function open() {
    if (!indexedDB) return null;
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('notidian-sync-history', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('baselines');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Sync history database is blocked.'));
    });
    return database;
  }
  return {
    async read() {
      if (!loaded) {
        try {
          const db = await open();
          if (db) cached = await new Promise((resolve, reject) => {
            const request = db.transaction('baselines').objectStore('baselines').get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
          });
        } catch (err) { console.warn('Sync history could not be read; preserving both versions.', err); }
        loaded = true;
      }
      return cached ? structuredClone(cached) : null;
    },
    async remember(snapshot) {
      cached = structuredClone(snapshot);
      loaded = true;
      try {
        const db = await open();
        if (db) await new Promise((resolve, reject) => {
          const tx = db.transaction('baselines', 'readwrite');
          tx.objectStore('baselines').put(cached, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch (err) { console.warn('Sync history is available for this session only.', err); }
    }
  };
}
