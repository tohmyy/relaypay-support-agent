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
// Lookups may run unlinked here; the tools that create records need the linked conversation set up below.
const server = createHttpServer({ store: createStore(db), authToken: token, allowUnlinked: true });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;

const conversationId = `test-smoke-${Date.now()}`;
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Conversation-Id': conversationId } },
  }),
);
const startedAt = new Date().toISOString();
async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n${name} ${JSON.stringify(args)}\n  ->`, JSON.stringify(r.structuredContent));
  return r.structuredContent as Record<string, unknown>;
}

try {
  // Tickets and escalations belong to the signed-in customer of a linked conversation (seed the sign-ins first).
  const { data: users } = await db
    .from('app_users')
    .select('id, customer_id')
    .eq('role', 'customer')
    .not('customer_id', 'is', null)
    .limit(1);
  const owner = users?.[0];
  if (owner) {
    await db.from('conversations').upsert({ conversation_id: conversationId, channel: 'voice' }, { onConflict: 'conversation_id' });
    await db.from('conversations').update({ customer_id: owner.customer_id, user_id: owner.id }).eq('conversation_id', conversationId);
  } else {
    console.log('no customer sign-in found (npm run db:seed-users): the create_* calls below will be refused');
  }
  console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
  await call('lookup_customer', { company_name: 'LagosLedger' }); // scenario 3
  await call('lookup_transaction', { transaction_id: 'TXN-9001' }); // scenario 4
  await call('lookup_payout', { payout_id: 'PAY-7002' }); // scenario 5
  await call('create_support_ticket', {
    category: 'payout',
    priority: 'high',
    summary: 'Payout PAY-7003 failed (smoke test)',
    conversation_id: conversationId,
  }); // scenario 6
  await call('create_escalation', {
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
  await db.from('escalations').delete().eq('conversation_id', conversationId);
  await db.from('support_tickets').delete().eq('conversation_id', conversationId);
  await db.from('conversation_events').delete().eq('conversation_id', conversationId);
  await db.from('tool_calls').delete().eq('conversation_id', conversationId);
  await db.from('tool_calls').delete().is('conversation_id', null).gte('created_at', startedAt);
  await db.from('conversations').delete().eq('conversation_id', conversationId);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('\ncleaned up test rows');
}
process.exit(0);
