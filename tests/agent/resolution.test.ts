import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyCompletion, looksLikeGibberish } from '../../services/agent/src/session/completion';
import { MAX_GIBBERISH_STRIKES, SessionController } from '../../services/agent/src/session/controller';
import { DEFAULT_SESSION_CONFIG, SESSION_TEXT, type SessionConfig } from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';
import { fakeDb, type Row } from './fake-db';

const CALL = { id: 'call1' };
const ID = 'vapi_call1';
const NOW = new Date('2026-10-03T12:00:00Z');

const row = (over: Row = {}): Row => ({
  conversation_id: ID,
  started_at: NOW.toISOString(),
  ended_at: null,
  end_reason: null,
  final_status: null,
  support_mode: 'ai',
  customer_id: 'CUS-1001',
  ...over,
});

function setup(control: Partial<VapiCallControl> = {}, config: Partial<SessionConfig> = {}) {
  const fake = fakeDb({ conversations: [row()] });
  const ctl: VapiCallControl = {
    say: vi.fn(async () => true),
    endCall: vi.fn(async () => true),
    ...control,
  };
  const session = new SessionController({
    db: fake.db,
    control: ctl,
    config: { ...DEFAULT_SESSION_CONFIG, silenceSeconds: 600, ...config },
  });
  const msg = (type: string, extra: Row = {}) => session.handleVapiMessage(ID, { type, call: CALL, ...extra });
  const start = () => msg('status-update', { status: 'in-progress' });
  const assistant = (status: 'started' | 'stopped') => msg('speech-update', { role: 'assistant', status });
  const turn = (userMessage: string) => session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage });
  const conv = () => fake.tables.conversations.find((c) => c.conversation_id === ID)!;
  const events = (type: string) => fake.tables.conversation_events.filter((e) => e.event_type === type);
  return { ...fake, session, control: ctl, start, assistant, turn, conv, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('looksLikeGibberish', () => {
  it.each(['asdkjh qwrtp', 'hjkl', 'mmm', 'uh', 'hmm hmm', '...', 'zzzzzzzz', 'bcdfgh', 'qwrtpsdf lkjhgf'])('%j is noise', (text) => {
    expect(looksLikeGibberish(text)).toBe(true);
  });

  it.each([
    'my payout is late',
    'hello',
    'I need help',
    'bye',
    'ok thanks',
    'TXN-9001',
    'transaction 9001',
    'why?',
    'a',
    'questions',
  ])('%j is language', (text) => {
    expect(looksLikeGibberish(text)).toBe(false);
  });

  it('one odd word in a real sentence is not noise', () => {
    expect(looksLikeGibberish('my payout xzqkrtp is late')).toBe(false);
  });
});

describe('low-confidence end (AC-40.2)', () => {
  it('lets the first noisy turns through, then ends the call on the third in a row with the low-confidence reason', async () => {
    const s = setup();
    await s.start();
    expect(MAX_GIBBERISH_STRIKES).toBe(3);
    expect(await s.turn('hjkl')).toEqual({ kind: 'proceed' });
    s.session.afterTurn(ID, { answerType: 'clarification', toolsUsed: [], retrieved: true });
    expect(await s.turn('asdkjh qwrtp')).toEqual({ kind: 'proceed' });
    s.session.afterTurn(ID, { answerType: 'clarification', toolsUsed: [], retrieved: true });

    const third = await s.turn('mmm');
    expect(third).toEqual({ kind: 'reply', text: SESSION_TEXT.lowConfidence });
    expect(s.events('low_confidence')).toHaveLength(1);

    // The line finishes playing, then the call is hung up and the reason recorded.
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'low-confidence', final_status: 'abandoned' });
    expect(s.conv().ended_at).toBeTruthy();
    expect(s.control.endCall).toHaveBeenCalled();
  });

  it('still ends the call if the end of the closing line is never reported', async () => {
    const s = setup();
    await s.start();
    for (const t of ['hjkl', 'qwrtp', 'mmm']) {
      await s.turn(t);
      s.session.afterTurn(ID, { answerType: 'clarification', toolsUsed: [], retrieved: true });
    }
    await vi.advanceTimersByTimeAsync(10_500);
    expect(s.conv().end_reason).toBe('low-confidence');
    expect(s.control.endCall).toHaveBeenCalled();
  });

  it('starts counting again after a real sentence, and ignores references and questions', async () => {
    const s = setup();
    await s.start();
    for (const t of ['hjkl', 'qwrtp', 'my payout is late', 'hjkl', 'qwrtp', 'TXN-9001', 'hjkl', 'why?']) {
      const d = await s.turn(t);
      expect(d.kind).toBe('proceed');
      s.session.afterTurn(ID, { answerType: 'direct_answer', toolsUsed: [], retrieved: true });
    }
    expect(s.conv().end_reason).toBeNull();
  });
});

