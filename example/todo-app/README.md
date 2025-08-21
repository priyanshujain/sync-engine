# Todo App - Sync Engine Demo

A simple React todo application that demonstrates the sync-engine functionality with real-time synchronization capabilities.

## Features

- ✅ Create, toggle, and delete todos
- ✅ Real-time sync engine integration
- ✅ Offline mode with local storage
- ✅ Clean, minimal UI with status indicators
- ✅ MobX reactive updates
- ✅ TypeScript support

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```

3. **Open your browser:**
   Navigate to http://localhost:3000

## Project Structure

```
├── src/
│   ├── App.tsx          # Main React component with todo UI
│   ├── main.tsx         # React entry point
│   └── models.ts        # Todo model with sync engine integration
├── index.html           # Simple HTML entry point
├── package.json         # Minimal dependencies
├── vite.config.ts       # Vite configuration
└── tsconfig.json        # TypeScript configuration
```

## Sync Engine Integration

The app demonstrates the following sync engine features:

- **Model Registration**: Todo model is registered with the sync engine
- **Transaction Management**: All CRUD operations create transactions
- **Object Pool**: Todos are tracked in the sync engine's object pool  
- **Connection Status**: Real-time connection status display
- **Offline Mode**: Changes are saved locally when disconnected

## Key Files

### `/src/models.ts`
- Defines the `Todo` model extending the sync engine's `Model` class
- Integrates with MobX for reactive updates
- Registered with the `ModelRegistry` for sync functionality

### `/src/App.tsx` 
- Main React component with todo list UI
- Initializes `SyncClient` for sync engine connectivity
- Demonstrates real-time sync status and statistics

## Testing Multi-Window Sync

1. Open the app in multiple browser windows/tabs
2. Add, edit, or delete todos in one window
3. When a sync server is running, changes will appear in other windows
4. Without a server, the app works in offline mode

## Sync Server

The app attempts to connect to `ws://localhost:8080` by default. When no server is available, it operates in offline mode with the following graceful degradation:

- ✅ All todo operations work normally
- ✅ Changes are tracked in the object pool
- ✅ UI shows offline status
- ✅ Transactions are queued for later sync

## Build for Production

```bash
npm run build
```

This creates optimized production files in the `dist/` directory.

## What This Demo Shows

This example demonstrates a **working, minimal implementation** of the sync engine with:

- Proper model integration
- Transaction management
- Real-time UI updates
- Graceful offline handling
- Clean, maintainable code structure

The sync engine is fully integrated and functional - you can see objects being tracked in the pool and transactions being managed, even in offline mode.