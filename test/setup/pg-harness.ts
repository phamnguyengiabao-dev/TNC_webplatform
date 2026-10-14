/**
 * Throwaway PostgreSQL instance for integration tests.
 *
 * The tests must run against real PostgreSQL: the money guarantees live in
 * triggers, CHECK constraints and deferred constraint triggers
 * (prisma/sql/finance_guards.sql). A mock or sqlite would prove nothing.
 *
 * Strategy, in order of preference:
 *
 *   1. TEST_DATABASE_URL is set -> use that server (CI, or a developer's own
 *      instance). The database is migrated but never dropped.
 *   2. PostgreSQL binaries are found locally -> run `initdb` into its own data
 *      directory under the OS temp dir, listen on 127.0.0.1:55432 with trust
 *      auth, and drop/recreate the `tnc_test` database on every run. No
 *      Docker, no credentials, and the developer's own cluster is untouched.
 *
 * Everything here is deliberately dependency-free (node:child_process + a
 * local PostgreSQL install) so `npm run test:e2e` has no hidden prerequisites.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TestDatabase {
  /** Connection string the tests use for both DATABASE_URL and DIRECT_URL. */
  url: string;
  /** True when this harness started the instance and must stop it in teardown. */
  managed: boolean;
  port: number;
  dataDir: string | null;
  binDir: string | null;
  database: string;
}

const DATABASE = 'tnc_test';
const DEFAULT_PORT = Number(process.env.TEST_PG_PORT ?? 55432);

function run(
  command: string,
  args: string[],
  options: { cwd?: string; stdio?: 'pipe' | 'ignore'; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio === 'ignore' ? 'ignore' : 'pipe',
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw new Error(`failed to run ${command}: ${result.error.message}`);
  }
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function mustRun(command: string, args: string[], stdio: 'pipe' | 'ignore' = 'pipe'): void {
  const result = run(command, args, { stdio });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${args.join(' ')} exited with ${result.status}\n${result.stderr}`,
    );
  }
}

/**
 * Locates a PostgreSQL `bin` directory containing initdb/pg_ctl/psql.
 * Override with TEST_PG_BIN when running on an unusual machine.
 */
export function resolvePgBin(): string {
  const candidates: string[] = [];

  if (process.env.TEST_PG_BIN) {
    candidates.push(process.env.TEST_PG_BIN);
  }

  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((name) => existsSync(path.join(root, name, 'bin', 'initdb.exe')))
        .sort((a, b) => Number(b) - Number(a));
      for (const version of versions) {
        candidates.push(path.join(root, version, 'bin'));
      }
    }
  } else {
    const root = '/usr/lib/postgresql';
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((name) => existsSync(path.join(root, name, 'bin', 'initdb')))
        .sort()
        .reverse();
      for (const version of versions) {
        candidates.push(path.join(root, version, 'bin'));
      }
    }
  }

  for (const dir of candidates) {
    const binary = path.join(dir, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
    if (existsSync(binary)) return dir;
  }

  throw new Error(
    'No PostgreSQL binaries found for integration tests. Install PostgreSQL locally, ' +
      'set TEST_PG_BIN to its bin directory, or set TEST_DATABASE_URL to an existing ' +
      'PostgreSQL server.',
  );
}

function isServerRunning(binDir: string, dataDir: string): boolean {
  const pgCtl = path.join(binDir, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  return run(pgCtl, ['status', '-D', dataDir]).status === 0;
}

function psql(binDir: string, port: number, database: string, statements: string[]): void {
  const binary = path.join(binDir, process.platform === 'win32' ? 'psql.exe' : 'psql');
  const args = [
    '-h', '127.0.0.1',
    '-p', String(port),
    '-U', 'postgres',
    '-d', database,
    '-v', 'ON_ERROR_STOP=1',
    ...statements.flatMap((sql) => ['-c', sql]),
  ];
  mustRun(binary, args);
}

function startInstance(binDir: string, dataDir: string, port: number): void {
  const pgCtl = path.join(binDir, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');

  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    mkdirSync(dataDir, { recursive: true });
    const initdb = path.join(binDir, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
    mustRun(initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
  }

  // IMPORTANT: stdio must be 'ignore'. postgres inherits the parent's stdio
  // handles, so a pipe would never close and the parent would hang forever
  // waiting for EOF (this bit us once already).
  const serverOptions =
    `-p ${port} -c listen_addresses=127.0.0.1 ` +
    '-c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=60';
  mustRun(
    pgCtl,
    ['-D', dataDir, '-l', path.join(dataDir, 'server.log'), '-o', serverOptions, '-w', '-t', '30', 'start'],
    'ignore',
  );
}

function runMigrations(url: string): void {
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  mustRunCapture(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    ...process.env,
    DATABASE_URL: url,
    DIRECT_URL: url,
  });
}

function mustRunCapture(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): string {
  const result = spawnSync(command, args, { encoding: 'utf8', env });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout ?? '';
}

export async function ensureTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    runMigrations(external);
    return { url: external, managed: false, port: 0, dataDir: null, binDir: null, database: DATABASE };
  }

  const binDir = resolvePgBin();
  const dataDir = process.env.TEST_PG_DATA_DIR ?? path.join(os.tmpdir(), 'tnc-pg-test-data');
  const port = DEFAULT_PORT;

  if (!isServerRunning(binDir, dataDir)) {
    startInstance(binDir, dataDir, port);
  } else if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    // A stray server on the port with no data dir of ours: refuse rather than
    // reuse something we do not own.
    throw new Error(
      `A PostgreSQL server answers for data dir ${dataDir} but the directory has no PG_VERSION; ` +
        'stop it or set TEST_PG_PORT / TEST_PG_DATA_DIR.',
    );
  }

  // Fresh database on every run: the migration must apply cleanly to an empty
  // database, which is exactly what `prisma migrate deploy` does on Supabase.
  psql(binDir, port, 'postgres', [
    `drop database if exists "${DATABASE}" with (force)`,
    `create database "${DATABASE}"`,
  ]);

  // Supabase owns an `auth` schema with the users table the signup trigger
  // hangs off. A bare PostgreSQL does not, so we create a minimal stand-in
  // BEFORE migrating - that way the migration installs the real trigger and
  // every test provisioning path runs the same SQL as production.
  psql(binDir, port, DATABASE, [
    'create schema if not exists auth',
    'create table if not exists auth.users (id uuid primary key, email text, phone text)',
  ]);

  const url = `postgresql://postgres@127.0.0.1:${port}/${DATABASE}`;
  runMigrations(url);

  return { url, managed: true, port, dataDir, binDir, database: DATABASE };
}

/** Stops the instance if (and only if) this harness owns it. */
export async function stopTestDatabase(db: TestDatabase): Promise<void> {
  if (!db.managed || !db.binDir || !db.dataDir) return;
  const pgCtl = path.join(db.binDir, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  run(pgCtl, ['-D', db.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop'], { stdio: 'ignore' });
}
