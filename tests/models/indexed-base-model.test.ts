import 'fake-indexeddb/auto';
import { IndexedBaseModel } from '../../src/models/indexed-base-model';
import { IndexedDBStore } from '../../src/storage/indexed-db-store';
import { ModelRegistry, ModelMetadata } from '../../src/model-registry';

import { observable, action } from 'mobx';

// Test model
class TestModel extends IndexedBaseModel {
  @observable name: string = '';
  @observable value: number = 0;
  @observable category: string = '';
  
  constructor(id: string) {
    super(id);
    this.name = '';
    this.value = 0;
    this.category = '';
    
    // Set up reactions for auto-dirty marking
    this.setupAutoMarkDirty();
  }
  
  @action
  setName(name: string) {
    this.name = name;
    this.markDirty();
  }
  
  @action
  setValue(value: number) {
    this.value = value;
    this.markDirty();
  }
  
  @action
  setCategory(category: string) {
    this.category = category;
    this.markDirty();
  }
  
  // For testing direct property assignment
  private setupAutoMarkDirty() {
    // This is a simple approach - in production you might use MobX reactions
    const originalMarkDirty = this.markDirty.bind(this);
    let isInitializing = true;
    
    // Allow initial setup without marking dirty
    setTimeout(() => { isInitializing = false; }, 0);
    
    // Override setter behavior for testing
    Object.defineProperty(this, 'name', {
      get: () => this._name,
      set: (value) => {
        this._name = value;
        if (!isInitializing) originalMarkDirty();
      }
    });
    
    Object.defineProperty(this, 'value', {
      get: () => this._value,
      set: (value) => {
        this._value = value;
        if (!isInitializing) originalMarkDirty();
      }
    });
    
    Object.defineProperty(this, 'category', {
      get: () => this._category,
      set: (value) => {
        this._category = value;
        if (!isInitializing) originalMarkDirty();
      }
    });
  }
  
  private _name: string = '';
  private _value: number = 0;
  private _category: string = '';
  
  // Expose protected methods for testing
  public testCaptureState() {
    this.captureState();
  }
  
  public testGetChanges() {
    return this.getChanges();
  }
}

