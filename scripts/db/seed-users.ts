import path from 'node:path';
import pg from 'pg';
import { hashPassword } from '../../apps/web/lib/auth/password';
import { readCsv } from './csv';
import { loadDbEnv } from './env';
import { buildDemoAccounts } from './users';

// Demo accounts for the sign-in area (docs/AUTH.md). All share the password from DEMO_USER_PASSWORD, which is
// never stored anywhere but as a salted hash. Upserted by email, so re-runs are safe (and reset the password).
const { SUPABASE_DB_URL, DEMO_USER_PASSWORD } = loadDbEnv('seed-users');

const accounts = buildDemoAccounts(readCsv(path.resolve('supabase/seed/customers.csv')));
const passwordHash = await hashPassword(DEMO_USER_PASSWORD);

const client = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  for (const a of accounts) {
    await client.query(
      `insert into app_users (email, password_hash, role, customer_id, display_name, title)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (email) do update set
         password_hash = excluded.password_hash, role = excluded.role, customer_id = excluded.customer_id,
         display_name = excluded.display_name, title = excluded.title, disabled = false`,
      [a.email, passwordHash, a.role, a.customerId, a.displayName, a.title],
    );
  }
  await client.query('commit');
  console.log(`seeded app_users: ${accounts.length} accounts`);
  for (const a of accounts) console.log(`  ${a.role.padEnd(13)} ${a.email}`);
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
