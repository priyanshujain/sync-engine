import { Model } from "./model";
import { ModelRegistry } from "./model-registry";
import { LazyReferenceCollection } from "./lazy-reference-collection";

export function BackReference() {
    return (target: Model, propertyKey: string) => {
      const modelName = target.constructor.name;
      
      ModelRegistry.registerProperty(modelName, propertyKey, {
        type: 'back-reference',
        collectionType: LazyReferenceCollection
      });
  
      // Initialize collection
      const initializeCollection = (instance: Model) => {
        if (!(instance as any)[propertyKey]) {
          (instance as any)[propertyKey] = new LazyReferenceCollection(
            instance.constructor as typeof Model,
            instance,
            propertyKey
          );
        }
      };
  
      // Hook into model lifecycle
      const originalConstructor = target.constructor;
      target.constructor = function (...args: any[]) {
        const instance = originalConstructor.apply(this, args);
        initializeCollection(instance);
        return instance;
      };
    };
  }
  