describe('IndexedBaseModel', () => {
  let store: IndexedDBStore;
  
  const testModelMetadata: ModelMetadata = {
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
    // Clear databases
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
    
    // Set up store and model
    store = new IndexedDBStore();
    await store.initialize([testModelMetadata]);
    IndexedBaseModel.setStore(store);
    
    // Register model metadata
    ModelRegistry.registerModel('TestModel', TestModel as any);
    ModelRegistry.registerProperty('TestModel', 'name', { type: 'property', indexed: true });
    ModelRegistry.registerProperty('TestModel', 'value', { type: 'property', indexed: false });
    ModelRegistry.registerProperty('TestModel', 'category', { type: 'property', indexed: true });
  });

  afterEach(() => {
    store.close();
  });

  describe('basic functionality', () => {
    test('creates model with id', () => {
      const model = new TestModel('test-123');
      
      expect(model.id).toBe('test-123');
      expect(model._version).toBe(0);
      expect(model._isDirty).toBe(false);
      expect(model._isDeleted).toBe(false);
    });

    test('marks dirty when property changes', () => {
      const model = new TestModel('test-123');
      
      model.setName('Changed');
      
      expect(model._isDirty).toBe(true);
      expect(model._version).toBe(1);
    });

    test('captures and tracks state changes', () => {
      const model = new TestModel('test-123');
      model.setName('Initial');
      model.setValue(100);
      
      model.testCaptureState();
      model.markClean();
      
      model.setName('Updated');
      
      const changes = model.testGetChanges();
      
      // Test that we get changes back - the exact shape depends on the toJSON implementation
      expect(changes).toBeDefined();
      expect(typeof changes).toBe('object');
      expect(Object.keys(changes).length).toBeGreaterThan(0);
    });
  });

  describe('JSON serialization', () => {
    test('converts to JSON with properties', () => {
      const model = new TestModel('test-123');
      model.setName('Test Name');
      model.setValue(42);
      model.setCategory('test');
      
      const json = model.toJSON();
      
      expect(json.id).toBe('test-123');
      expect(json.name).toBe('Test Name');
      expect(json.value).toBe(42);
      expect(json.category).toBe('test');
      expect(json._version).toBe(3); // Each setter increments version
      expect(json.updatedAt).toBeDefined();
    });

    test('creates from JSON', () => {
      const data = {
        id: 'test-456',
        name: 'From JSON',
        value: 99,
        category: 'imported',
        _version: 5
      };
      
      const model = TestModel.fromJSON(data);
      
      expect(model.id).toBe('test-456');
      expect(model.name).toBe('From JSON');
      expect(model.value).toBe(99);
      expect(model.category).toBe('imported');
      expect(model._version).toBe(5);
      expect(model._isDirty).toBe(false);
    });
  });

  describe('IndexedDB persistence', () => {
    test('saves model to IndexedDB', async () => {
      const model = new TestModel('save-test');
      model.setName('Saved Model');
      model.setValue(123);
      
      await model.save();
      
      // Verify stored in IndexedDB
      const stored = await store.get('TestModel', 'save-test');
      expect(stored).toBeDefined();
      expect(stored.name).toBe('Saved Model');
      expect(stored.value).toBe(123);
      
      // Verify queued for sync
      const syncQueue = await store.getPendingSyncItems();
      expect(syncQueue).toHaveLength(1);
      expect(syncQueue[0].operation).toBe('create');
    });

    test('updates existing model in IndexedDB', async () => {
      const model = new TestModel('update-test');
      model.setName('Initial');
      await model.save();
      model.markClean();
      
      model.setName('Updated');
      await model.save();
      
      // Verify updated in IndexedDB
      const stored = await store.get('TestModel', 'update-test');
      expect(stored.name).toBe('Updated');
      
      // Verify update operation queued for sync
      const syncQueue = await store.getPendingSyncItems();
      expect(syncQueue).toHaveLength(1); // Only update operation
      expect(syncQueue[0].operation).toBe('update');
    });

    test('deletes model from IndexedDB', async () => {
      const model = new TestModel('delete-test');
      model.setName('To Delete');
      await model.save();
      
      await model.delete();
      
      // Verify removed from IndexedDB
      const stored = await store.get('TestModel', 'delete-test');
      expect(stored).toBeUndefined();
      
      // Verify delete operation queued for sync
      const syncQueue = await store.getPendingSyncItems();
      expect(syncQueue).toHaveLength(1); // Only delete operation
      expect(syncQueue[0].operation).toBe('delete');
      
      expect(model._isDeleted).toBe(true);
    });

    test('does not save when not dirty', async () => {
      const model = new TestModel('clean-test');
      model.setName('Clean');
      await model.save();
      model.markClean();
      
      // Try to save again without changes
      await model.save();
      
      // Should still only have one sync queue item
      const syncQueue = await store.getPendingSyncItems();
      expect(syncQueue).toHaveLength(1);
    });
  });

  describe('static methods', () => {
    test('loads model from IndexedDB', async () => {
      // Store directly in IndexedDB
      const data = {
        id: 'load-test',
        name: 'Loaded Model',
        value: 789,
        category: 'loaded'
      };
      await store.put('TestModel', data);
      
      const loaded = await TestModel.load('load-test');
      
      expect(loaded).toBeDefined();
      expect(loaded!.name).toBe('Loaded Model');
      expect(loaded!.value).toBe(789);
      expect(loaded!._isDirty).toBe(false);
    });

    test('returns null for non-existent model', async () => {
      const loaded = await TestModel.load('non-existent');
      expect(loaded).toBeNull();
    });

    test('loads all models', async () => {
      // Store multiple models
      await store.put('TestModel', { id: '1', name: 'First', value: 1 });
      await store.put('TestModel', { id: '2', name: 'Second', value: 2 });
      await store.put('TestModel', { id: '3', name: 'Third', value: 3 });
      
      const all = await TestModel.loadAll();
      
      expect(all).toHaveLength(3);
      expect(all.map(m => m.name).sort()).toEqual(['First', 'Second', 'Third']);
    });

    test('finds models by criteria', async () => {
      await store.put('TestModel', { id: '1', name: 'Apple', category: 'fruit', value: 1 });
      await store.put('TestModel', { id: '2', name: 'Banana', category: 'fruit', value: 2 });
      await store.put('TestModel', { id: '3', name: 'Carrot', category: 'vegetable', value: 3 });
      
      const fruits = await TestModel.findBy({ category: 'fruit' });
      
      expect(fruits).toHaveLength(2);
      expect(fruits.map(f => f.name).sort()).toEqual(['Apple', 'Banana']);
    });

    test('finds one model by criteria', async () => {
      await store.put('TestModel', { id: '1', name: 'Apple', category: 'fruit', value: 1 });
      await store.put('TestModel', { id: '2', name: 'Banana', category: 'fruit', value: 2 });
      
      const fruit = await TestModel.findOneBy({ category: 'fruit' });
      
      expect(fruit).toBeDefined();
      expect(['Apple', 'Banana']).toContain(fruit!.name);
    });

    test('counts models', async () => {
      await store.put('TestModel', { id: '1', name: 'One' });
      await store.put('TestModel', { id: '2', name: 'Two' });
      await store.put('TestModel', { id: '3', name: 'Three' });
      
      const count = await TestModel.count();
      
      expect(count).toBe(3);
    });

    test('clears all models', async () => {
      await store.put('TestModel', { id: '1', name: 'One' });
      await store.put('TestModel', { id: '2', name: 'Two' });
      
      await TestModel.clear();
      
      const count = await TestModel.count();
      expect(count).toBe(0);
    });
  });

  describe('hash calculation', () => {
    test('calculates consistent hash for same data', async () => {
      const model1 = new TestModel('hash-test');
      model1.setName('Test');
      model1.setValue(100);
      model1.markClean(); // Reset version to prevent differences
      
      const model2 = new TestModel('hash-test');
      model2.setName('Test');
      model2.setValue(100);
      model2.markClean(); // Reset version to prevent differences
      
      // Wait a bit to ensure updatedAt doesn't differ
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const hash1 = await model1.calculateHash();
      const hash2 = await model2.calculateHash();
      
      expect(hash1).toBe(hash2);
    });

    test('calculates different hash for different data', async () => {
      const model1 = new TestModel('hash-test-1');
      model1.setName('Test');
      model1.setValue(100);
      
      const model2 = new TestModel('hash-test-2');
      model2.setName('Different');
      model2.setValue(200);
      
      const hash1 = await model1.calculateHash();
      const hash2 = await model2.calculateHash();
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('rollback functionality', () => {
    test('rolls back to previous state', () => {
      const model = new TestModel('rollback-test');
      model.setName('Initial');
      model.setValue(100);
      model.testCaptureState();
      model.markClean();
      
      model.setName('Changed');
      model.setValue(200);
      
      model.rollback();
      
      expect(model.name).toBe('Initial');
      expect(model.value).toBe(100);
      expect(model._isDirty).toBe(false);
    });
  });

  describe('error handling', () => {
    test('throws error when store not initialized', async () => {
      IndexedBaseModel.setStore(undefined as any);
      
      const model = new TestModel('error-test');
      
      await expect(model.save()).rejects.toThrow();
      await expect(TestModel.load('test')).rejects.toThrow('Store not initialized');
      await expect(TestModel.loadAll()).rejects.toThrow('Store not initialized');
    });
  });
});