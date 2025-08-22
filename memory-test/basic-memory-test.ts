#!/usr/bin/env tsx

/**
 * Basic memory test to verify resource cleanup works correctly
 * This is a shorter, more focused test for quick validation
 */

import { ResourceManager } from '../src/utils/resource-manager';
import { IndexedDBStore } from '../src/storage/indexed-db-store';
import { IndexedBaseModel } from '../src/models/indexed-base-model';
import { HashSyncEngine } from '../src/sync/hash-sync-engine';
import { ModelRegistry } from '../src/model-registry';

// Enable fake IndexedDB
import 'fake-indexeddb/auto';

// Mock WebSocket
(global as any).WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor() {}
  send() {}
  close() {}
};

// Mock browser APIs
if (!global.navigator) (global as any).navigator = { onLine: true };
if (!global.window) (global as any).window = { addEventListener: () => {}, removeEventListener: () => {} };

class TestModel extends IndexedBaseModel {
  name = '';
  
  setName(name: string) {
    this.name = name;
    this.markDirty();
  }

  toJSON() {
    return { id: this.id, name: this.name, _version: this._version, updatedAt: new Date().toISOString() };
  }
}

async function runBasicMemoryTest() {
  console.log('🧪 Running Basic Memory Test...\n');

  let initialMemory: any = null;
  let peakMemory: any = null;
  let finalMemory: any = null;

  // Record initial memory
  if (typeof process !== 'undefined' && process.memoryUsage) {
    initialMemory = process.memoryUsage();
    console.log(`📊 Initial Memory: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  }

  // Test 1: ResourceManager
  console.log('\n🔧 Test 1: ResourceManager Resource Cleanup');
  await testResourceManager();

  // Test 2: Model Creation and Disposal
  console.log('\n🏗️  Test 2: Model Creation and Disposal');
  await testModelLifecycle();

  // Test 3: Sync Engine Lifecycle
  console.log('\n🔄 Test 3: Sync Engine Lifecycle');
  await testSyncEngineLifecycle();

  // Force garbage collection if available
  if (global.gc) {
    console.log('\n🗑️  Forcing garbage collection...');
    global.gc();
  }

  // Record final memory
  if (typeof process !== 'undefined' && process.memoryUsage) {
    finalMemory = process.memoryUsage();
    console.log(`📊 Final Memory: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    
    const growth = finalMemory.heapUsed - initialMemory.heapUsed;
    const growthMB = growth / 1024 / 1024;
    
    console.log(`📈 Memory Growth: ${growthMB > 0 ? '+' : ''}${growthMB.toFixed(2)} MB`);
    
    if (growthMB > 5) {
      console.error('❌ FAIL: Memory growth exceeds 5MB threshold');
      return false;
    } else {
      console.log('✅ PASS: Memory growth within acceptable limits');
      return true;
    }
  }

  return true;
}

async function testResourceManager() {
  const managers: ResourceManager[] = [];
  
  // Create many resource managers with timers
  for (let i = 0; i < 100; i++) {
    const manager = new ResourceManager();
    
    // Add various resources
    manager.setTimeout(() => {}, 10000); // Long timeout
    manager.setInterval(() => {}, 1000); // Interval
    manager.createAbortController(); // AbortController
    
    managers.push(manager);
  }
  
  console.log(`   Created ${managers.length} ResourceManagers with timers and controllers`);
  
  // Dispose all managers
  for (const manager of managers) {
    await manager.dispose();
  }
  
  console.log('   ✅ All ResourceManagers disposed');
}

async function testModelLifecycle() {
  // Set up storage
  const store = new IndexedDBStore({ dbName: 'basic_memory_test' });
  await store.initialize([{
    name: 'TestModel',
    loadStrategy: 'full' as const,
    schemaVersion: 1,
    properties: new Map([['name', { type: 'property', indexed: false }]])
  }]);

  IndexedBaseModel.setStore(store);
  ModelRegistry.registerModel('TestModel', TestModel as any);
  ModelRegistry.registerProperty('TestModel', 'name', { type: 'property', indexed: false });

  const models: TestModel[] = [];
  
  // Create many models
  for (let i = 0; i < 200; i++) {
    const model = new TestModel(`model_${i}`);
    model.setName(`Test Model ${i}`);
    models.push(model);
  }
  
  console.log(`   Created ${models.length} models`);
  
  // Dispose all models
  for (const model of models) {
    await model.dispose();
  }
  
  console.log('   ✅ All models disposed');
  
  // Cleanup store
  await store.deleteDatabase();
}

async function testSyncEngineLifecycle() {
  const engines: HashSyncEngine[] = [];
  
  for (let i = 0; i < 10; i++) {
    const store = new IndexedDBStore({ dbName: `sync_test_${i}` });
    await store.initialize([]);
    
    const engine = new HashSyncEngine(store, {
      serverUrl: `ws://localhost:808${i}`,
      clientId: `test_${i}`,
      syncIntervalMs: 1000,
      heartbeatIntervalMs: 5000
    });
    
    await engine.initialize();
    engines.push(engine);
  }
  
  console.log(`   Created ${engines.length} sync engines`);
  
  // Dispose all engines
  for (const engine of engines) {
    await engine.dispose();
  }
  
  console.log('   ✅ All sync engines disposed');
}

// Run the test
if (require.main === module) {
  runBasicMemoryTest()
    .then(success => {
      if (success) {
        console.log('\n🎉 Basic Memory Test PASSED - No memory leaks detected!');
        process.exit(0);
      } else {
        console.log('\n💥 Basic Memory Test FAILED - Memory leaks detected!');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Basic Memory Test ERROR:', error);
      process.exit(1);
    });
}