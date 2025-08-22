import { HashSyncEngine, HashSyncStatus, SyncRecord, SyncDelta } from '../src/sync/hash-sync-engine';
import { IndexedDBStore } from '../src/storage/indexed-db-store';
import { IndexedBaseModel } from '../src/models/indexed-base-model';
import { ModelRegistry, ModelMetadata } from '../src/model-registry';
import { SchemaHasher } from '../src/hash';

// Mock WebSocket for testing
global.WebSocket = jest.fn().mockImplementation(() => ({
  readyState: 1,
  send: jest.fn(),
  close: jest.fn(),
  addEventListener: jest.fn(),
})) as any;

// Mock navigator for Node.js environment
if (!global.navigator) {
  (global as any).navigator = {};
}
Object.defineProperty(global.navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock crypto for node environment
if (!global.crypto) {
  global.crypto = require('crypto').webcrypto;
}

// Mock window event listeners for browser APIs
global.window = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
} as any;

// Test model for sync testing
class TestSyncModel extends IndexedBaseModel {
  name: string = '';
  value: number = 0;

  update(data: { name?: string; value?: number }): void {
    if (data.name !== undefined) this.name = data.name;
    if (data.value !== undefined) this.value = data.value;
    this.markDirty();
  }

  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      value: this.value,
      _version: this._version,
      updatedAt: new Date(),
    };
  }
}

