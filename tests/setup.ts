import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { configure } from 'mobx';

// Store original objects for cleanup
let originalIndexedDB: IDBFactory;

beforeAll(() => {
  originalIndexedDB = global.indexedDB;
  
  // Configure MobX for test environment
  configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  try {
    // Clear all databases synchronously to avoid async cleanup issues
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        const deleteReq = indexedDB.deleteDatabase(db.name);
        // Wait synchronously for deletion to complete
        await new Promise<void>((resolve, reject) => {
          deleteReq.onsuccess = () => resolve();
          deleteReq.onerror = () => reject(deleteReq.error);
          deleteReq.onblocked = () => {
            // Force close all connections
            const timer = setTimeout(resolve, 100);
            if (timer && typeof timer.unref === 'function') {
              timer.unref();
            }
          };
        });
      }
    }
    
    // Clear any pending timers and MobX state
    jest.clearAllTimers();
    
  } catch (error) {
    // Ignore cleanup errors during test teardown
  }
});

afterAll(() => {
  // Restore original indexedDB to prevent memory leaks
  if (originalIndexedDB) {
    global.indexedDB = originalIndexedDB;
  }
});