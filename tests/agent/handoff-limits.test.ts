import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../services/agent/src/env';
import { loadHistory } from '../../services/agent/src/history';
import { sessionConfigFromEnv } from '../../services/agent/src/session/config';
import { SessionController } from '../../services/agent/src/session/controller';
import { finalStatusFor } from '../../services/agent/src/session/end-reason';
import { budgetExceeded } from '../../services/agent/src/session/limits';
import { endConversation, startHandoff } from '../../services/agent/src/session/persist';
import {
  DEFAULT_SESSION_CONFIG,
  END_REASONS,
  NO_LIMITS,
  SESSION_TEXT,
  type AbuseLimits,
  type SessionConfig,
} from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';
import { fakeDb, type Row } from './fake-db';

const CALL = { id: 'call1' };
const ID = 'vapi_call1';
const CUSTOMER = 'CUS-1001';
const NOW = new Date('2026-10-03T12:00:00Z');

const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const conversation = (over: Row = {}): Row => ({
  conversation_id: ID,
  started_at: iso(5_000),
  ended_at: null,
  end_reason: null,
  final_status: null,
  support_mode: 'ai',
  customer_id: CUSTOMER,
  last_activity_at: iso(1_000),
  ...over,
});

function setup(
  opts: { methods?: () => Promise<{ textChat: boolean }>; config?: Partial<SessionConfig>; limits?: Partial<AbuseLimits>; rows?: Row[]; extra?: Record<string, Row[]> } = {},
) {
  const fake = fakeDb({ conversations: opts.rows ?? [conversation()], ...opts.extra });
  const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
  const config: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...opts.config,
    limits: { ...NO_LIMITS, ...opts.limits },
  };
  const session = new SessionController({ db: fake.db, control, config, methods: opts.methods });
  const msg = (type: string, extra: Row = {}) => session.handleVapiMessage(ID, { type, call: CALL, ...extra });
  const assistant = (status: 'started' | 'stopped') => msg('speech-update', { role: 'assistant', status });
  const turn = (userMessage = 'my payout failed') =>
    session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage });
  const events = (type: string) => fake.tables.conversation_events.filter((e) => e.event_type === type);
  const conv = () => fake.tables.conversations.find((c) => c.conversation_id === ID)!;
  const used = (answer: Partial<Parameters<SessionController['afterTurn']>[1]> = {}) =>
    session.afterTurn(ID, { answerType: 'direct_answer', toolsUsed: [], retrieved: true, ...answer });
  return { ...fake, session, control, msg, assistant, turn, events, conv, used };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('human handoff', () => {
  const on = { humanHandoff: true };

  it('does nothing when the flag is off', async () => {
    const s = setup();
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ answerType: 'escalation', escalated: true, escalationCreated: true, escalationChannel: 'text_chat' });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(12_000); // past the 10s handoff fallback, before the 15s silence timer
    expect(s.conv().support_mode).toBe('ai');
    expect(s.control.endCall).not.toHaveBeenCalled();
  });

  it('keeps the call for a callback, or when no choice was recorded, even though handoff is on', async () => {
    for (const channel of ['callback', undefined] as const) {
      const s = setup({ config: on });
      await s.msg('status-update', { status: 'in-progress' });
      await s.turn();
      s.used({ answerType: 'escalation', escalated: true, escalationCreated: true, escalationChannel: channel });
      await s.assistant('started');
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(12_000);
      expect(s.conv().support_mode).toBe('ai');
      expect(s.control.endCall).not.toHaveBeenCalled();
      expect(s.events('human_handoff')).toHaveLength(0);
    }
  });

  it('does not move anyone when an administrator has turned the text chat off, even if the model chose it', async () => {
    const s = setup({ config: on, methods: async () => ({ textChat: false }) });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ answerType: 'escalation', escalated: true, escalationCreated: true, escalationChannel: 'text_chat' });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(s.conv().support_mode).toBe('ai');
    expect(s.control.endCall).not.toHaveBeenCalled();
    expect(s.events('human_handoff')).toHaveLength(0);
  });

  it('moves them when the setting allows it, or cannot be read', async () => {
    for (const methods of [async () => ({ textChat: true }), async () => Promise.reject(new Error('down'))]) {
      const s = setup({ config: on, methods });
      await s.msg('status-update', { status: 'in-progress' });
      await s.turn();
      s.used({ answerType: 'escalation', escalated: true, escalationCreated: true, escalationChannel: 'text_chat' });
      await vi.advanceTimersByTimeAsync(0);
      await s.assistant('started');
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(0);
      expect(s.conv().support_mode).toBe('human');
    }
  });

  it('moves a signed-in customer to staff once the confirmation has been spoken, and keeps the conversation open', async () => {
    const s = setup({ config: on });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ answerType: 'escalation', escalated: true, escalationCreated: true, escalationChannel: 'text_chat' });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv().support_mode).toBe('ai'); // not yet: the customer is still hearing the reply

    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);

    expect(s.conv().support_mode).toBe('human');
    expect(s.conv().ended_at).toBeNull();
    expect(s.conv().end_reason).toBeNull();
    expect(s.control.endCall).toHaveBeenCalledOnce();
    expect(s.session.phaseOf(ID)).toBe('human-support');
    expect(s.tables.conversation_turns.filter((t) => t.sender === 'system')).toEqual([
      expect.objectContaining({ body: SESSION_TEXT.handoffNotice, conversation_id: ID }),
    ]);
    expect(s.events('human_handoff')).toHaveLength(1);
    expect(s.events('session_ended')).toHaveLength(0);
    expect(s.events('voice_stats')).toHaveLength(1);
    expect(s.conv().handoff_at).toBe(NOW.toISOString());
  });

  it('still hands over if the end of the speech is never reported', async () => {
    const s = setup({ config: on });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ escalationCreated: true, escalationChannel: 'text_chat', answerType: 'escalation' });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(s.conv().support_mode).toBe('ai');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(s.conv().support_mode).toBe('human');
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('leaves an anonymous caller on the call (Mode A)', async () => {
    const s = setup({ config: on, rows: [conversation({ customer_id: null })] });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ escalationCreated: true, escalationChannel: 'text_chat', answerType: 'escalation' });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(s.conv().support_mode).toBe('ai');
    expect(s.control.endCall).not.toHaveBeenCalled();
  });

  it('hands over only once', async () => {
    const s = setup({ config: on });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ escalationCreated: true, escalationChannel: 'text_chat', answerType: 'escalation' });
    s.used({ escalationCreated: true, escalationChannel: 'text_chat', answerType: 'escalation' });
    await s.assistant('started');
    await s.assistant('stopped');
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.tables.conversation_turns.filter((t) => t.sender === 'system')).toHaveLength(1);
    expect(s.events('human_handoff')).toHaveLength(1);
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('never answers a human conversation with the model, and has no timers left to end it', async () => {
    const s = setup({ config: on });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ escalationCreated: true, escalationChannel: 'text_chat', answerType: 'escalation' });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    const pairsBefore = s.tables.conversation_turns.filter((t) => t.sender === undefined).length;

    expect(await s.turn('hello?')).toEqual({ kind: 'reply', text: SESSION_TEXT.humanActive });
    expect(s.tables.conversation_turns.filter((t) => t.sender === undefined)).toHaveLength(pairsBefore);

    await vi.advanceTimersByTimeAsync(20 * 60_000); // past the 6-minute limit and any silence timer
    expect(s.conv().support_mode).toBe('human');
    expect(s.conv().ended_at).toBeNull();
    expect(s.events('session_ended')).toHaveLength(0);
  });

  it('keeps the conversation human after a restart and does not arm timers', async () => {
    const s = setup({ config: on, rows: [conversation({ support_mode: 'human', started_at: iso(10 * 60_000) })] });
    expect(await s.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.humanActive });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.conv().ended_at).toBeNull();
    expect(s.control.endCall).not.toHaveBeenCalled();
  });

  it('carries on as an AI call if the handoff cannot be saved', async () => {
    const s = setup({ config: on });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used({ escalationCreated: true, escalationChannel: 'text_chat', answerType: 'escalation' });
    await vi.advanceTimersByTimeAsync(0);
    s.failNext('conversations');
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv().support_mode).toBe('ai');
    expect(s.control.endCall).not.toHaveBeenCalled();
  });

  it('startHandoff is first-wins and refuses an ended conversation', async () => {
    const s = setup();
    expect(await startHandoff(s.db, ID, { reason: 'escalation', notice: 'n' })).toEqual({ applied: true });
    expect(await startHandoff(s.db, ID, { reason: 'escalation', notice: 'n' })).toEqual({ applied: false });
    const ended = setup({ rows: [conversation({ ended_at: iso(1000) })] });
    expect(await startHandoff(ended.db, ID, { reason: 'escalation', notice: 'n' })).toEqual({ applied: false });
    const missing = setup({ rows: [] });
    expect(await startHandoff(missing.db, ID, { reason: 'escalation', notice: 'n' })).toEqual({ applied: false });
  });

  it("the voice provider's end-of-call report does not close a human conversation", async () => {
    const s = setup({ rows: [conversation({ support_mode: 'human' })] });
    const result = await endConversation(s.db, ID, 'agent-ended');
    expect(result.applied).toBe(false);
    expect(s.conv().ended_at).toBeNull();
    expect(s.conv().end_reason).toBeNull();
    expect(s.events('session_ended')).toHaveLength(0);
  });

  it('keeps messages from people out of the AI history', async () => {
    const s = setup({
      extra: {
        conversation_turns: [
          { conversation_id: ID, turn_number: 1, user_transcript: 'hi', assistant_response: 'hello' },
          { conversation_id: ID, turn_number: null, sender: 'staff', body: 'Sarah here' },
        ],
      },
    });
    const history = await loadHistory(s.db, ID);
    expect(history.nextTurnNumber).toBe(2);
    expect(history.turns).toEqual([{ user: 'hi', assistant: 'hello' }]);
    expect(history.customerId).toBe(CUSTOMER);
  });
});

