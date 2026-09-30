import path from 'node:path';
import pg from 'pg';
import { readCsv } from './csv';
import { loadDbEnv } from './env';

const { SUPABASE_DB_URL } = loadDbEnv('seed');

// FK order: customers -> transactions -> payouts. Upsert by business key, so re-runs are safe.
const tables = [
  { table: 'customers', key: 'customer_id' },
  { table: 'transactions', key: 'transaction_id' },
  { table: 'payouts', key: 'payout_id' },
];

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query('begin');
  for (const { table, key } of tables) {
    const rows = readCsv(path.resolve('supabase/seed', `${table}.csv`));
    for (const row of rows) {
      const cols = Object.keys(row);
      const updates = cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`);
      await client.query(
        `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         on conflict (${key}) do update set ${updates.join(', ')}`,
        cols.map((c) => row[c]),
      );
    }
    console.log(`seeded ${table}: ${rows.length} rows`);
  }
  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
