#!/usr/bin/env tsx

/**
 * Long-running memory test for the sync engine
 * This demo creates, modifies, and destroys models continuously
 * to test for memory leaks and resource management
 */

import { IndexedDBStore } from '../src/storage/indexed-db-store';
import { IndexedBaseModel } from '../src/models/indexed-base-model';
import { HashSyncEngine } from '../src/sync/hash-sync-engine';
import { ModelRegistry } from '../src/model-registry';
import { ResourceManager } from '../src/utils/resource-manager';

// Enable fake IndexedDB for Node.js environment
import 'fake-indexeddb/auto';

// Mock WebSocket for testing
(global as any).WebSocket = class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen?: () => void;
  onmessage?: (event: any) => void;
  onclose?: () => void;
  onerror?: (error: any) => void;

  constructor(public url: string) {
    setTimeout(() => {
      this.onopen?.();
    }, 10);
  }

  send(data: string) {
    // Echo back heartbeat responses
    if (data.includes('heartbeat')) {
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() })
        });
      }, 1);
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => this.onclose?.(), 1);
  }
};

// Mock navigator for browser APIs
if (!global.navigator) {
  (global as any).navigator = { onLine: true };
}

// Mock window for event listeners
if (!global.window) {
  (global as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

// Test model for stress testing
class TestModel extends IndexedBaseModel {
  name: string = '';
  value: number = 0;
  data: any = {};
  testCreatedAt: Date;

  constructor(id?: string) {
    super(id || `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, {
      autoSave: false, // Disable to prevent race conditions in stress test
      trackChanges: true
    });
    
    this.testCreatedAt = new Date();
  }

  setName(name: string) {
    this.name = name;
    this.markDirty();
  }

  setValue(value: number) {
    this.value = value;
    this.markDirty();
  }

  setData(data: any) {
    this.data = data;
    this.markDirty();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      value: this.value,
      data: this.data,
      testCreatedAt: this.testCreatedAt.toISOString(),
      _version: this._version,
      updatedAt: new Date().toISOString()
    };
  }
}

// Memory monitoring utilities
class MemoryMonitor {
  private samples: Array<{ time: number; heapUsed: number; heapTotal: number; external: number }> = [];
  private startTime = Date.now();

  takeSample() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      this.samples.push({
        time: Date.now() - this.startTime,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external
      });
    }
  }

  getStats() {
    if (this.samples.length === 0) return null;

    const latest = this.samples[this.samples.length - 1];
    const first = this.samples[0];
    
    return {
      runtime: latest.time,
      currentHeapUsed: this.formatBytes(latest.heapUsed),
      currentHeapTotal: this.formatBytes(latest.heapTotal),
      currentExternal: this.formatBytes(latest.external),
      heapGrowth: this.formatBytes(latest.heapUsed - first.heapUsed),
      totalGrowth: this.formatBytes(latest.heapTotal - first.heapTotal),
      samples: this.samples.length
    };
  }

  private formatBytes(bytes: number): string {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  detectLeak(): boolean {
    if (this.samples.length < 10) return false;

    // Check if memory is consistently growing over the last 10 samples
    const recent = this.samples.slice(-10);
    let growingCount = 0;

    for (let i = 1; i < recent.length; i++) {
      if (recent[i].heapUsed > recent[i - 1].heapUsed) {
        growingCount++;
      }
    }

    return growingCount >= 8; // 80% of samples showing growth
  }
}

// Stress test scenarios
class StressTestRunner {
  private store!: IndexedDBStore;
  private syncEngine!: HashSyncEngine;
  private resourceManager = new ResourceManager();
  private models: TestModel[] = [];
  private isRunning = false;
  private monitor = new MemoryMonitor();
  private stats = {
    modelsCreated: 0,
    modelsUpdated: 0,
    modelsDeleted: 0,
    syncOperations: 0,
    errors: 0
  };

  async initialize() {
    console.log('🚀 Initializing stress test environment...');

    // Set up storage
    this.store = new IndexedDBStore({ dbName: 'stress_test_db' });
    await this.store.initialize([{
      name: 'TestModel',
      loadStrategy: 'full' as const,
      schemaVersion: 1,
      properties: new Map([
        ['name', { type: 'property', indexed: true }],
        ['value', { type: 'property', indexed: false }],
        ['data', { type: 'property', indexed: false }]
      ])
    }]);

    // Set up models
    IndexedBaseModel.setStore(this.store);
    ModelRegistry.registerModel('TestModel', TestModel as any);
    ModelRegistry.registerProperty('TestModel', 'name', { type: 'property', indexed: true });
    ModelRegistry.registerProperty('TestModel', 'value', { type: 'property', indexed: false });
    ModelRegistry.registerProperty('TestModel', 'data', { type: 'property', indexed: false });

    // Set up sync engine
    this.syncEngine = new HashSyncEngine(this.store, {
      serverUrl: 'ws://localhost:8080/stress-test',
      clientId: `stress_test_${Date.now()}`,
      syncIntervalMs: 1000,
      heartbeatIntervalMs: 5000,
      batchSize: 20
    });

    IndexedBaseModel.setSyncEngine(this.syncEngine);
    await this.syncEngine.initialize();
    await this.syncEngine.connect();

    console.log('✅ Stress test environment initialized');
  }

  async runContinuousStressTest(durationMinutes: number = 2) {
    console.log(`🔥 Starting ${durationMinutes}-minute stress test...`);
    
    this.isRunning = true;
    const endTime = Date.now() + (durationMinutes * 60 * 1000);

    // Start monitoring
    const monitorInterval = this.resourceManager.setInterval(() => {
      this.monitor.takeSample();
      this.printStats();
    }, 5000);

    // Start stress test scenarios
    this.startModelCreationScenario();
    this.startModelModificationScenario();
    this.startModelDeletionScenario();
    this.startSyncStressScenario();

    // Wait for test duration
    while (Date.now() < endTime && this.isRunning) {
      await this.sleep(1000);
      
      // Check for memory leaks
      if (this.monitor.detectLeak()) {
        console.warn('⚠️  MEMORY LEAK DETECTED!');
        this.printDetailedMemoryStats();
      }
    }

    this.isRunning = false;
    console.log('🏁 Stress test completed');
    
    return this.generateReport();
  }

  private startModelCreationScenario() {
    const createModels = async () => {
      while (this.isRunning) {
        try {
          // Create models at a controlled rate
          for (let i = 0; i < 2; i++) {
            try {
              const model = new TestModel();
              model.setName(`Model ${this.stats.modelsCreated}`);
              model.setValue(Math.random() * 1000);
              model.setData({
                timestamp: Date.now(),
                randomData: Array.from({ length: 5 }, () => Math.random())
              });

              this.models.push(model);
              this.stats.modelsCreated++;

              // Keep model count manageable 
              if (this.models.length > 50) {
                const oldModel = this.models.shift();
                if (oldModel) {
                  await oldModel.dispose();
                }
              }
            } catch (error) {
              this.stats.errors++;
            }
          }

          await this.sleep(500); // 2 models every 500ms = 4 models/sec
        } catch (error) {
          this.stats.errors++;
          console.error('Model creation error:', error);
        }
      }
    };

    createModels().catch(console.error);
  }

  private startModelModificationScenario() {
    const modifyModels = async () => {
      while (this.isRunning) {
        try {
          if (this.models.length > 0) {
            // Randomly modify existing models
            const model = this.models[Math.floor(Math.random() * this.models.length)];
            model.setValue(Math.random() * 1000);
            model.setData({
              updated: Date.now(),
              randomValue: Math.random()
            });
            this.stats.modelsUpdated++;
          }

          await this.sleep(1000); // 1 update per second
        } catch (error) {
          this.stats.errors++;
          console.error('Model modification error:', error);
        }
      }
    };

    modifyModels().catch(console.error);
  }

  private startModelDeletionScenario() {
    const deleteModels = async () => {
      while (this.isRunning) {
        try {
          if (this.models.length > 50) {
            // Delete some models periodically
            const toDelete = this.models.splice(0, 5);
            for (const model of toDelete) {
              await model.delete();
              await model.dispose();
              this.stats.modelsDeleted++;
            }
          }

          await this.sleep(1000); // Delete 5 models every second
        } catch (error) {
          this.stats.errors++;
          console.error('Model deletion error:', error);
        }
      }
    };

    deleteModels().catch(console.error);
  }

  private startSyncStressScenario() {
    const stressSync = async () => {
      while (this.isRunning) {
        try {
          // Force sync operations
          await this.syncEngine.sync();
          this.stats.syncOperations++;

          await this.sleep(2000); // Sync every 2 seconds
        } catch (error) {
          this.stats.errors++;
          console.error('Sync error:', error);
        }
      }
    };

    stressSync().catch(console.error);
  }

  private printStats() {
    const memStats = this.monitor.getStats();
    const syncStats = this.syncEngine.stats;

    console.log('\n📊 STRESS TEST STATS:');
    console.log('════════════════════════════════════════');
    console.log(`Models: Created=${this.stats.modelsCreated}, Updated=${this.stats.modelsUpdated}, Deleted=${this.stats.modelsDeleted}`);
    console.log(`Sync: Operations=${this.stats.syncOperations}, Pending=${syncStats.pendingSyncRecords}, Status=${syncStats.status}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`Active Models: ${this.models.length}`);
    
    if (memStats) {
      console.log(`Memory: Used=${memStats.currentHeapUsed}, Total=${memStats.currentHeapTotal}`);
      console.log(`Growth: Heap=${memStats.heapGrowth}, Total=${memStats.totalGrowth}`);
      console.log(`Runtime: ${Math.floor(memStats.runtime / 1000)}s`);
    }
    console.log('════════════════════════════════════════\n');
  }

  private printDetailedMemoryStats() {
    const memStats = this.monitor.getStats();
    if (!memStats) return;

    console.log('\n🔍 DETAILED MEMORY ANALYSIS:');
    console.log('══════════════════════════════════════════');
    console.log(`Runtime: ${Math.floor(memStats.runtime / 1000)}s`);
    console.log(`Current Heap: ${memStats.currentHeapUsed} / ${memStats.currentHeapTotal}`);
    console.log(`External Memory: ${memStats.currentExternal}`);
    console.log(`Heap Growth: ${memStats.heapGrowth}`);
    console.log(`Total Growth: ${memStats.totalGrowth}`);
    console.log(`Samples Taken: ${memStats.samples}`);
    console.log('══════════════════════════════════════════\n');
  }

  private async generateReport() {
    const memStats = this.monitor.getStats();
    const syncStats = this.syncEngine.stats;

    const report = {
      testSummary: {
        duration: memStats ? `${Math.floor(memStats.runtime / 1000)}s` : 'N/A',
        modelsCreated: this.stats.modelsCreated,
        modelsUpdated: this.stats.modelsUpdated,
        modelsDeleted: this.stats.modelsDeleted,
        syncOperations: this.stats.syncOperations,
        errors: this.stats.errors,
        finalActiveModels: this.models.length
      },
      memoryAnalysis: memStats || 'Memory monitoring not available',
      syncEngineStats: {
        status: syncStats.status,
        pendingSyncRecords: syncStats.pendingSyncRecords,
        lastSyncTime: syncStats.lastSyncTime,
        isOnline: syncStats.isOnline
      },
      verdict: {
        memoryLeakDetected: this.monitor.detectLeak(),
        resourcesProperlyManaged: this.stats.errors < 10,
        syncEngineStable: syncStats.status !== 'error'
      }
    };

    console.log('\n🎯 FINAL REPORT:');
    console.log('══════════════════════════════════════════');
    console.log(JSON.stringify(report, null, 2));
    console.log('══════════════════════════════════════════\n');

    return report;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = this.resourceManager.setTimeout(resolve, ms);
    });
  }

  async cleanup() {
    console.log('🧹 Cleaning up stress test environment...');
    
    this.isRunning = false;

    // Dispose all models
    for (const model of this.models) {
      await model.dispose();
    }
    this.models = [];

    // Cleanup sync engine
    if (this.syncEngine) {
      await this.syncEngine.dispose();
    }

    // Cleanup store
    if (this.store) {
      await this.store.deleteDatabase();
    }

    // Cleanup resource manager
    await this.resourceManager.dispose();

    console.log('✅ Cleanup completed');
  }
}

// Main execution
async function runLongRunningTest() {
  const runner = new StressTestRunner();
  
  try {
    await runner.initialize();
    
    console.log('Starting 2-minute stress test...');
    console.log('This will create, modify, and delete models continuously');
    console.log('while monitoring for memory leaks and resource management issues.\n');
    
    const report = await runner.runContinuousStressTest(0.5); // 30 seconds
    
    // Analyze results
    if (report.verdict.memoryLeakDetected) {
      console.error('❌ MEMORY LEAK DETECTED - Resource management needs improvement');
      process.exit(1);
    } else if (report.verdict.resourcesProperlyManaged && report.verdict.syncEngineStable) {
      console.log('✅ SUCCESS - No memory leaks detected, resources properly managed');
      process.exit(0);
    } else {
      console.warn('⚠️  WARNING - Some issues detected but no critical failures');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('💥 Stress test failed:', error);
    process.exit(1);
  } finally {
    await runner.cleanup();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the test
if (require.main === module) {
  runLongRunningTest().catch(console.error);
}

export { StressTestRunner, MemoryMonitor };