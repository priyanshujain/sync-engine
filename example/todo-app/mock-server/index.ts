import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// Types from the sync engine
enum TransactionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE', 
  DELETE = 'DELETE',
  ARCHIVE = 'ARCHIVE',
  UNARCHIVE = 'UNARCHIVE'
}

enum DeltaAction {
  INSERT = 'I',
  UPDATE = 'U',
  ARCHIVE = 'A',
  DELETE = 'D',
  CREATE = 'C',
  GAP = 'G',
  SYNC = 'S',
  VALIDATION = 'V'
}

interface Transaction {
  id: string;
  type: TransactionType;
  modelType: string;
  modelId: string;
  timestamp: number;
  data: any;
  previousData?: any;
}

interface TransactionBatch {
  id: string;
  transactions: Transaction[];
  timestamp: number;
}

interface DeltaPacket {
  id: number;
  modelName: string;
  modelId: string;
  action: DeltaAction;
  data?: any;
  previousData?: any;
  timestamp?: number;
  userId?: string;
}

interface ClientConnection {
  ws: WebSocket;
  id: string;
  lastSyncId: number;
}

interface StoredModel {
  id: string;
  modelType: string;
  data: any;
  lastModified: number;
  syncId: number;
}

class MockSyncServer {
  private wss: WebSocketServer;
  private clients: Map<string, ClientConnection> = new Map();
  private models: Map<string, StoredModel> = new Map(); // key: modelType:modelId
  private syncIdCounter: number = 1;
  private port: number;

  constructor(port: number = 8080) {
    this.port = port;
    this.wss = new WebSocketServer({ port });
    this.setupServer();
  }

