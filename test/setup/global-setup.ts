import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { ensureTestDatabase } from './pg-harness';

/** Where the resolved test database URL is handed to the test workers. */
export const TEST_ENV_FILE = path.join(__dirname, '..', '..', '.tmp', 'test-db.json');

export default async function globalSetup(): Promise<void> {
  const db = await ensureTestDatabase();
  mkdirSync(path.dirname(TEST_ENV_FILE), { recursive: true });
  writeFileSync(TEST_ENV_FILE, JSON.stringify(db, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n[e2e] test database ready: ${db.url}\n`);
}
