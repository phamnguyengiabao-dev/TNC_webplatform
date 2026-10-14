import { readFileSync } from 'node:fs';
import { stopTestDatabase, type TestDatabase } from './pg-harness';
import { TEST_ENV_FILE } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  let db: TestDatabase;
  try {
    db = JSON.parse(readFileSync(TEST_ENV_FILE, 'utf8')) as TestDatabase;
  } catch {
    return; // setup never completed; nothing to stop
  }
  await stopTestDatabase(db);
}
