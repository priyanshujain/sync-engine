// reference.ts
import { Model } from './model';
import { ModelRegistry } from './model-registry';
import { observable, runInAction, makeObservable } from 'mobx';

export function Reference(targetModel: () => typeof Model, backRefName: string) {
  return (target: Model, propertyKey: string) => {
    const modelName = target.constructor.name;
    const idProperty = `${propertyKey}Id`;

    // Register forward reference
    ModelRegistry.registerProperty(modelName, propertyKey, {
      type: 'reference',
      targetModel: targetModel(),
      backRef: backRefName
    });

    // Create ID property
    Object.defineProperty(target, idProperty, {
      get() {
        return this[`_${idProperty}`];
      },
      set(id: string) {
        runInAction(() => {
          const previousId = this[`_${idProperty}`];
          this[`_${idProperty}`] = id;
          
          // Update back reference
          if (previousId) {
            const previousModel = ModelRegistry.getModelInstance(
              targetModel().name, 
              previousId
            );
            (previousModel as any)?.[backRefName]?.remove(this);
          }
          
          if (id) {
            const newModel = ModelRegistry.getModelInstance(
              targetModel().name, 
              id
            );
            (newModel as any)?.[backRefName]?.add(this);
          }
        });
      }
    });

    // Define reference getter
    Object.defineProperty(target, propertyKey, {
      get() {
        return ModelRegistry.getModelInstance(
          targetModel().name, 
          this[idProperty]
        );
      },
      set(value: Model | null) {
        this[idProperty] = value?.id;
      }
    });

    // // Make observable
    // observable(target, idProperty);
    // makeObservable(target, propertyKey);
  };
}