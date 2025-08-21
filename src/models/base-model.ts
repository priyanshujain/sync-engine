import { makeObservable, observable, action } from 'mobx';
import { ModelRegistry } from '../model-registry';
import { CreateTransaction, UpdateTransaction, DeleteTransaction } from '../sync/transaction';
import { TransactionManager } from '../sync/transaction-manager';
import { ObjectPool } from '../sync/object-pool';

export interface ModelOptions {
  autoSave?: boolean;
  trackChanges?: boolean;
  optimisticUpdate?: boolean;
}

export abstract class BaseModel {
  id: string;
  _version = 0;
  _isDirty = false;
  _previousState: Record<string, any> = {};
  _isDeleted = false;
  
  static loadStrategy: 'full' | 'partial' = 'full';
  
  protected static transactionManager?: TransactionManager;
  protected static objectPool?: ObjectPool;
  protected options: ModelOptions;

  constructor(id: string, options: ModelOptions = {}) {
    this.id = id;
    this.options = {
      autoSave: options.autoSave ?? true,
      trackChanges: options.trackChanges ?? true,
      optimisticUpdate: options.optimisticUpdate ?? true,
    };
    
    makeObservable(this, {
      _version: observable,
      _isDirty: observable,
      _isDeleted: observable,
      markDirty: action,
      markClean: action,
      markDeleted: action,
    });
    
    ModelRegistry.registerInstance(this);
    BaseModel.objectPool?.add(this);
  }

  static setTransactionManager(manager: TransactionManager): void {
    BaseModel.transactionManager = manager;
  }

  static setObjectPool(pool: ObjectPool): void {
    BaseModel.objectPool = pool;
  }

  protected getChanges(): Record<string, any> {
    const changes: Record<string, any> = {};
    const currentState = this.toJSON();
    
    for (const key in currentState) {
      if (currentState[key] !== this._previousState[key]) {
        changes[key] = currentState[key];
      }
    }
    
    return changes;
  }

  protected captureState(): void {
    this._previousState = { ...this.toJSON() };
  }

  markDirty(): void {
    this._isDirty = true;
    this._version++;
    
    if (this.options.autoSave) {
      this.save();
    }
  }

  markClean(): void {
    this._isDirty = false;
    this.captureState();
  }

  markDeleted(): void {
    this._isDeleted = true;
    this.markDirty();
  }

  async save(): Promise<void> {
    if (!this._isDirty || !BaseModel.transactionManager) {
      return;
    }

    const changes = this.getChanges();
    if (Object.keys(changes).length === 0) {
      this.markClean();
      return;
    }

    const transaction = this._previousState.id
      ? new UpdateTransaction(
          this.constructor.name,
          this.id,
          changes,
          this._previousState
        )
      : new CreateTransaction(
          this.constructor.name,
          this.id,
          this.toJSON()
        );

    await BaseModel.transactionManager.enqueue(transaction);
    
    if (this.options.optimisticUpdate) {
      BaseModel.objectPool?.update(this);
    }
    
    this.markClean();
  }

  async delete(): Promise<void> {
    if (!BaseModel.transactionManager) {
      return;
    }

    const transaction = new DeleteTransaction(
      this.constructor.name,
      this.id,
      this.toJSON()
    );

    await BaseModel.transactionManager.enqueue(transaction);
    
    if (this.options.optimisticUpdate) {
      BaseModel.objectPool?.remove(this.constructor.name, this.id);
    }
    
    this.markDeleted();
  }

  rollback(): void {
    Object.assign(this, this._previousState);
    this.markClean();
  }

  toJSON(): Record<string, any> {
    const json: Record<string, any> = {};
    const metadata = ModelRegistry.getModelMetadata(this.constructor as any);
    
    if (!metadata) {
      return { id: this.id };
    }
    
    for (const [propName, propMeta] of metadata.properties) {
      if (propMeta.type === 'property') {
        json[propName] = (this as any)[propName];
      }
    }
    
    json.id = this.id;
    return json;
  }

  static fromJSON<T extends BaseModel>(
    this: new (id: string) => T,
    data: Record<string, any>
  ): T {
    const instance = new this(data.id);
    Object.assign(instance, data);
    instance.captureState();
    instance.markClean();
    return instance;
  }
}