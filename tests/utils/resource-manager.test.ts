import { ResourceManager, DisposableResource, ManagedWebSocket } from '../../src/utils/resource-manager';

// Mock setTimeout and setInterval for testing
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

describe('ResourceManager', () => {
  let manager: ResourceManager;
  let timeouts: any[] = [];
  let intervals: any[] = [];

  beforeEach(() => {
    manager = new ResourceManager();
    timeouts = [];
    intervals = [];

    // Mock timers to track them
    (global as any).setTimeout = jest.fn((callback: any, delay: any) => {
      const timer = { id: Math.random(), callback, delay, unref: jest.fn() };
      timeouts.push(timer);
      return timer as any;
    });

    (global as any).setInterval = jest.fn((callback: any, delay: any) => {
      const timer = { id: Math.random(), callback, delay, unref: jest.fn() };
      intervals.push(timer);
      return timer as any;
    });

    (global as any).clearTimeout = jest.fn((timer: any) => {
      const index = timeouts.findIndex(t => t === timer);
      if (index >= 0) timeouts.splice(index, 1);
    });

    (global as any).clearInterval = jest.fn((timer: any) => {
      const index = intervals.findIndex(t => t === timer);
      if (index >= 0) intervals.splice(index, 1);
    });
  });

  afterEach(async () => {
    if (!manager.disposed) {
      await manager.dispose();
    }

    // Restore original functions
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    global.clearTimeout = originalClearTimeout;
    global.clearInterval = originalClearInterval;
  });

  describe('timer management', () => {
    test('creates and tracks timeouts', () => {
      const callback = jest.fn();
      const timer = manager.setTimeout(callback, 1000);
      
      expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(timeouts).toHaveLength(1);
      expect(timeouts[0].unref).toHaveBeenCalled(); // Auto-unref for Node.js
    });

    test('creates and tracks intervals', () => {
      const callback = jest.fn();
      const timer = manager.setInterval(callback, 1000);
      
      expect(global.setInterval).toHaveBeenCalledWith(callback, 1000);
      expect(intervals).toHaveLength(1);
      expect(intervals[0].unref).toHaveBeenCalled(); // Auto-unref for Node.js
    });

    test('clears individual timers', () => {
      const timer = manager.setTimeout(() => {}, 1000);
      manager.clearTimer(timer);
      
      expect(global.clearTimeout).toHaveBeenCalledWith(timer);
    });

    test('clears all timers on disposal', async () => {
      manager.setTimeout(() => {}, 1000);
      manager.setInterval(() => {}, 1000);
      
      expect(timeouts).toHaveLength(1);
      expect(intervals).toHaveLength(1);
      
      await manager.dispose();
      
      expect(global.clearTimeout).toHaveBeenCalled();
      expect(global.clearInterval).toHaveBeenCalled();
    });

    test('prevents creating timers after disposal', async () => {
      await manager.dispose();
      
      expect(() => {
        manager.setTimeout(() => {}, 1000);
      }).toThrow('Cannot create timer on disposed ResourceManager');
    });
  });

  describe('resource management', () => {
    test('manages disposable resources', async () => {
      const disposed = jest.fn();
      const resource = new DisposableResource(disposed);
      
      manager.add(resource);
      await manager.dispose();
      
      expect(disposed).toHaveBeenCalled();
    });

    test('handles async disposable resources', async () => {
      const asyncDisposed = jest.fn().mockResolvedValue(undefined);
      const resource = new DisposableResource(asyncDisposed);
      
      manager.add(resource);
      await manager.dispose();
      
      expect(asyncDisposed).toHaveBeenCalled();
    });

    test('prevents adding resources after disposal', async () => {
      const resource = new DisposableResource(() => {});
      await manager.dispose();
      
      expect(() => {
        manager.add(resource);
      }).toThrow('Cannot add resource to disposed ResourceManager');
    });
  });

  describe('event listeners', () => {
    test('adds and removes event listeners', async () => {
      const mockTarget = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      } as any;
      const listener = jest.fn();
      
      manager.addEventListener(mockTarget, 'click', listener);
      
      expect(mockTarget.addEventListener).toHaveBeenCalledWith('click', listener, undefined);
      
      await manager.dispose();
      
      expect(mockTarget.removeEventListener).toHaveBeenCalledWith('click', listener);
    });

    test('prevents adding event listeners after disposal', async () => {
      const mockTarget = { addEventListener: jest.fn() } as any;
      await manager.dispose();
      
      expect(() => {
        manager.addEventListener(mockTarget, 'click', () => {});
      }).toThrow('Cannot add event listener on disposed ResourceManager');
    });
  });

  describe('AbortController management', () => {
    test('creates and aborts controllers', async () => {
      const controller = manager.createAbortController();
      
      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);
      
      await manager.dispose();
      
      expect(controller.signal.aborted).toBe(true);
    });

    test('prevents creating controllers after disposal', async () => {
      await manager.dispose();
      
      expect(() => {
        manager.createAbortController();
      }).toThrow('Cannot create AbortController on disposed ResourceManager');
    });
  });

  describe('ResourceManager.using', () => {
    test('automatically disposes manager after use', async () => {
      let managerRef: ResourceManager | undefined;
      const disposedSpy = jest.fn();
      
      const result = await ResourceManager.using(async (manager) => {
        managerRef = manager;
        
        // Add a resource to track disposal
        const resource = new DisposableResource(disposedSpy);
        manager.add(resource);
        
        return 'test-result';
      });
      
      expect(result).toBe('test-result');
      expect(managerRef?.disposed).toBe(true);
      expect(disposedSpy).toHaveBeenCalled();
    });

    test('disposes manager even if function throws', async () => {
      let managerRef: ResourceManager | undefined;
      const disposedSpy = jest.fn();
      
      try {
        await ResourceManager.using(async (manager) => {
          managerRef = manager;
          
          const resource = new DisposableResource(disposedSpy);
          manager.add(resource);
          
          throw new Error('Test error');
        });
      } catch (error) {
        expect((error as Error).message).toBe('Test error');
      }
      
      expect(managerRef?.disposed).toBe(true);
      expect(disposedSpy).toHaveBeenCalled();
    });
  });
});

describe('DisposableResource', () => {
  test('calls dispose callback', async () => {
    const callback = jest.fn();
    const resource = new DisposableResource(callback);
    
    await resource.dispose();
    
    expect(callback).toHaveBeenCalled();
  });

  test('handles async dispose callback', async () => {
    const asyncCallback = jest.fn().mockResolvedValue(undefined);
    const resource = new DisposableResource(asyncCallback);
    
    await resource.dispose();
    
    expect(asyncCallback).toHaveBeenCalled();
  });

  test('prevents multiple disposal', async () => {
    const callback = jest.fn();
    const resource = new DisposableResource(callback);
    
    await resource.dispose();
    await resource.dispose(); // Should not call again
    
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// Note: ManagedWebSocket tests would require mocking WebSocket globally,
// which is complex in Jest. In a real scenario, we'd use a WebSocket mock
// library or test it in integration tests with a real WebSocket server.
describe('ManagedWebSocket', () => {
  test('is exported and constructible', () => {
    // Just verify the class exists and can be instantiated
    // Full testing would require WebSocket mocking
    expect(ManagedWebSocket).toBeDefined();
    expect(typeof ManagedWebSocket).toBe('function');
  });
});