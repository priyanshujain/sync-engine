import { observable, runInAction } from 'mobx'; // Removed makeObservable

class Model {
  @observable id: string = '';
  constructor(id?: string) {
    if (id) this.id = id;
    // No makeObservable here
  }
}

class ModelRegistry {
  private models = new Map<string, Map<string, Model>>();

  registerProperty(modelName: string, propertyKey: string, config: any) {
    console.log(`Registered property ${propertyKey} on ${modelName}`, config);
  }

  getModelInstance<T extends Model>(modelName: string, id: string): T | undefined {
    const modelMap = this.models.get(modelName);
    return modelMap?.get(id) as T | undefined;
  }

  registerModelInstance(model: Model) {
    const modelName = model.constructor.name;
    if (!this.models.has(modelName)) {
      this.models.set(modelName, new Map());
    }
    this.models.get(modelName)!.set(model.id, model);
  }
}

const modelRegistry = new ModelRegistry();

function Reference<T extends Model>(targetModel: () => (new (...args: any) => T), backRefName: string) {
  return (target: Model, propertyKey: string) => {
    const modelName = target.constructor.name;
    const idProperty = `${propertyKey}Id`;
    const observablePropertyKey = `_${propertyKey}`; 

    modelRegistry.registerProperty(modelName, propertyKey, {
      type: 'reference',
      targetModel: targetModel,
      backRef: backRefName,
    });

    // No makeObservable here

    Object.defineProperty(target, idProperty, {
      get() {
        return this[`_${idProperty}`];
      },
      set(id: string | undefined) { 
        runInAction(() => {
          const previousId = this[`_${idProperty}`];
          this[`_${idProperty}`] = id;

          // Update the observable property directly
          this[observablePropertyKey] = id? modelRegistry.getModelInstance(targetModel().name, id): null;

          // Update back references in the related model
          if (previousId) {
            const previousModel = modelRegistry.getModelInstance(targetModel().name, previousId);
            if (previousModel && typeof previousModel[backRefName].remove === 'function' && this[propertyKey]) {
              previousModel[backRefName].remove(this[propertyKey]); 
            }
          }
          if (id) {
            const newModel = modelRegistry.getModelInstance(targetModel().name, id);
            if (newModel && typeof newModel[backRefName].add === 'function' && this[propertyKey]) {
              newModel[backRefName].add(this[propertyKey]); 
            }
          }
        });
      },
      enumerable: true,
      configurable: true,
    });

    // Remove the setter for the public property
    Object.defineProperty(target, propertyKey, {
      get() {
        return this[observablePropertyKey];
      },
      enumerable: true,
      configurable: true,
    });
  };
}

class Author extends Model {
  @observable name: string = '';
  @Reference(() => Book, 'author') books: Book[] = [];
  @observable _books: Book[] = []; // Add private observable property
  constructor(id: string, name: string) {
    super(id);
    this.name = name;
    modelRegistry.registerModelInstance(this);
  }

  addBook(book: Book) {
    this.books.push(book);
  }

  removeBook(book: Book) {
    this.books = this.books.filter(b => b!== book);
  }
}

class Book extends Model {
  @observable title: string = '';
  @Reference(() => Author, 'books') author: Author | null = null;
  @observable _author: Author | null = null; // Add private observable property
  constructor(id: string, title: string) {
    super(id);
    this.title = title;
    modelRegistry.registerModelInstance(this);
  }
}

const author1 = new Author("a1", "John Doe");
const book1 = new Book("b1", "The Great Gatsby");
const book2 = new Book("b2", "To Kill a Mockingbird");

// Set the author using the Book's 'author' property 
book1.author = author1; 
book2.author = author1;

console.log(book1.author?.name);    // Output: John Doe
console.log(author1.books.length);  // Output: 2 
console.log(author1.books); // Output: The Great Gatsby

book1.author = null;                // Clear the author for book1
console.log(author1.books.length);  // Output: 1 

author1.addBook(new Book("b3", "New Book"));
console.log(author1.books.length); // Output: 2

import { autorun } from 'mobx';

autorun(() => {
  console.log("Author's books:", author1.books.map(book => book.title));
});

book1.author = author1;
book2.author = null;
author1.addBook(new Book("b4", "Another new book"));

console.log(JSON.stringify(author1));