describe('conversation budgets', () => {
  it('stops a conversation that has used its agent calls, with a fixed line and the limit-reached reason', async () => {
    const s = setup({ limits: { maxAgentCalls: 2 } });
    await s.msg('status-update', { status: 'in-progress' });
    for (let i = 0; i < 2; i++) {
      expect((await s.turn()).kind).toBe('proceed');
      s.used();
    }
    const decision = await s.turn();
    expect(decision).toEqual({ kind: 'reply', text: SESSION_TEXT.budget });
    expect(s.events('limit_reached')[0]?.metadata).toMatchObject({ kind: 'agent_calls', limit: 2, value: 2 });

    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'limit-reached', final_status: 'abandoned' });
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('counts tool calls and knowledge lookups separately', async () => {
    const tools = setup({ limits: { maxToolCalls: 3 } });
    await tools.turn();
    tools.used({ toolsUsed: ['lookup_customer', 'lookup_payout'] });
    expect((await tools.turn()).kind).toBe('proceed');
    tools.used({ toolsUsed: ['lookup_payout'] });
    expect((await tools.turn()).kind).toBe('reply');
    expect(tools.events('limit_reached')[0]?.metadata).toMatchObject({ kind: 'tool_calls' });

    const lookups = setup({ limits: { maxRetrievals: 1 } });
    await lookups.turn();
    lookups.used({ retrieved: true });
    expect((await lookups.turn()).kind).toBe('reply');
    expect(lookups.events('limit_reached')[0]?.metadata).toMatchObject({ kind: 'retrievals' });
  });

  it('hands a signed-in customer to staff instead of ending the call', async () => {
    const s = setup({ config: { humanHandoff: true }, limits: { maxAgentCalls: 1 } });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used();
    expect(await s.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.budgetHandoff });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv().support_mode).toBe('human');
    expect(s.conv().ended_at).toBeNull();
    expect(s.events('human_handoff')[0]?.metadata).toMatchObject({ reason: 'limit-reached' });
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('ends an anonymous caller politely even when handoff is on', async () => {
    const s = setup({
      config: { humanHandoff: true },
      limits: { maxAgentCalls: 1 },
      rows: [conversation({ customer_id: null })],
    });
    await s.msg('status-update', { status: 'in-progress' });
    await s.turn();
    s.used();
    expect(await s.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.budget });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'limit-reached' });
  });

  it('does not forget what a conversation has used when the service restarts', async () => {
    const turns = [1, 2, 3].map((n) => ({
      conversation_id: ID,
      turn_number: n,
      user_transcript: 'q',
      assistant_response: 'a',
    }));
    const person = { conversation_id: ID, turn_number: null, sender: 'staff', body: 'not an AI call' };
    const s = setup({ limits: { maxAgentCalls: 4 }, extra: { conversation_turns: [...turns, person] } });
    expect((await s.turn()).kind).toBe('proceed'); // 3 used, 1 left
    s.used();
    expect((await s.turn()).kind).toBe('reply');

    const fresh = setup({
      limits: { maxToolCalls: 5 },
      extra: { tool_calls: Array.from({ length: 5 }, () => ({ conversation_id: ID })) },
    });
    expect((await fresh.turn()).kind).toBe('reply');
    const lookups = setup({
      limits: { maxRetrievals: 2 },
      extra: { retrieval_logs: [{ conversation_id: ID }, { conversation_id: ID }] },
    });
    expect((await lookups.turn()).kind).toBe('reply');
  });

  it('a limit of 0 is off and makes no extra queries', async () => {
    const s = setup();
    await s.msg('status-update', { status: 'in-progress' });
    const before = s.queries.length;
    for (let i = 0; i < 100; i++) s.used({ toolsUsed: ['a', 'b'] });
    expect((await s.turn()).kind).toBe('proceed');
    expect(s.queries.slice(before).filter((t) => t !== 'conversations')).toEqual([]);
  });

  it('never blocks a customer because a check failed', async () => {
    const s = setup({ limits: { maxConcurrentSessions: 1, sessionRateMax: 5 } });
    await s.msg('status-update', { status: 'in-progress' });
    s.failNext('conversations');
    expect((await s.turn()).kind).toBe('proceed');
  });

  it('budgetExceeded reports the first used-up budget', () => {
    const limits = { ...NO_LIMITS, maxAgentCalls: 5, maxToolCalls: 5, maxRetrievals: 5 };
    expect(budgetExceeded({ agentCalls: 4, toolCalls: 4, retrievalCalls: 4 }, limits)).toBeUndefined();
    expect(budgetExceeded({ agentCalls: 5, toolCalls: 9, retrievalCalls: 0 }, limits)?.kind).toBe('agent_calls');
    expect(budgetExceeded({ agentCalls: 99, toolCalls: 99, retrievalCalls: 99 }, NO_LIMITS)).toBeUndefined();
  });
});

