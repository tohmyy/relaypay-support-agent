import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentServer, type AgentServerOptions } from '../../services/agent/src/server';
import { SessionController } from '../../services/agent/src/session/controller';
import {
  RESUMABLE_END_REASONS,
  RESUME_GRACE_MS,
  reopenConversation,
} from '../../services/agent/src/session/persist';
import { DEFAULT_SESSION_CONFIG, END_REASONS, SESSION_TEXT } from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';
import { resolveConversationId } from '../../services/agent/src/vapi';
import { fakeDb, type Row } from './fake-db';

const ID = 'vapi_call1';
const NOW = new Date('2026-10-05T12:00:00Z');
const ended = (msAgo: number, over: Row = {}): Row => ({
  conversation_id: ID,
  started_at: new Date(NOW.getTime() - 120_000).toISOString(),
  ended_at: new Date(NOW.getTime() - msAgo).toISOString(),
  end_reason: 'user-ended',
  final_status: 'resolved',
  support_mode: 'ai',
  customer_id: 'CUS-1001',
  ...over,
});

describe('reopenConversation: the 30 second rule (AC-16.2, AC-16.4)', () => {
  const reopen = (row: Row, customerId: string | null = 'CUS-1001', now = NOW) => {
    const f = fakeDb({ conversations: [row] });
    return reopenConversation(f.db, ID, { customerId, now }).then((result) => ({ result, ...f }));
  };

  it('is 30 seconds', () => {
    expect(RESUME_GRACE_MS).toBe(30_000);
  });

  it('reopens within the grace period for the owner: the same conversation, ended state cleared, an event written', async () => {
    const { result, tables } = await reopen(ended(10_000));
    expect(result).toEqual({ reopened: true });
    expect(tables.conversations[0]).toMatchObject({ conversation_id: ID, ended_at: null, end_reason: null, final_status: null });
    expect(tables.conversation_events.map((e) => e.event_type)).toEqual(['session_resumed']);
    expect(tables.conversation_events[0].metadata).toMatchObject({ previous_end_reason: 'user-ended', seconds_after_end: 10 });
  });

  it('allows exactly the grace period and not a moment longer', async () => {
    expect((await reopen(ended(RESUME_GRACE_MS))).result).toEqual({ reopened: true });
    const late = await reopen(ended(RESUME_GRACE_MS + 1));
    expect(late.result).toEqual({ reopened: false, reason: 'expired' });
    expect(late.tables.conversations[0].ended_at).toBeTruthy();
    expect(late.tables.conversation_events).toHaveLength(0);
  });

  it('keeps an escalation escalated', async () => {
    const { tables } = await reopen(ended(5_000, { final_status: 'escalated' }));
    expect(tables.conversations[0]).toMatchObject({ ended_at: null, final_status: 'escalated' });
  });

  it('only for resumable reasons', async () => {
    expect([...RESUMABLE_END_REASONS].sort()).toEqual(['agent-ended', 'error', 'silence-timeout', 'user-ended']);
    for (const reason of END_REASONS) {
      const { result } = await reopen(ended(5_000, { end_reason: reason }));
      expect(result.reopened).toBe(RESUMABLE_END_REASONS.includes(reason));
      if (!result.reopened) expect(result).toMatchObject({ reason: 'not-resumable' });
    }
  });

  it('only for the customer who owns it, and only while the AI has it', async () => {
    expect((await reopen(ended(5_000), 'CUS-9999')).result).toEqual({ reopened: false, reason: 'not-owner' });
    expect((await reopen(ended(5_000), null)).result).toEqual({ reopened: false, reason: 'not-owner' });
    expect((await reopen(ended(5_000, { customer_id: null }))).result).toEqual({ reopened: false, reason: 'not-owner' });
    expect((await reopen(ended(5_000, { support_mode: 'human' }))).result).toEqual({ reopened: false, reason: 'human' });
  });

  it('says so for a conversation that has not ended, or does not exist', async () => {
    expect((await reopen(ended(5_000, { ended_at: null, end_reason: null }))).result).toEqual({ reopened: false, reason: 'not-ended' });
    const f = fakeDb();
    expect(await reopenConversation(f.db, 'vapi_nope', { customerId: 'CUS-1001', now: NOW })).toEqual({ reopened: false, reason: 'not-found' });
  });

  it('reports a lost race instead of claiming a reopen that did not happen', async () => {
    const f = fakeDb({ conversations: [ended(5_000)] });
    // Someone ended it again between the read and the conditional update, so the update matches nothing.
    const realFrom = f.db.from.bind(f.db) as unknown as (t: string) => Record<string, unknown>;
    (f.db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const builder = realFrom(table);
      if (table === 'conversations') {
        const noop: Record<string, unknown> = { eq: () => noop, then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }) };
        builder.update = () => noop;
      }
      return builder;
    };
    const result = await reopenConversation(f.db, ID, { customerId: 'CUS-1001', now: NOW });
    expect(result).toEqual({ reopened: false, reason: 'raced' });
    expect(f.tables.conversation_events).toHaveLength(0);
    expect(f.tables.conversations[0].ended_at).toBeTruthy();
  });
});

