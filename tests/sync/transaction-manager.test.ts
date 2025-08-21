import { TransactionManager } from '../../src/sync/transaction-manager';
import { 
  Transaction, 
  CreateTransaction, 
  UpdateTransaction, 
  DeleteTransaction,
  TransactionStatus 
} from '../../src/sync/transaction';

describe('TransactionManager', () => {
  let manager: TransactionManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new TransactionManager({
      batchSize: 3,
      batchDelayMs: 100,
      persistTransactions: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('enqueue', () => {
    it('should enqueue transactions', async () => {
      const transaction = new CreateTransaction('Model', '1', { name: 'test' });
      
      await manager.enqueue(transaction);
      
      expect(manager.getQueueSize()).toBe(1);
    });

    it('should throw error when queue is full', async () => {
      const smallManager = new TransactionManager({
        maxQueueSize: 2,
        persistTransactions: false,
      });
      
      await smallManager.enqueue(new CreateTransaction('Model', '1', {}));
      await smallManager.enqueue(new CreateTransaction('Model', '2', {}));
      
      await expect(
        smallManager.enqueue(new CreateTransaction('Model', '3', {}))
      ).rejects.toThrow('Transaction queue is full');
    });
  });

  describe('batching', () => {
    it('should trigger batch when size threshold is reached', async () => {
      const batchCallback = jest.fn();
      manager.onBatch(batchCallback);
      
      await manager.enqueue(new CreateTransaction('Model', '1', {}));
      await manager.enqueue(new CreateTransaction('Model', '2', {}));
      
      expect(batchCallback).not.toHaveBeenCalled();
      
      await manager.enqueue(new CreateTransaction('Model', '3', {}));
      
      // Batch processing happens synchronously when size is reached
      jest.runAllTimers();
      
      expect(batchCallback).toHaveBeenCalledTimes(1);
      expect(batchCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          transactions: expect.arrayContaining([
            expect.objectContaining({ modelId: '1' }),
            expect.objectContaining({ modelId: '2' }),
            expect.objectContaining({ modelId: '3' }),
          ]),
        })
      );
    });

    it('should trigger batch after delay for small batches', async () => {
      const batchCallback = jest.fn();
      manager.onBatch(batchCallback);
      
      await manager.enqueue(new CreateTransaction('Model', '1', {}));
      await manager.enqueue(new CreateTransaction('Model', '2', {}));
      
      expect(batchCallback).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(100);
      
      expect(batchCallback).toHaveBeenCalledTimes(1);
      expect(batchCallback.mock.calls[0][0].transactions).toHaveLength(2);
    });

    it('should not trigger batch for empty queue', () => {
      const batchCallback = jest.fn();
      manager.onBatch(batchCallback);
      
      jest.advanceTimersByTime(100);
      
      expect(batchCallback).not.toHaveBeenCalled();
    });
  });

  describe('transaction lifecycle', () => {
    it('should mark transactions as in-flight', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      
      manager.markInFlight(transaction);
      
      expect(manager.getInFlightCount()).toBe(1);
      expect(transaction.status).toBe(TransactionStatus.IN_FLIGHT);
    });

    it('should mark transactions as completed', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      
      manager.markCompleted(transaction.id, 123);
      
      expect(manager.getInFlightCount()).toBe(0);
      expect(manager.getCompletedCount()).toBe(1);
      expect(transaction.status).toBe(TransactionStatus.COMPLETED);
      expect(transaction.syncId).toBe(123);
    });

    it('should mark transactions as failed', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      
      const error = new Error('Network error');
      manager.markFailed(transaction.id, error);
      
      expect(manager.getInFlightCount()).toBe(0);
      expect(manager.getFailedCount()).toBe(1);
      expect(transaction.status).toBe(TransactionStatus.FAILED);
      expect(transaction.error).toBe(error);
    });

    it('should retry failed transactions', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      
      manager.markInFlight(transaction);
      manager.markFailed(transaction.id, new Error('Network error'));
      
      expect(manager.getQueueSize()).toBe(1);
      expect(transaction.retryCount).toBe(1);
    });

    it('should not retry after max retries', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      transaction.retryCount = 3;
      
      manager.markInFlight(transaction);
      manager.markFailed(transaction.id, new Error('Network error'));
      
      expect(manager.getQueueSize()).toBe(0);
      expect(manager.getFailedCount()).toBe(1);
    });
  });

  describe('rollback', () => {
    it('should rollback completed transaction', async () => {
      const transaction = new UpdateTransaction(
        'Model',
        '1',
        { name: 'new' },
        { name: 'old' }
      );
      
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      manager.markCompleted(transaction.id);
      
      const result = manager.rollback(transaction.id);
      
      expect(result).toBe(true);
      expect(transaction.status).toBe(TransactionStatus.ROLLED_BACK);
    });

    it('should return false for non-existent transaction', () => {
      const result = manager.rollback('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getTransaction', () => {
    it('should find transaction in queue', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      
      const found = manager.getTransaction(transaction.id);
      expect(found).toBe(transaction);
    });

    it('should find in-flight transaction', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      
      const found = manager.getTransaction(transaction.id);
      expect(found).toBe(transaction);
    });

    it('should find completed transaction', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      manager.markCompleted(transaction.id);
      
      const found = manager.getTransaction(transaction.id);
      expect(found).toBe(transaction);
    });

    it('should find failed transaction', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      manager.markFailed(transaction.id, new Error());
      
      const found = manager.getTransaction(transaction.id);
      expect(found).toBe(transaction);
    });
  });

  describe('clear operations', () => {
    it('should clear all transactions', async () => {
      await manager.enqueue(new CreateTransaction('Model', '1', {}));
      const t2 = new CreateTransaction('Model', '2', {});
      await manager.enqueue(t2);
      manager.markInFlight(t2);
      
      manager.clear();
      
      expect(manager.getQueueSize()).toBe(0);
      expect(manager.getInFlightCount()).toBe(0);
      expect(manager.getCompletedCount()).toBe(0);
      expect(manager.getFailedCount()).toBe(0);
    });

    it('should clear completed transactions', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      manager.markCompleted(transaction.id);
      
      manager.clearCompleted();
      
      expect(manager.getCompletedCount()).toBe(0);
    });

    it('should clear failed transactions', async () => {
      const transaction = new CreateTransaction('Model', '1', {});
      transaction.retryCount = 3;
      await manager.enqueue(transaction);
      manager.markInFlight(transaction);
      manager.markFailed(transaction.id, new Error());
      
      manager.clearFailed();
      
      expect(manager.getFailedCount()).toBe(0);
    });
  });

  describe('retryFailed', () => {
    it('should retry failed transactions that can be retried', async () => {
      const t1 = new CreateTransaction('Model', '1', {});
      const t2 = new CreateTransaction('Model', '2', {});
      t2.retryCount = 3;
      
      manager.markInFlight(t1);
      manager.markInFlight(t2);
      manager.markFailed(t1.id, new Error());
      manager.markFailed(t2.id, new Error());
      
      manager.retryFailed();
      
      expect(manager.getQueueSize()).toBe(2); // t1 was retried and incremented
      expect(manager.getFailedCount()).toBe(1); // t2 stays failed
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      // Use a custom manager to avoid automatic batch processing
      const customManager = new TransactionManager({
        batchSize: 10, // High batch size to prevent auto-batching
        persistTransactions: false,
      });
      
      const t1 = new CreateTransaction('Model', '1', {});
      const t2 = new CreateTransaction('Model', '2', {});
      const t3 = new CreateTransaction('Model', '3', {});
      const t4 = new CreateTransaction('Model', '4', {});
      t4.retryCount = 3;
      
      await customManager.enqueue(t1);
      await customManager.enqueue(t2);
      await customManager.enqueue(t3);
      
      // Dequeue t1 and mark it complete
      const dequeued = customManager.dequeue(1);
      if (dequeued[0]) {
        customManager.markInFlight(dequeued[0]);
        customManager.markCompleted(dequeued[0].id);
      }
      
      // Mark t2 as in-flight
      const dequeued2 = customManager.dequeue(1);
      if (dequeued2[0]) {
        customManager.markInFlight(dequeued2[0]);
      }
      
      // Mark t4 as failed (without retry)
      customManager.markInFlight(t4);
      customManager.markFailed(t4.id, new Error());
      
      const stats = customManager.getStats();
      
      expect(stats.queueSize).toBe(1); // t3 still in queue
      expect(stats.inFlight).toBe(1); // t2 in flight
      expect(stats.completed).toBe(1); // t1 completed
      expect(stats.failed).toBe(1); // t4 failed
      expect(stats.total).toBe(4);
    });
  });

  describe('Transaction classes', () => {
    describe('CreateTransaction', () => {
      it('should create transaction with data', () => {
        const data = { name: 'test', value: 123 };
        const transaction = new CreateTransaction('Model', '1', data);
        
        expect(transaction.type).toBe('CREATE');
        expect(transaction.getData()).toEqual(data);
        expect(transaction.getPreviousData()).toBeNull();
      });
    });

    describe('UpdateTransaction', () => {
      it('should create update transaction with current and previous data', () => {
        const currentData = { name: 'new' };
        const previousData = { name: 'old' };
        const transaction = new UpdateTransaction('Model', '1', currentData, previousData);
        
        expect(transaction.type).toBe('UPDATE');
        expect(transaction.getData()).toEqual(currentData);
        expect(transaction.getPreviousData()).toEqual(previousData);
      });
    });

    describe('DeleteTransaction', () => {
      it('should create delete transaction with previous data', () => {
        const previousData = { name: 'deleted', value: 123 };
        const transaction = new DeleteTransaction('Model', '1', previousData);
        
        expect(transaction.type).toBe('DELETE');
        expect(transaction.getData()).toEqual({});
        expect(transaction.getPreviousData()).toEqual(previousData);
      });
    });

    describe('Transaction JSON serialization', () => {
      it('should serialize transaction to JSON', () => {
        const transaction = new CreateTransaction('Model', '1', { name: 'test' });
        transaction.setSyncId(123);
        
        const json = transaction.toJSON();
        
        expect(json).toMatchObject({
          id: transaction.id,
          type: 'CREATE',
          modelType: 'Model',
          modelId: '1',
          status: 'PENDING',
          data: { name: 'test' },
          syncId: 123,
        });
      });
    });
  });
});