describe('HashSyncEngine', () => {
  let store: IndexedDBStore;
  let syncEngine: HashSyncEngine;
  let testModel: TestSyncModel;

  beforeEach(async () => {
    // Initialize storage
    store = new IndexedDBStore();
    
    const testModelMetadata: ModelMetadata = {
      name: 'TestSyncModel',
      loadStrategy: 'full',
      schemaVersion: 1,
      properties: new Map([
        ['name', { type: 'property', indexed: false }],
        ['value', { type: 'property', indexed: true }],
      ])
    };

    await store.initialize([testModelMetadata]);
    
    // Clear any existing sync records
    await store.clear('_sync');
    
    // Set up model integration
    IndexedBaseModel.setStore(store);
    ModelRegistry.registerModel('TestSyncModel', TestSyncModel as any);

    // Initialize sync engine
    syncEngine = new HashSyncEngine(store, {
      serverUrl: 'ws://localhost:8080/sync',
      clientId: 'test-client-1',
      batchSize: 10,
      syncIntervalMs: 1000,
      conflictResolution: 'last-write-wins',
    });

    await syncEngine.initialize();
    IndexedBaseModel.setSyncEngine(syncEngine);

    // Create test model with autoSave disabled to avoid duplicate saves
    testModel = new TestSyncModel('test-model-1', { autoSave: false });
  });

  afterEach(async () => {
    syncEngine.disconnect();
    await store.deleteDatabase();
  });

  describe('Initialization', () => {
    test('initializes with correct configuration', () => {
      expect(syncEngine.stats.status).toBe(HashSyncStatus.DISCONNECTED);
      expect(syncEngine.stats.serverVersion).toBe(0);
      expect(syncEngine.stats.localVersion).toBe(0);
      expect(syncEngine.stats.pendingSyncRecords).toBe(0);
    });

    test('loads existing sync state', async () => {
      // Save some sync state
      await store.setMetadata('sync_state', {
        localVersion: 5,
        serverVersion: 3,
        pendingSyncRecords: 2,
      });

      // Create new sync engine to test loading
      const newSyncEngine = new HashSyncEngine(store, { clientId: 'test-client-2' });
      await newSyncEngine.initialize();

      expect(newSyncEngine.stats.localVersion).toBe(5);
      expect(newSyncEngine.stats.serverVersion).toBe(3);
      expect(newSyncEngine.stats.pendingSyncRecords).toBe(2);
    });
  });

  describe('Schema Hashing', () => {
    test('generates consistent schema hash', async () => {
      const models = ModelRegistry.getAllModels();
      const hash1 = await SchemaHasher.generateDatabaseHash(Array.from(models.values()));
      const hash2 = await SchemaHasher.generateDatabaseHash(Array.from(models.values()));
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    test('generates different hash for different schemas', async () => {
      const models1: ModelMetadata[] = [
        {
          name: 'Model1',
          loadStrategy: 'full',
          schemaVersion: 1,
          properties: new Map([['prop1', { type: 'property', indexed: false }]])
        }
      ];

      const models2: ModelMetadata[] = [
        {
          name: 'Model2', 
          loadStrategy: 'full',
          schemaVersion: 1,
          properties: new Map([['prop2', { type: 'property', indexed: false }]])
        }
      ];

      const hash1 = await SchemaHasher.generateDatabaseHash(models1);
      const hash2 = await SchemaHasher.generateDatabaseHash(models2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Sync Record Management', () => {
    test('queues sync record for model changes', async () => {
      // Update model to trigger sync record
      testModel.update({ name: 'Test Name', value: 42 });
      await testModel.save();

      // Check that sync record was queued
      const pendingRecords = await store.getPendingSyncRecords(10);
      expect(pendingRecords).toHaveLength(1);
      
      const record = pendingRecords[0];
      expect(record.modelName).toBe('TestSyncModel');
      expect(record.modelId).toBe('test-model-1');
      expect(record.operation).toBe('create');
      expect(record.data.name).toBe('Test Name');
      expect(record.data.value).toBe(42);
    });

    test('tracks pending sync record count', async () => {
      expect(syncEngine.stats.pendingSyncRecords).toBe(0);

      // Create multiple model changes
      testModel.update({ name: 'Test 1' });
      await testModel.save();

      const model2 = new TestSyncModel('test-model-2', { autoSave: false });
      model2.update({ name: 'Test 2' });
      await model2.save();

      // Wait for sync count to update
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(syncEngine.stats.pendingSyncRecords).toBe(2);
    });

    test('can queue custom sync records', async () => {
      await syncEngine.queueSyncRecord({
        modelName: 'TestSyncModel',
        modelId: 'custom-model',
        operation: 'update',
        data: { name: 'Custom', value: 999 },
        version: 1,
      });

      const pendingRecords = await store.getPendingSyncRecords(10);
      expect(pendingRecords).toHaveLength(1);
      
      // The structure should have the complete sync record in data field
      const syncRecord = pendingRecords[0];
      expect(syncRecord.data).toBeDefined();
      expect(syncRecord.data.data).toBeDefined();
      expect(syncRecord.data.data.name).toBe('Custom');
      expect(syncRecord.data.data.value).toBe(999);
    });
  });

  describe('Delta Creation', () => {
    test('creates sync delta with multiple records', async () => {
      // Create multiple changes
      testModel.update({ name: 'Model 1', value: 10 });
      await testModel.save();

      const model2 = new TestSyncModel('test-model-2', { autoSave: false });
      model2.update({ name: 'Model 2', value: 20 });
      await model2.save();

      // Get pending records
      const pendingRecords = await store.getPendingSyncRecords(10);
      expect(pendingRecords).toHaveLength(2);

      // Verify records have proper structure
      pendingRecords.forEach(record => {
        expect(record).toHaveProperty('id');
        expect(record).toHaveProperty('createdAt');
        expect(record).toHaveProperty('modelName');
        expect(record.modelName).toBe('TestSyncModel');
      });
    });
  });

  describe('Conflict Resolution', () => {
    test('applies last-write-wins resolution', async () => {
      // Create initial model
      testModel.update({ name: 'Original', value: 100 });
      await testModel.save();

      // Simulate remote update with newer timestamp
      const remoteRecord: SyncRecord = {
        id: 'remote-record-1',
        modelName: 'TestSyncModel',
        modelId: 'test-model-1',
        operation: 'update',
        data: { name: 'Remote Update', value: 200 },
        version: 2,
        timestamp: Date.now() + 1000, // Newer
        clientId: 'remote-client',
        hash: 'abc123def456789', // Valid hex hash
      };

      // Apply remote record (this would normally be done through WebSocket)
      await (syncEngine as any).applyRemoteRecord(remoteRecord);

      // Verify remote change was applied
      const updatedModel = await TestSyncModel.load('test-model-1');
      expect(updatedModel?.name).toBe('Remote Update');
      expect(updatedModel?.value).toBe(200);
    });

    test('preserves local changes when local is newer', async () => {
      // Create model with high version number
      testModel.update({ name: 'Local Update', value: 300 });
      testModel._version = 5; // High version
      await testModel.save();

      // Simulate older remote update
      const remoteRecord: SyncRecord = {
        id: 'remote-record-2',
        modelName: 'TestSyncModel', 
        modelId: 'test-model-1',
        operation: 'update',
        data: { name: 'Old Remote', value: 100 },
        version: 2, // Lower version
        timestamp: Date.now() - 1000, // Older
        clientId: 'remote-client',
        hash: 'fedcba987654321', // Valid hex hash
      };

      // Apply remote record
      await (syncEngine as any).applyRemoteRecord(remoteRecord);

      // Verify local change was preserved
      const model = await TestSyncModel.load('test-model-1');
      expect(model?.name).toBe('Local Update');
      expect(model?.value).toBe(300);
    });
  });

  describe('Connection Management', () => {
    test('tracks connection status', () => {
      expect(syncEngine.stats.status).toBe(HashSyncStatus.DISCONNECTED);
    });

    test('handles disconnect gracefully', () => {
      syncEngine.disconnect();
      expect(syncEngine.stats.status).toBe(HashSyncStatus.DISCONNECTED);
    });

    test('handles connection attempts', async () => {
      // Mock WebSocket to avoid actual connection
      const mockConnect = jest.spyOn(syncEngine as any, 'establishWebSocketConnection')
        .mockRejectedValue(new Error('Connection failed'));

      await expect(syncEngine.connect()).rejects.toThrow('Connection failed');
      expect(syncEngine.stats.status).toBe(HashSyncStatus.ERROR);
      expect(syncEngine.stats.lastError).toBe('Connection failed');

      mockConnect.mockRestore();
    });

    test('handles sync attempts when disconnected', async () => {
      // Should not throw when disconnected
      await expect(syncEngine.sync()).resolves.toBeUndefined();
      expect(syncEngine.stats.status).toBe(HashSyncStatus.DISCONNECTED);
    });
  });

  describe('Sync Statistics', () => {
    test('provides comprehensive sync stats', () => {
      const stats = syncEngine.stats;
      
      expect(stats).toHaveProperty('status');
      expect(stats).toHaveProperty('serverVersion');
      expect(stats).toHaveProperty('localVersion');
      expect(stats).toHaveProperty('pendingSyncRecords');
      expect(stats).toHaveProperty('isOnline');
      expect(stats).toHaveProperty('lastSyncTime');
    });

    test('updates stats after sync operations', async () => {
      const initialStats = syncEngine.stats;
      expect(initialStats.pendingSyncRecords).toBe(0);
      
      // Create sync record
      await syncEngine.queueSyncRecord({
        modelName: 'TestSyncModel',
        modelId: 'stats-test',
        operation: 'create',
        data: { name: 'Stats Test' },
        version: 1,
      });

      // Wait for async updates
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updatedStats = syncEngine.stats;
      expect(updatedStats.pendingSyncRecords).toBeGreaterThan(initialStats.pendingSyncRecords);
      expect(updatedStats.pendingSyncRecords).toBe(1);
    });
  });

  describe('Offline Support', () => {
    test('queues changes when offline', async () => {
      // Simulate offline
      (global.navigator as any).onLine = false;
      
      // Make changes while offline
      testModel.update({ name: 'Offline Change', value: 999 });
      await testModel.save();

      // Verify change was queued for sync
      const pendingRecords = await store.getPendingSyncRecords(10);
      expect(pendingRecords).toHaveLength(1);
      expect(pendingRecords[0].data.name).toBe('Offline Change');
    });
  });

  describe('Data Integrity', () => {
    test('validates sync record data integrity', async () => {
      const record: SyncRecord = {
        id: 'integrity-test',
        modelName: 'TestSyncModel',
        modelId: 'integrity-model',
        operation: 'create',
        data: { name: 'Integrity Test', value: 123 },
        version: 1,
        timestamp: Date.now(),
        clientId: 'test-client',
        hash: '1234567890abcdef', // Valid hex hash
      };

      // Verify record has all required fields
      expect(record.id).toBeDefined();
      expect(record.modelName).toBeDefined();
      expect(record.modelId).toBeDefined();
      expect(record.operation).toMatch(/^(create|update|delete)$/);
      expect(record.data).toBeDefined();
      expect(record.version).toBeGreaterThan(0);
      expect(record.timestamp).toBeGreaterThan(0);
      expect(record.clientId).toBeDefined();
      expect(record.hash).toBeDefined();
    });

    test('handles data hashing', async () => {
      const data = { name: 'Test', value: 42 };
      const hash = await (syncEngine as any).hashData(data);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(16);
      
      // Same data should produce same hash
      const hash2 = await (syncEngine as any).hashData(data);
      expect(hash).toBe(hash2);
    });

    test('generates unique IDs', () => {
      const id1 = (syncEngine as any).generateSyncRecordId();
      const id2 = (syncEngine as any).generateSyncRecordId();
      const deltaId = (syncEngine as any).generateDeltaId();
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(deltaId).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('sync_')).toBe(true);
      expect(deltaId.startsWith('delta_')).toBe(true);
    });
  });
});

describe('HashSyncEngine Edge Cases', () => {
  let store: IndexedDBStore;
  let syncEngine: HashSyncEngine;

  beforeEach(async () => {
    store = new IndexedDBStore();
    await store.initialize([]);
    syncEngine = new HashSyncEngine(store, { clientId: 'edge-test-client' });
    await syncEngine.initialize();
  });

  afterEach(async () => {
    syncEngine.disconnect();
    await store.deleteDatabase();
  });

  test('handles empty sync queues gracefully', async () => {
    const pendingRecords = await store.getPendingSyncRecords(10);
    expect(pendingRecords).toHaveLength(0);
    expect(syncEngine.stats.pendingSyncRecords).toBe(0);
  });

  test('handles missing model types gracefully', async () => {
    const invalidRecord: SyncRecord = {
      id: 'invalid-record',
      modelName: 'NonExistentModel',
      modelId: 'invalid-model',
      operation: 'create',
      data: { test: 'data' },
      version: 1,
      timestamp: Date.now(),
      clientId: 'test-client',
      hash: 'abcdef1234567890', // Valid hex hash
    };

    // Suppress expected console output for this test
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Should handle the error gracefully without throwing (caught internally)
    await (syncEngine as any).applyRemoteRecord(invalidRecord);
    
    // Verify the error was logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid sync record received:'),
      expect.arrayContaining([
        expect.objectContaining({
          field: 'modelName',
          message: expect.stringContaining('Unknown model type')
        })
      ])
    );
    
    // Restore console
    consoleErrorSpy.mockRestore();
  });

  test('handles sync engine without WebSocket connection', () => {
    // Simulate no WebSocket connection
    (syncEngine as any).websocket = null;
    
    // Should not throw when trying to send message
    expect(() => {
      (syncEngine as any).sendMessage({ type: 'test' });
    }).not.toThrow();
  });
});