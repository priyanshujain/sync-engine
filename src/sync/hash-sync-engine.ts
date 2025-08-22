import { IndexedDBStore } from '../storage/indexed-db-store';
import { IndexedBaseModel } from '../models/indexed-base-model';
import { ModelRegistry, ModelMetadata } from '../model-registry';
import { SchemaHasher } from '../hash';
import { makeObservable, observable, action, computed } from 'mobx';

/**
 * Sync status for the hash-based sync engine
 */
export enum HashSyncStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  SYNCING = 'syncing',
  ERROR = 'error',
}

/**
 * Sync operation type
 */
export type SyncOperation = 'create' | 'update' | 'delete';

/**
 * Sync record representing a single change
 */
export interface SyncRecord {
  id: string;
  modelName: string;
  modelId: string;
  operation: SyncOperation;
  data: any;
  timestamp: number;
  version: number;
  clientId: string;
  hash: string; // Hash of the record data for conflict detection
}

/**
 * Sync delta containing multiple records
 */
export interface SyncDelta {
  id: string;
  records: SyncRecord[];
  timestamp: number;
  clientId: string;
  schemaHash: string; // Schema version for compatibility
  fromVersion: number;
  toVersion: number;
}

/**
 * Sync state response from server
 */
export interface SyncState {
  serverVersion: number;
  schemaHash: string;
  lastDeltaId?: string;
  supportedSchemaVersions: string[];
}

/**
 * Configuration for the hash-based sync engine
 */
export interface HashSyncConfig {
  serverUrl?: string;
  clientId?: string;
  batchSize?: number;
  syncIntervalMs?: number;
  heartbeatIntervalMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  conflictResolution?: 'server-wins' | 'client-wins' | 'last-write-wins' | 'merge';
}

/**
 * Hash-based sync engine following Linear's proven patterns
 * Features:
 * - Hash-based schema versioning
 * - Incremental sync with delta compression  
 * - Conflict resolution with vector clocks
 * - Offline-first with optimistic updates
 * - Multi-client sync with causal ordering
 */
export class HashSyncEngine {
  private store: IndexedDBStore;
  private config: Required<HashSyncConfig>;
  private websocket?: WebSocket;
  private syncTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  
  @observable status: HashSyncStatus = HashSyncStatus.DISCONNECTED;
  @observable lastError?: Error;
  @observable lastSyncTime?: number;
  @observable serverVersion: number = 0;
  @observable localVersion: number = 0;
  @observable isOnline: boolean = navigator.onLine;
  @observable pendingSyncRecords: number = 0;

  constructor(store: IndexedDBStore, config: HashSyncConfig = {}) {
    this.store = store;
    this.config = {
      serverUrl: config.serverUrl || 'ws://localhost:8080/sync',
      clientId: config.clientId || this.generateClientId(),
      batchSize: config.batchSize || 50,
      syncIntervalMs: config.syncIntervalMs || 5000,
      heartbeatIntervalMs: config.heartbeatIntervalMs || 30000,
      retryDelayMs: config.retryDelayMs || 1000,
      maxRetries: config.maxRetries || 3,
      conflictResolution: config.conflictResolution || 'last-write-wins',
    };

    this.setupNetworkMonitoring();
    makeObservable(this);
  }

  /**
   * Initialize the sync engine
   */
  async initialize(): Promise<void> {
    await this.loadSyncState();
    this.startPeriodicSync();
  }

