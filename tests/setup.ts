import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs.map(db => {
      if (db.name) {
        return indexedDB.deleteDatabase(db.name);
      }
    })
  );
});