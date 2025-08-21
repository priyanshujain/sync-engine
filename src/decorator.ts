import { Model } from './model';
import { ModelRegistry, ModelProperty } from './model-registry';

export function ClientModel(name: string) {
  return (constructor: typeof Model) => {
    ModelRegistry.registerModel(name, constructor as typeof Model);
  };
}

export function Property(options?: Partial<ModelProperty>) {
  return (target: Model, propertyKey: string): void => {
    const modelName = target.constructor.name;
    ModelRegistry.registerProperty(modelName, propertyKey, {
      type: 'property',
      ...options
    });
  };
}