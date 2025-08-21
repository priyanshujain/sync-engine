import { Transaction, TransactionStatus } from './transaction';

export interface TransactionBatch {
  id: string;
  transactions: Transaction[];
  timestamp: number;
}

export interface TransactionManagerOptions {
  batchSize: number;
  batchDelayMs: number;
  persistTransactions: boolean;
  maxQueueSize: number;
}

export class TransactionManager {
  private queue: Transaction[] = [];
  private inFlightTransactions: Map<string, Transaction> = new Map();
  private completedTransactions: Map<string, Transaction> = new Map();
  private failedTransactions: Map<string, Transaction> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private options: TransactionManagerOptions;
  private onBatchReady?: (batch: TransactionBatch) => void;

  constructor(
    options: Partial<TransactionManagerOptions> = {}
  ) {
    this.options = {
      batchSize: options.batchSize || 50,
      batchDelayMs: options.batchDelayMs || 100,
      persistTransactions: options.persistTransactions ?? true,
      maxQueueSize: options.maxQueueSize || 1000,
    };
  }

  async enqueue(transaction: Transaction): Promise<void> {
    if (this.queue.length >= this.options.maxQueueSize) {
      throw new Error(`Transaction queue is full (max: ${this.options.maxQueueSize})`);
    }

    this.queue.push(transaction);
    
    if (this.options.persistTransactions) {
      await this.persistTransaction(transaction);
    }

    this.scheduleBatch();
  }

  dequeue(count: number = 1): Transaction[] {
    return this.queue.splice(0, Math.min(count, this.queue.length));
  }

  markInFlight(transaction: Transaction): void {
    transaction.setStatus(TransactionStatus.IN_FLIGHT);
    this.inFlightTransactions.set(transaction.id, transaction);
  }

  markCompleted(transactionId: string, syncId?: number): void {
    const transaction = this.inFlightTransactions.get(transactionId);
    if (transaction) {
      transaction.setStatus(TransactionStatus.COMPLETED);
      if (syncId !== undefined) {
        transaction.setSyncId(syncId);
      }
      this.inFlightTransactions.delete(transactionId);
      this.completedTransactions.set(transactionId, transaction);
    }
  }

  markFailed(transactionId: string, error: Error): void {
    const transaction = this.inFlightTransactions.get(transactionId);
    if (transaction) {
      transaction.setError(error);
      this.inFlightTransactions.delete(transactionId);
      this.failedTransactions.set(transactionId, transaction);
      
      if (transaction.canRetry()) {
        transaction.incrementRetry();
        this.queue.unshift(transaction);
        this.scheduleBatch();
      }
    }
  }

  rollback(transactionId: string): boolean {
    const transaction = 
      this.completedTransactions.get(transactionId) ||
      this.failedTransactions.get(transactionId) ||
      this.inFlightTransactions.get(transactionId);
    
    if (transaction) {
      transaction.rollback();
      transaction.setStatus(TransactionStatus.ROLLED_BACK);
      return true;
    }
    
    return false;
  }

  getTransaction(transactionId: string): Transaction | undefined {
    return this.queue.find(t => t.id === transactionId) ||
           this.inFlightTransactions.get(transactionId) ||
           this.completedTransactions.get(transactionId) ||
           this.failedTransactions.get(transactionId);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getInFlightCount(): number {
    return this.inFlightTransactions.size;
  }

  getCompletedCount(): number {
    return this.completedTransactions.size;
  }

  getFailedCount(): number {
    return this.failedTransactions.size;
  }

  getPendingTransactions(): Transaction[] {
    return [...this.queue];
  }

  getInFlightTransactions(): Transaction[] {
    return Array.from(this.inFlightTransactions.values());
  }

  getFailedTransactions(): Transaction[] {
    return Array.from(this.failedTransactions.values());
  }

  clear(): void {
    this.queue = [];
    this.inFlightTransactions.clear();
    this.completedTransactions.clear();
    this.failedTransactions.clear();
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  clearCompleted(): void {
    this.completedTransactions.clear();
  }

  clearFailed(): void {
    this.failedTransactions.clear();
  }

  retryFailed(): void {
    const failed = Array.from(this.failedTransactions.values());
    this.failedTransactions.clear();
    
    for (const transaction of failed) {
      if (transaction.canRetry()) {
        transaction.incrementRetry();
        transaction.setStatus(TransactionStatus.PENDING);
        this.queue.push(transaction);
      } else {
        this.failedTransactions.set(transaction.id, transaction);
      }
    }
    
    if (this.queue.length > 0) {
      this.scheduleBatch();
    }
  }

  onBatch(callback: (batch: TransactionBatch) => void): void {
    this.onBatchReady = callback;
  }

  private scheduleBatch(): void {
    if (this.queue.length >= this.options.batchSize) {
      // Clear any existing timer
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      this.processBatch();
    } else if (!this.batchTimer && this.queue.length > 0) {
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.options.batchDelayMs);
    }
  }

  private processBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const transactions = this.dequeue(this.options.batchSize);
    const batch: TransactionBatch = {
      id: this.generateBatchId(),
      transactions,
      timestamp: Date.now(),
    };

    transactions.forEach(t => this.markInFlight(t));

    if (this.onBatchReady) {
      this.onBatchReady(batch);
    }
  }

  private async persistTransaction(transaction: Transaction): Promise<void> {
    // TODO: Implement persistence to IndexedDB
    // This will be implemented when we integrate with the Database class
  }

  private generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getStats(): {
    queueSize: number;
    inFlight: number;
    completed: number;
    failed: number;
    total: number;
  } {
    return {
      queueSize: this.queue.length,
      inFlight: this.inFlightTransactions.size,
      completed: this.completedTransactions.size,
      failed: this.failedTransactions.size,
      total: this.queue.length + 
             this.inFlightTransactions.size + 
             this.completedTransactions.size + 
             this.failedTransactions.size,
    };
  }
}