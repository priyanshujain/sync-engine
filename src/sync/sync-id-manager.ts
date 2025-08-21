export interface SyncGap {
  start: number;
  end: number;
}

export class SyncIdManager {
  private currentSyncId: number = 0;
  private lastReceivedSyncId: number = 0;
  private receivedSyncIds: Set<number> = new Set();
  private maxGapSize: number;
  private gapDetectionEnabled: boolean;

  constructor(
    initialSyncId: number = 0,
    maxGapSize: number = 1000,
    gapDetectionEnabled: boolean = true
  ) {
    this.currentSyncId = initialSyncId;
    this.lastReceivedSyncId = initialSyncId;
    this.maxGapSize = maxGapSize;
    this.gapDetectionEnabled = gapDetectionEnabled;
  }

  getCurrentSyncId(): number {
    return this.currentSyncId;
  }

  getLastReceivedSyncId(): number {
    return this.lastReceivedSyncId;
  }

  setCurrentSyncId(syncId: number): void {
    if (syncId < this.currentSyncId) {
      throw new Error(`Cannot set sync ID to ${syncId}, current is ${this.currentSyncId}`);
    }
    this.currentSyncId = syncId;
  }

  receiveSyncId(syncId: number): void {
    this.receivedSyncIds.add(syncId);
    
    if (syncId > this.lastReceivedSyncId) {
      this.lastReceivedSyncId = syncId;
    }

    if (this.gapDetectionEnabled) {
      this.cleanupOldSyncIds();
    }
  }

  detectGaps(): SyncGap[] {
    if (!this.gapDetectionEnabled) {
      return [];
    }

    const gaps: SyncGap[] = [];
    const sortedIds = Array.from(this.receivedSyncIds).sort((a, b) => a - b);
    
    if (sortedIds.length === 0) {
      if (this.currentSyncId > 0) {
        return [{ start: 1, end: this.currentSyncId }];
      }
      return [];
    }

    if (sortedIds[0] > this.currentSyncId + 1) {
      gaps.push({ start: this.currentSyncId + 1, end: sortedIds[0] - 1 });
    }

    for (let i = 0; i < sortedIds.length - 1; i++) {
      const current = sortedIds[i];
      const next = sortedIds[i + 1];
      
      if (next - current > 1) {
        gaps.push({ start: current + 1, end: next - 1 });
      }
    }

    return gaps;
  }

  hasGaps(): boolean {
    return this.detectGaps().length > 0;
  }

  isInSync(): boolean {
    if (!this.gapDetectionEnabled) {
      return true;
    }
    
    return !this.hasGaps() && this.currentSyncId === this.lastReceivedSyncId;
  }

  reset(newSyncId: number = 0): void {
    this.currentSyncId = newSyncId;
    this.lastReceivedSyncId = newSyncId;
    this.receivedSyncIds.clear();
  }

  getNextSyncId(): number {
    return this.currentSyncId + 1;
  }

  incrementSyncId(): number {
    this.currentSyncId++;
    return this.currentSyncId;
  }

  private cleanupOldSyncIds(): void {
    if (this.receivedSyncIds.size > this.maxGapSize * 2) {
      const sortedIds = Array.from(this.receivedSyncIds).sort((a, b) => a - b);
      const cutoff = sortedIds[sortedIds.length - this.maxGapSize];
      
      this.receivedSyncIds = new Set(
        sortedIds.filter(id => id >= cutoff)
      );
    }
  }

  getMissingSyncIds(maxCount: number = 100): number[] {
    const gaps = this.detectGaps();
    const missing: number[] = [];
    
    for (const gap of gaps) {
      for (let id = gap.start; id <= gap.end && missing.length < maxCount; id++) {
        missing.push(id);
      }
      
      if (missing.length >= maxCount) {
        break;
      }
    }
    
    return missing;
  }

  getStats(): {
    currentSyncId: number;
    lastReceivedSyncId: number;
    totalReceived: number;
    gapCount: number;
    totalMissing: number;
  } {
    const gaps = this.detectGaps();
    const totalMissing = gaps.reduce((sum, gap) => sum + (gap.end - gap.start + 1), 0);
    
    return {
      currentSyncId: this.currentSyncId,
      lastReceivedSyncId: this.lastReceivedSyncId,
      totalReceived: this.receivedSyncIds.size,
      gapCount: gaps.length,
      totalMissing,
    };
  }
}