describe('session limits', () => {
  const earlier = (over: Row = {}): Row =>
    conversation({ conversation_id: 'vapi_earlier', started_at: iso(60_000), last_activity_at: iso(5_000), ...over });

  it('tells a second simultaneous call that the customer already has one, and ends it', async () => {
    const s = setup({ limits: { maxConcurrentSessions: 1 }, rows: [earlier(), conversation()] });
    await s.msg('status-update', { status: 'in-progress' });
    expect(await s.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.concurrent });
    expect(s.events('limit_reached')[0]?.metadata).toMatchObject({ kind: 'concurrent_sessions' });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'limit-reached' });
    expect(s.tables.conversations.find((c) => c.conversation_id === 'vapi_earlier')?.ended_at).toBeNull();
  });

  it('lets the older call carry on', async () => {
    const newer = conversation({ conversation_id: 'vapi_newer', started_at: iso(1_000) });
    const s = setup({ limits: { maxConcurrentSessions: 1 }, rows: [conversation(), newer] });
    expect((await s.turn()).kind).toBe('proceed');
  });

  it('ignores earlier sessions that ended, were handed to staff, or look abandoned', async () => {
    for (const row of [
      earlier({ ended_at: iso(3_000) }),
      earlier({ support_mode: 'human' }),
      earlier({ last_activity_at: iso(20 * 60_000), started_at: iso(30 * 60_000) }),
      earlier({ customer_id: 'CUS-1002' }),
    ]) {
      const s = setup({ limits: { maxConcurrentSessions: 1 }, rows: [row, conversation()] });
      expect((await s.turn()).kind, JSON.stringify(row)).toBe('proceed');
    }
  });

  it('checks again once the customer link lands after the call started', async () => {
    const s = setup({ limits: { maxConcurrentSessions: 1 }, rows: [earlier(), conversation({ customer_id: null })] });
    await s.msg('status-update', { status: 'in-progress' });
    expect((await s.turn()).kind).toBe('proceed'); // not linked yet, so nothing to check against
    s.used();
    s.conv().customer_id = CUSTOMER;
    expect(await s.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.concurrent });
  });

  it('stops re-reading the identity of a call that stays anonymous', async () => {
    const s = setup({ limits: { maxConcurrentSessions: 1 }, rows: [conversation({ customer_id: null })] });
    await s.msg('status-update', { status: 'in-progress' });
    for (let i = 0; i < 4; i++) await s.turn();
    const before = s.queries.length;
    for (let i = 0; i < 5; i++) await s.turn();
    expect(s.queries.slice(before)).toEqual([]);
  });

  it('limits how many sessions a customer can start in a window', async () => {
    const recent = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        conversation({
          conversation_id: `vapi_old${i}`,
          started_at: iso(60_000 + i),
          ended_at: iso(30_000),
          support_mode: 'ended',
        }),
      );
    const limits = { sessionRateMax: 5, sessionRateWindowSeconds: 3600 };
    const within = setup({ limits, rows: [...recent(4), conversation()] }); // 5 including this one
    expect((await within.turn()).kind).toBe('proceed');
    const over = setup({ limits, rows: [...recent(5), conversation()] }); // 6
    expect(await over.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.rateLimited });
    expect(over.events('limit_reached')[0]?.metadata).toMatchObject({ kind: 'session_rate', limit: 5, value: 6 });
    // Sessions older than the window do not count.
    const old = Array.from({ length: 9 }, (_, i) =>
      conversation({
        conversation_id: `vapi_a${i}`,
        started_at: iso(2 * 3600_000 + i),
        ended_at: iso(1),
        support_mode: 'ended',
      }),
    );
    const aged = setup({ limits, rows: [...old, conversation()] });
    expect((await aged.turn()).kind).toBe('proceed');
  });

  it('has a global breaker for callers the server cannot identify', async () => {
    const flood = Array.from({ length: 6 }, (_, i) =>
      conversation({
        conversation_id: `vapi_f${i}`,
        customer_id: null,
        started_at: iso(1_000 + i),
        support_mode: 'ended',
        ended_at: iso(1),
      }),
    );
    const limits = { globalSessionRateMax: 5, globalSessionRateWindowSeconds: 600 };
    const s = setup({ limits, rows: [...flood, conversation({ customer_id: null })] });
    expect(await s.turn()).toEqual({ kind: 'reply', text: SESSION_TEXT.rateLimited });
    expect(s.events('limit_reached')[0]?.metadata).toMatchObject({ kind: 'global_session_rate' });
    const quiet = setup({ limits, rows: [conversation({ customer_id: null })] });
    expect((await quiet.turn()).kind).toBe('proceed');
  });
});

