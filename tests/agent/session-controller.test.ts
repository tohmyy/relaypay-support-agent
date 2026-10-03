import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../services/agent/src/session/controller';
import { DEFAULT_SESSION_CONFIG, SESSION_TEXT, type SessionConfig } from '../../services/agent/src/session/types';
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

const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, maxSeconds: 360, warningSeconds: 30, silenceSeconds: 15, countdownSeconds: 10 };
const CALL = { id: 'call1' };
const ID = 'vapi_call1';

function setup(seed?: { conversations?: Row[] }) {
  const { db, tables } = fakeDb(seed);
  const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
  const session = new SessionController({ db, control, config });
  const msg = (type: string, extra: Row = {}) => session.handleVapiMessage(ID, { type, call: CALL, ...extra });
  const start = () => msg('status-update', { status: 'in-progress' });
  const assistant = (status: 'started' | 'stopped') => msg('speech-update', { role: 'assistant', status });
  const user = (status: 'started' | 'stopped') => msg('speech-update', { role: 'user', status });
  const events = (type: string) => tables.conversation_events.filter((e) => e.event_type === type);
  const conv = () => tables.conversations[0];
  return { session, control, tables, msg, start, assistant, user, events, conv, db };
}

/** A started call whose greeting has just finished, so the customer's quiet time begins. */
async function quietCall(s: ReturnType<typeof setup>) {
  // Mirrors the webhook order: the row exists before the controller sees the first message.
  await Promise.resolve(s.db.from('conversations').upsert({ conversation_id: ID, channel: 'voice' }));
  await s.start();
  await s.assistant('started');
  await s.assistant('stopped');
}

