import { ModelMetadata } from "./model-registry";
import { SchemaHasher } from "./hash";

abstract class ObjectStore {
    protected storeName: string = ''; 
    protected isInitialized: boolean = false;

    constructor(protected model: ModelMetadata) {}

    protected async initializeStore() {
        this.storeName = await SchemaHasher.generateStoreHash(
            this.model
        );
    }

    abstract createStore(db: IDBDatabase): void;
    abstract initialize(): Promise<void>;
}

class FullObjectStore extends ObjectStore {
    constructor(model: ModelMetadata) {
        super(model);
    }

    async initialize() {
       await this.initializeStore();
        this.isInitialized = true;
    }

    createStore(db: IDBDatabase) {
        if (!this.isInitialized) {
            throw new Error("Store not initialized");
        }

        if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, {
                keyPath: 'id',
                autoIncrement: false
            });

            // Create indexes for indexed properties
            Object.entries(this.model.properties).forEach(([name, meta]) => {
                if (meta.indexed) {
                    store.createIndex(name, name, { unique: false });
                }
            });
        }
    }
}

class PartialObjectStore extends ObjectStore {
    private partialStoreName: string = '';

    constructor(model: ModelMetadata) {
        super(model);
    }

    async initialize() {
        this.initializeStore();
        this.partialStoreName = `${this.storeName}_partial`;
        this.isInitialized = true;
    }

    createStore(db: IDBDatabase) {
        // Create main store
        if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, {
                keyPath: 'id',
                autoIncrement: false
            });

            // Create partial index store
            db.createObjectStore(this.partialStoreName, {
                keyPath: 'indexKey'
            });
        }
    }
}

export { ObjectStore, FullObjectStore, PartialObjectStore };