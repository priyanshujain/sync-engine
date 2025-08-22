/**
 * Resource Manager for proper cleanup of timers, connections, and event listeners
 * Prevents memory leaks by ensuring all resources are properly disposed
 */

export interface IDisposable {
  dispose(): void | Promise<void>;
}

export class DisposableResource implements IDisposable {
  private isDisposed = false;
  private disposeCallback: () => void | Promise<void>;

  constructor(disposeCallback: () => void | Promise<void>) {
    this.disposeCallback = disposeCallback;
  }

  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    
    this.isDisposed = true;
    await this.disposeCallback();
  }
}

export class ResourceManager implements IDisposable {
  private resources: Set<IDisposable> = new Set();
  private timers: Set<NodeJS.Timeout | number> = new Set();
  private eventListeners: Array<{
    target: EventTarget;
    event: string;
    listener: EventListener;
  }> = [];
  private abortControllers: Set<AbortController> = new Set();
  private isDisposed = false;

  /**
   * Add a disposable resource to be managed
   */
  add<T extends IDisposable>(resource: T): T {
    if (this.isDisposed) {
      throw new Error('Cannot add resource to disposed ResourceManager');
    }
    this.resources.add(resource);
    return resource;
  }

  /**
   * Create and manage a timer (setTimeout)
   */
  setTimeout(callback: () => void, delay: number): NodeJS.Timeout | number {
    if (this.isDisposed) {
      throw new Error('Cannot create timer on disposed ResourceManager');
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);

    this.timers.add(timer);
    
    // Prevent timer from keeping process alive in Node.js
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    
    return timer;
  }

  /**
   * Create and manage an interval (setInterval)
   */
  setInterval(callback: () => void, interval: number): NodeJS.Timeout | number {
    if (this.isDisposed) {
      throw new Error('Cannot create interval on disposed ResourceManager');
    }

    const timer = setInterval(callback, interval);
    this.timers.add(timer);
    
    // Prevent timer from keeping process alive in Node.js
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    
    return timer;
  }

  /**
   * Clear a specific timer
   */
  clearTimer(timer: NodeJS.Timeout | number): void {
    if (this.timers.has(timer)) {
      clearTimeout(timer as any);
      clearInterval(timer as any);
      this.timers.delete(timer);
    }
  }

  /**
   * Add an event listener that will be automatically removed on disposal
   */
  addEventListener(
    target: EventTarget,
    event: string,
    listener: EventListener,
    options?: AddEventListenerOptions
  ): void {
    if (this.isDisposed) {
      throw new Error('Cannot add event listener on disposed ResourceManager');
    }

    target.addEventListener(event, listener, options);
    this.eventListeners.push({ target, event, listener });
  }

  /**
   * Create an AbortController that will be automatically aborted on disposal
   */
  createAbortController(): AbortController {
    if (this.isDisposed) {
      throw new Error('Cannot create AbortController on disposed ResourceManager');
    }

    const controller = new AbortController();
    this.abortControllers.add(controller);
    return controller;
  }

  /**
   * Execute a function with automatic resource cleanup
   */
  static async using<T>(
    fn: (manager: ResourceManager) => T | Promise<T>
  ): Promise<T> {
    const manager = new ResourceManager();
    try {
      return await fn(manager);
    } finally {
      await manager.dispose();
    }
  }

  /**
   * Dispose all managed resources
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;

    // Clear all timers
    for (const timer of this.timers) {
      clearTimeout(timer as any);
      clearInterval(timer as any);
    }
    this.timers.clear();

    // Remove all event listeners
    for (const { target, event, listener } of this.eventListeners) {
      target.removeEventListener(event, listener);
    }
    this.eventListeners = [];

    // Abort all controllers
    for (const controller of this.abortControllers) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
    this.abortControllers.clear();

    // Dispose all managed resources
    const disposePromises: Promise<void>[] = [];
    for (const resource of this.resources) {
      const result = resource.dispose();
      if (result instanceof Promise) {
        disposePromises.push(result);
      }
    }
    
    await Promise.all(disposePromises);
    this.resources.clear();
  }

  /**
   * Check if the manager has been disposed
   */
  get disposed(): boolean {
    return this.isDisposed;
  }
}

/**
 * Decorator to automatically manage resources in a class
 */
export function Disposable(target: any) {
  return class extends target {
    protected resourceManager = new ResourceManager();

    async dispose(): Promise<void> {
      await this.resourceManager.dispose();
      if (super.dispose) {
        await super.dispose();
      }
    }
  };
}

/**
 * Create a disposable WebSocket connection
 */
export class ManagedWebSocket extends DisposableResource {
  private ws: WebSocket;
  private reconnectTimer?: NodeJS.Timeout | number;
  private heartbeatTimer?: NodeJS.Timeout | number;
  private resourceManager: ResourceManager;

  constructor(
    url: string,
    private options: {
      onOpen?: () => void;
      onMessage?: (event: MessageEvent) => void;
      onClose?: () => void;
      onError?: (error: Event) => void;
      reconnectDelay?: number;
      heartbeatInterval?: number;
    } = {}
  ) {
    const resourceManager = new ResourceManager();
    
    super(async () => {
      await this.cleanup();
    });

    this.resourceManager = resourceManager;
    this.ws = this.createWebSocket(url);
  }

  private createWebSocket(url: string): WebSocket {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      this.options.onOpen?.();
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      this.options.onMessage?.(event);
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.options.onClose?.();
      
      if (this.options.reconnectDelay && this.options.reconnectDelay > 0) {
        this.scheduleReconnect(url);
      }
    };

    ws.onerror = (error) => {
      this.options.onError?.(error);
    };

    return ws;
  }

  private startHeartbeat(): void {
    if (this.options.heartbeatInterval && this.options.heartbeatInterval > 0) {
      this.heartbeatTimer = this.resourceManager.setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, this.options.heartbeatInterval);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.resourceManager.clearTimer(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = this.resourceManager.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.ws.readyState !== WebSocket.OPEN) {
        this.ws = this.createWebSocket(url);
      }
    }, this.options.reconnectDelay || 5000);
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  close(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      this.resourceManager.clearTimer(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  private async cleanup(): Promise<void> {
    this.close();
    await this.resourceManager.dispose();
  }

  get readyState(): number {
    return this.ws.readyState;
  }
}