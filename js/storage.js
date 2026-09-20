'use strict';

// One transaction replaces the complete durable snapshot, including image blobs.
window.projectStorage = {
  async transaction(mode, value) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('stopmotion-projects', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other StopMotion tabs and retry.'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('projects', mode);
        const store = tx.objectStore('projects');
        const request = mode === 'readonly' ? store.get('current') : store.put(value, 'current');
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  },
  read() { return this.transaction('readonly'); },
  write(value) { return this.transaction('readwrite', value); }
};
