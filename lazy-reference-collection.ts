import { Model } from "./model";
import { ModelRegistry } from "./model-registry";
import { observable, runInAction } from "mobx";

export class LazyReferenceCollection<T extends Model = Model> {
    private loaded = false;
    private items = observable.array<T>([], { deep: false });
  
    constructor(
      private sourceModel: typeof Model,
      private sourceInstance: Model,
      private referenceProperty: string
    ) {}
  
    async load() {
      if (!this.loaded) {
        const references = await ModelRegistry.queryModels<T>(
          this.sourceModel.name,
          { [this.referenceProperty]: this.sourceInstance.id }
        );
        
        runInAction(() => {
          this.items.replace(references);
          this.loaded = true;
        });
      }
      return this.items;
    }
  
    get current() {
      if (!this.loaded) {
        this.load();
      }
      return this.items;
    }
  
    add(item: T) {
      if (!this.items.includes(item)) {
        this.items.push(item);
      }
    }
  
    remove(item: T) {
      this.items.remove(item);
    }
  }
  