describe('configuration and reasons', () => {
  const base = {
    ANTHROPIC_API_KEY: 'k',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    MCP_SERVER_URL: 'https://mcp.example',
    MCP_SERVER_AUTH_TOKEN: 'k',
  };

  it('defaults to conservative limits with handoff off', () => {
    const cfg = sessionConfigFromEnv(parseEnv(base));
    expect(cfg.humanHandoff).toBe(false);
    expect(cfg.limits).toEqual({
      maxAgentCalls: 30,
      maxToolCalls: 50,
      maxRetrievals: 30,
      maxConcurrentSessions: 1,
      sessionRateMax: 8,
      sessionRateWindowSeconds: 3600,
      globalSessionRateMax: 60,
      globalSessionRateWindowSeconds: 600,
    });
  });

  it('reads overrides, treats blanks as defaults and 0 as off', () => {
    const cfg = sessionConfigFromEnv(
      parseEnv({
        ...base,
        HUMAN_HANDOFF: '1',
        MAX_AGENT_CALLS: '3',
        MAX_TOOL_CALLS: '0',
        MAX_RETRIEVALS: '',
        SESSION_RATE_MAX: '0',
      }),
    );
    expect(cfg.humanHandoff).toBe(true);
    expect(cfg.limits).toMatchObject({ maxAgentCalls: 3, maxToolCalls: 0, maxRetrievals: 30, sessionRateMax: 0 });
  });

  it('rejects nonsense values by name only', () => {
    expect(() => parseEnv({ ...base, MAX_AGENT_CALLS: '-1' })).toThrow('MAX_AGENT_CALLS');
    expect(() => parseEnv({ ...base, HUMAN_HANDOFF: 'yes' })).toThrow('HUMAN_HANDOFF');
  });

  it('knows limit-reached as an abandoned ending', () => {
    expect(END_REASONS).toContain('limit-reached');
    expect(finalStatusFor('limit-reached', { turnCount: 3 })).toBe('abandoned');
    expect(finalStatusFor('limit-reached', { turnCount: 3, existing: 'escalated' })).toBe('escalated');
  });
});
