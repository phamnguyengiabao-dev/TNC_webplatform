/**
 * Integration tests: run against a real PostgreSQL instance.
 *
 * test/setup/pg-harness.ts starts a throwaway instance (its own data directory
 * and port, trust auth) unless TEST_DATABASE_URL points at an existing server.
 * The database is dropped and recreated with `prisma migrate deploy` on every
 * run, so the migration is exercised exactly as it will run on Supabase.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  setupFiles: ['reflect-metadata', '<rootDir>/test/setup/load-test-env.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
};