  private setupServer(): void {
    console.log(`🚀 Mock Sync Server starting on port ${this.port}`);
    
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuidv4();
      const client: ClientConnection = {
        ws,
        id: clientId,
        lastSyncId: this.syncIdCounter
      };
      
      this.clients.set(clientId, client);
      console.log(`✅ Client connected: ${clientId} (${this.clients.size} total clients)`);

      // Send initial sync status
      this.sendSyncStatus(client);

      // Send existing models to the new client
      this.sendExistingModels(client);

      ws.on('message', async (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(client, message);
        } catch (error) {
          console.error('❌ Error handling message:', error);
          this.sendError(client, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`❌ Client disconnected: ${clientId} (${this.clients.size} remaining)`);
      });

      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for client ${clientId}:`, error);
        this.clients.delete(clientId);
      });
    });

    this.wss.on('listening', () => {
      console.log(`🎯 Mock Sync Server ready on ws://localhost:${this.port}`);
      console.log('📝 Ready to handle transaction batches and broadcast deltas');
    });
  }

  private async handleMessage(client: ClientConnection, message: any): Promise<void> {
    console.log(`📨 Message from ${client.id}:`, message.type);

    switch (message.type) {
      case 'transaction_batch':
        await this.handleTransactionBatch(client, message.batch);
        break;
      case 'sync_status_request':
        this.sendSyncStatus(client);
        break;
      case 'ping':
        this.send(client, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        console.warn(`⚠️ Unknown message type: ${message.type}`);
    }
  }

  private async handleTransactionBatch(client: ClientConnection, batch: TransactionBatch): Promise<void> {
    console.log(`🔄 Processing batch ${batch.id} with ${batch.transactions.length} transactions`);
    
    const deltaPackets: DeltaPacket[] = [];
    const processedTransactions: string[] = [];

    for (const transaction of batch.transactions) {
      try {
        const delta = await this.processTransaction(transaction);
        if (delta) {
          deltaPackets.push(delta);
          processedTransactions.push(transaction.id);
        }
      } catch (error) {
        console.error(`❌ Error processing transaction ${transaction.id}:`, error);
        this.sendTransactionError(client, transaction.id, error.message);
      }
    }

    // Send acknowledgments for successfully processed transactions
    for (const transactionId of processedTransactions) {
      this.sendTransactionAck(client, transactionId, this.syncIdCounter);
    }

    // Broadcast delta packets to all clients
    if (deltaPackets.length > 0) {
      this.broadcastDeltas(deltaPackets, client.id);
    }
  }

  private async processTransaction(transaction: Transaction): Promise<DeltaPacket | null> {
    const modelKey = `${transaction.modelType}:${transaction.modelId}`;
    const syncId = ++this.syncIdCounter;
    
    console.log(`⚡ Processing ${transaction.type} for ${transaction.modelType}:${transaction.modelId}`);

    let delta: DeltaPacket | null = null;

    switch (transaction.type) {
      case TransactionType.CREATE:
        if (!this.models.has(modelKey)) {
          this.models.set(modelKey, {
            id: transaction.modelId,
            modelType: transaction.modelType,
            data: transaction.data,
            lastModified: Date.now(),
            syncId
          });
          
          delta = {
            id: syncId,
            modelName: transaction.modelType,
            modelId: transaction.modelId,
            action: DeltaAction.CREATE,
            data: transaction.data,
            timestamp: Date.now()
          };
        }
        break;

      case TransactionType.UPDATE:
        const existingModel = this.models.get(modelKey);
        if (existingModel) {
          // Simple last-write-wins conflict resolution
          const previousData = { ...existingModel.data };
          existingModel.data = { ...existingModel.data, ...transaction.data };
          existingModel.lastModified = Date.now();
          existingModel.syncId = syncId;
          
          delta = {
            id: syncId,
            modelName: transaction.modelType,
            modelId: transaction.modelId,
            action: DeltaAction.UPDATE,
            data: existingModel.data,
            previousData,
            timestamp: Date.now()
          };
        } else {
          // Model doesn't exist, treat UPDATE as CREATE for new models
          console.log(`📝 UPDATE on non-existent model, treating as CREATE: ${transaction.modelType}:${transaction.modelId}`);
          this.models.set(modelKey, {
            id: transaction.modelId,
            modelType: transaction.modelType,
            data: transaction.data,
            lastModified: Date.now(),
            syncId
          });
          
          delta = {
            id: syncId,
            modelName: transaction.modelType,
            modelId: transaction.modelId,
            action: DeltaAction.CREATE,
            data: transaction.data,
            timestamp: Date.now()
          };
        }
        break;

      case TransactionType.DELETE:
        const modelToDelete = this.models.get(modelKey);
        if (modelToDelete) {
          const previousData = { ...modelToDelete.data };
          this.models.delete(modelKey);
          
          delta = {
            id: syncId,
            modelName: transaction.modelType,
            modelId: transaction.modelId,
            action: DeltaAction.DELETE,
            previousData,
            timestamp: Date.now()
          };
        }
        break;

      case TransactionType.ARCHIVE:
        const modelToArchive = this.models.get(modelKey);
        if (modelToArchive) {
          modelToArchive.data._isArchived = true;
          modelToArchive.lastModified = Date.now();
          modelToArchive.syncId = syncId;
          
          delta = {
            id: syncId,
            modelName: transaction.modelType,
            modelId: transaction.modelId,
            action: DeltaAction.ARCHIVE,
            data: modelToArchive.data,
            timestamp: Date.now()
          };
        }
        break;
    }

    return delta;
  }

  private sendExistingModels(client: ClientConnection): void {
    const deltaPackets: DeltaPacket[] = [];
    
    for (const model of this.models.values()) {
      if (!model.data._isDeleted && !model.data._isArchived) {
        deltaPackets.push({
          id: model.syncId,
          modelName: model.modelType,
          modelId: model.id,
          action: DeltaAction.CREATE,
          data: model.data,
          timestamp: model.lastModified
        });
      }
    }

    if (deltaPackets.length > 0) {
      console.log(`📤 Sending ${deltaPackets.length} existing models to client ${client.id}`);
      this.send(client, {
        type: 'delta_batch',
        batch: {
          packets: deltaPackets,
          startSyncId: Math.min(...deltaPackets.map(d => d.id)),
          endSyncId: Math.max(...deltaPackets.map(d => d.id)),
          timestamp: Date.now()
        }
      });
    }
  }

  private broadcastDeltas(deltaPackets: DeltaPacket[], excludeClientId?: string): void {
    console.log(`📡 Broadcasting ${deltaPackets.length} deltas to ${this.clients.size} clients`);
    
    const message = {
      type: 'delta_batch',
      batch: {
        packets: deltaPackets,
        startSyncId: Math.min(...deltaPackets.map(d => d.id)),
        endSyncId: Math.max(...deltaPackets.map(d => d.id)),
        timestamp: Date.now()
      }
    };

    this.clients.forEach((client) => {
      if (client.id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        this.send(client, message);
      }
    });
  }

  private sendSyncStatus(client: ClientConnection): void {
    this.send(client, {
      type: 'sync_status',
      syncId: this.syncIdCounter,
      timestamp: Date.now()
    });
  }

  private sendTransactionAck(client: ClientConnection, transactionId: string, syncId: number): void {
    this.send(client, {
      type: 'transaction_ack',
      transactionId,
      syncId,
      timestamp: Date.now()
    });
  }

  private sendTransactionError(client: ClientConnection, transactionId: string, error: string): void {
    this.send(client, {
      type: 'transaction_error',
      transactionId,
      error,
      timestamp: Date.now()
    });
  }

  private sendError(client: ClientConnection, error: string): void {
    this.send(client, {
      type: 'error',
      error,
      timestamp: Date.now()
    });
  }

  private send(client: ClientConnection, message: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  public getStats(): any {
    return {
      connectedClients: this.clients.size,
      totalModels: this.models.size,
      currentSyncId: this.syncIdCounter,
      modelsByType: this.getModelStats()
    };
  }

  private getModelStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const model of this.models.values()) {
      stats[model.modelType] = (stats[model.modelType] || 0) + 1;
    }
    return stats;
  }

  public printStats(): void {
    const stats = this.getStats();
    console.log('\n📊 Server Stats:');
    console.log(`  Connected Clients: ${stats.connectedClients}`);
    console.log(`  Total Models: ${stats.totalModels}`);
    console.log(`  Current Sync ID: ${stats.currentSyncId}`);
    console.log('  Models by Type:', stats.modelsByType);
    console.log('');
  }
}

// Start the server
const server = new MockSyncServer(8080);

// Print stats every 30 seconds
setInterval(() => {
  server.printStats();
}, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Mock Sync Server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down Mock Sync Server...');
  process.exit(0);
});

export { MockSyncServer };