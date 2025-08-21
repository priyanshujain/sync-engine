import { Model } from '../model';

export enum TransactionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  ARCHIVE = 'ARCHIVE',
  UNARCHIVE = 'UNARCHIVE',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  IN_FLIGHT = 'IN_FLIGHT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export interface TransactionData {
  [key: string]: any;
}

export abstract class Transaction {
  id: string;
  type: TransactionType;
  modelType: string;
  modelId: string;
  status: TransactionStatus;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  error?: Error;
  syncId?: number;

  constructor(
    type: TransactionType,
    modelType: string,
    modelId: string,
    maxRetries: number = 3
  ) {
    this.id = this.generateId();
    this.type = type;
    this.modelType = modelType;
    this.modelId = modelId;
    this.status = TransactionStatus.PENDING;
    this.timestamp = Date.now();
    this.retryCount = 0;
    this.maxRetries = maxRetries;
  }

  abstract apply(model?: Model): void;
  abstract rollback(model?: Model): void;
  abstract getData(): TransactionData;
  abstract getPreviousData(): TransactionData | null;

  canRetry(): boolean {
    return this.retryCount < this.maxRetries && 
           this.status === TransactionStatus.FAILED;
  }

  incrementRetry(): void {
    this.retryCount++;
  }

  setStatus(status: TransactionStatus): void {
    this.status = status;
  }

  setError(error: Error): void {
    this.error = error;
    this.status = TransactionStatus.FAILED;
  }

  setSyncId(syncId: number): void {
    this.syncId = syncId;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  toJSON(): object {
    return {
      id: this.id,
      type: this.type,
      modelType: this.modelType,
      modelId: this.modelId,
      status: this.status,
      timestamp: this.timestamp,
      retryCount: this.retryCount,
      data: this.getData(),
      previousData: this.getPreviousData(),
      syncId: this.syncId,
      error: this.error?.message,
    };
  }
}

export class CreateTransaction extends Transaction {
  private data: TransactionData;

  constructor(
    modelType: string,
    modelId: string,
    data: TransactionData
  ) {
    super(TransactionType.CREATE, modelType, modelId);
    this.data = { ...data };
  }

  apply(model?: Model): void {
    if (model) {
      Object.assign(model, this.data);
    }
  }

  rollback(model?: Model): void {
    // For create, rollback means removing the model
    // This would be handled by the ObjectPool
  }

  getData(): TransactionData {
    return { ...this.data };
  }

  getPreviousData(): TransactionData | null {
    return null;
  }
}

export class UpdateTransaction extends Transaction {
  private data: TransactionData;
  private previousData: TransactionData;

  constructor(
    modelType: string,
    modelId: string,
    data: TransactionData,
    previousData: TransactionData
  ) {
    super(TransactionType.UPDATE, modelType, modelId);
    this.data = { ...data };
    this.previousData = { ...previousData };
  }

  apply(model?: Model): void {
    if (model) {
      Object.assign(model, this.data);
    }
  }

  rollback(model?: Model): void {
    if (model) {
      Object.assign(model, this.previousData);
    }
  }

  getData(): TransactionData {
    return { ...this.data };
  }

  getPreviousData(): TransactionData {
    return { ...this.previousData };
  }
}

export class DeleteTransaction extends Transaction {
  private previousData: TransactionData;

  constructor(
    modelType: string,
    modelId: string,
    previousData: TransactionData
  ) {
    super(TransactionType.DELETE, modelType, modelId);
    this.previousData = { ...previousData };
  }

  apply(model?: Model): void {
    // Delete is handled by removing from ObjectPool
  }

  rollback(model?: Model): void {
    if (model) {
      Object.assign(model, this.previousData);
    }
  }

  getData(): TransactionData {
    return {};
  }

  getPreviousData(): TransactionData {
    return { ...this.previousData };
  }
}