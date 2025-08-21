import { Model } from '../model';

export interface PoolStats {
  totalObjects: number;
  modelCounts: Map<string, number>;
  memoryUsage?: number;
}

export class ObjectPool {
  private pool: Map<string, Model> = new Map();
  private modelTypeIndex: Map<string, Set<string>> = new Map();
  private lastAccessTime: Map<string, number> = new Map();
  private maxPoolSize: number;
  private evictionEnabled: boolean;

  constructor(maxPoolSize: number = 10000, evictionEnabled: boolean = true) {
    this.maxPoolSize = maxPoolSize;
    this.evictionEnabled = evictionEnabled;
  }

  add(model: Model): void {
    const key = this.getKey(model.constructor.name, model.id);
    
    if (this.evictionEnabled && this.pool.size >= this.maxPoolSize && !this.pool.has(key)) {
      this.evictLeastRecentlyUsed();
    }

    this.pool.set(key, model);
    this.lastAccessTime.set(key, Date.now());

    if (!this.modelTypeIndex.has(model.constructor.name)) {
      this.modelTypeIndex.set(model.constructor.name, new Set());
    }
    this.modelTypeIndex.get(model.constructor.name)!.add(model.id);
  }

  get<T extends Model>(modelType: string, id: string): T | undefined {
    const key = this.getKey(modelType, id);
    const model = this.pool.get(key);
    
    if (model) {
      this.lastAccessTime.set(key, Date.now());
    }
    
    return model as T | undefined;
  }

  getByType<T extends Model>(modelType: string): T[] {
    const ids = this.modelTypeIndex.get(modelType);
    if (!ids) return [];

    return Array.from(ids)
      .map(id => this.get<T>(modelType, id))
      .filter((model): model is T => model !== undefined);
  }

  has(modelType: string, id: string): boolean {
    return this.pool.has(this.getKey(modelType, id));
  }

  remove(modelType: string, id: string): boolean {
    const key = this.getKey(modelType, id);
    const deleted = this.pool.delete(key);
    
    if (deleted) {
      this.lastAccessTime.delete(key);
      const typeIndex = this.modelTypeIndex.get(modelType);
      if (typeIndex) {
        typeIndex.delete(id);
        if (typeIndex.size === 0) {
          this.modelTypeIndex.delete(modelType);
        }
      }
    }
    
    return deleted;
  }

  update(model: Model): void {
    const key = this.getKey(model.constructor.name, model.id);
    if (this.pool.has(key)) {
      this.pool.set(key, model);
      this.lastAccessTime.set(key, Date.now());
    } else {
      this.add(model);
    }
  }

  clear(): void {
    this.pool.clear();
    this.modelTypeIndex.clear();
    this.lastAccessTime.clear();
  }

  clearByType(modelType: string): number {
    const ids = this.modelTypeIndex.get(modelType);
    if (!ids) return 0;

    let count = 0;
    for (const id of ids) {
      if (this.remove(modelType, id)) {
        count++;
      }
    }
    
    return count;
  }

  getStats(): PoolStats {
    const modelCounts = new Map<string, number>();
    
    for (const [modelType, ids] of this.modelTypeIndex.entries()) {
      modelCounts.set(modelType, ids.size);
    }

    return {
      totalObjects: this.pool.size,
      modelCounts,
    };
  }

  private evictLeastRecentlyUsed(): void {
    if (this.pool.size === 0) return;

    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, time] of this.lastAccessTime.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const [modelType, id] = oldestKey.split(':');
      this.remove(modelType, id);
    }
  }

  private getKey(modelType: string, id: string): string {
    return `${modelType}:${id}`;
  }

  getAllModels(): Model[] {
    return Array.from(this.pool.values());
  }

  size(): number {
    return this.pool.size;
  }
}