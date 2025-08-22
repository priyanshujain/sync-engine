import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// Types for HashSyncEngine protocol

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

      // Client will request sync state via sync_state_request message

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
      console.log('📝 Ready to handle HashSyncEngine protocol messages');
    });
  }

  private async handleMessage(client: ClientConnection, message: any): Promise<void> {
    console.log(`📨 Message from ${client.id}:`, message.type);

    switch (message.type) {
      // HashSyncEngine protocol
      case 'sync_delta':
        await this.handleSyncDelta(client, message);
        break;
      case 'version_check':
        this.handleVersionCheck(client, message);
        break;
      case 'sync_state_request':
        console.log(`📋 Sync state request from ${client.id}:`, JSON.stringify(message, null, 2));
        this.sendSyncState(client, message);
        break;
      case 'heartbeat':
        // Client heartbeat - no response needed
        break;
        
      default:
        console.warn(`⚠️ Unknown message type: ${message.type}`);
    }
  }

  // HashSyncEngine protocol handlers
  private async handleSyncDelta(client: ClientConnection, message: any): Promise<void> {
    const delta = message.delta;
    console.log(`🔄 Processing sync delta from ${client.id}:`, delta?.records?.length || 0, 'records');
    
    if (!delta || !delta.records || !Array.isArray(delta.records)) {
      console.warn('⚠️ Invalid sync delta format - no delta.records array');
      return;
    }

    const processedRecords: any[] = [];
    
    for (const record of delta.records) {
      try {
        const result = await this.processSyncRecord(record);
        if (result) {
          processedRecords.push(result);
        }
      } catch (error) {
        console.error(`❌ Error processing sync record:`, error);
      }
    }

    // Send acknowledgment back to client with the original sync record IDs
    const processedRecordIds = processedRecords.map(record => record.originalSyncRecordId);
    this.send(client, {
      type: 'sync_ack',
      deltaId: delta.id,
      recordIds: processedRecordIds,
      timestamp: Date.now()
    });

    // Broadcast changes to other clients
    if (processedRecords.length > 0) {
      this.broadcastSyncRecords(processedRecords, client.id);
    }
  }

  private async processSyncRecord(record: any): Promise<any> {
    const modelKey = `${record.modelName}:${record.modelId}`;
    const syncId = ++this.syncIdCounter;
    
    console.log(`⚡ Processing ${record.operation} for ${record.modelName}:${record.modelId}`);

    switch (record.operation) {
      case 'create':
        if (!this.models.has(modelKey)) {
          this.models.set(modelKey, {
            id: record.modelId,
            modelType: record.modelName,
            data: record.data,
            lastModified: Date.now(),
            syncId
          });
          return { ...record, syncId, processed: true, originalSyncRecordId: record.id };
        }
        break;

      case 'update':
        const existingModel = this.models.get(modelKey);
        if (existingModel) {
          existingModel.data = { ...existingModel.data, ...record.data };
          existingModel.lastModified = Date.now();
          existingModel.syncId = syncId;
          return { ...record, syncId, processed: true, originalSyncRecordId: record.id };
        }
        break;

      case 'delete':
        if (this.models.has(modelKey)) {
          this.models.delete(modelKey);
          return { ...record, syncId, processed: true, originalSyncRecordId: record.id };
        }
        break;
    }

    return null;
  }

  private broadcastSyncRecords(records: any[], excludeClientId?: string): void {
    console.log(`📡 Broadcasting ${records.length} sync records to ${this.clients.size} clients`);
    
    const message = {
      type: 'sync_delta',
      delta: {
        id: `broadcast-${Date.now()}`,
        records,
        timestamp: Date.now(),
        clientId: 'server',
        schemaHash: 'mock-schema-hash',
        fromVersion: this.syncIdCounter - records.length,
        toVersion: this.syncIdCounter
      }
    };

    this.clients.forEach((client) => {
      if (client.id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        this.send(client, message);
      }
    });
  }

  private handleVersionCheck(client: ClientConnection, message: any): void {
    // HashSyncEngine doesn't expect a response to version_check - it's just informational
    // The real sync happens through sync_state_request/response cycle
    console.log(`📋 Version check from ${client.id}:`, message.localVersion || 'unknown');
  }

  private sendSyncState(client: ClientConnection, request?: any): void {
    // Convert models to sync records and send as sync_state_response
    const existingRecords: any[] = [];
    
    for (const model of this.models.values()) {
      existingRecords.push({
        id: `${model.modelType}:${model.id}:${model.lastModified}`,
        modelName: model.modelType,
        modelId: model.id,
        operation: 'create',
        data: model.data,
        version: model.syncId,
        timestamp: model.lastModified,
        clientId: 'server',
        hash: 'mock-hash'
      });
    }

    // Use client's schema hash if provided, otherwise use default
    const clientSchemaHash = request?.schemaHash || 'mock-schema-hash';
    
    // Send a sync_state_response with proper format - use client's schema hash
    this.send(client, {
      type: 'sync_state_response',
      state: {
        serverVersion: this.syncIdCounter,
        schemaHash: clientSchemaHash,
        lastDeltaId: null,
        supportedSchemaVersions: [clientSchemaHash, 'mock-schema-hash']
      }
    });
    
    // If there are existing records, send them as a sync_delta
    if (existingRecords.length > 0) {
      this.send(client, {
        type: 'sync_delta',
        delta: {
          id: `server-initial-${Date.now()}`,
          records: existingRecords,
          timestamp: Date.now(),
          clientId: 'server',
          schemaHash: 'mock-schema-hash',
          fromVersion: 0,
          toVersion: this.syncIdCounter
        }
      });
    }
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