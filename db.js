/* 点亮你的书本 —— 本地数据存储（IndexedDB） */

(function (global) {
  'use strict';

  const DB_NAME = 'dianliang-books';
  const DB_VERSION = 1;

  let dbPromise = null;

  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains('children')) {
            db.createObjectStore('children', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('books')) {
            const books = db.createObjectStore('books', { keyPath: 'id' });
            books.createIndex('childId', 'childId');
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function requestToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function getAll(storeName) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readonly');
    return requestToPromise(t.objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const t = db.transaction(storeName, 'readwrite');
      t.objectStore(storeName).put(value);
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  async function remove(storeName, key) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const t = db.transaction(storeName, 'readwrite');
      t.objectStore(storeName).delete(key);
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
    });
  }

  async function getBooksByChild(childId) {
    const db = await openDB();
    const t = db.transaction('books', 'readonly');
    const index = t.objectStore('books').index('childId');
    return requestToPromise(index.getAll(childId));
  }

  async function clearAll() {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const t = db.transaction(['children', 'books'], 'readwrite');
      t.objectStore('children').clear();
      t.objectStore('books').clear();
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
    });
  }

  global.DB = {
    getAllChildren: function () { return getAll('children'); },
    getAllBooks: function () { return getAll('books'); },
    getBooksByChild: getBooksByChild,
    saveChild: function (child) { return put('children', child); },
    saveBook: function (book) { return put('books', book); },
    deleteChild: function (id) { return remove('children', id); },
    deleteBook: function (id) { return remove('books', id); },
    clearAll: clearAll
  };
})(window);
