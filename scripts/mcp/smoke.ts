import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createSupabase } from '../../services/mcp/src/db/client';
import { createStore } from '../../services/mcp/src/db/store';
import { parseEnv } from '../../services/mcp/src/env';
import { createHttpServer } from '../../services/mcp/src/server';

// Starts the MCP server in-process on a random port, calls every tool through a real MCP client,
// prints the results, then deletes the rows it created.
// The server is in-process, so a throwaway token is used instead of the configured one.
const token = randomUUID();
const env = parseEnv({ ...process.env, MCP_SERVER_AUTH_TOKEN: token });
const db = createSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const server = createHttpServer({ store: createStore(db), authToken: token });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);

const conversationId = `test-smoke-${Date.now()}`;
const startedAt = new Date().toISOString();
async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n${name} ${JSON.stringify(args)}\n  ->`, JSON.stringify(r.structuredContent));
  return r.structuredContent as Record<string, unknown>;
}

try {
  console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
  await call('lookup_customer', { company_name: 'LagosLedger' }); // scenario 3
  await call('lookup_transaction', { transaction_id: 'TXN-9001' }); // scenario 4
  await call('lookup_payout', { payout_id: 'PAY-7002' }); // scenario 5
  const ticket = await call('create_support_ticket', {
    customer_id: 'CUS-1004',
    category: 'payout',
    priority: 'high',
    summary: 'Payout PAY-7003 failed (smoke test)',
    conversation_id: conversationId,
  }); // scenario 6
  await call('create_escalation', {
    ticket_id: ticket.ticket_id,
    customer_id: 'CUS-1003',
    user_name: 'Smoke Test',
    user_email: 'smoke@example.com',
    category: 'compliance',
    reason: 'Restricted account (smoke test)',
    preferred_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
  }); // scenario 7
  await call('log_conversation_event', {
    conversation_id: conversationId,
    event_type: 'smoke_test',
    summary: 'done',
    metadata: { ok: true },
  });
  await call('lookup_customer', {}); // structured validation error
} finally {
  await client.close();
  await db.from('escalations').delete().eq('user_email', 'smoke@example.com');
  await db.from('support_tickets').delete().eq('conversation_id', conversationId);
  await db.from('conversation_events').delete().eq('conversation_id', conversationId);
  await db.from('tool_calls').delete().eq('conversation_id', conversationId);
  await db.from('tool_calls').delete().is('conversation_id', null).gte('created_at', startedAt);
  await db.from('conversations').delete().eq('conversation_id', conversationId);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('\ncleaned up test rows');
}
process.exit(0);
