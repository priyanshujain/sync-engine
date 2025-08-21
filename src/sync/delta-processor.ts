import { DeltaPacket, DeltaAction, DeltaBatch } from './delta-packet';
import { ObjectPool } from './object-pool';
import { SyncIdManager } from './sync-id-manager';
import { Model } from '../model';
import { ModelRegistry } from '../model-registry';

export interface ProcessResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{ packet: DeltaPacket; error: Error }>;
}

export interface DeltaProcessorOptions {
  validatePackets: boolean;
  skipUnknownModels: boolean;
  applyInBatches: boolean;
  batchSize: number;
}

export class DeltaProcessor {
  private objectPool: ObjectPool;
  private syncIdManager: SyncIdManager;
  private options: DeltaProcessorOptions;
  private processingQueue: DeltaPacket[] = [];
  private isProcessing = false;

  constructor(
    objectPool: ObjectPool,
    syncIdManager: SyncIdManager,
    options: Partial<DeltaProcessorOptions> = {}
  ) {
    this.objectPool = objectPool;
    this.syncIdManager = syncIdManager;
    this.options = {
      validatePackets: options.validatePackets ?? true,
      skipUnknownModels: options.skipUnknownModels ?? false,
      applyInBatches: options.applyInBatches ?? true,
      batchSize: options.batchSize ?? 100,
    };
  }

  async processDelta(packet: DeltaPacket): Promise<void> {
    if (this.options.validatePackets) {
      this.validatePacket(packet);
    }

    this.syncIdManager.receiveSyncId(packet.id);

    switch (packet.action) {
      case DeltaAction.INSERT:
      case DeltaAction.CREATE:
        await this.handleCreate(packet);
        break;
      case DeltaAction.UPDATE:
        await this.handleUpdate(packet);
        break;
      case DeltaAction.DELETE:
        await this.handleDelete(packet);
        break;
      case DeltaAction.ARCHIVE:
        await this.handleArchive(packet);
        break;
      case DeltaAction.GAP:
        await this.handleGap(packet);
        break;
      case DeltaAction.SYNC:
        await this.handleSync(packet);
        break;
      case DeltaAction.VALIDATION:
        await this.handleValidation(packet);
        break;
      default:
        throw new Error(`Unknown delta action: ${packet.action}`);
    }
  }

  async processBatch(batch: DeltaBatch): Promise<ProcessResult> {
    const result: ProcessResult = {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
    };

    if (this.options.applyInBatches) {
      this.processingQueue.push(...batch.packets);
      const processedResult = await this.processQueue();
      return processedResult;
    } else {
      for (const packet of batch.packets) {
        try {
          await this.processDelta(packet);
          result.processed++;
        } catch (error) {
          result.failed++;
          result.success = false;
          result.errors.push({
            packet,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    return result;
  }

  private async processQueue(): Promise<ProcessResult> {
    const result: ProcessResult = {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
    };

    if (this.isProcessing || this.processingQueue.length === 0) {
      return result;
    }

    this.isProcessing = true;

    try {
      while (this.processingQueue.length > 0) {
        const batch = this.processingQueue.splice(0, this.options.batchSize);
        
        for (const packet of batch) {
          try {
            await this.processDelta(packet);
            result.processed++;
          } catch (error) {
            console.error('Failed to process delta packet:', packet, error);
            result.failed++;
            result.success = false;
            result.errors.push({
              packet,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return result;
  }

  private async handleCreate(packet: DeltaPacket): Promise<void> {
    const ModelClass = ModelRegistry.getModel(packet.modelName);
    
    if (!ModelClass) {
      if (this.options.skipUnknownModels) {
        return;
      }
      throw new Error(`Unknown model type: ${packet.modelName}`);
    }

    const existing = this.objectPool.get(packet.modelName, packet.modelId);
    if (existing) {
      // Model already exists, update it instead
      await this.handleUpdate(packet);
      return;
    }

    const model = new (ModelClass as any)(packet.modelId);
    Object.assign(model, packet.data);
    this.objectPool.add(model);
  }

  private async handleUpdate(packet: DeltaPacket): Promise<void> {
    const model = this.objectPool.get(packet.modelName, packet.modelId);
    
    if (!model) {
      if (packet.data) {
        // Model doesn't exist, create it
        await this.handleCreate(packet);
        return;
      }
      throw new Error(`Model not found: ${packet.modelName}:${packet.modelId}`);
    }

    Object.assign(model, packet.data);
    this.objectPool.update(model);
  }

  private async handleDelete(packet: DeltaPacket): Promise<void> {
    const removed = this.objectPool.remove(packet.modelName, packet.modelId);
    if (!removed && !this.options.skipUnknownModels) {
      throw new Error(`Failed to delete model: ${packet.modelName}:${packet.modelId}`);
    }
  }

  private async handleArchive(packet: DeltaPacket): Promise<void> {
    const model = this.objectPool.get(packet.modelName, packet.modelId);
    
    if (!model) {
      if (!this.options.skipUnknownModels) {
        throw new Error(`Model not found for archive: ${packet.modelName}:${packet.modelId}`);
      }
      return;
    }

    // Set archived flag if the model supports it
    if ('archived' in model) {
      (model as any).archived = true;
      this.objectPool.update(model);
    }
  }

  private async handleGap(packet: DeltaPacket): Promise<void> {
    // Gap packets indicate missing sync IDs
    // The sync client should request the missing packets
    const gaps = this.syncIdManager.detectGaps();
    if (gaps.length > 0) {
      console.warn('Sync gaps detected:', gaps);
    }
  }

  private async handleSync(packet: DeltaPacket): Promise<void> {
    // Sync packets are used to update the current sync ID
    this.syncIdManager.setCurrentSyncId(packet.id);
  }

  private async handleValidation(packet: DeltaPacket): Promise<void> {
    // Validation packets can be used to verify data integrity
    const model = this.objectPool.get(packet.modelName, packet.modelId);
    
    if (!model && !this.options.skipUnknownModels) {
      throw new Error(`Model not found for validation: ${packet.modelName}:${packet.modelId}`);
    }

    // Additional validation logic can be implemented here
  }

  private validatePacket(packet: DeltaPacket): void {
    if (!packet.id || packet.id <= 0) {
      throw new Error('Invalid delta packet ID');
    }

    if (!packet.modelName) {
      throw new Error('Delta packet missing model name');
    }

    if (!packet.modelId) {
      throw new Error('Delta packet missing model ID');
    }

    if (!packet.action || !Object.values(DeltaAction).includes(packet.action)) {
      throw new Error(`Invalid delta action: ${packet.action}`);
    }
  }

  getQueueSize(): number {
    return this.processingQueue.length;
  }

  isQueueEmpty(): boolean {
    return this.processingQueue.length === 0;
  }

  clearQueue(): void {
    this.processingQueue = [];
  }
}