describe('SessionController.reopen and the old call’s late report', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const f = fakeDb({ conversations: [ended(1_000, { end_reason: 'user-ended' })] });
    const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
    const session = new SessionController({ db: f.db, control, config: { ...DEFAULT_SESSION_CONFIG, silenceSeconds: 600 } });
    return { ...f, session, control };
  }

  it('starts a fresh session for the new call, so the resumed conversation answers turns again', async () => {
    const s = setup();
    // The old call: rebuilt as ended, so a turn gets the "ended" line.
    await s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call1' } });
    expect(await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'hello?' })).toEqual({
      kind: 'reply',
      text: SESSION_TEXT.ended,
    });

    expect(await s.session.reopen(ID, 'CUS-1001')).toEqual({ reopened: true });
    await s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call2' } });
    expect(s.session.phaseOf(ID)).toBe('active');
    expect(await s.session.beforeTurn({ conversationId: ID, callId: 'call2', userMessage: 'My payout is late' })).toEqual({ kind: 'proceed' });
  });

  it('refuses after the grace period, leaving the session ended', async () => {
    const s = setup();
    s.tables.conversations[0].ended_at = new Date(NOW.getTime() - 40_000).toISOString();
    expect(await s.session.reopen(ID, 'CUS-1001')).toEqual({ reopened: false, reason: 'expired' });
    await s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call2' } });
    expect(s.session.phaseOf(ID)).toBe('ended');
  });

  it('recognises the earlier call’s report as stale once the conversation was resumed', async () => {
    const s = setup();
    await s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call1' } });
    expect(s.session.isStaleCallReport(ID, 'call1')).toBe(false);
    await s.session.reopen(ID, 'CUS-1001');
    expect(s.session.isStaleCallReport(ID, 'call1')).toBe(true); // before the new call even attaches
    await s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call2' } });
    expect(s.session.isStaleCallReport(ID, 'call1')).toBe(true);
    expect(s.session.isStaleCallReport(ID, 'call2')).toBe(false);
    expect(s.session.isStaleCallReport(ID, undefined)).toBe(false);
  });
});

describe('agent server: /resume and stale reports', () => {
  const TOKEN = 'agent-token-0123456789';
  let server: Server | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  async function start(opts: Partial<AgentServerOptions> = {}) {
    server = createAgentServer({ apiToken: TOKEN, webhookSecret: 'whsec-12345678', runTurn: async () => ({ response: 'x' }), ...opts });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const post = (url: string, body: unknown, headers: Record<string, string> = auth) =>
    fetch(`${url}/resume`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('requires the bearer token and a valid body', async () => {
    const url = await start();
    expect((await post(url, { conversationId: ID }, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await post(url, 'not json')).status).toBe(400);
    expect((await post(url, { customerId: 'CUS-1001' })).status).toBe(400);
    expect((await post(url, { conversationId: 'a b' })).status).toBe(400);
    expect((await fetch(`${url}/resume`, { headers: auth })).status).toBe(405);
  });

  it('is not found when the server has neither a controller nor a database', async () => {
    const url = await start();
    expect((await post(url, { conversationId: ID, customerId: 'CUS-1001' })).status).toBe(404);
  });

  it('reopens through the controller and reports why when it cannot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const f = fakeDb({ conversations: [ended(5_000)] });
    const session = new SessionController({ db: f.db, config: DEFAULT_SESSION_CONFIG });
    const url = await start({ db: f.db, session });
    vi.useRealTimers();
    const wrong = await (await post(url, { conversationId: ID, customerId: 'CUS-9999' })).json();
    expect(wrong).toEqual({ reopened: false, reason: 'not-owner' });
    expect(f.tables.conversations[0].ended_at).toBeTruthy();
  });

  it('ignores the end-of-call report of the call that was resumed, and records the new call’s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const f = fakeDb({ conversations: [ended(2_000, { end_reason: 'user-ended' })] });
    const session = new SessionController({ db: f.db, config: DEFAULT_SESSION_CONFIG });
    const url = await start({ db: f.db, session });
    const hook = (message: Record<string, unknown>) =>
      fetch(`${url}/vapi/events`, {
        method: 'POST',
        headers: { 'X-Vapi-Secret': 'whsec-12345678', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    // The old call is known to the controller, then the customer resumes.
    await hook({ type: 'status-update', status: 'in-progress', call: { id: 'call1' } });
    expect((await (await post(url, { conversationId: ID, customerId: 'CUS-1001' })).json()).reopened).toBe(true);
    expect(f.tables.conversations[0].ended_at).toBeNull();

    // The earlier call's report arrives late: it must not end the resumed conversation.
    await hook({ type: 'end-of-call-report', endedReason: 'customer-ended-call', call: { id: 'call1' } });
    expect(f.tables.conversations[0]).toMatchObject({ ended_at: null, end_reason: null });

    // The resumed call (tagged with the conversation id) starts and later ends normally.
    await hook({ type: 'status-update', status: 'in-progress', call: { id: 'call2', metadata: { conversation_id: ID } } });
    await hook({ type: 'end-of-call-report', endedReason: 'customer-ended-call', call: { id: 'call2', metadata: { conversation_id: ID } } });
    expect(f.tables.conversations[0].end_reason).toBe('user-ended');
    expect(f.tables.conversations[0].ended_at).toBeTruthy();
  });
});

describe('a resumed call names its conversation (Vapi metadata)', () => {
  it('finds the conversation id wherever the call carries it, ahead of the call id', () => {
    for (const call of [
      { id: 'c2', metadata: { conversation_id: ID } },
      { id: 'c2', assistantOverrides: { metadata: { conversation_id: ID } } },
      { id: 'c2', assistant: { metadata: { conversation_id: ID } } },
    ]) {
      expect(resolveConversationId({ call })).toBe(ID);
    }
    expect(resolveConversationId({ call: { id: 'c2' } })).toBe('vapi_c2');
    expect(resolveConversationId({ call: { id: 'c2', assistantOverrides: { metadata: { conversation_id: 'bad id!' } } } })).toBe('vapi_c2');
  });
});
