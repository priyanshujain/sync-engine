export enum OperationType {
    CREATE,
    UPDATE,
    DELETE
  }
  
  export abstract class Operation {
    abstract type: OperationType;
    modelId: string;
    modelType: string;
  
    constructor(modelId: string, modelType: string) {
      this.modelId = modelId;
      this.modelType = modelType;
    }
  
    abstract apply(): void;
    abstract rollback(): void;
  }
  
  export class UpdateOperation extends Operation {
    type = OperationType.UPDATE;
    private changes: Record<string, any>;
    private previousState: Record<string, any>;
  
    constructor(modelId: string, modelType: string, changes: Record<string, any>) {
      super(modelId, modelType);
      this.changes = changes;
      this.previousState = {}; // Populated from model
    }
  
    apply() {
      console.log("apply", this.changes);
    }
  
    rollback() {
      console.log("rollback", this.previousState);
    }
  }

  export class CreateOperation extends Operation {
    type = OperationType.CREATE;
    private previousState: Record<string, any>;
  
    constructor(modelId: string, modelType: string, previousState: Record<string, any>) {
      super(modelId, modelType);
      this.previousState = previousState;
    }
  
    apply() {
      console.log("apply", this.previousState);
    }

    rollback() {
      console.log("rollback", this.previousState);
    }
  }