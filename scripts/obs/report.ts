import pg from 'pg';
import { loadDbEnv } from '../db/env';
import { buildReport, formatReport, parseSince, type ReportInput } from './aggregate';

// Summary numbers for the support system: evidence for testing and for the reflection.
//   npm run report -- [--since 24h] [--json]
const i = process.argv.indexOf('--since');
let sinceMs: number | null = null;
try {
  if (i >= 0) sinceMs = parseSince(process.argv[i + 1] ?? '');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const { SUPABASE_DB_URL } = loadDbEnv('migrate');
const since = sinceMs ? new Date(Date.now() - sinceMs).toISOString() : '1970-01-01T00:00:00Z';

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const q = async (sql: string) => (await client.query(sql, [since])).rows;
  const input: ReportInput = {
    conversations: await q(
      'select conversation_id, customer_id, support_mode, end_reason, final_status, ended_at from conversations where created_at >= $1',
    ),
    turns: await q(
      'select conversation_id, answer_type, latency_ms, cost_usd, timings from conversation_turns where created_at >= $1 and sender is null',
    ),
    toolCalls: await q(
      'select conversation_id, tool_name, status, duration_ms from tool_calls where created_at >= $1',
    ),
    events: await q('select conversation_id, event_type, metadata from conversation_events where created_at >= $1'),
    tickets: Number(
      (await q('select count(*)::int n from support_tickets where created_at >= $1'))[0].n,
    ),
    escalations: Number(
      (await q('select count(*)::int n from escalations where created_at >= $1'))[0].n,
    ),
  };
  const report = buildReport(input);
  const label = sinceMs ? `last ${process.argv[i + 1]}` : 'all time';
  console.log(
    process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report, label),
  );
} finally {
  await client.end();
}
