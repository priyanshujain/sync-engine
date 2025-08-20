import { LazyReferenceCollection } from './lazy-reference-collection';
import { Model } from './model';

type ModelClass = typeof Model;
export type ModelProperty = {
  type: 'property' | 'reference' | 'back-reference';
  collectionType?: typeof LazyReferenceCollection;
  targetModel?: ModelClass;
  backRef?: string;
  lazy?: boolean;
  indexed?: boolean;
};

export type ModelMetadata = {
  name: string;
  loadStrategy: 'full' | 'partial';
  schemaVersion: number;
  properties: Map<string, ModelProperty>;
}

export class ModelRegistry {
  private static modelLookup = new Map<string, ModelClass>();
  private static modelPropertyLookup = new Map<string, Map<string, ModelProperty>>();
  private static modelReferencePropertyLookup = new Map<string, Map<string, string>>();
  private static modelInstances = new Map<string, Map<string, Model>>();

  static registerModel(name: string, constructor: ModelClass) {
    this.modelLookup.set(name, constructor);
    if (!this.modelPropertyLookup.has(name)) {
      this.modelPropertyLookup.set(name, new Map());
    }
    if (!this.modelReferencePropertyLookup.has(name)) {
      this.modelReferencePropertyLookup.set(name, new Map());
    }
  }

  static registerProperty(modelName: string, propName: string, meta: ModelProperty) {
    const props = this.modelPropertyLookup.get(modelName) || new Map();
    props.set(propName, meta);
    this.modelPropertyLookup.set(modelName, props);
  }

  static getModel(name: string): ModelClass | undefined {
    return this.modelLookup.get(name);
  }

  static getModels(): ModelClass[] {
    return Array.from(this.modelLookup.values());
  }

  static getModelMetadata(modelClass: ModelClass): ModelMetadata {
    const name = modelClass.name;
    return {
      name,
      loadStrategy: modelClass.loadStrategy,
      schemaVersion: 1, // You might want to make this configurable
      properties: this.modelPropertyLookup.get(name) || new Map()
    };
  }

  static getModelInstance(modelName: string, id: string): Model | undefined {
    const instances = this.modelInstances.get(modelName);
    return instances?.get(id);
  }

  static registerInstance(model: Model) {
    const modelName = model.constructor.name;
    if (!this.modelInstances.has(modelName)) {
      this.modelInstances.set(modelName, new Map());
    }
    this.modelInstances.get(modelName)?.set(model.id, model);
  }

  static async queryModels<T extends Model>(modelName: string, criteria: Record<string, any>): Promise<T[]> {
    const instances = this.modelInstances.get(modelName) || new Map();
    return Array.from(instances.values()).filter(model => {
      return Object.entries(criteria).every(([key, value]) => model[key] === value);
    }) as T[];
  }
}



