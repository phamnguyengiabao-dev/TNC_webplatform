/**
 * PostgreSQL cục bộ cho môi trường dev của showroom.
 *
 * Vì sao không dùng thẳng cluster đang cài trên máy: dev cần một DB có thể
 * drop/recreate bất cứ lúc nào, và không được đụng vào dữ liệu thật. Script này
 * dựng một cụm riêng trong thư mục temp, đúng cách mà `test/setup/pg-harness.ts`
 * làm cho e2e - chỉ khác data dir và port, nên hai thứ chạy song song được.
 *
 *   node scripts/dev/dev-db.mjs            # start + migrate + seed (idempotent)
 *   node scripts/dev/dev-db.mjs --reset    # drop database rồi dựng lại từ đầu
 *   node scripts/dev/dev-db.mjs --no-seed  # chỉ migrate
 *   node scripts/dev/dev-db.mjs --stop     # tắt cụm
 *
 * Env ghi đè: TNC_DEV_PG_PORT, TNC_DEV_PG_DATA, TNC_DEV_PG_BIN, TNC_DEV_DB.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PORT = Number(process.env.TNC_DEV_PG_PORT ?? 55433);
const DATABASE = process.env.TNC_DEV_DB ?? 'tnc_dev';
const DATA_DIR = process.env.TNC_DEV_PG_DATA ?? path.join(os.tmpdir(), 'tnc-pg-dev-data');
/** Log để NGOÀI data dir: để trong đó thì postgres và cmd.exe giành handle của nhau. */
const LOG_FILE = path.join(os.tmpdir(), 'tnc-pg-dev.log');
const URL = `postgresql://postgres@127.0.0.1:${PORT}/${DATABASE}`;

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const seed = !args.has('--no-seed');
const stop = args.has('--stop');

/** Tìm thư mục `bin` của PostgreSQL (bản mới nhất đang cài). */
function resolvePgBin() {
  const candidates = [];
  if (process.env.TNC_DEV_PG_BIN) candidates.push(process.env.TNC_DEV_PG_BIN);

  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(root)) {
      for (const version of readdirSync(root).sort((a, b) => Number(b) - Number(a))) {
        candidates.push(path.join(root, version, 'bin'));
      }
    }
  } else {
    const root = '/usr/lib/postgresql';
    if (existsSync(root)) {
      for (const version of readdirSync(root).sort().reverse()) {
        candidates.push(path.join(root, version, 'bin'));
      }
    }
  }

  for (const dir of candidates) {
    const initdb = path.join(dir, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
    if (existsSync(initdb)) return dir;
  }

  throw new Error(
    'Không tìm thấy PostgreSQL. Cài PostgreSQL rồi đặt TNC_DEV_PG_BIN trỏ vào thư mục bin.',
  );
}

function binary(binDir, name) {
  return path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: options.quiet || options.noStdio ? 'ignore' : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.error) throw new Error(`không chạy được ${command}: ${result.error.message}`);
  return result.status ?? -1;
}

/** In vài dòng cuối của log để lỗi khởi động server không bị nuốt mất. */
function tailFile(file, lines = 20) {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
}

function psql(binDir, database, statements) {
  const status = run(binary(binDir, 'psql'), [
    '-h', '127.0.0.1',
    '-p', String(PORT),
    '-U', 'postgres',
    '-d', database,
    '-v', 'ON_ERROR_STOP=1',
    ...statements.flatMap((sql) => ['-c', sql]),
  ]);
  if (status !== 0) throw new Error(`psql thất bại (exit ${status})`);
}

function isRunning(binDir) {
  return run(binary(binDir, 'pg_ctl'), ['status', '-D', DATA_DIR], { quiet: true }) === 0;
}

function main() {
  const binDir = resolvePgBin();
  const pgCtl = binary(binDir, 'pg_ctl');

  if (stop) {
    if (!isRunning(binDir)) {
      console.log('Cụm dev không chạy - không cần tắt.');
      return;
    }
    if (run(pgCtl, ['-D', DATA_DIR, '-m', 'fast', '-w', '-t', '30', 'stop']) !== 0) {
      throw new Error('không tắt được cụm dev');
    }
    console.log('Đã tắt cụm dev.');
    return;
  }

  if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log(`initdb vào ${DATA_DIR} ...`);
    mkdirSync(DATA_DIR, { recursive: true });
    const status = run(binary(binDir, 'initdb'), [
      '-D', DATA_DIR, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C',
    ]);
    if (status !== 0) throw new Error('initdb thất bại');
  }

  if (!isRunning(binDir)) {
    console.log(`khởi động PostgreSQL trên cổng ${PORT} ...`);
    // `noStdio` là bắt buộc: postgres là tiến trình sống lâu, nếu nó thừa hưởng
    // pipe stdout của tiến trình cha thì pipe đó không bao giờ đóng và người gọi
    // sẽ treo mãi dù server đã lên (bài học từ test/setup/pg-harness.ts).
    const status = run(pgCtl, [
      '-D', DATA_DIR,
      '-l', LOG_FILE,
      '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`,
      '-w', '-t', '30', 'start',
    ], { noStdio: true });
    // pg_ctl có thể báo lỗi vì lý do bên lề (log bị giữ handle, timeout đọc
    // postmaster.pid) trong khi server đã lên thật - chỉ chết khi thật sự không có
    // server nào trả lời.
    if (status !== 0 && !isRunning(binDir)) {
      console.error(tailFile(LOG_FILE));
      throw new Error('pg_ctl start thất bại');
    }
  }

  if (reset) {
    console.log(`xoá database ${DATABASE} ...`);
    psql(binDir, 'postgres', [`drop database if exists ${DATABASE} with (force)`]);
  }

  const probe = spawnSync(
    binary(binDir, 'psql'),
    ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'postgres', '-tAc',
      `select 1 from pg_database where datname = '${DATABASE}'`],
    { encoding: 'utf8' },
  );
  const exists = probe.stdout?.trim() === '1';

  if (!exists) {
    psql(binDir, 'postgres', [`create database ${DATABASE}`]);
  }

  // Supabase sở hữu schema `auth` với bảng users; PostgreSQL trần thì không, nên
  // phải dựng bản thay thế TRƯỚC khi migrate để trigger đồng bộ UserProfile
  // (section 7 của finance_guards.sql) được cài đúng như ở production.
  psql(binDir, DATABASE, [
    'create schema if not exists auth',
    'create table if not exists auth.users (id uuid primary key, email text, phone text)',
  ]);

  const env = { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL };
  console.log('prisma migrate deploy ...');
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (run(process.execPath, [prismaCli, 'migrate', 'deploy'], { env }) !== 0) {
    throw new Error('prisma migrate deploy thất bại');
  }

  if (seed) {
    console.log('seed dữ liệu showroom ...');
    if (run(process.execPath, [path.join('scripts', 'dev', 'seed-dev.cjs')], { env }) !== 0) {
      throw new Error('seed thất bại');
    }
  }

  console.log(`\nDATABASE_URL=${URL}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
