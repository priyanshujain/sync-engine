import { makeObservable, observable, action, computed, reaction } from 'mobx';

class Book {
  @observable title: string;
  // No author property here!

  constructor(title: string) {
    makeObservable(this);
    this.title = title;
  }

  @action setTitle(newTitle: string) {
    this.title = newTitle;
  }
}

class Author {
  @observable name: string;
  @observable books: Book[] = [];

  constructor(name: string) {
    makeObservable(this);
    this.name = name;

      // Reaction to update book titles in author's book list
    reaction(
        () => this.books.map(book => book.title), // Track book titles
        (newBookTitles, previousBookTitles) => {
            if(previousBookTitles) {
                //Check if there has been any change in the book titles
                const changedBooks = this.books.filter((book, index) => book.title !== previousBookTitles[index]);
                changedBooks.forEach(book => {
                    console.log(`Book title changed for ${book.title}`); // Or any other logic you need
                });
            }
        }
    );
  }

  @action setName(newName: string) {
    this.name = newName;
  }

  @action addBook(book: Book) {
    if (!this.books.includes(book)) {
      this.books.push(book);
    }
  }

  @action removeBook(book: Book) {
    this.books = this.books.filter(b => b !== book);
  }

  // No computed property needed anymore, as the reaction handles it
}

// Example Usage:
const author1 = new Author("J.R.R. Tolkien");
const book1 = new Book("The Hobbit");
const book2 = new Book("The Lord of the Rings");

author1.addBook(book1);
author1.addBook(book2);

console.log(author1.books.map(b => b.title)); // Output: ["The Hobbit", "The Lord of the Rings"]

book1.setTitle("A New Title for the Hobbit"); // Change the book title
console.log(author1.books.map(b => b.title)); // Output: ["A New Title for the Hobbit", "The Lord of the Rings"] (Auto-updated!)

book2.setTitle("Fellowship of the Ring");
console.log(author1.books.map(b => b.title)); // Output: ["A New Title for the Hobbit", "Fellowship of the Ring"] (Auto-updated!)