describe('resolution: the platform ends the call, nothing else changes status (AC-34, AC-35)', () => {
  it('a clear closer says goodbye, hangs up, and records user-ended + resolved when there were turns (AC-34.1)', async () => {
    const s = setup();
    await s.start();
    expect(await s.turn('Where is my payout?')).toEqual({ kind: 'proceed' });
    s.session.afterTurn(ID, { answerType: 'direct_answer', toolsUsed: [], retrieved: true });
    // Persist a turn the way the agent would, so the conversation has something to resolve.
    s.tables.conversation_turns.push({ conversation_id: ID, turn_number: 1 });

    const closer = await s.turn("That's all, thank you");
    expect(closer).toMatchObject({ kind: 'reply', text: SESSION_TEXT.goodbye, endCallAfterSpoken: true });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'user-ended', final_status: 'resolved' });
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('bare thanks only earns "anything else?" and resolves nothing until the customer confirms (AC-34.2)', async () => {
    const s = setup();
    await s.start();
    expect(classifyCompletion('okay thanks')).toBe('ambiguous');
    const check = await s.turn('okay thanks');
    expect(check).toEqual({ kind: 'reply', text: SESSION_TEXT.anythingElse });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv().end_reason).toBeNull();
    expect(s.conv().final_status).toBeNull();
    expect(s.control.endCall).not.toHaveBeenCalled();

    const confirm = await s.turn('no, thanks');
    expect(confirm).toMatchObject({ kind: 'reply', text: SESSION_TEXT.goodbye, endCallAfterSpoken: true });
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.conv()).toMatchObject({ end_reason: 'user-ended' });
  });

  it('the customer saying "resolved?" style things to the model never writes a status', async () => {
    const s = setup();
    await s.start();
    expect(await s.turn('I think this is resolved now, is it fixed?')).toEqual({ kind: 'proceed' });
    s.session.afterTurn(ID, { answerType: 'direct_answer', toolsUsed: [], retrieved: true });
    expect(s.conv().final_status).toBeNull();
    expect(s.conv().end_reason).toBeNull();
  });
});

describe('hang-up hardening (AC-40.1)', () => {
  const closeAfterSilence = async (s: ReturnType<typeof setup>) => {
    await s.start();
    await s.assistant('started');
    await s.assistant('stopped');
    await vi.advanceTimersByTimeAsync(0);
  };

  it('falls back to ending the call when the closing line cannot be spoken', async () => {
    const s = setup({ say: vi.fn(async () => false) }, { maxSeconds: 20, warningSeconds: 5 });
    await closeAfterSilence(s);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(s.conv().end_reason).toBe('session-timeout');
    expect(s.control.say).toHaveBeenCalledWith(expect.anything(), SESSION_TEXT.timeout, { endAfter: true });
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('also falls back when speaking the closing line throws', async () => {
    const s = setup(
      {
        say: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
      { maxSeconds: 20, warningSeconds: 5 },
    );
    await closeAfterSilence(s);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(s.control.endCall).toHaveBeenCalledOnce();
  });

  it('tries to end the call once more if the first attempt did not take, and records a failure when none does', async () => {
    const flaky = setup({ endCall: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) }, { silenceSeconds: 1, countdownSeconds: 1 });
    await flaky.start();
    await flaky.assistant('started');
    await flaky.assistant('stopped');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flaky.conv().end_reason).toBe('silence-timeout');
    expect(flaky.control.endCall).toHaveBeenCalledTimes(2);
    expect(flaky.events('hangup_failed')).toHaveLength(0);

    const dead = setup({ endCall: vi.fn(async () => false) }, { silenceSeconds: 1, countdownSeconds: 1 });
    await dead.start();
    await dead.assistant('started');
    await dead.assistant('stopped');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(dead.conv().end_reason).toBe('silence-timeout'); // still recorded: the page and Vapi's own limit are the backstop
    expect(dead.control.endCall).toHaveBeenCalledTimes(2);
    expect(dead.events('hangup_failed')).toHaveLength(1);
  });
});
