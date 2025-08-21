import { ObjectPool } from './object-pool';
import { SyncIdManager } from './sync-id-manager';
import { TransactionManager, TransactionBatch } from './transaction-manager';
import { DeltaProcessor } from './delta-processor';
import { DeltaPacket } from './delta-packet';
import { BaseModel } from '../models/base-model';
import { makeObservable, observable, action } from 'mobx';

export enum SyncStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  SYNCING = 'syncing',
  ERROR = 'error',
}

export interface SyncClientOptions {
  serverUrl?: string;
  batchSize?: number;
  batchDelayMs?: number;
  maxRetries?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export interface SyncStats {
  status: SyncStatus;
  syncId: number;
  pendingTransactions: number;
  inFlightTransactions: number;
  completedTransactions: number;
  failedTransactions: number;
  objectPoolSize: number;
  syncGaps: number;
  lastSyncTime?: number;
}

export class SyncClient {
  private objectPool: ObjectPool;
  private syncIdManager: SyncIdManager;
  private transactionManager: TransactionManager;
  private deltaProcessor: DeltaProcessor;
  private websocket?: WebSocket;
  private options: Required<SyncClientOptions>;
  
  @observable status: SyncStatus = SyncStatus.DISCONNECTED;
  @observable lastError?: Error;
  @observable lastSyncTime?: number;
  @observable isOnline: boolean = navigator.onLine;

  constructor(options: SyncClientOptions = {}) {
    this.options = {
      serverUrl: options.serverUrl || 'ws://localhost:8080',
      batchSize: options.batchSize || 50,
      batchDelayMs: options.batchDelayMs || 100,
      maxRetries: options.maxRetries || 3,
      reconnectDelayMs: options.reconnectDelayMs || 1000,
      heartbeatIntervalMs: options.heartbeatIntervalMs || 30000,
    };

    // Initialize components
    this.objectPool = new ObjectPool();
    this.syncIdManager = new SyncIdManager();
    this.transactionManager = new TransactionManager({
      batchSize: this.options.batchSize,
      batchDelayMs: this.options.batchDelayMs,
      persistTransactions: true,
    });
    this.deltaProcessor = new DeltaProcessor(
      this.objectPool,
      this.syncIdManager
    );

    // Set up integration between components
    BaseModel.setObjectPool(this.objectPool);
    BaseModel.setTransactionManager(this.transactionManager);

    // Set up transaction batch handling
    this.transactionManager.onBatch((batch) => {
      this.sendTransactionBatch(batch);
    });

    // Set up network status monitoring
    this.setupNetworkMonitoring();

    makeObservable(this);
  }

  @action
  async connect(): Promise<void> {
    if (this.status === SyncStatus.CONNECTING || this.status === SyncStatus.CONNECTED) {
      return;
    }

    this.setStatus(SyncStatus.CONNECTING);

    try {
      await this.establishWebSocketConnection();
      this.setStatus(SyncStatus.CONNECTED);
      this.lastError = undefined;
    } catch (error) {
      this.setStatus(SyncStatus.ERROR);
      this.lastError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  @action
  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }
    this.setStatus(SyncStatus.DISCONNECTED);
  }

  private async establishWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(this.options.serverUrl);

      this.websocket.onopen = () => {
        console.log('WebSocket connected');
        resolve();
      };

      this.websocket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          await this.handleServerMessage(data);
        } catch (error) {
          console.error('Failed to process server message:', error);
        }
      };

      this.websocket.onclose = () => {
        console.log('WebSocket disconnected');
        this.handleDisconnection();
      };

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };

      // Connection timeout
      setTimeout(() => {
        if (this.websocket?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 5000);
    });
  }

  private async handleServerMessage(data: any): Promise<void> {
    if (data.type === 'delta') {
      await this.deltaProcessor.processDelta(data.packet as DeltaPacket);
    } else if (data.type === 'delta_batch') {
      await this.deltaProcessor.processBatch(data.batch);
    } else if (data.type === 'transaction_ack') {
      this.transactionManager.markCompleted(data.transactionId, data.syncId);
    } else if (data.type === 'transaction_error') {
      this.transactionManager.markFailed(data.transactionId, new Error(data.error));
    } else if (data.type === 'sync_status') {
      this.syncIdManager.setCurrentSyncId(data.syncId);
      this.lastSyncTime = Date.now();
    }
  }

  private async sendTransactionBatch(batch: TransactionBatch): Promise<void> {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send transaction batch: WebSocket not connected');
      return;
    }

    this.setStatus(SyncStatus.SYNCING);

    try {
      this.websocket.send(JSON.stringify({
        type: 'transaction_batch',
        batch: {
          id: batch.id,
          transactions: batch.transactions.map(t => t.toJSON()),
          timestamp: batch.timestamp,
        },
      }));
    } catch (error) {
      console.error('Failed to send transaction batch:', error);
      batch.transactions.forEach(t => {
        this.transactionManager.markFailed(t.id, error instanceof Error ? error : new Error(String(error)));
      });
    } finally {
      this.setStatus(SyncStatus.CONNECTED);
    }
  }

  @action
  private setStatus(status: SyncStatus): void {
    this.status = status;
  }

  private handleDisconnection(): void {
    this.setStatus(SyncStatus.DISCONNECTED);
    
    if (this.isOnline) {
      // Auto-reconnect after delay
      setTimeout(() => {
        if (this.status === SyncStatus.DISCONNECTED) {
          this.connect().catch(console.error);
        }
      }, this.options.reconnectDelayMs);
    }
  }

  private setupNetworkMonitoring(): void {
    const handleOnline = () => {
      this.isOnline = true;
      if (this.status === SyncStatus.DISCONNECTED) {
        this.connect().catch(console.error);
      }
    };

    const handleOffline = () => {
      this.isOnline = false;
      this.setStatus(SyncStatus.DISCONNECTED);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  // Public API methods
  getModel<T extends BaseModel>(modelType: string, id: string): T | undefined {
    return this.objectPool.get<T>(modelType, id);
  }

  getAllModels(): BaseModel[] {
    return this.objectPool.getAllModels();
  }

  getModelsByType<T extends BaseModel>(modelType: string): T[] {
    return this.objectPool.getByType<T>(modelType);
  }

  getStats(): SyncStats {
    const transactionStats = this.transactionManager.getStats();
    const poolStats = this.objectPool.getStats();
    const syncStats = this.syncIdManager.getStats();

    return {
      status: this.status,
      syncId: syncStats.currentSyncId,
      pendingTransactions: transactionStats.queueSize,
      inFlightTransactions: transactionStats.inFlight,
      completedTransactions: transactionStats.completed,
      failedTransactions: transactionStats.failed,
      objectPoolSize: poolStats.totalObjects,
      syncGaps: syncStats.gapCount,
      lastSyncTime: this.lastSyncTime,
    };
  }

  retryFailedTransactions(): void {
    this.transactionManager.retryFailed();
  }

  clearCompletedTransactions(): void {
    this.transactionManager.clearCompleted();
  }

  // Development/debugging methods
  simulateOffline(): void {
    this.disconnect();
  }

  simulateOnline(): void {
    this.connect().catch(console.error);
  }

  clearAllData(): void {
    this.objectPool.clear();
    this.transactionManager.clear();
    this.syncIdManager.reset();
  }
}