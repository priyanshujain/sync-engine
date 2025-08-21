import { v4 as uuidv4 } from 'uuid'
import { observable, action, makeObservable } from 'mobx'
import { Model, ModelOptions } from '../../../src/model'
import { ModelRegistry } from '../../../src/model-registry'

export class Todo extends Model {
  text: string = ''
  completed: boolean = false  
  createdAt: number = Date.now()

  constructor(id?: string, options?: ModelOptions & { text?: string }) {
    super(id || uuidv4(), options)
    this.text = options?.text || ''
    
    // Make properties observable for React updates
    makeObservable(this, {
      text: observable,
      completed: observable,
      createdAt: observable,
      setText: action,
      toggle: action,
    })
  }

  setText(text: string): void {
    this.text = text
    this.markDirty()
  }

  toggle(): void {
    this.completed = !this.completed
    this.markDirty()
  }

  toJSON(): Record<string, any> {
    return {
      id: this.id,
      text: this.text,
      completed: this.completed,
      createdAt: this.createdAt,
    }
  }

  static fromJSON<T extends Model>(
    this: new (id: string) => T,
    data: Record<string, any>
  ): T {
    const instance = new this(data.id)
    Object.assign(instance, data)
    instance.markClean()
    return instance
  }
}

// Register the model with the sync engine
ModelRegistry.registerModel('Todo', Todo)