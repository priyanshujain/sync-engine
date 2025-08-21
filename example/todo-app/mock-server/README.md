# Mock WebSocket Server for Sync Engine Demo

This is a mock WebSocket server that simulates a real sync engine backend for testing multi-client synchronization.

## Features

- **WebSocket Server**: Handles multiple simultaneous client connections
- **Transaction Processing**: Processes CREATE, UPDATE, DELETE, and ARCHIVE transactions
- **Delta Broadcasting**: Sends changes to all connected clients in real-time
- **Conflict Resolution**: Uses simple last-write-wins strategy
- **In-Memory Storage**: Maintains todos in memory with sync ID tracking
- **Connection Management**: Handles client connect/disconnect gracefully

## Message Types

### From Client to Server
- `transaction_batch`: Batch of transactions to process
- `sync_status_request`: Request current sync status
- `ping`: Heartbeat ping

### From Server to Client  
- `delta_batch`: Batch of delta packets with changes
- `transaction_ack`: Transaction successfully processed
- `transaction_error`: Transaction failed to process
- `sync_status`: Current sync ID status
- `pong`: Heartbeat response

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Server Stats

The server logs stats every 30 seconds showing:
- Connected clients count
- Total models in memory
- Current sync ID counter
- Models breakdown by type

## Testing Multi-Client Sync

1. Start the mock server
2. Start the todo app client
3. Open multiple browser tabs with the todo app
4. Create/edit/delete todos in one tab
5. Watch them sync in real-time across all tabs

The server handles the complexity of:
- Assigning monotonic sync IDs
- Broadcasting deltas to all clients except sender
- Managing model state with conflict resolution
- Handling client reconnections