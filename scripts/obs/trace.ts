import pg from 'pg';
import { loadDbEnv } from '../db/env';
import { buildTimeline, formatTimeline, type TimelineInput } from './timeline';

// Prints everything recorded about one call in time order.
//   npm run trace -- <conversation_id> [--json]
const id = process.argv[2];
if (!id || id.startsWith('--') || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) {
  console.error('Usage: npm run trace -- <conversation_id> [--json]');
  process.exit(1);
}
const { SUPABASE_DB_URL } = loadDbEnv('migrate');

type Row = Record<string, unknown>;
const toIso = (r: Row): Row =>
  Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  );

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const rows = async (table: string, columns: string, order = 'created_at') =>
    (
      await client.query(
        `select ${columns} from ${table} where conversation_id = $1 order by ${order}`,
        [id],
      )
    ).rows.map(toIso);

  const conversation = (
    await client.query(
      'select conversation_id, channel, started_at, ended_at, final_status from conversations where conversation_id = $1',
      [id],
    )
  ).rows[0];

  const input = {
    conversation: conversation ? toIso(conversation) : null,
    turns: await rows(
      'conversation_turns',
      'turn_number, user_transcript, assistant_response, answer_type, latency_ms, cost_usd, created_at',
      'turn_number',
    ),
    retrievals: await rows('retrieval_logs', 'query, source_titles, created_at'),
    toolCalls: await rows(
      'tool_calls',
      'tool_name, purpose, status, duration_ms, result_summary, error, created_at',
    ),
    events: await rows('conversation_events', 'event_type, summary, metadata, created_at'),
    tickets: await rows('support_tickets', 'ticket_id, category, priority, created_at'),
    escalations: await rows('escalations', 'escalation_id, category, preferred_time, created_at'),
  } as unknown as TimelineInput;

  const timeline = buildTimeline(input);
  if (process.argv.includes('--json')) console.log(JSON.stringify(timeline, null, 2));
  else console.log(`Conversation ${id}\n${formatTimeline(timeline)}`);
} finally {
  await client.end();
}
