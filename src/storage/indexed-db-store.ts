import { ModelMetadata } from '../model-registry';

export interface StoreConfig {
  dbName?: string;
  version?: number;
  stores?: string[];
}

export interface QueryOptions {
  index?: string;
  range?: IDBKeyRange;
  limit?: number;
  offset?: number;
}

/**
 * IndexedDB-based storage following Linear's patterns
 * Replaces in-memory ObjectPool with persistent storage
 */
export class IndexedDBStore {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private schemaVersion: number = 1;
  private schemaHash: string = '';
  
  constructor(config: StoreConfig = {}) {
    this.dbName = config.dbName || 'sync_engine';
    this.schemaVersion = config.version || 1;
  }

  /**
   * Initialize database with model stores
   * Following Linear's pattern: separate stores per model + system stores
   */
  async initialize(models: ModelMetadata[]): Promise<void> {
    // Generate schema hash for database versioning (Linear pattern)
    this.schemaHash = await this.generateSchemaHash(models);
    this.dbName = `sync_engine_${this.schemaHash.substring(0, 8)}`;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.schemaVersion);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create model stores
        for (const model of models) {
          if (!db.objectStoreNames.contains(model.name.toLowerCase())) {
            const store = db.createObjectStore(model.name.toLowerCase(), {
              keyPath: 'id',
              autoIncrement: false
            });
            
            // Create indexes for properties marked as indexed
            for (const [propName, propMeta] of model.properties) {
              if (propMeta.indexed) {
                store.createIndex(propName, propName, { unique: false });
              }
            }
          }
        }
        
        // Create system stores (Linear pattern)
        // _meta: stores database metadata
        if (!db.objectStoreNames.contains('_meta')) {
          db.createObjectStore('_meta', { keyPath: 'key' });
        }
        
        // _sync: stores sync queue and sync state
        if (!db.objectStoreNames.contains('_sync')) {
          const syncStore = db.createObjectStore('_sync', { 
            keyPath: 'id',
            autoIncrement: false 
          });
          syncStore.createIndex('syncId', 'syncId', { unique: false });
          syncStore.createIndex('status', 'status', { unique: false });
          syncStore.createIndex('modelName', 'modelName', { unique: false });
        }
        
        // _transactions: offline transaction queue (Linear pattern)
        if (!db.objectStoreNames.contains('_transactions')) {
          const txStore = db.createObjectStore('_transactions', {
            keyPath: 'id',
            autoIncrement: false
          });
          txStore.createIndex('status', 'status', { unique: false });
          txStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error}`));
      };
    });
  }

  /**
   * Store a model in IndexedDB
   */
  async put(storeName: string, data: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readwrite');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const request = store.put(data);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a model from IndexedDB
   */
  async get(storeName: string, id: string): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readonly');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a model from IndexedDB
   */
  async delete(storeName: string, id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readwrite');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Query models with optional filtering
   */
  async query(storeName: string, options: QueryOptions = {}): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readonly');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      let count = 0;
      const offset = options.offset || 0;
      const limit = options.limit || Infinity;
      
      let request: IDBRequest;
      
      if (options.index) {
        const index = store.index(options.index);
        request = index.openCursor(options.range);
      } else {
        request = store.openCursor(options.range);
      }
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor) {
          if (count >= offset && results.length < limit) {
            results.push(cursor.value);
          }
          count++;
          
          if (results.length < limit) {
            cursor.continue();
          } else {
            resolve(results);
          }
        } else {
          resolve(results);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all records from a store
   */
  async getAll(storeName: string): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readonly');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all records from a store
   */
  async clear(storeName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readwrite');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count records in a store
   */
  async count(storeName: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction([storeName.toLowerCase()], 'readonly');
    const store = transaction.objectStore(storeName.toLowerCase());
    
    return new Promise((resolve, reject) => {
      const request = store.count();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Store metadata (Linear pattern)
   */
  async setMeta(key: string, value: any): Promise<void> {
    return this.put('_meta', { key, value, updatedAt: Date.now() });
  }

  /**
   * Get metadata
   */
  async getMeta(key: string): Promise<any> {
    const result = await this.get('_meta', key);
    return result?.value;
  }

  /**
   * Queue transaction for sync (Linear pattern)
   */
  async queueForSync(modelName: string, modelId: string, operation: 'create' | 'update' | 'delete', data: any): Promise<void> {
    const syncEntry = {
      id: `${modelName}:${modelId}:${Date.now()}`,
      modelName,
      modelId,
      operation,
      data,
      status: 'pending',
      createdAt: Date.now(),
      syncId: null
    };
    
    await this.put('_sync', syncEntry);
  }

  /**
   * Get pending sync items
   */
  async getPendingSyncItems(): Promise<any[]> {
    return this.query('_sync', {
      index: 'status',
      range: IDBKeyRange.only('pending')
    });
  }

  /**
   * Mark item as synced
   */
  async markSynced(syncItemId: string, syncId: number): Promise<void> {
    const item = await this.get('_sync', syncItemId);
    if (item) {
      item.status = 'synced';
      item.syncId = syncId;
      item.syncedAt = Date.now();
      await this.put('_sync', item);
    }
  }

  /**
   * Get pending sync records with limit (for hash-based sync engine)
   */
  async getPendingSyncRecords(limit: number = 50): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['_sync'], 'readonly');
    const store = transaction.objectStore('_sync');
    const index = store.index('status');
    
    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only('pending'), limit);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove sync record by ID
   */
  async removeSyncRecord(syncRecordId: string): Promise<void> {
    await this.delete('_sync', syncRecordId);
  }

  /**
   * Set metadata (alias for compatibility with hash sync engine)
   */
  async setMetadata(key: string, value: any): Promise<void> {
    return this.setMeta(key, value);
  }

  /**
   * Get metadata (alias for compatibility with hash sync engine)
   */
  async getMetadata(key: string): Promise<any> {
    return this.getMeta(key);
  }

  /**
   * Generate schema hash for database versioning (Linear pattern)
   */
  private async generateSchemaHash(models: ModelMetadata[]): Promise<string> {
    const schemaString = models.map(model => {
      const props = Array.from(model.properties.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, meta]) => `${name}:${meta.type}`)
        .join(',');
      return `${model.name}:${props}`;
    }).join(';');
    
    // Simple hash function for demo (in production, use crypto.subtle.digest)
    let hash = 0;
    for (let i = 0; i < schemaString.length; i++) {
      const char = schemaString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return Math.abs(hash).toString(16);
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Delete entire database
   */
  async deleteDatabase(): Promise<void> {
    this.close();
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}