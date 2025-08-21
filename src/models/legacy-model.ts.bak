import { OperationQueue } from "./operation-queue";
import { makeObservable } from "mobx";
import { ModelRegistry } from "./model-registry";

export abstract class Model {
  id: string;
  operationQueue: OperationQueue;
  _version = 0;
  [key: string]: any;

  static loadStrategy: 'full' | 'partial' = 'full';
  
  constructor(id: string) {
    this.id = id;
    this.operationQueue = new OperationQueue();
    ModelRegistry.registerInstance(this);
  }

  protected abstract getChanges(): Record<string, any>;

  abstract save(): void;
  markChanged() {
    this._version++;
  }
}