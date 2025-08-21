import "fake-indexeddb/auto";
import { ModelRegistry } from "./model-registry";
import { ObjectStore, FullObjectStore, PartialObjectStore } from "./object-store";
import { SchemaHasher } from "./hash";
class StoreManager {
    private dbName!: string;
    private stores = new Map<string, ObjectStore>();

    async initialize() {
        const models = ModelRegistry.getModels();
        this.dbName = `db-${await SchemaHasher.generateDatabaseHash(models.map(
            model => ModelRegistry.getModelMetadata(model)))}`;
        for (const model of models) {
            let store: ObjectStore;

            switch (model.loadStrategy) {
                case 'partial':
                    store = new PartialObjectStore(ModelRegistry.getModelMetadata(model));
                    break;
                default:
                    store = new FullObjectStore(ModelRegistry.getModelMetadata(model));
            }
            await store.initialize();

            this.stores.set(model.name, store);
            await new Promise(resolve => setTimeout(resolve, 0)); // Allow store to initialize
            this.createDatabase(store);
        }
    }

    private createDatabase(store: ObjectStore) {
        const dbName = this.dbName;
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = (event) => {
            const db = request.result;
            store.createStore(db);
        };

        request.onsuccess = () => {
            console.log(`Database ${dbName} initialized`);
        };
    }

    getStore(modelName: string): ObjectStore | undefined {
        return this.stores.get(modelName);
    }
}

export { StoreManager };