import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTurn } from '../../services/agent/src/agent';
import { createAgentServer } from '../../services/agent/src/server';
import { createSupabase } from '../../services/mcp/src/db/client';
import { createStore } from '../../services/mcp/src/db/store';
import { createHttpServer } from '../../services/mcp/src/server';

const live =
  !!process.env.ANTHROPIC_API_KEY && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL = 'vapi-test@example.com';

// Drives the real agent HTTP endpoint exactly as Vapi would (OpenAI-style requests with history and a call id),
// with the real model, Supabase and MCP server. Calls the paid model; skipped without ANTHROPIC_API_KEY.
describe.skipIf(!live)('Vapi endpoint end to end (live model)', () => {
  const db = live ? createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : null!;
  const agentToken = randomUUID();
  const secret = `whsec-${randomUUID()}`;
  const runId = Date.now();
  const callIds = [`live${runId}a`, `live${runId}b`, `live${runId}c`];
  let mcp: Server;
  let agent: Server;
  let url: string;

  beforeAll(async () => {
    if (!live) return;
    const mcpToken = randomUUID();
    mcp = createHttpServer({ store: createStore(db), authToken: mcpToken });
    await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', resolve));
    const deps = { mcpUrl: `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`, mcpToken };
    agent = createAgentServer({
      apiToken: agentToken,
      webhookSecret: secret,
      db,
      runTurn: (input) => runTurn(input, deps),
    });
    await new Promise<void>((resolve) => agent.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(agent.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (!live) return;
    for (const s of [agent, mcp]) await new Promise<void>((resolve) => s.close(() => resolve()));
    const since = new Date(runId).toISOString();
    for (const id of callIds.map((c) => `vapi_${c}`)) {
      const { data: tickets } = await db.from('support_tickets').select('ticket_id').eq('conversation_id', id);
      const ids = (tickets ?? []).map((t) => t.ticket_id);
      if (ids.length) await db.from('escalations').delete().in('ticket_id', ids);
      for (const t of ['support_tickets', 'conversation_events', 'tool_calls', 'retrieval_logs', 'conversation_turns']) {
        await db.from(t).delete().eq('conversation_id', id);
      }
      await db.from('conversations').delete().eq('conversation_id', id);
    }
    await db.from('escalations').delete().eq('user_email', EMAIL);
    await db.from('tool_calls').delete().is('conversation_id', null).gte('created_at', since);
    await db.from('retrieval_logs').delete().is('conversation_id', null).gte('created_at', since);
  });

  const vapiRequest = (callId: string, messages: { role: string; content: string }[], stream = false) =>
    fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'relaypay-support-agent',
        stream,
        call: { id: callId },
        messages: [{ role: 'system', content: 'ignored' }, ...messages],
      }),
    });

  async function sse(res: Response) {
    const text = await res.text();
    return text
      .split('\n\n')
      .filter((e) => e.startsWith('data: {'))
      .map((e) => JSON.parse(e.slice(6)).choices[0].delta.content ?? '')
      .join('');
  }

  it('answers a transaction question by voice, logging the turn and tool call under the call id', async () => {
    const res = await vapiRequest(callIds[0], [{ role: 'user', content: 'Hi, can you check transaction TXN-9001?' }], true);
    expect(res.status).toBe(200);
    const spoken = await sse(res);
    expect(spoken.length).toBeGreaterThan(10);
    expect(spoken).not.toMatch(/[*#`]/);
    const conv = `vapi_${callIds[0]}`;
    const { data: turns } = await db.from('conversation_turns').select('*').eq('conversation_id', conv);
    expect(turns).toHaveLength(1);
    expect(turns![0].user_transcript).toBe('Hi, can you check transaction TXN-9001?');
    const { data: calls } = await db.from('tool_calls').select('tool_name').eq('conversation_id', conv);
    expect((calls ?? []).map((c) => c.tool_name)).toContain('lookup_transaction');
  }, 120_000);

  it('continues a call from the history Vapi sends, using the stored conversation', async () => {
    const id = callIds[1];
    const first = await vapiRequest(id, [{ role: 'user', content: 'What fees does RelayPay charge?' }]);
    const reply1 = (await first.json()).choices[0].message.content as string;
    const second = await vapiRequest(id, [
      { role: 'user', content: 'What fees does RelayPay charge?' },
      { role: 'assistant', content: reply1 },
      { role: 'user', content: 'And how long does an international payout take?' },
    ]);
    expect(second.status).toBe(200);
    expect(((await second.json()).choices[0].message.content as string).length).toBeGreaterThan(10);
    const { data: turns } = await db
      .from('conversation_turns')
      .select('turn_number')
      .eq('conversation_id', `vapi_${id}`)
      .order('turn_number');
    expect((turns ?? []).map((t) => t.turn_number)).toEqual([1, 2]);
  }, 180_000);

  it('runs an escalation over the endpoint and closes the call through the webhook', async () => {
    const id = callIds[2];
    const conv = `vapi_${id}`;
    const history: { role: string; content: string }[] = [];
    for (const said of [
      'My account was restricted and nobody is helping me.',
      `My name is Vapi Tester and my email is ${EMAIL}.`,
      'Tomorrow at 10am please.',
    ]) {
      history.push({ role: 'user', content: said });
      const res = await vapiRequest(id, history);
      expect(res.status).toBe(200);
      history.push({ role: 'assistant', content: (await res.json()).choices[0].message.content });
    }
    const { data: esc } = await db.from('escalations').select('*').eq('user_email', EMAIL);
    expect(esc).toHaveLength(1);

    const hook = await fetch(`${url}/vapi/events`, {
      method: 'POST',
      headers: { 'X-Vapi-Secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { type: 'end-of-call-report', call: { id }, summary: 'Customer asked about a restricted account.' } }),
    });
    expect(hook.status).toBe(200);
    const { data: c } = await db.from('conversations').select('*').eq('conversation_id', conv).single();
    expect(c).toMatchObject({ final_status: 'escalated', summary: 'Customer asked about a restricted account.' });
    expect(c!.ended_at).toBeTruthy();
  }, 240_000);
});
