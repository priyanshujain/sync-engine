import React, { useState, useEffect } from 'react'
import { observer } from 'mobx-react-lite'
// TODO: Update TODO app to use new HashSyncEngine API
// import { HashSyncEngine, HashSyncStatus } from '../../../src/sync/hash-sync-engine'
// import { IndexedDBStore } from '../../../src/storage/indexed-db-store'
import { Todo } from './models'

// TODO: Initialize the new hash-based sync client after updating API usage
// const store = new IndexedDBStore()
// const syncClient = new HashSyncEngine(store, {
//   serverUrl: 'ws://localhost:8080', // Mock server URL
// })

const App = observer(() => {
  const [newTodoText, setNewTodoText] = useState('')
  const [todos, setTodos] = useState<Todo[]>([])

  useEffect(() => {
    // TODO: Try to connect to sync server (will fail gracefully if no server)
    // syncClient.connect().catch(console.warn)
    
    // TODO: Update todos list when sync client state changes
    // const updateTodos = () => {
    //   const allTodos = syncClient.getModelsByType<Todo>('Todo')
    //   setTodos(allTodos.filter(todo => !todo._isDeleted))
    // }
    
    // updateTodos()
    
    // TODO: Set up periodic updates (simple polling since we don't have proper event system)
    // const interval = setInterval(updateTodos, 500) // Faster updates for demo
    
    return () => {
      // clearInterval(interval)
      // syncClient.disconnect()
    }
  }, [])

  const addTodo = async () => {
    if (!newTodoText.trim()) return
    
    const todo = new Todo(undefined, { text: newTodoText.trim() })
    setTodos(prev => [...prev, todo])
    setNewTodoText('')
    
    // Save will automatically sync via the sync client
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
      case SyncStatus.CONNECTED: return 'connected'
      case SyncStatus.CONNECTING: return 'connecting'
      case SyncStatus.SYNCING: return 'connecting'
      default: return 'disconnected'
    }
  }

  const getStatusText = () => {
    switch (syncClient.status) {
      case SyncStatus.CONNECTED: return 'Connected to sync server'
      case SyncStatus.CONNECTING: return 'Connecting to sync server...'
      case SyncStatus.SYNCING: return 'Syncing...'
      case SyncStatus.ERROR: return `Sync error: ${syncClient.lastError?.message || 'Unknown error'}`
      default: return 'Offline mode (changes saved locally)'
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addTodo()
    }
  }

  const stats = syncClient.getStats()

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