import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadDbEnv } from './env';

const { SUPABASE_DB_URL } = loadDbEnv('migrate');
const dir = path.resolve('supabase/migrations');

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const done = new Set(
    (await client.query('select name from schema_migrations')).rows.map((r) => r.name),
  );
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) {
      console.log(`skip    ${file}`);
      continue;
    }
    await client.query('begin');
    try {
      await client.query(readFileSync(path.join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
} finally {
  await client.end();
}
