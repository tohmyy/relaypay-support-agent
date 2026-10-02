import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTurn, type AgentDeps, type TurnResult } from '../../services/agent/src/agent';
import { createSupabase } from '../../services/mcp/src/db/client';
import { createStore } from '../../services/mcp/src/db/store';
import { createHttpServer } from '../../services/mcp/src/server';

const live =
  !!process.env.ANTHROPIC_API_KEY && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL = 'workflow-test@example.com';

// Workflows A-H (docs/WORKFLOWS.md) against the official scenarios, including the records left in Supabase.
// Calls the real model, so each run costs a little. Assertions are structural, never exact wording.
describe.skipIf(!live)('support workflows A-H (live model)', () => {
  const db = live ? createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : null!;
  const token = randomUUID();
  const runId = Date.now();
  const convs: string[] = [];
  let server: Server;
  let deps: AgentDeps;

  beforeAll(async () => {
    if (!live) return;
    server = createHttpServer({ store: createStore(db), authToken: token, allowUnlinked: true });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    deps = { mcpUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, mcpToken: token };
  });

  afterAll(async () => {
    if (!live) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const since = new Date(runId).toISOString();
    for (const c of convs) {
      await db.from('escalations').delete().eq('conversation_id', c);
      const { data: tickets } = await db.from('support_tickets').select('ticket_id').eq('conversation_id', c);
      const ids = (tickets ?? []).map((t) => t.ticket_id);
      if (ids.length) await db.from('escalations').delete().in('ticket_id', ids);
      for (const t of ['support_tickets', 'conversation_events', 'tool_calls', 'retrieval_logs', 'conversation_turns']) {
        await db.from(t).delete().eq('conversation_id', c);
      }
      await db.from('conversations').delete().eq('conversation_id', c);
    }
    await db.from('escalations').delete().eq('user_email', EMAIL);
    await db.from('tool_calls').delete().is('conversation_id', null).gte('created_at', since);
    await db.from('retrieval_logs').delete().is('conversation_id', null).gte('created_at', since);
  });


  // Escalations take the customer's name and email from the signed-in account, so these conversations are linked to a
  // seeded customer account first (the web app's link does this in production). Skips the test if none is seeded.
  async function account() {
    const { data } = await db
      .from('app_users')
      .select('id, display_name, email')
      .eq('role', 'customer')
      .eq('customer_id', 'CUS-1001')
      .limit(1);
    return data?.[0] as { id: string; display_name: string; email: string } | undefined;
  }
  async function linkTo(conversationId: string, acct: { id: string }) {
    await db
      .from('conversations')
      .upsert({ conversation_id: conversationId, channel: 'voice', customer_id: 'CUS-1001', user_id: acct.id }, { onConflict: 'conversation_id' });
  }

  const conv = (name: string) => {
    const id = `test-workflow-${name}-${runId}`;
    convs.push(id);
    return id;
  };
  const say = (conversationId: string, userMessage: string): Promise<TurnResult> =>
    runTurn({ conversationId, userMessage }, deps);

  async function records(conversationId: string) {
    const [turns, retrievals, calls, tickets] = await Promise.all([
      db.from('conversation_turns').select('*').eq('conversation_id', conversationId).order('turn_number'),
      db.from('retrieval_logs').select('*').eq('conversation_id', conversationId),
      db.from('tool_calls').select('*').eq('conversation_id', conversationId),
      db.from('support_tickets').select('*').eq('conversation_id', conversationId),
    ]);
    return {
      turns: turns.data ?? [],
      retrievals: retrievals.data ?? [],
      calls: calls.data ?? [],
      tickets: tickets.data ?? [],
    };
  }

  it('A: general knowledge (Scenario 1) answers from the KB and logs retrieval and turn', async () => {
    const c = conv('a');
    const r = await say(c, 'What fees does RelayPay charge for international payments?');
    expect(r.answerType).toBe('direct_answer');
    expect(r.toolsUsed).toEqual([]);
    expect(r.response).toMatch(/before/i);
    expect(r.response).not.toMatch(/\d+(\.\d+)?\s?%|[$£€]\s?\d/);
    const rec = await records(c);
    expect(rec.turns).toHaveLength(1);
    expect(rec.turns[0]).toMatchObject({ turn_number: 1, answer_type: 'direct_answer' });
    expect(rec.retrievals.length).toBeGreaterThan(0);
    expect(rec.calls).toEqual([]);
  }, 90_000);

  it('B: clarification (Scenario 2) asks one question, then continues without guessing', async () => {
    const c = conv('b');
    const r1 = await say(c, 'My payment is stuck.');
    expect(r1.answerType).toBe('clarification');
    expect(r1.toolsUsed).toEqual([]);
    expect(r1.response).toMatch(/payout|transfer|invoice/i);
    expect((r1.response.match(/\?/g) ?? []).length).toBe(1);
    const r2 = await say(c, 'It is an outgoing payout.');
    expect(r2.toolsUsed).toEqual([]);
    expect(r2.answerType).toMatch(/clarification|direct_answer/);
    expect(r2.response).toMatch(/reference|transaction|payout (id|number)|TXN|PAY/i);
    expect((await records(c)).turns.map((t) => t.turn_number)).toEqual([1, 2]);
  }, 150_000);

  it('C: customer lookup (Scenario 3) uses the tool and keeps details private', async () => {
    const c = conv('c');
    const r = await say(c, 'I am Amara from LagosLedger. Can you check my account?');
    expect(r.toolsUsed).toContain('lookup_customer');
    expect(r.response).not.toMatch(/kyc|support note|amara@|growth|approved/i);
    const rec = await records(c);
    expect(rec.calls.map((x) => x.tool_name)).toContain('lookup_customer');
    expect(rec.calls.every((x) => x.status !== 'failed')).toBe(true);
  }, 90_000);

  it('D: transaction lookup (Scenario 4) gives a safe status without promising arrival', async () => {
    const c = conv('d');
    const r = await say(c, 'Can you check transaction TXN-9001?');
    expect(r.toolsUsed).toContain('lookup_transaction');
    expect(r.answerType).not.toBe('decline');
    expect(r.response).not.toMatch(/\b(will (definitely )?arrive|guaranteed to|i (can )?promise|i guarantee)\b/i);
    const rec = await records(c);
    expect(rec.calls.some((x) => x.tool_name === 'lookup_transaction' && x.status === 'success')).toBe(true);
  }, 90_000);

  it('E: payout lookup (Scenario 5) looks it up and summarizes before escalating a review, without explaining why', async () => {
    const c = conv('e');
    const r = await say(c, 'What is happening with payout PAY-7002?');
    expect(r.toolsUsed).toContain('lookup_payout');
    expect(r.answerType).toBe('escalation');
    expect(r.response).not.toMatch(/compliance review|failure reason|kyc/i);
    const rec = await records(c);
    expect(rec.calls.some((x) => x.tool_name === 'lookup_payout')).toBe(true);
  }, 90_000);

  it('F: support ticket (Scenario 6) asks for a reference, then creates and confirms a ticket', async () => {
    const c = conv('f');
    const r1 = await say(c, 'My invoice payment failed and I need someone to look at it.');
    expect(r1.toolsUsed).not.toContain('create_support_ticket');
    expect(r1.response).toContain('?');
    const r2 = await say(c, 'The invoice reference is INV-2041 and the payment failed yesterday. Please log it.');
    expect(r2.toolsUsed).toContain('create_support_ticket');
    const rec = await records(c);
    expect(rec.tickets).toHaveLength(1);
    expect(rec.tickets[0]).toMatchObject({ status: 'open', conversation_id: c });
    expect(r2.response).toContain(rec.tickets[0].ticket_id);
  }, 150_000);

  it('G: human escalation (Scenario 7) uses the account details, asks for a specific time, then stops troubleshooting', async () => {
    const acct = await account();
    if (!acct) return;
    const c = conv('g');
    await linkTo(c, acct);
    const r1 = await say(c, 'My account was restricted and nobody is helping me.');
    expect(r1.answerType).toBe('escalation');
    expect(r1.response).not.toMatch(/because|due to|kyc|compliance/i);
    expect(r1.response).not.toMatch(/\b(your|full) (name|email)|email address/i);
    const r2 = await say(c, 'A callback please, but any time is fine.');
    expect(r2.toolsUsed).not.toContain('create_escalation'); // "any time" is not a specific time
    const r3 = await say(c, 'Tomorrow at 10am works for a call, I am in Lagos.');
    const { data } = await db.from('escalations').select('*').eq('conversation_id', c);
    expect(data?.length ?? 0).toBe(1);
    expect(data![0]).toMatchObject({ user_name: acct.display_name, user_email: acct.email, status: 'open', contact_preference: 'callback' });
    expect(data![0].preferred_at).toBeTruthy();
    expect(String(data![0].preferred_time ?? '')).toMatch(/10/);
    expect(r3.escalated).toBe(true);
    const r4 = await say(c, 'So what is going on with my account?');
    expect(r4.toolsUsed).not.toContain('lookup_customer');
    expect(r4.answerType).toBe('escalation');
    const rec = await records(c);
    expect(rec.calls.map((x) => x.tool_name)).toContain('create_escalation');
    const { data: events } = await db.from('conversation_events').select('*').eq('conversation_id', c);
    expect((events ?? []).length).toBeGreaterThan(0);
  }, 240_000);

  it('H: unsupported request (Scenario 8) declines the guarantee and offers what the KB says', async () => {
    const c = conv('h');
    const r = await say(c, 'Can RelayPay guarantee my payout arrives by 9am tomorrow?');
    expect(r.response).toMatch(/can(no|')t|cannot|unable|not able|no guarantee|not guarantee|can not/i);
    expect(r.response).not.toMatch(/\b(will (definitely )?arrive|i (can )?promise|i guarantee)\b/i);
    expect(r.response).toMatch(/business days?|specialist|support team/i);
    expect((await records(c)).retrievals.length).toBeGreaterThan(0);
  }, 90_000);
});
