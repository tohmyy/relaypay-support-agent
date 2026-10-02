import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../services/agent/src/session/controller';
import { SESSION_TEXT, type SessionConfig } from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';

type Row = Record<string, unknown>;

/** In-memory supabase stand-in: conversations, conversation_turns, conversation_events. */
function fakeDb(seed: { conversations?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    conversations: seed.conversations ?? [],
    conversation_turns: [],
    conversation_events: [],
  };
  const from = (table: string) => {
    const rows = tables[table];
    const filters: [string, unknown][] = [];
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    let desc = false;
    const matching = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      order: (_c: string, o?: { ascending?: boolean }) => ((desc = o?.ascending === false), b),
      update: (p: Row) => ((mode = 'update'), (patch = p), b),
      insert: (row: Row) => (rows.push({ ...row }), Promise.resolve({ data: null, error: null })),
      upsert: (row: Row) => {
        if (!rows.some((r) => r.conversation_id === row.conversation_id)) {
          rows.push({ started_at: new Date().toISOString(), ended_at: null, end_reason: null, final_status: null, ...row });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        if (mode === 'update') {
          matching().forEach((r) => Object.assign(r, patch));
          return resolve({ data: null, error: null });
        }
        const data = matching().slice();
        if (desc) data.reverse();
        return resolve({ data, error: null });
      },
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, tables };
}

const config: SessionConfig = { maxSeconds: 360, warningSeconds: 30, silenceSeconds: 15, countdownSeconds: 10 };
const CALL = { id: 'call1' };
const ID = 'vapi_call1';

function setup(seed?: { conversations?: Row[] }) {
  const { db, tables } = fakeDb(seed);
  const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
  const session = new SessionController({ db, control, config });
  const msg = (type: string, extra: Row = {}) => session.handleVapiMessage(ID, { type, call: CALL, ...extra });
  const assistant = (status: 'started' | 'stopped') => msg('speech-update', { role: 'assistant', status });
  const user = (status: 'started' | 'stopped') => msg('speech-update', { role: 'user', status });
  const events = (type: string) => tables.conversation_events.filter((e) => e.event_type === type);
  const stats = () => events('voice_stats').map((e) => e.metadata as Record<string, number>);
  const turn = (userMessage: string) => session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage });
  return { session, control, tables, msg, assistant, user, events, stats, turn, db, conv: () => tables.conversations[0] };
}

async function liveCall(s: ReturnType<typeof setup>) {
  await Promise.resolve(s.db.from('conversations').upsert({ conversation_id: ID, channel: 'voice' }));
  await s.msg('status-update', { status: 'in-progress' });
  await s.assistant('started');
  await s.assistant('stopped');
}

describe('interruption tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  async function interrupt(s: ReturnType<typeof setup>, forMs: number) {
    await s.assistant('started');
    await s.user('started');
    await vi.advanceTimersByTimeAsync(forMs);
    await s.user('stopped');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(2000);
  }

  it('counts the customer talking over the assistant, and not ordinary turn-taking', async () => {
    const s = setup();
    await liveCall(s);
    // Ordinary: the customer speaks while the assistant is quiet.
    await s.user('started');
    await vi.advanceTimersByTimeAsync(1500);
    await s.user('stopped');
    await interrupt(s, 1500);
    await s.msg('end-of-call-report', { endedReason: 'customer-ended-call' });
    expect(s.stats()).toEqual([{ interruptions: 1, short_interruptions: 0, undelivered_replies: 0, silence_warnings: 0 }]);
  });

  it('calls very short interruptions out separately: a cough or keystroke rather than a real interruption', async () => {
    const s = setup();
    await liveCall(s);
    await interrupt(s, 200);
    await interrupt(s, 499);
    await interrupt(s, 500);
    await interrupt(s, 2000);
    await s.msg('end-of-call-report', {});
    expect(s.stats()[0]).toMatchObject({ interruptions: 4, short_interruptions: 2 });
  });

  it('does not count a repeated "started" as a second interruption', async () => {
    const s = setup();
    await liveCall(s);
    await s.assistant('started');
    await s.user('started');
    await s.user('started');
    await s.user('stopped');
    await s.msg('end-of-call-report', {});
    expect(s.stats()[0].interruptions).toBe(1);
  });

  it('does not count the customer speaking after the assistant has finished', async () => {
    const s = setup();
    await liveCall(s);
    await s.assistant('started');
    await s.assistant('stopped');
    await s.user('started');
    await s.user('stopped');
    await s.msg('end-of-call-report', {});
    expect(s.stats()[0].interruptions).toBe(0);
  });

  it('writes one summary per call, with zeros when nothing happened', async () => {
    const s = setup();
    await liveCall(s);
    await s.msg('end-of-call-report', {});
    await s.msg('end-of-call-report', {});
    expect(s.stats()).toEqual([{ interruptions: 0, short_interruptions: 0, undelivered_replies: 0, silence_warnings: 0 }]);
  });

  it('writes it when the controller ends the call, and not again when the report follows', async () => {
    const s = setup();
    await liveCall(s);
    await interrupt(s, 1000);
    await vi.advanceTimersByTimeAsync(26_000); // silence ends the call
    expect(s.conv()).toMatchObject({ end_reason: 'silence-timeout' });
    expect(s.stats()).toHaveLength(1);
    expect(s.stats()[0]).toMatchObject({ interruptions: 1, silence_warnings: 1 });
    await s.msg('end-of-call-report', {});
    expect(s.stats()).toHaveLength(1);
  });

  it('does not invent zeros for a session rebuilt after a restart', async () => {
    const s = setup({
      conversations: [
        { conversation_id: ID, started_at: '2026-10-02T11:58:00Z', ended_at: '2026-10-02T11:59:00Z', end_reason: 'user-ended', final_status: 'resolved' },
      ],
    });
    await s.turn('hello'); // rebuilds the session from the database
    await s.msg('end-of-call-report', {});
    expect(s.stats()).toEqual([]);
  });
});

