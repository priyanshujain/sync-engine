import { DeltaProcessor } from '../../src/sync/delta-processor';
import { ObjectPool } from '../../src/sync/object-pool';
import { SyncIdManager } from '../../src/sync/sync-id-manager';
import { DeltaPacket, DeltaAction, DeltaBatch } from '../../src/sync/delta-packet';
import { BaseModel } from '../../src/models/base-model';
import { ModelRegistry } from '../../src/model-registry';

class TestModel extends BaseModel {
  name: string = '';
  archived: boolean = false;
  
  constructor(id: string) {
    super(id, { autoSave: false });
  }

  protected getChanges(): Record<string, any> {
    return { name: this.name };
  }

  async save(): Promise<void> {
    this.markDirty();
  }
}

describe('DeltaProcessor', () => {
  let processor: DeltaProcessor;
  let objectPool: ObjectPool;
  let syncIdManager: SyncIdManager;

  beforeEach(() => {
    objectPool = new ObjectPool();
    syncIdManager = new SyncIdManager();
    processor = new DeltaProcessor(objectPool, syncIdManager);
    
    // Register TestModel
    ModelRegistry.registerModel('TestModel', TestModel as any);
  });

  afterEach(() => {
    // Clean up registry
    (ModelRegistry as any).modelLookup.clear();
  });

  describe('processDelta', () => {
    describe('CREATE action', () => {
      it('should create new model', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.CREATE,
          data: { name: 'Test Item' },
        };

        await processor.processDelta(packet);

        const model = objectPool.get<TestModel>('TestModel', 'test-1');
        expect(model).toBeDefined();
        expect(model?.name).toBe('Test Item');
        expect(syncIdManager.getLastReceivedSyncId()).toBe(1);
      });

      it('should update existing model on CREATE if already exists', async () => {
        const existing = new TestModel('test-1');
        existing.name = 'Old Name';
        objectPool.add(existing);

        const packet: DeltaPacket = {
          id: 2,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.CREATE,
          data: { name: 'New Name' },
        };

        await processor.processDelta(packet);

        const model = objectPool.get<TestModel>('TestModel', 'test-1');
        expect(model?.name).toBe('New Name');
      });

      it('should throw for unknown model type when not skipping', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'UnknownModel',
          modelId: 'test-1',
          action: DeltaAction.CREATE,
          data: { name: 'Test' },
        };

        await expect(processor.processDelta(packet)).rejects.toThrow('Unknown model type: UnknownModel');
      });

      it('should skip unknown model types when configured', async () => {
        const customProcessor = new DeltaProcessor(objectPool, syncIdManager, {
          skipUnknownModels: true,
        });

        const packet: DeltaPacket = {
          id: 1,
          modelName: 'UnknownModel',
          modelId: 'test-1',
          action: DeltaAction.CREATE,
          data: { name: 'Test' },
        };

        await expect(customProcessor.processDelta(packet)).resolves.not.toThrow();
      });
    });

    describe('UPDATE action', () => {
      it('should update existing model', async () => {
        const model = new TestModel('test-1');
        model.name = 'Original';
        objectPool.add(model);

        const packet: DeltaPacket = {
          id: 2,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.UPDATE,
          data: { name: 'Updated' },
        };

        await processor.processDelta(packet);

        const updated = objectPool.get<TestModel>('TestModel', 'test-1');
        expect(updated?.name).toBe('Updated');
      });

      it('should create model if not exists and data provided', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.UPDATE,
          data: { name: 'New Model' },
        };

        await processor.processDelta(packet);

        const model = objectPool.get<TestModel>('TestModel', 'test-1');
        expect(model).toBeDefined();
        expect(model?.name).toBe('New Model');
      });

      it('should throw if model not found and no data', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.UPDATE,
        };

        await expect(processor.processDelta(packet)).rejects.toThrow('Model not found: TestModel:test-1');
      });
    });

    describe('DELETE action', () => {
      it('should delete existing model', async () => {
        const model = new TestModel('test-1');
        objectPool.add(model);

        const packet: DeltaPacket = {
          id: 2,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.DELETE,
        };

        await processor.processDelta(packet);

        expect(objectPool.has('TestModel', 'test-1')).toBe(false);
      });

      it('should throw when deleting non-existent model', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.DELETE,
        };

        await expect(processor.processDelta(packet)).rejects.toThrow('Failed to delete model: TestModel:test-1');
      });

      it('should skip deletion error when configured', async () => {
        const customProcessor = new DeltaProcessor(objectPool, syncIdManager, {
          skipUnknownModels: true,
        });

        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.DELETE,
        };

        await expect(customProcessor.processDelta(packet)).resolves.not.toThrow();
      });
    });

    describe('ARCHIVE action', () => {
      it('should archive model with archived property', async () => {
        const model = new TestModel('test-1');
        model.archived = false;
        objectPool.add(model);

        const packet: DeltaPacket = {
          id: 2,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.ARCHIVE,
        };

        await processor.processDelta(packet);

        const archived = objectPool.get<TestModel>('TestModel', 'test-1');
        expect(archived?.archived).toBe(true);
      });

      it('should throw when archiving non-existent model', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.ARCHIVE,
        };

        await expect(processor.processDelta(packet)).rejects.toThrow('Model not found for archive: TestModel:test-1');
      });
    });

    describe('SYNC action', () => {
      it('should update current sync ID', async () => {
        const packet: DeltaPacket = {
          id: 100,
          modelName: 'System',
          modelId: 'sync',
          action: DeltaAction.SYNC,
        };

        await processor.processDelta(packet);

        expect(syncIdManager.getCurrentSyncId()).toBe(100);
      });
    });

    describe('GAP action', () => {
      it('should detect gaps', async () => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        
        syncIdManager.receiveSyncId(1);
        syncIdManager.receiveSyncId(5);

        const packet: DeltaPacket = {
          id: 6,
          modelName: 'System',
          modelId: 'gap',
          action: DeltaAction.GAP,
        };

        await processor.processDelta(packet);

        expect(consoleWarnSpy).toHaveBeenCalledWith('Sync gaps detected:', expect.any(Array));
        consoleWarnSpy.mockRestore();
      });
    });

    describe('VALIDATION action', () => {
      it('should validate existing model', async () => {
        const model = new TestModel('test-1');
        objectPool.add(model);

        const packet: DeltaPacket = {
          id: 2,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.VALIDATION,
        };

        await expect(processor.processDelta(packet)).resolves.not.toThrow();
      });

      it('should throw for non-existent model', async () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'TestModel',
          modelId: 'test-1',
          action: DeltaAction.VALIDATION,
        };

        await expect(processor.processDelta(packet)).rejects.toThrow('Model not found for validation: TestModel:test-1');
      });
    });
  });

  describe('processBatch', () => {
    it('should process multiple packets', async () => {
      const batch: DeltaBatch = {
        packets: [
          {
            id: 1,
            modelName: 'TestModel',
            modelId: 'test-1',
            action: DeltaAction.CREATE,
            data: { name: 'Item 1' },
          },
          {
            id: 2,
            modelName: 'TestModel',
            modelId: 'test-2',
            action: DeltaAction.CREATE,
            data: { name: 'Item 2' },
          },
          {
            id: 3,
            modelName: 'TestModel',
            modelId: 'test-1',
            action: DeltaAction.UPDATE,
            data: { name: 'Updated Item 1' },
          },
        ],
        startSyncId: 1,
        endSyncId: 3,
        timestamp: Date.now(),
      };

      const result = await processor.processBatch(batch);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);

      expect(objectPool.get<TestModel>('TestModel', 'test-1')?.name).toBe('Updated Item 1');
      expect(objectPool.get<TestModel>('TestModel', 'test-2')?.name).toBe('Item 2');
    });

    it('should handle errors in batch processing', async () => {
      const batch: DeltaBatch = {
        packets: [
          {
            id: 1,
            modelName: 'TestModel',
            modelId: 'test-1',
            action: DeltaAction.CREATE,
            data: { name: 'Item 1' },
          },
          {
            id: 2,
            modelName: 'UnknownModel',
            modelId: 'test-2',
            action: DeltaAction.CREATE,
            data: { name: 'Item 2' },
          },
          {
            id: 3,
            modelName: 'TestModel',
            modelId: 'test-3',
            action: DeltaAction.CREATE,
            data: { name: 'Item 3' },
          },
        ],
        startSyncId: 1,
        endSyncId: 3,
        timestamp: Date.now(),
      };

      const customProcessor = new DeltaProcessor(objectPool, syncIdManager, {
        applyInBatches: false,
      });

      const result = await customProcessor.processBatch(batch);

      expect(result.success).toBe(false);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error.message).toContain('Unknown model type');
    });

    it('should use queue when applyInBatches is true', async () => {
      const customProcessor = new DeltaProcessor(objectPool, syncIdManager, {
        applyInBatches: true,
        batchSize: 2,
      });

      const batch: DeltaBatch = {
        packets: [
          {
            id: 1,
            modelName: 'TestModel',
            modelId: 'test-1',
            action: DeltaAction.CREATE,
            data: { name: 'Item 1' },
          },
          {
            id: 2,
            modelName: 'TestModel',
            modelId: 'test-2',
            action: DeltaAction.CREATE,
            data: { name: 'Item 2' },
          },
        ],
        startSyncId: 1,
        endSyncId: 2,
        timestamp: Date.now(),
      };

      await customProcessor.processBatch(batch);

      expect(objectPool.get<TestModel>('TestModel', 'test-1')?.name).toBe('Item 1');
      expect(objectPool.get<TestModel>('TestModel', 'test-2')?.name).toBe('Item 2');
    });
  });

  describe('queue management', () => {
    it('should report queue size', () => {
      expect(processor.getQueueSize()).toBe(0);
      expect(processor.isQueueEmpty()).toBe(true);
    });

    it('should clear queue', () => {
      processor.clearQueue();
      expect(processor.getQueueSize()).toBe(0);
    });
  });

  describe('validation', () => {
    it('should skip validation when disabled', async () => {
      const customProcessor = new DeltaProcessor(objectPool, syncIdManager, {
        validatePackets: false,
      });

      const invalidPacket = {
        id: -1,
        modelName: '',
        modelId: '',
        action: 'INVALID' as DeltaAction,
      };

      // This would normally throw, but validation is disabled
      await expect(customProcessor.processDelta(invalidPacket)).rejects.toThrow('Unknown delta action');
    });
  });
});