describe('SessionController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  describe('silence', () => {
    it('shows a countdown after 15s of quiet and ends the call when it runs out', async () => {
      const s = setup();
      await quietCall(s);

      await vi.advanceTimersByTimeAsync(14_000);
      expect(s.session.phaseOf(ID)).toBe('active');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(s.session.phaseOf(ID)).toBe('silence-warning');
      expect(s.events('silence_warning')).toHaveLength(1);
      // The caller is asked "Are you still there?" first, and the call is not ended yet.
      expect(s.control.say).toHaveBeenCalledWith(expect.anything(), 'Are you still there?');
      expect(s.control.endCall).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(11_000); // 10s countdown + 1s grace
      expect(s.session.phaseOf(ID)).toBe('ended');
      expect(s.conv()).toMatchObject({ end_reason: 'silence-timeout', final_status: 'abandoned' });
      expect(s.conv().ended_at).toBeTruthy();
      expect(s.control.endCall).toHaveBeenCalledOnce();
      expect(s.events('session_ended')[0]).toMatchObject({ metadata: { end_reason: 'silence-timeout' } });
      // ...and the question came before the hang-up.
      expect(vi.mocked(s.control.say).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(s.control.endCall).mock.invocationCallOrder[0],
      );
    });

    it('is cancelled by the customer speaking, at any point', async () => {
      const s = setup();
      await quietCall(s);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(s.session.phaseOf(ID)).toBe('silence-warning');

      await s.user('started');
      expect(s.session.phaseOf(ID)).toBe('active');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(s.conv().end_reason ?? null).toBeNull();
      expect(s.control.endCall).not.toHaveBeenCalled();

      // Once they stop, the quiet time starts again from zero.
      await s.user('stopped');
      await vi.advanceTimersByTimeAsync(15_000);
      expect(s.session.phaseOf(ID)).toBe('silence-warning');
    });

    it('does not run while the assistant is speaking or a turn is being processed', async () => {
      const s = setup();
      await quietCall(s);
      await s.assistant('started');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(s.session.phaseOf(ID)).toBe('active');
      await s.assistant('stopped');

      const decision = await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'Where is my payout?' });
      expect(decision).toEqual({ kind: 'proceed' });
      await vi.advanceTimersByTimeAsync(120_000); // slow agent turn
      expect(s.session.phaseOf(ID)).toBe('active');
      expect(s.conv().end_reason ?? null).toBeNull();
    });

    it('is suspended while the escalation contact form is open', async () => {
      const s = setup();
      await quietCall(s);
      await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'I want a human' });
      s.session.afterTurn(ID, { answerType: 'escalation', escalated: false, escalationCreated: false });
      await s.assistant('started');
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(300_000);
      expect(s.session.phaseOf(ID)).toBe('active');

      // The customer's next message (the contact details) clears the hold; silence is measured again.
      await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'My name is Amara' });
      s.session.afterTurn(ID, { answerType: 'escalation', escalated: true, escalationCreated: true });
      await s.assistant('started');
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(15_000);
      expect(s.session.phaseOf(ID)).toBe('silence-warning');
    });
  });

  describe('session time limit', () => {
    it('warns at 5:30, then hangs up at 6:00 with session-timeout', async () => {
      const s = setup();
      await quietCall(s);
      // Keep the customer "talking" so silence never interferes with the clock.
      await s.user('started');

      await vi.advanceTimersByTimeAsync(329_000);
      expect(s.events('session_warning')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(s.events('session_warning')).toHaveLength(1);
      expect(s.control.say).toHaveBeenCalledWith(expect.anything(), SESSION_TEXT.warning);

      await vi.advanceTimersByTimeAsync(29_000);
      expect(s.conv().end_reason ?? null).toBeNull();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(s.conv()).toMatchObject({ end_reason: 'session-timeout', final_status: 'abandoned' });
      expect(s.control.say).toHaveBeenCalledWith(expect.anything(), SESSION_TEXT.timeout, { endAfter: true });
    });

    it('hangs up directly when the goodbye cannot be spoken', async () => {
      const s = setup();
      vi.mocked(s.control.say).mockResolvedValue(false);
      await quietCall(s);
      await s.user('started');
      await vi.advanceTimersByTimeAsync(360_000);
      expect(s.control.endCall).toHaveBeenCalledOnce();
    });

    it('refuses a turn past the deadline even when no timer fired (restart / missed timer)', async () => {
      const s = setup({
        conversations: [
          { conversation_id: ID, started_at: '2026-10-01T11:50:00Z', ended_at: null, end_reason: null, final_status: null },
        ],
      });
      const d = await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'Another question' });
      expect(d).toEqual({ kind: 'reply', text: SESSION_TEXT.timeout });
      expect(s.conv()).toMatchObject({ end_reason: 'session-timeout' });
    });

    it('refuses turns for a conversation that already ended, without ending it again', async () => {
      const s = setup({
        conversations: [
          { conversation_id: ID, started_at: '2026-10-01T11:59:00Z', ended_at: '2026-10-01T11:59:30Z', end_reason: 'user-ended', final_status: 'resolved' },
        ],
      });
      const d = await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'hello?' });
      expect(d).toEqual({ kind: 'reply', text: SESSION_TEXT.ended });
      expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
      expect(s.control.endCall).not.toHaveBeenCalled();
    });
  });

  describe('user-requested completion', () => {
    const turn = (s: ReturnType<typeof setup>, userMessage: string) =>
      s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage });

    it('says goodbye to a clear closer, persists the turn, and hangs up once the goodbye has been spoken', async () => {
      const s = setup();
      await quietCall(s);
      const d = await turn(s, "No, that's all.");
      expect(d).toMatchObject({ kind: 'reply', text: SESSION_TEXT.goodbye, endCallAfterSpoken: true });
      expect(s.tables.conversation_turns).toHaveLength(1);
      expect(s.tables.conversation_turns[0]).toMatchObject({ user_transcript: "No, that's all.", answer_type: 'direct_answer' });

      // The goodbye is not cut off: the call ends when the assistant has finished speaking it.
      await s.assistant('started');
      expect(s.control.endCall).not.toHaveBeenCalled();
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(0);
      expect(s.conv()).toMatchObject({ end_reason: 'user-ended', final_status: 'resolved' });
      expect(s.control.endCall).toHaveBeenCalledOnce();
    });

    it('still hangs up if the speech-end event never arrives', async () => {
      const s = setup();
      await quietCall(s);
      await turn(s, "I'm done");
      await vi.advanceTimersByTimeAsync(4_000);
      expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
      expect(s.control.endCall).toHaveBeenCalledOnce();
    });

    it('converges a duplicate speech-end and the fallback on one hang-up', async () => {
      const s = setup();
      await quietCall(s);
      await turn(s, "that's all");
      await s.assistant('started');
      await Promise.all([s.assistant('stopped'), s.assistant('stopped')]);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(s.control.endCall).toHaveBeenCalledOnce();
    });

    it('asks "anything else?" for a bare thanks, then ends on "no"', async () => {
      const s = setup();
      await quietCall(s);
      expect(await turn(s, 'Okay, thanks.')).toEqual({ kind: 'reply', text: SESSION_TEXT.anythingElse });
      expect(s.session.phaseOf(ID)).toBe('awaiting-confirmation');
      expect(s.conv().end_reason ?? null).toBeNull();

      expect(await turn(s, 'No, that is all')).toMatchObject({ kind: 'reply', text: SESSION_TEXT.goodbye, endCallAfterSpoken: true });
      await s.assistant('started');
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(0);
      expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
      expect(s.tables.conversation_turns.map((t) => t.turn_number)).toEqual([1, 2]);
    });

    it('goes back to normal when the customer has more to ask', async () => {
      const s = setup();
      await quietCall(s);
      await turn(s, 'thank you');
      const d = await turn(s, 'Actually, what is the status of TXN-9001?');
      expect(d).toEqual({ kind: 'proceed' });
      expect(s.session.phaseOf(ID)).toBe('active');
      expect(s.conv().end_reason ?? null).toBeNull();
    });

    it('measures silence again after the "anything else?" question is spoken', async () => {
      const s = setup();
      await quietCall(s);
      await turn(s, 'thanks a lot');
      await s.assistant('started');
      await s.assistant('stopped');
      await vi.advanceTimersByTimeAsync(15_000);
      expect(s.session.phaseOf(ID)).toBe('silence-warning');
      await s.user('started');
      expect(s.session.phaseOf(ID)).toBe('awaiting-confirmation');
    });

    it('lets a real question through untouched', async () => {
      const s = setup();
      await quietCall(s);
      expect(await turn(s, 'Why is my payout still pending?')).toEqual({ kind: 'proceed' });
      expect(s.tables.conversation_turns).toHaveLength(0);
    });
  });

  describe('ending', () => {
    it('is first-wins: a later end never replaces the recorded reason', async () => {
      const s = setup();
      await quietCall(s);
      await vi.advanceTimersByTimeAsync(26_000); // silence-timeout
      expect(s.conv()).toMatchObject({ end_reason: 'silence-timeout' });
      await vi.advanceTimersByTimeAsync(400_000); // limits were cleared with the session
      expect(s.conv()).toMatchObject({ end_reason: 'silence-timeout' });
      expect(s.control.endCall).toHaveBeenCalledOnce();
      expect(s.events('session_ended')).toHaveLength(1);
    });

    it('stops all timers when the call ends on its own', async () => {
      const s = setup();
      await quietCall(s);
      await s.msg('end-of-call-report', { endedReason: 'customer-ended-call' });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(s.control.endCall).not.toHaveBeenCalled();
      expect(s.events('silence_warning')).toHaveLength(0);
    });

    it('still ends the session when hang-up is unavailable (persisted, turns refused)', async () => {
      const s = setup();
      vi.mocked(s.control.endCall).mockResolvedValue(false);
      await quietCall(s);
      await vi.advanceTimersByTimeAsync(26_000);
      expect(s.conv()).toMatchObject({ end_reason: 'silence-timeout' });
      const d = await s.session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage: 'hello' });
      expect(d).toEqual({ kind: 'reply', text: SESSION_TEXT.ended });
    });
  });

  describe('speech to request gap (for latency timings)', () => {
    it('is the time from the customer going quiet to the request arriving, and is used once', async () => {
      const s = setup();
      await quietCall(s);
      await s.user('started');
      await s.user('stopped');
      await vi.advanceTimersByTimeAsync(450);
      expect(s.session.consumeSpeechGapMs(ID)).toBe(450);
      expect(s.session.consumeSpeechGapMs(ID)).toBeUndefined();
    });

    it('uses the latest time the customer went quiet', async () => {
      const s = setup();
      await quietCall(s);
      await s.user('started');
      await s.user('stopped');
      await vi.advanceTimersByTimeAsync(1000);
      await s.user('started');
      await s.user('stopped');
      await vi.advanceTimersByTimeAsync(200);
      expect(s.session.consumeSpeechGapMs(ID)).toBe(200);
    });

    it('is unknown when no speech event was seen, for an unknown call, or when the event is stale', async () => {
      const s = setup();
      expect(s.session.consumeSpeechGapMs('vapi_unknown')).toBeUndefined();
      await quietCall(s);
      expect(s.session.consumeSpeechGapMs(ID)).toBeUndefined();
      await s.user('started');
      await s.user('stopped');
      await vi.advanceTimersByTimeAsync(61_000);
      expect(s.session.consumeSpeechGapMs(ID)).toBeUndefined();
    });

    it('ignores the assistant going quiet', async () => {
      const s = setup();
      await quietCall(s); // assistant started and stopped
      expect(s.session.consumeSpeechGapMs(ID)).toBeUndefined();
    });
  });
});
