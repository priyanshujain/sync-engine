import "fake-indexeddb/auto";
import { Operation } from './operation';

export class Database {
    private db!: IDBDatabase;
  
    async initialize() {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('sync-engine', 1);
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('transactions')) {
            db.createObjectStore('transactions', { keyPath: 'id' });
          }
        };
  
        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };
        
        request.onerror = () => reject(request.error);
      });
    }
  
    async saveOperation(transaction: Operation) {
      const tx = this.db.transaction('transactions', 'readwrite');
      tx.objectStore('transactions').add(transaction);
      return tx.oncomplete;
    }
  }