describe('a goodbye the customer talks over', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('does not hang up when the customer carries on with a new request', async () => {
    const s = setup();
    await liveCall(s);
    expect(await s.turn("that's all")).toEqual({ kind: 'reply', text: SESSION_TEXT.goodbye });
    expect(s.session.phaseOf(ID)).toBe('ending');
    await s.assistant('started'); // the goodbye begins...
    expect((await s.turn('Wait, one more thing, where is my payout?')).kind).toBe('proceed');
    expect(s.session.phaseOf(ID)).toBe('active');
    await s.assistant('stopped'); // ...and is cut off
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.conv().end_reason ?? null).toBeNull();
    expect(s.control.endCall).not.toHaveBeenCalled();
  });

  it('still ends when the customer repeats that they are done', async () => {
    const s = setup();
    await liveCall(s);
    await s.turn("that's all");
    await s.assistant('started');
    expect(await s.turn("No, that's all, goodbye")).toEqual({ kind: 'reply', text: SESSION_TEXT.goodbye });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
  });

  it('is unchanged when only noise interrupts it (no turn arrives): the goodbye ends the call as before', async () => {
    const s = setup();
    await liveCall(s);
    await s.turn("that's all");
    await s.assistant('started');
    await s.user('started');
    await s.user('stopped');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
  });

  it('is unchanged when nothing happens: the fallback still hangs up', async () => {
    const s = setup();
    await liveCall(s);
    await s.turn("that's all");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
  });

  it('measures silence again after the cancelled goodbye', async () => {
    const s = setup();
    await liveCall(s);
    await s.turn("that's all");
    await s.turn('actually, what are the payout times?');
    s.session.afterTurn(ID, { answerType: 'direct_answer', escalated: false });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.session.phaseOf(ID)).toBe('silence-warning');
  });
});

describe('a reply that never reached the customer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('starts measuring silence again, because no speech event will do it', async () => {
    const s = setup();
    await liveCall(s);
    await s.turn('Where is my payout?');
    s.session.afterTurn(ID, { answerType: 'direct_answer', escalated: false });
    // The customer talked over it; the reply was dropped and nothing was spoken.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.session.phaseOf(ID)).toBe('active'); // without the call below, silence is never re-armed

    s.session.replyNotDelivered(ID);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.session.phaseOf(ID)).toBe('silence-warning');
  });

  it('is counted in the call summary', async () => {
    const s = setup();
    await liveCall(s);
    await s.turn('first');
    s.session.replyNotDelivered(ID);
    await s.turn('second');
    s.session.replyNotDelivered(ID);
    await s.msg('end-of-call-report', {});
    expect(s.stats()[0].undelivered_replies).toBe(2);
  });

  it('does not start a silence countdown while the customer is speaking, or the assistant is', async () => {
    const s = setup();
    await liveCall(s);
    await s.user('started');
    s.session.replyNotDelivered(ID);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.session.phaseOf(ID)).toBe('active');
  });

  it('is harmless for an unknown or finished call', async () => {
    const s = setup();
    expect(() => s.session.replyNotDelivered('vapi_unknown')).not.toThrow();
    await liveCall(s);
    await s.msg('end-of-call-report', {});
    expect(() => s.session.replyNotDelivered(ID)).not.toThrow();
  });
});
