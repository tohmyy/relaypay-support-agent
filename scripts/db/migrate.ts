import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadDbEnv } from './env';
import { runMigrations } from './migrate-runner';

// `npm run db:migrate -- --dry-run` runs every pending migration in a transaction that is rolled back, and prints the
// backfill report of the ones that record one. Nothing is applied.
const dryRun = process.argv.includes('--dry-run');
const { SUPABASE_DB_URL } = loadDbEnv('migrate');
const dir = path.resolve('supabase/migrations');

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await runMigrations(client, readdirSync(dir).filter((f) => f.endsWith('.sql')), {
    dryRun,
    read: (file) => readFileSync(path.join(dir, file), 'utf8'),
    log: (line) => console.log(line),
  });
} finally {
  await client.end();
}
