import { v4 as uuidv4 } from 'uuid'
import { observable, action, makeObservable } from 'mobx'
import { IndexedBaseModel } from '../../../src/models/indexed-base-model'
import { ModelRegistry } from '../../../src/model-registry'

export class Todo extends IndexedBaseModel {
  @observable text: string = ''
  @observable completed: boolean = false

  constructor(id?: string, options?: { text?: string }) {
    super(id || uuidv4(), {})
    
    // Set initial values
    this.text = options?.text || ''
    
    // Mark as dirty so it will be saved
    if (this.text) {
      this.markDirty()
    }
  }

  @action
  setText(text: string): void {
    this.text = text
    this.markDirty()
  }

  @action
  toggle(): void {
    this.completed = !this.completed
    this.markDirty()
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      text: this.text,
      completed: this.completed,
    }
  }
}

// Register the model with the sync engine
ModelRegistry.registerModel('Todo', Todo as any)