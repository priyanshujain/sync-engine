import React, { useState, useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { HashSyncEngine, HashSyncStatus } from '../../../src/sync/hash-sync-engine'
import { IndexedDBStore } from '../../../src/storage/indexed-db-store'
import { Todo } from './models'

const store = new IndexedDBStore()
const syncClient = new HashSyncEngine(store, {
  serverUrl: 'ws://localhost:8080',
  clientId: `todo-client-${Date.now()}`,
})

// Set up the models with the store and sync engine
Todo.setStore(store)
Todo.setSyncEngine(syncClient)

const App = observer(() => {
  const [newTodoText, setNewTodoText] = useState('')
  const [todos, setTodos] = useState<Todo[]>([])

  useEffect(() => {
    const initializeSync = async () => {
      try {
        // Initialize store first with Todo model metadata
        await store.initialize([{
          name: 'Todo',
          loadStrategy: 'full',
          schemaVersion: 1,
          properties: new Map()
        }])
        
        // Initialize sync engine
        await syncClient.initialize()
        
        // Try to connect to sync server (will fail gracefully if no server)
        syncClient.connect().catch(console.warn)
        
        // Load existing todos from storage
        const existingTodos = await Todo.loadAll()
        setTodos(existingTodos.filter((todo: Todo) => !todo._isDeleted))
      } catch (error) {
        console.warn('Failed to initialize sync client:', error)
      }
    }
    
    initializeSync()
    
    // Set up periodic updates to reflect sync changes
    const interval = setInterval(async () => {
      try {
        const allTodos = await Todo.loadAll()
        setTodos(allTodos.filter((todo: Todo) => !todo._isDeleted))
      } catch (error) {
        console.warn('Failed to update todos:', error)
      }
    }, 1000)
    
    return () => {
      clearInterval(interval)
      syncClient.disconnect()
    }
  }, [])

  const addTodo = async () => {
    if (!newTodoText.trim()) return
    
    const todo = new Todo(undefined, { text: newTodoText.trim() })
    setTodos(prev => [...prev, todo])
    setNewTodoText('')
    
    await todo.save()
  }

  const toggleTodo = async (todo: Todo) => {
    todo.toggle()
    await todo.save()
  }

  const deleteTodo = async (todo: Todo) => {
    setTodos(prev => prev.filter(t => t.id !== todo.id))
    await todo.delete()
  }

  const getStatusClass = () => {
    switch (syncClient.status) {
      case HashSyncStatus.CONNECTED: return 'connected'
      case HashSyncStatus.CONNECTING: return 'connecting'
      case HashSyncStatus.SYNCING: return 'connecting'
      default: return 'disconnected'
    }
  }

  const getStatusText = () => {
    switch (syncClient.status) {
      case HashSyncStatus.CONNECTED: return 'Connected to sync server'
      case HashSyncStatus.CONNECTING: return 'Connecting to sync server...'
      case HashSyncStatus.SYNCING: return 'Syncing...'
      case HashSyncStatus.ERROR: return `Sync error: ${syncClient.lastError?.message || 'Unknown error'}`
      default: return 'Offline mode (changes saved locally)'
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addTodo()
    }
  }

  const stats = {
    objectPoolSize: todos.length,
    pendingTransactions: syncClient.pendingSyncRecords,
    completedTransactions: 0
  }

  return (
    <div className="container">
      <h1>Todo App - Sync Engine Demo</h1>
      
      <div className={`sync-status ${getStatusClass()}`}>
        {getStatusText()}
        {stats.objectPoolSize > 0 && (
          <div style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Objects in pool: {stats.objectPoolSize} | 
            Pending: {stats.pendingTransactions} | 
            Completed: {stats.completedTransactions}
          </div>
        )}
      </div>

      <div className="add-todo">
        <input
          type="text"
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Add a new todo..."
        />
        <button onClick={addTodo}>Add Todo</button>
      </div>

      <ul className="todo-list">
        {todos.map((todo) => (
          <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo)}
            />
            <span style={{ flex: 1 }}>{todo.text}</span>
            <button className="delete-btn" onClick={() => deleteTodo(todo)}>
              Delete
            </button>
          </li>
        ))}
        {todos.length === 0 && (
          <li style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
            No todos yet. Add one above!
          </li>
        )}
      </ul>

      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f8f9fa', borderRadius: '4px' }}>
        <h3>Sync Engine Demo Instructions:</h3>
        <ol>
          <li>Add some todos above</li>
          <li>Open this app in another browser window/tab</li>
          <li>Changes should sync between windows (when server is running)</li>
          <li>Try going offline - changes are saved locally and will sync when reconnected</li>
        </ol>
        
        <p><strong>Current Status:</strong> {getStatusText()}</p>
        <p><strong>Todos in memory:</strong> {todos.length}</p>
      </div>
    </div>
  )
})

export default App