import { ObjectPool } from '../../src/sync/object-pool';
import { Model } from '../../src/model';

class TestModel extends Model {
  name: string = '';
  
  constructor(id: string) {
    super(id);
  }

  protected getChanges(): Record<string, any> {
    return { name: this.name };
  }

  save(): void {
    this.markChanged();
  }
}

class AnotherTestModel extends Model {
  value: number = 0;
  
  constructor(id: string) {
    super(id);
  }

  protected getChanges(): Record<string, any> {
    return { value: this.value };
  }

  save(): void {
    this.markChanged();
  }
}

describe('ObjectPool', () => {
  let pool: ObjectPool;

  beforeEach(() => {
    pool = new ObjectPool();
  });

  describe('add and get', () => {
    it('should add and retrieve a model', () => {
      const model = new TestModel('1');
      model.name = 'Test';
      
      pool.add(model);
      
      const retrieved = pool.get<TestModel>('TestModel', '1');
      expect(retrieved).toBe(model);
      expect(retrieved?.name).toBe('Test');
    });

    it('should return undefined for non-existent model', () => {
      const result = pool.get('TestModel', 'non-existent');
      expect(result).toBeUndefined();
    });

    it('should handle multiple model types', () => {
      const testModel = new TestModel('1');
      const anotherModel = new AnotherTestModel('2');
      
      pool.add(testModel);
      pool.add(anotherModel);
      
      expect(pool.get('TestModel', '1')).toBe(testModel);
      expect(pool.get('AnotherTestModel', '2')).toBe(anotherModel);
    });
  });

  describe('getByType', () => {
    it('should retrieve all models of a specific type', () => {
      const model1 = new TestModel('1');
      const model2 = new TestModel('2');
      const anotherModel = new AnotherTestModel('3');
      
      pool.add(model1);
      pool.add(model2);
      pool.add(anotherModel);
      
      const testModels = pool.getByType<TestModel>('TestModel');
      expect(testModels).toHaveLength(2);
      expect(testModels).toContain(model1);
      expect(testModels).toContain(model2);
      expect(testModels).not.toContain(anotherModel);
    });

    it('should return empty array for non-existent type', () => {
      const result = pool.getByType('NonExistent');
      expect(result).toEqual([]);
    });
  });

  describe('has', () => {
    it('should check if model exists', () => {
      const model = new TestModel('1');
      
      expect(pool.has('TestModel', '1')).toBe(false);
      
      pool.add(model);
      
      expect(pool.has('TestModel', '1')).toBe(true);
      expect(pool.has('TestModel', '2')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove a model', () => {
      const model = new TestModel('1');
      pool.add(model);
      
      const removed = pool.remove('TestModel', '1');
      
      expect(removed).toBe(true);
      expect(pool.has('TestModel', '1')).toBe(false);
      expect(pool.get('TestModel', '1')).toBeUndefined();
    });

    it('should return false when removing non-existent model', () => {
      const removed = pool.remove('TestModel', 'non-existent');
      expect(removed).toBe(false);
    });

    it('should clean up type index when last model of type is removed', () => {
      const model = new TestModel('1');
      pool.add(model);
      pool.remove('TestModel', '1');
      
      const stats = pool.getStats();
      expect(stats.modelCounts.has('TestModel')).toBe(false);
    });
  });

  describe('update', () => {
    it('should update existing model', () => {
      const model = new TestModel('1');
      model.name = 'Original';
      pool.add(model);
      
      model.name = 'Updated';
      pool.update(model);
      
      const retrieved = pool.get<TestModel>('TestModel', '1');
      expect(retrieved?.name).toBe('Updated');
    });

    it('should add model if it does not exist', () => {
      const model = new TestModel('1');
      
      pool.update(model);
      
      expect(pool.has('TestModel', '1')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all models', () => {
      pool.add(new TestModel('1'));
      pool.add(new TestModel('2'));
      pool.add(new AnotherTestModel('3'));
      
      pool.clear();
      
      expect(pool.size()).toBe(0);
      expect(pool.getStats().totalObjects).toBe(0);
      expect(pool.getStats().modelCounts.size).toBe(0);
    });
  });

  describe('clearByType', () => {
    it('should remove all models of specific type', () => {
      pool.add(new TestModel('1'));
      pool.add(new TestModel('2'));
      pool.add(new AnotherTestModel('3'));
      
      const removed = pool.clearByType('TestModel');
      
      expect(removed).toBe(2);
      expect(pool.has('TestModel', '1')).toBe(false);
      expect(pool.has('TestModel', '2')).toBe(false);
      expect(pool.has('AnotherTestModel', '3')).toBe(true);
    });

    it('should return 0 for non-existent type', () => {
      const removed = pool.clearByType('NonExistent');
      expect(removed).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      pool.add(new TestModel('1'));
      pool.add(new TestModel('2'));
      pool.add(new AnotherTestModel('3'));
      
      const stats = pool.getStats();
      
      expect(stats.totalObjects).toBe(3);
      expect(stats.modelCounts.get('TestModel')).toBe(2);
      expect(stats.modelCounts.get('AnotherTestModel')).toBe(1);
    });
  });

  describe('eviction', () => {
    it('should evict least recently used model when pool is full', () => {
      const smallPool = new ObjectPool(2, true);
      
      const model1 = new TestModel('1');
      const model2 = new TestModel('2');
      const model3 = new TestModel('3');
      
      smallPool.add(model1);
      jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() + 1000);
      smallPool.add(model2);
      
      jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() + 2000);
      smallPool.get('TestModel', '1');
      
      jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() + 3000);
      smallPool.add(model3);
      
      expect(smallPool.has('TestModel', '2')).toBe(false);
      expect(smallPool.has('TestModel', '1')).toBe(true);
      expect(smallPool.has('TestModel', '3')).toBe(true);
    });

    it('should not evict when eviction is disabled', () => {
      const smallPool = new ObjectPool(2, false);
      
      smallPool.add(new TestModel('1'));
      smallPool.add(new TestModel('2'));
      smallPool.add(new TestModel('3'));
      
      expect(smallPool.size()).toBe(3);
    });
  });

  describe('getAllModels', () => {
    it('should return all models in the pool', () => {
      const model1 = new TestModel('1');
      const model2 = new AnotherTestModel('2');
      
      pool.add(model1);
      pool.add(model2);
      
      const allModels = pool.getAllModels();
      
      expect(allModels).toHaveLength(2);
      expect(allModels).toContain(model1);
      expect(allModels).toContain(model2);
    });
  });

  describe('size', () => {
    it('should return correct pool size', () => {
      expect(pool.size()).toBe(0);
      
      pool.add(new TestModel('1'));
      expect(pool.size()).toBe(1);
      
      pool.add(new TestModel('2'));
      expect(pool.size()).toBe(2);
      
      pool.remove('TestModel', '1');
      expect(pool.size()).toBe(1);
    });
  });
});