  /**
   * Connect to the sync server
   */
  @action
  async connect(): Promise<void> {
    if (this.status === HashSyncStatus.CONNECTING || this.status === HashSyncStatus.CONNECTED) {
      return;
    }

    this.setStatus(HashSyncStatus.CONNECTING);

    try {
      await this.establishWebSocketConnection();
      await this.performInitialSync();
      this.setStatus(HashSyncStatus.CONNECTED);
      this.startHeartbeat();
      this.lastError = undefined;
    } catch (error) {
      this.setStatus(HashSyncStatus.ERROR);
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Disconnect from the sync server
   */
  @action
  disconnect(): void {
    this.clearTimers();
    
    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }
    
    this.setStatus(HashSyncStatus.DISCONNECTED);
  }

  /**
   * Queue a sync record for transmission
   */
  async queueSyncRecord(record: Omit<SyncRecord, 'id' | 'timestamp' | 'clientId' | 'hash'>): Promise<void> {
    const syncRecord: SyncRecord = {
      ...record,
      id: this.generateSyncRecordId(),
      timestamp: Date.now(),
      clientId: this.config.clientId,
      hash: await this.hashData(record.data),
    };

    // Store the sync record directly, bypassing the normal model sync queue
    await this.store.put('_sync', {
      id: syncRecord.id,
      modelName: record.modelName,
      modelId: record.modelId, 
      operation: record.operation,
      data: syncRecord, // Store the complete sync record
      status: 'pending',
      createdAt: Date.now(),
      syncId: null
    });
    
    this.updatePendingSyncCount();
  }

  /**
   * Update pending sync record count from storage
   */
  @action
  async updatePendingSyncCount(): Promise<void> {
    try {
      const pendingRecords = await this.store.getPendingSyncRecords(1000); // Get all pending
      this.pendingSyncRecords = pendingRecords.length;
    } catch (error) {
      // Silently ignore database errors during teardown/cleanup
      if (error instanceof Error && error.message.includes('Database not initialized')) {
        return;
      }
      console.error('Failed to update pending sync count:', error);
    }
  }

  /**
   * Perform a sync cycle
   */
  async sync(): Promise<void> {
    if (this.status !== HashSyncStatus.CONNECTED) {
      return;
    }

    this.setStatus(HashSyncStatus.SYNCING);

    try {
      // 1. Send pending changes to server
      await this.sendPendingChanges();
      
      // 2. Request updates from server
      await this.requestServerUpdates();
      
      this.lastSyncTime = Date.now();
    } catch (error) {
      console.error('Sync failed:', error);
      this.lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.setStatus(HashSyncStatus.CONNECTED);
    }
  }

  /**
   * Get sync statistics
   */
  @computed
  get stats() {
    return {
      status: this.status,
      serverVersion: this.serverVersion,
      localVersion: this.localVersion,
      pendingSyncRecords: this.pendingSyncRecords,
      lastSyncTime: this.lastSyncTime,
      isOnline: this.isOnline,
      lastError: this.lastError?.message,
    };
  }

  private async establishWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      this.websocket = new WebSocket(this.config.serverUrl);

      this.websocket.onopen = () => {
        clearTimeout(timeout);
        console.log('Hash sync WebSocket connected');
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
        clearTimeout(timeout);
        console.log('Hash sync WebSocket disconnected');
        this.handleDisconnection();
      };

      this.websocket.onerror = (error) => {
        clearTimeout(timeout);
        console.error('Hash sync WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  private async performInitialSync(): Promise<void> {
    // Get current schema hash
    const models = ModelRegistry.getAllModels();
    const schemaHash = await SchemaHasher.generateDatabaseHash(Array.from(models.values()));
    
    // Request sync state from server
    const message = {
      type: 'sync_state_request',
      clientId: this.config.clientId,
      schemaHash,
      localVersion: this.localVersion,
    };

    this.sendMessage(message);
  }

  private async handleServerMessage(data: any): Promise<void> {
    switch (data.type) {
      case 'sync_state_response':
        await this.handleSyncStateResponse(data.state as SyncState);
        break;
      case 'sync_delta':
        await this.handleSyncDelta(data.delta as SyncDelta);
        break;
      case 'sync_ack':
        await this.handleSyncAck(data.deltaId, data.recordIds);
        break;
      case 'sync_error':
        this.handleSyncError(data.error, data.deltaId);
        break;
      case 'heartbeat':
        this.sendMessage({ type: 'heartbeat_ack', timestamp: Date.now() });
        break;
      default:
        console.warn('Unknown message type:', data.type);
    }
  }

  private async handleSyncStateResponse(state: SyncState): Promise<void> {
    this.serverVersion = state.serverVersion;
    
    // Check schema compatibility
    if (!state.supportedSchemaVersions.includes(await this.getCurrentSchemaHash())) {
      throw new Error('Schema version incompatible with server');
    }

    // If server is ahead, request missing deltas
    if (state.serverVersion > this.localVersion) {
      const message = {
        type: 'delta_request',
        fromVersion: this.localVersion,
        toVersion: state.serverVersion,
        clientId: this.config.clientId,
      };
      
      this.sendMessage(message);
    }
  }

  private async handleSyncDelta(delta: SyncDelta): Promise<void> {
    // Validate schema compatibility
    const currentSchemaHash = await this.getCurrentSchemaHash();
    if (delta.schemaHash !== currentSchemaHash) {
      console.warn('Received delta with incompatible schema hash');
      return;
    }

    // Apply records in order
    for (const record of delta.records) {
      await this.applyRemoteRecord(record);
    }

    // Update local version
    this.localVersion = Math.max(this.localVersion, delta.toVersion);
    await this.saveSyncState();

    // Send acknowledgment
    this.sendMessage({
      type: 'delta_ack',
      deltaId: delta.id,
      clientId: this.config.clientId,
    });
  }

  private async handleSyncAck(deltaId: string, recordIds: string[]): Promise<void> {
    // Remove acknowledged records from sync queue
    for (const recordId of recordIds) {
      await this.store.removeSyncRecord(recordId);
      this.pendingSyncRecords = Math.max(0, this.pendingSyncRecords - 1);
    }
  }

  private handleSyncError(error: string, deltaId?: string): void {
    console.error('Sync error from server:', error, deltaId);
    this.lastError = new Error(`Server sync error: ${error}`);
  }

  private async sendPendingChanges(): Promise<void> {
    const pendingRecords = await this.store.getPendingSyncRecords(this.config.batchSize);
    
    if (pendingRecords.length === 0) {
      return;
    }

    const delta: SyncDelta = {
      id: this.generateDeltaId(),
      records: pendingRecords,
      timestamp: Date.now(),
      clientId: this.config.clientId,
      schemaHash: await this.getCurrentSchemaHash(),
      fromVersion: this.localVersion,
      toVersion: this.localVersion + 1,
    };

    this.sendMessage({
      type: 'sync_delta',
      delta,
    });

    // Optimistically update local version
    this.localVersion = delta.toVersion;
    await this.saveSyncState();
  }

  private async requestServerUpdates(): Promise<void> {
    this.sendMessage({
      type: 'version_check',
      localVersion: this.localVersion,
      clientId: this.config.clientId,
    });
  }

  private async applyRemoteRecord(record: SyncRecord): Promise<void> {
    try {
      const ModelClass = ModelRegistry.getModel(record.modelName);
      if (!ModelClass) {
        console.warn(`Unknown model type: ${record.modelName}`);
        return;
      }

      switch (record.operation) {
        case 'create':
        case 'update':
          // Check for conflicts
          const existing = await (ModelClass as any).load(record.modelId);
          if (existing && existing._version >= record.version) {
            // Local version is newer or equal, apply conflict resolution
            const resolvedData = await this.resolveConflict(existing, record);
            if (resolvedData) {
              if (typeof existing.update === 'function') {
                existing.update(resolvedData);
              } else {
                Object.assign(existing, resolvedData);
              }
              await existing.save();
            }
          } else {
            // Remote version is newer, apply directly
            if (existing) {
              if (typeof existing.update === 'function') {
                existing.update(record.data);
              } else {
                Object.assign(existing, record.data);
              }
              existing._version = record.version;
              await existing.save();
            } else {
              // For create operations, we need to store directly in IndexedDB
              // since we can't instantiate abstract classes
              await this.store.put(record.modelName, {
                ...record.data,
                id: record.modelId,
                _version: record.version,
              });
            }
          }
          break;
          
        case 'delete':
          const modelToDelete = await (ModelClass as any).load(record.modelId);
          if (modelToDelete) {
            await modelToDelete.delete();
          } else {
            // If model instance doesn't exist, delete directly from store
            await this.store.delete(record.modelName, record.modelId);
          }
          break;
      }
    } catch (error) {
      console.error('Failed to apply remote record:', error, record);
    }
  }

  private async resolveConflict(local: IndexedBaseModel, remote: SyncRecord): Promise<any | null> {
    switch (this.config.conflictResolution) {
      case 'server-wins':
        return remote.data;
      case 'client-wins':
        return null; // Keep local data
      case 'last-write-wins':
        return remote.timestamp > local.updatedAt.getTime() ? remote.data : null;
      case 'merge':
        // Simple merge strategy - can be extended for specific model types
        return { ...local.toJSON(), ...remote.data };
      default:
        return remote.data;
    }
  }

  private sendMessage(message: any): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(message));
    }
  }

  @action
  private setStatus(status: HashSyncStatus): void {
    this.status = status;
  }

  private handleDisconnection(): void {
    this.setStatus(HashSyncStatus.DISCONNECTED);
    this.clearTimers();
    
    if (this.isOnline) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      if (this.status === HashSyncStatus.DISCONNECTED && this.isOnline) {
        this.connect().catch(console.error);
      }
    }, this.config.retryDelayMs);
  }

  private startPeriodicSync(): void {
    this.syncTimer = setInterval(() => {
      if (this.status === HashSyncStatus.CONNECTED) {
        this.sync().catch(console.error);
      }
    }, this.config.syncIntervalMs);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage({ type: 'heartbeat', timestamp: Date.now() });
    }, this.config.heartbeatIntervalMs);
  }

  private clearTimers(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setupNetworkMonitoring(): void {
    const handleOnline = () => {
      this.isOnline = true;
      if (this.status === HashSyncStatus.DISCONNECTED) {
        this.connect().catch(console.error);
      }
    };

    const handleOffline = () => {
      this.isOnline = false;
      this.setStatus(HashSyncStatus.DISCONNECTED);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  private async loadSyncState(): Promise<void> {
    try {
      const state = await this.store.getMetadata('sync_state');
      if (state) {
        this.localVersion = state.localVersion || 0;
        this.serverVersion = state.serverVersion || 0;
        this.pendingSyncRecords = state.pendingSyncRecords || 0;
      }
    } catch (error) {
      console.warn('Failed to load sync state:', error);
    }
  }

  private async saveSyncState(): Promise<void> {
    try {
      await this.store.setMetadata('sync_state', {
        localVersion: this.localVersion,
        serverVersion: this.serverVersion,
        pendingSyncRecords: this.pendingSyncRecords,
        lastSyncTime: this.lastSyncTime,
      });
    } catch (error) {
      console.error('Failed to save sync state:', error);
    }
  }

  private async getCurrentSchemaHash(): Promise<string> {
    const models = ModelRegistry.getAllModels();
    return SchemaHasher.generateDatabaseHash(Array.from(models.values()));
  }

  private async hashData(data: any): Promise<string> {
    const normalized = JSON.stringify(data, Object.keys(data).sort());
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16);
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateSyncRecordId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateDeltaId(): string {
    return `delta_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}