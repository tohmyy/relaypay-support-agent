import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runTurn, type AgentDeps } from '../../services/agent/src/agent';
import { createSupabase } from '../../services/mcp/src/db/client';
import { createStore } from '../../services/mcp/src/db/store';
import { createHttpServer } from '../../services/mcp/src/server';

const live =
  !!process.env.ANTHROPIC_API_KEY && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbOnly = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.SUPABASE_DB_URL;

// Real model + real database: checks what a call leaves behind and that the trace tool shows it.
describe.skipIf(!live || !dbOnly)('observability (live)', () => {
  const db = live ? createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : null!;
  const runId = Date.now();
  const callId = `test-obs-call-${runId}`;
  const failId = `test-obs-fail-${runId}`;
  const token = randomUUID();
  let mcp: Server;
  let deps: AgentDeps;

  beforeAll(async () => {
    if (!live) return;
    mcp = createHttpServer({ store: createStore(db), authToken: token, allowUnlinked: true });
    await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', resolve));
    deps = { mcpUrl: `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`, mcpToken: token };
  });

  afterAll(async () => {
    if (!live) return;
    await new Promise<void>((resolve) => mcp.close(() => resolve()));
    for (const id of [callId, failId]) {
      for (const t of ['conversation_events', 'tool_calls', 'retrieval_logs', 'conversation_turns']) {
        await db.from(t).delete().eq('conversation_id', id);
      }
      await db.from('conversations').delete().eq('conversation_id', id);
    }
    const since = new Date(runId).toISOString();
    await db.from('tool_calls').delete().is('conversation_id', null).gte('created_at', since);
    await db.from('retrieval_logs').delete().is('conversation_id', null).gte('created_at', since);
  });

  it('records timing, cost, purpose and a safe summary, and the trace shows the whole call', async () => {
    const r = await runTurn(
      { conversationId: callId, userMessage: 'Hi, my email is obs-test@example.com. Can you check transaction TXN-9001?' },
      deps,
    );
    expect(r.toolsUsed).toContain('lookup_transaction');

    const { data: turn } = await db.from('conversation_turns').select('*').eq('conversation_id', callId).single();
    expect(turn!.latency_ms).toBeGreaterThan(500);
    expect(Number(turn!.cost_usd)).toBeGreaterThan(0);

    const { data: calls } = await db.from('tool_calls').select('*').eq('conversation_id', callId);
    const lookup = calls!.find((c) => c.tool_name === 'lookup_transaction')!;
    expect(lookup).toMatchObject({
      status: 'success',
      purpose: 'Look up a transaction to report its status',
      result_summary: 'found TXN-9001, status processing',
    });
    expect(lookup.duration_ms).toBeGreaterThanOrEqual(0);

    // Personal data typed by the customer must not reach the retrieval log.
    const { data: retrievals } = await db.from('retrieval_logs').select('query').eq('conversation_id', callId);
    expect(retrievals!.length).toBeGreaterThan(0);
    expect(JSON.stringify(retrievals)).not.toContain('obs-test@example.com');
    expect(JSON.stringify(retrievals)).toContain('[email]');

    const out = execFileSync('npx', ['tsx', '--env-file-if-exists=.env.local', 'scripts/obs/trace.ts', callId], {
      encoding: 'utf8',
      shell: true,
    });
    expect(out).toContain(`Conversation ${callId}`);
    for (const kind of ['customer', 'retrieval', 'tool', 'agent']) expect(out).toMatch(new RegExp(`\\s${kind}\\s`));
    expect(out).toContain('lookup_transaction success');
    expect(out).toContain('found TXN-9001, status processing');
    expect(out).not.toContain('obs-test@example.com');
  }, 180_000);

  it('leaves an error event when a turn fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: AgentDeps = {
      ...deps,
      retrieve: async () => {
        throw new Error('search unavailable for obs-fail@example.com');
      },
    };
    await expect(runTurn({ conversationId: failId, userMessage: 'hello' }, failing)).rejects.toThrow(/search unavailable/);
    const { data } = await db.from('conversation_events').select('*').eq('conversation_id', failId);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ event_type: 'error', metadata: { source: 'agent.runTurn' } });
    expect(JSON.stringify(data)).not.toContain('obs-fail@example.com');
    vi.restoreAllMocks();
  }, 60_000);
});
