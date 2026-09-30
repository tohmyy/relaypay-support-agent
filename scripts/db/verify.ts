import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { loadDbEnv } from './env';

const env = loadDbEnv('verify');
// Node 20 has no native WebSocket, which supabase-js's realtime client requires.
const options = { realtime: { transport: ws as never } };
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);

const results: { check: string; pass: boolean }[] = [];
const check = (name: string, pass: boolean) => results.push({ check: name, pass });

async function count(table: string) {
  const { count: n, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return n;
}
async function one(table: string, col: string, value: string) {
  const { data, error } = await db.from(table).select('*').eq(col, value).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

check('customers = 5', (await count('customers')) === 5);
check('transactions = 5', (await count('transactions')) === 5);
check('payouts = 3', (await count('payouts')) === 3);

const cus = await one('customers', 'customer_id', 'CUS-1001');
check('customer lookup by id', cus?.company_name === 'LagosLedger');
check('LagosLedger active/approved', cus?.account_status === 'active' && cus?.kyc_status === 'approved');
const byEmail = await db
  .from('customers')
  .select('customer_id')
  .ilike('contact_email', 'AMARA@lagosledger.example');
check('customer lookup by email (case-insensitive)', byEmail.data?.[0]?.customer_id === 'CUS-1001');
const byName = await db.from('customers').select('customer_id').ilike('company_name', 'lagosledger');
check('customer lookup by company name', byName.data?.[0]?.customer_id === 'CUS-1001');

const txn = await one('transactions', 'transaction_id', 'TXN-9001');
check('TXN-9001 processing', txn?.status === 'processing');
const pay = await one('payouts', 'payout_id', 'PAY-7002');
check(
  'PAY-7002 review required / compliance review',
  pay?.status === 'review required' && pay?.failure_reason === 'compliance review',
);
const viaTxn = await one('payouts', 'transaction_id', 'TXN-9003');
check('payout lookup by transaction_id', viaTxn?.payout_id === 'PAY-7002');
const restricted = await one('customers', 'customer_id', pay?.customer_id ?? '');
check('PAY-7002 -> CUS-1003 restricted', restricted?.account_status === 'restricted');
check(
  'PAY-7001 failure_reason is NULL',
  (await one('payouts', 'payout_id', 'PAY-7001'))?.failure_reason === null,
);
check(
  'TXN-9003 estimated_arrival is NULL',
  (await one('transactions', 'transaction_id', 'TXN-9003'))?.estimated_arrival === null,
);

for (const t of [
  'conversations',
  'conversation_turns',
  'retrieval_logs',
  'tool_calls',
  'support_tickets',
  'escalations',
  'evaluations',
]) {
  check(`runtime table exists: ${t}`, (await count(t)) !== undefined);
}

if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  const anon = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  const { data, error } = await anon.from('customers').select('customer_id');
  check('anon key cannot read customers', !!error || (data ?? []).length === 0);
} else {
  console.log('note: NEXT_PUBLIC_SUPABASE_ANON_KEY not set; skipping anon access check');
}

console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
