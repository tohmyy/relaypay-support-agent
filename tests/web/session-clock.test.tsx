// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { NEUTRAL_STATE, type PublicConversationState } from '@/lib/conversation-state';
import { DEFAULT_LIMITS } from '@/lib/session/limits';
import { MockVoiceClient } from '@/lib/voice/mock-client';

const NOW = new Date('2026-10-01T12:00:00Z');

function setup(opts: { backend?: () => Partial<PublicConversationState> } = {}) {
  const client = new MockVoiceClient([], 'vapi_test-call');
  const fetchState = vi.fn(async (): Promise<PublicConversationState> => ({
    ...NEUTRAL_STATE,
    startedAt: new Date().toISOString(),
    serverTime: new Date().toISOString(),
    limits: DEFAULT_LIMITS,
    ...opts.backend?.(),
  }));
  const hook = renderHook(() =>
    useVoiceSession({ createClient: () => client, fetchState, checkMic: async () => null, pollMs: 500 }),
  );
  return { client, fetchState, hook, now: () => hook.result.current };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** A connected, listening call whose first snapshot (with the session limits) has arrived. */
async function listeningCall(s: ReturnType<typeof setup>) {
  await act(async () => {
    await s.hook.result.current.start();
  });
  act(() => s.client.handlers!.onCallStart());
  await advance(600);
}

describe('session timing in the voice session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('counts down after 10s of quiet and cancels the moment the customer speaks', async () => {
    const s = setup();
    await listeningCall(s);
    expect(s.now().session.silenceCountdown).toBeNull();

    await advance(10_000);
    expect(s.now().session.silenceCountdown).toBe(10);
    await advance(3_000);
    expect(s.now().session.silenceCountdown).toBe(7);

    act(() => s.client.handlers!.onUserSpeech(true));
    expect(s.now().session.silenceCountdown).toBeNull();
    act(() => s.client.handlers!.onUserSpeech(false));
    await advance(9_000);
    expect(s.now().session.silenceCountdown).toBeNull();
  });

  it('does not count while the assistant is speaking or thinking', async () => {
    const s = setup();
    await listeningCall(s);
    act(() => s.client.handlers!.onAssistantSpeech(true));
    await advance(60_000);
    expect(s.now().session.silenceCountdown).toBeNull();
    act(() => s.client.handlers!.onAssistantSpeech(false)); // quiet time restarts from here
    await advance(9_000);
    expect(s.now().session.silenceCountdown).toBeNull();
    await advance(1_000);
    expect(s.now().session.silenceCountdown).toBe(10);
  });

  it('does not count while the escalation contact form is open', async () => {
    const s = setup({ backend: () => ({ answerType: 'escalation' }) });
    await listeningCall(s);
    expect(s.now().support).toBe('escalation-required');
    await advance(60_000);
    expect(s.now().session.silenceCountdown).toBeNull();
  });

  it('warns in the last 30 seconds of the session', async () => {
    const startedAt = new Date(Date.now() - 320_000).toISOString();
    const s = setup({ backend: () => ({ startedAt }) });
    await listeningCall(s);
    expect(s.now().session.sessionWarning).toBe(false);
    await advance(10_000);
    expect(s.now().session.sessionWarning).toBe(true);
    expect(s.now().session.secondsLeft).toBeLessThanOrEqual(30);
  });

  it('hangs up locally as a last resort when the call outlives the limit', async () => {
    const startedAt = new Date(Date.now() - 365_000).toISOString();
    const s = setup({ backend: () => ({ startedAt }) });
    await listeningCall(s);
    await advance(1_500);
    expect(s.client.stopped).toBe(true);
    expect(s.now().voice.state).toBe('ended');
  });

  it('reads a skewed browser clock against the server clock', async () => {
    // Server says the session started 340s before its own "now"; the browser clock is irrelevant.
    const serverStart = Date.now() + 60_000 - 340_000;
    const s = setup({
      backend: () => ({
        serverTime: new Date(Date.now() + 60_000).toISOString(),
        startedAt: new Date(serverStart).toISOString(),
      }),
    });
    await listeningCall(s);
    expect(s.now().session.sessionWarning).toBe(true);
    expect(s.now().session.secondsLeft).toBeLessThanOrEqual(20);
  });

  describe('why the call ended', () => {
    it('blames silence straight away when a countdown was showing, then shows the recorded reason', async () => {
      let recorded: PublicConversationState['endReason'] = null;
      const s = setup({ backend: () => ({ endReason: recorded }) });
      await listeningCall(s);
      await advance(20_000);
      expect(s.now().session.silenceCountdown).not.toBeNull();

      act(() => s.client.handlers!.onCallEnd()); // the agent service hung up
      expect(s.now().voice.state).toBe('ended');
      expect(s.now().endReason).toBe('silence-timeout');

      recorded = 'silence-timeout';
      await advance(2_000);
      expect(s.now().backend.endReason).toBe('silence-timeout');
      expect(s.now().endReason).toBe('silence-timeout');
    });

    it('never blames silence when the customer ended the call themselves', async () => {
      const s = setup();
      await listeningCall(s);
      await advance(20_000);
      expect(s.now().session.silenceCountdown).not.toBeNull();
      await act(async () => {
        await s.hook.result.current.end();
      });
      expect(s.now().voice.state).toBe('ended');
      expect(s.now().endReason).toBeNull();
    });

    it('says nothing when the call simply ends mid-conversation', async () => {
      const s = setup();
      await listeningCall(s);
      act(() => s.client.handlers!.onUserSpeech(true));
      act(() => s.client.handlers!.onCallEnd());
      expect(s.now().endReason).toBeNull();
    });

    it('keeps looking for the recorded reason after the call drops, then stops', async () => {
      let calls = 0;
      let recorded: PublicConversationState['endReason'] = null;
      const s = setup({ backend: () => ({ endReason: recorded }) });
      await listeningCall(s);
      act(() => s.client.handlers!.onUserSpeech(true));
      act(() => s.client.handlers!.onCallEnd());
      calls = s.fetchState.mock.calls.length;

      recorded = 'user-ended'; // arrives with Vapi's end-of-call report, a moment after the call drops
      await advance(1_600);
      expect(s.now().endReason).toBe('user-ended');

      const after = s.fetchState.mock.calls.length;
      await advance(10_000);
      expect(s.fetchState.mock.calls.length).toBe(after); // reason known: no more lookups
      expect(after).toBeGreaterThan(calls);
    });

    it('gives up after a few lookups when no reason is ever recorded', async () => {
      const s = setup();
      await listeningCall(s);
      act(() => s.client.handlers!.onUserSpeech(true));
      act(() => s.client.handlers!.onCallEnd());
      const at = s.fetchState.mock.calls.length;
      await advance(30_000);
      expect(s.fetchState.mock.calls.length - at).toBeLessThanOrEqual(4); // 1 on call end + 3 scheduled
      expect(s.now().endReason).toBeNull();
    });
  });
});
