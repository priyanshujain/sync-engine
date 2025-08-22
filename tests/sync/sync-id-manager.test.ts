import { SyncIdManager } from '../../src/sync/sync-id-manager';

describe('SyncIdManager', () => {
  let manager: SyncIdManager;

  beforeEach(() => {
    manager = new SyncIdManager();
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      expect(manager.getCurrentSyncId()).toBe(0);
      expect(manager.getLastReceivedSyncId()).toBe(0);
      expect(manager.isInSync()).toBe(true);
    });

    it('should initialize with custom sync ID', () => {
      const customManager = new SyncIdManager(100);
      expect(customManager.getCurrentSyncId()).toBe(100);
      expect(customManager.getLastReceivedSyncId()).toBe(100);
    });
  });

  describe('setCurrentSyncId', () => {
    it('should set current sync ID when valid', () => {
      manager.setCurrentSyncId(10);
      expect(manager.getCurrentSyncId()).toBe(10);
    });

    it('should throw error when setting lower sync ID', () => {
      manager.setCurrentSyncId(10);
      expect(() => manager.setCurrentSyncId(5)).toThrow(
        'Cannot set sync ID to 5, current is 10'
      );
    });

    it('should allow setting same sync ID', () => {
      manager.setCurrentSyncId(10);
      manager.setCurrentSyncId(10);
      expect(manager.getCurrentSyncId()).toBe(10);
    });
  });

  describe('receiveSyncId', () => {
    it('should track received sync IDs', () => {
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      manager.receiveSyncId(3);
      
      expect(manager.getLastReceivedSyncId()).toBe(3);
    });

    it('should handle out-of-order sync IDs', () => {
      manager.receiveSyncId(3);
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      
      expect(manager.getLastReceivedSyncId()).toBe(3);
    });

    it('should handle duplicate sync IDs', () => {
      manager.receiveSyncId(1);
      manager.receiveSyncId(1);
      
      const stats = manager.getStats();
      expect(stats.totalReceived).toBe(1);
    });
  });

  describe('detectGaps', () => {
    it('should detect no gaps when in sync', () => {
      manager.setCurrentSyncId(3);
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      manager.receiveSyncId(3);
      
      const gaps = manager.detectGaps();
      expect(gaps).toEqual([]);
    });

    it('should detect gaps in received sync IDs', () => {
      manager.setCurrentSyncId(0);
      manager.receiveSyncId(1);
      manager.receiveSyncId(3);
      manager.receiveSyncId(5);
      
      const gaps = manager.detectGaps();
      expect(gaps).toEqual([
        { start: 2, end: 2 },
        { start: 4, end: 4 }
      ]);
    });

    it('should detect gap at the beginning', () => {
      manager.setCurrentSyncId(0);
      manager.receiveSyncId(5);
      manager.receiveSyncId(6);
      
      const gaps = manager.detectGaps();
      expect(gaps).toEqual([
        { start: 1, end: 4 }
      ]);
    });

    it('should detect large gaps', () => {
      manager.setCurrentSyncId(0);
      manager.receiveSyncId(1);
      manager.receiveSyncId(100);
      
      const gaps = manager.detectGaps();
      expect(gaps).toEqual([
        { start: 2, end: 99 }
      ]);
    });

    it('should return empty array when gap detection is disabled', () => {
      const noGapManager = new SyncIdManager(0, 1000, false);
      noGapManager.receiveSyncId(1);
      noGapManager.receiveSyncId(5);
      
      const gaps = noGapManager.detectGaps();
      expect(gaps).toEqual([]);
    });
  });

  describe('hasGaps', () => {
    it('should return false when no gaps', () => {
      manager.setCurrentSyncId(2);
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      
      expect(manager.hasGaps()).toBe(false);
    });

    it('should return true when gaps exist', () => {
      manager.receiveSyncId(1);
      manager.receiveSyncId(3);
      
      expect(manager.hasGaps()).toBe(true);
    });
  });

  describe('isInSync', () => {
    it('should be in sync initially', () => {
      expect(manager.isInSync()).toBe(true);
    });

    it('should not be in sync with gaps', () => {
      manager.receiveSyncId(1);
      manager.receiveSyncId(3);
      
      expect(manager.isInSync()).toBe(false);
    });

    it('should not be in sync when current differs from last received', () => {
      manager.setCurrentSyncId(5);
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      manager.receiveSyncId(3);
      
      expect(manager.isInSync()).toBe(false);
    });

    it('should be in sync when all conditions met', () => {
      manager.setCurrentSyncId(3);
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      manager.receiveSyncId(3);
      
      expect(manager.isInSync()).toBe(true);
    });

    it('should always be in sync when gap detection is disabled', () => {
      const noGapManager = new SyncIdManager(0, 1000, false);
      noGapManager.receiveSyncId(1);
      noGapManager.receiveSyncId(5);
      
      expect(noGapManager.isInSync()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      manager.setCurrentSyncId(10);
      manager.receiveSyncId(5);
      manager.receiveSyncId(10);
      
      manager.reset();
      
      expect(manager.getCurrentSyncId()).toBe(0);
      expect(manager.getLastReceivedSyncId()).toBe(0);
      expect(manager.getStats().totalReceived).toBe(0);
    });

    it('should reset to specified sync ID', () => {
      manager.setCurrentSyncId(10);
      manager.receiveSyncId(10);
      
      manager.reset(50);
      
      expect(manager.getCurrentSyncId()).toBe(50);
      expect(manager.getLastReceivedSyncId()).toBe(50);
    });
  });

  describe('getNextSyncId and incrementSyncId', () => {
    it('should get next sync ID without incrementing', () => {
      expect(manager.getNextSyncId()).toBe(1);
      expect(manager.getCurrentSyncId()).toBe(0);
    });

    it('should increment and return new sync ID', () => {
      const newId = manager.incrementSyncId();
      expect(newId).toBe(1);
      expect(manager.getCurrentSyncId()).toBe(1);
      
      const nextId = manager.incrementSyncId();
      expect(nextId).toBe(2);
      expect(manager.getCurrentSyncId()).toBe(2);
    });
  });

  describe('getMissingSyncIds', () => {
    it('should return missing sync IDs', () => {
      manager.receiveSyncId(1);
      manager.receiveSyncId(3);
      manager.receiveSyncId(6);
      
      const missing = manager.getMissingSyncIds();
      expect(missing).toEqual([2, 4, 5]);
    });

    it('should limit returned missing IDs', () => {
      manager.receiveSyncId(1);
      manager.receiveSyncId(100);
      
      const missing = manager.getMissingSyncIds(10);
      expect(missing).toHaveLength(10);
      expect(missing).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('should return empty array when no gaps', () => {
      manager.setCurrentSyncId(3);
      manager.receiveSyncId(1);
      manager.receiveSyncId(2);
      manager.receiveSyncId(3);
      
      const missing = manager.getMissingSyncIds();
      expect(missing).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      manager.setCurrentSyncId(5);
      manager.receiveSyncId(1);
      manager.receiveSyncId(3);
      manager.receiveSyncId(5);
      
      const stats = manager.getStats();
      
      expect(stats.currentSyncId).toBe(5);
      expect(stats.lastReceivedSyncId).toBe(5);
      expect(stats.totalReceived).toBe(3);
      expect(stats.gapCount).toBe(2);
      expect(stats.totalMissing).toBe(2); // Missing: 2, 4
    });

    it('should handle no received IDs', () => {
      manager.setCurrentSyncId(5);
      
      const stats = manager.getStats();
      
      expect(stats.currentSyncId).toBe(5);
      expect(stats.lastReceivedSyncId).toBe(0);
      expect(stats.totalReceived).toBe(0);
      expect(stats.gapCount).toBe(1);
      expect(stats.totalMissing).toBe(5);
    });
  });

  describe('cleanup of old sync IDs', () => {
    it('should cleanup old sync IDs when threshold exceeded', () => {
      const smallManager = new SyncIdManager(0, 10);
      
      for (let i = 1; i <= 30; i++) {
        smallManager.receiveSyncId(i);
      }
      
      const stats = smallManager.getStats();
      expect(stats.totalReceived).toBeLessThanOrEqual(20);
    });
  });
});