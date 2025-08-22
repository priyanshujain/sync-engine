module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/example'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Fix Jest deprecation warnings and memory issues
  workerIdleMemoryLimit: '512MB',
  clearMocks: true,
  restoreMocks: true,
  // Use 'on' to prevent accessing soft-deleted properties
  resetMocks: true,
  resetModules: true,
  // Use single worker to avoid cross-test contamination
  maxWorkers: 1,
  // Increase timeout for cleanup
  testTimeout: 10000,
};