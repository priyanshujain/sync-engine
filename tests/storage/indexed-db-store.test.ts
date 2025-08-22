import 'fake-indexeddb/auto';
import { IndexedDBStore } from '../../src/storage/indexed-db-store';
import { ModelMetadata } from '../../src/model-registry';

describe('IndexedDBStore', () => {
  let store: IndexedDBStore;
  
  const testModel: ModelMetadata = {
    name: 'TestModel',
    loadStrategy: 'full',
    schemaVersion: 1,
    properties: new Map([
      ['name', { type: 'property', indexed: true }],
      ['value', { type: 'property', indexed: false }],
      ['category', { type: 'property', indexed: true }]
    ])
  };

  beforeEach(async () => {
    // Clear all databases before each test
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name && db.name !== '') {
        await new Promise((resolve, reject) => {
          const deleteReq = indexedDB.deleteDatabase(db.name!);
          deleteReq.onsuccess = () => resolve(undefined);
          deleteReq.onerror = () => reject(deleteReq.error);
        });
      }
    }
    
    store = new IndexedDBStore();
  });

  afterEach(() => {
    store.close();
  });

  describe('initialization', () => {
    test('creates database with model stores', async () => {
      await store.initialize([testModel]);
      
      // Verify store was created
      const testData = { id: '1', name: 'Test', value: 100 };
      await store.put('TestModel', testData);
      
      const retrieved = await store.get('TestModel', '1');
      expect(retrieved).toEqual(testData);
    });

    test('creates system stores (_meta, _sync, _transactions)', async () => {
      await store.initialize([testModel]);
      
      // Test _meta store
      await store.setMeta('lastSyncId', 100);
      const syncId = await store.getMeta('lastSyncId');
      expect(syncId).toBe(100);
      
      // Test _sync store
      await store.queueForSync('TestModel', '1', 'create', { id: '1', name: 'Test' });
      const pendingItems = await store.getPendingSyncItems();
      expect(pendingItems).toHaveLength(1);
      expect(pendingItems[0].modelName).toBe('TestModel');
    });

    test('generates schema hash for database naming', async () => {
      const models: ModelMetadata[] = [
        {
          name: 'Account',
          loadStrategy: 'full',
          schemaVersion: 1,
          properties: new Map([
            ['code', { type: 'property', indexed: true }],
            ['name', { type: 'property', indexed: false }]
          ])
        },
        {
          name: 'Transaction',
          loadStrategy: 'full', 
          schemaVersion: 1,
          properties: new Map([
            ['date', { type: 'property', indexed: true }],
            ['amount', { type: 'property', indexed: false }]
          ])
        }
      ];
      
      await store.initialize(models);
      
      // Database should be named with hash
      // Hash should be consistent for same schema
      const store2 = new IndexedDBStore();
      await store2.initialize(models);
      
      // Both should work with same database
      await store.put('Account', { id: '1', code: '1000', name: 'Cash' });
      const account = await store2.get('Account', '1');
      expect(account.code).toBe('1000');
      
      store2.close();
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      await store.initialize([testModel]);
    });

    test('put and get model', async () => {
      const data = { id: '123', name: 'Test Item', value: 42, category: 'A' };
      
      await store.put('TestModel', data);
      const retrieved = await store.get('TestModel', '123');
      
      expect(retrieved).toEqual(data);
    });

    test('update existing model', async () => {
      const initial = { id: '1', name: 'Initial', value: 10 };
      await store.put('TestModel', initial);
      
      const updated = { id: '1', name: 'Updated', value: 20 };
      await store.put('TestModel', updated);
      
      const retrieved = await store.get('TestModel', '1');
      expect(retrieved.name).toBe('Updated');
      expect(retrieved.value).toBe(20);
    });

    test('delete model', async () => {
      await store.put('TestModel', { id: '1', name: 'ToDelete' });
      
      await store.delete('TestModel', '1');
      
      const retrieved = await store.get('TestModel', '1');
      expect(retrieved).toBeUndefined();
    });

    test('get non-existent model returns undefined', async () => {
      const result = await store.get('TestModel', 'non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('querying', () => {
    beforeEach(async () => {
      await store.initialize([testModel]);
      
      // Add test data
      await store.put('TestModel', { id: '1', name: 'Apple', value: 10, category: 'fruit' });
      await store.put('TestModel', { id: '2', name: 'Banana', value: 20, category: 'fruit' });
      await store.put('TestModel', { id: '3', name: 'Carrot', value: 15, category: 'vegetable' });
      await store.put('TestModel', { id: '4', name: 'Date', value: 25, category: 'fruit' });
    });

    test('getAll returns all records', async () => {
      const all = await store.getAll('TestModel');
      
      expect(all).toHaveLength(4);
      expect(all.map(item => item.name).sort()).toEqual(['Apple', 'Banana', 'Carrot', 'Date']);
    });

    test('query with index', async () => {
      const fruits = await store.query('TestModel', {
        index: 'category',
        range: IDBKeyRange.only('fruit')
      });
      
      expect(fruits).toHaveLength(3);
      expect(fruits.every(item => item.category === 'fruit')).toBe(true);
    });

    test('query with limit and offset', async () => {
      const page = await store.query('TestModel', {
        limit: 2,
        offset: 1
      });
      
      expect(page).toHaveLength(2);
    });

    test('count returns number of records', async () => {
      const count = await store.count('TestModel');
      expect(count).toBe(4);
    });

    test('clear removes all records', async () => {
      await store.clear('TestModel');
      
      const count = await store.count('TestModel');
      expect(count).toBe(0);
    });
  });

  describe('sync queue management', () => {
    beforeEach(async () => {
      await store.initialize([testModel]);
    });

    test('queue items for sync', async () => {
      await store.queueForSync('TestModel', '1', 'create', { id: '1', name: 'New' });
      await store.queueForSync('TestModel', '2', 'update', { id: '2', name: 'Updated' });
      await store.queueForSync('TestModel', '3', 'delete', { id: '3' });
      
      const pending = await store.getPendingSyncItems();
      
      expect(pending).toHaveLength(3);
      expect(pending[0].operation).toBe('create');
      expect(pending[1].operation).toBe('update');
      expect(pending[2].operation).toBe('delete');
    });

    test('mark items as synced', async () => {
      await store.queueForSync('TestModel', '1', 'create', { id: '1' });
      const pending = await store.getPendingSyncItems();
      const itemId = pending[0].id;
      
      await store.markSynced(itemId, 12345);
      
      const stillPending = await store.getPendingSyncItems();
      expect(stillPending).toHaveLength(0);
      
      const synced = await store.get('_sync', itemId);
      expect(synced.status).toBe('synced');
      expect(synced.syncId).toBe(12345);
      expect(synced.syncedAt).toBeDefined();
    });
  });

  describe('metadata management', () => {
    beforeEach(async () => {
      await store.initialize([testModel]);
    });

    test('set and get metadata', async () => {
      await store.setMeta('schemaVersion', 2);
      await store.setMeta('lastSyncTime', '2024-01-01T00:00:00Z');
      
      const version = await store.getMeta('schemaVersion');
      const syncTime = await store.getMeta('lastSyncTime');
      
      expect(version).toBe(2);
      expect(syncTime).toBe('2024-01-01T00:00:00Z');
    });

    test('update existing metadata', async () => {
      await store.setMeta('counter', 1);
      await store.setMeta('counter', 2);
      
      const value = await store.getMeta('counter');
      expect(value).toBe(2);
    });

    test('get non-existent metadata returns undefined', async () => {
      const value = await store.getMeta('non-existent');
      expect(value).toBeUndefined();
    });
  });

  describe('error handling', () => {
    test('throws error when database not initialized', async () => {
      const uninitializedStore = new IndexedDBStore();
      
      await expect(uninitializedStore.put('TestModel', { id: '1' }))
        .rejects.toThrow('Database not initialized');
      
      await expect(uninitializedStore.get('TestModel', '1'))
        .rejects.toThrow('Database not initialized');
    });

    test('handles invalid store names gracefully', async () => {
      await store.initialize([testModel]);
      
      // IndexedDB will throw an error for non-existent store
      await expect(store.put('NonExistent', { id: '1' }))
        .rejects.toThrow();
    });
  });

  describe('database lifecycle', () => {
    test('close database connection', async () => {
      await store.initialize([testModel]);
      await store.put('TestModel', { id: '1', name: 'Test' });
      
      store.close();
      
      // After closing, operations should fail
      await expect(store.get('TestModel', '1'))
        .rejects.toThrow('Database not initialized');
    });

    test('delete entire database', async () => {
      await store.initialize([testModel]);
      await store.put('TestModel', { id: '1', name: 'Test' });
      
      await store.deleteDatabase();
      
      // Create new store with same config
      const newStore = new IndexedDBStore();
      await newStore.initialize([testModel]);
      
      // Data should be gone
      const result = await newStore.get('TestModel', '1');
      expect(result).toBeUndefined();
      
      newStore.close();
    });
  });
});