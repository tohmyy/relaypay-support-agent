import { describe, expect, it } from 'vitest';
import { deriveSessionView, provisionalEndReason, type SessionViewInput } from '@/lib/session/derive';
import { DEFAULT_LIMITS, sessionLimitsFromEnv } from '@/lib/session/limits';
import { COPY, withSeconds } from '@/lib/copy';
import { MOCK_LIMITS, silenceDemoScript } from '@/lib/voice/mock-state';
import { DEMO_SCRIPT } from '@/lib/voice/mock-client';

describe('sessionLimitsFromEnv', () => {
  it('defaults to 6 minutes, a 30s warning, 15s of quiet and a 10s countdown', () => {
    expect(sessionLimitsFromEnv({})).toEqual(DEFAULT_LIMITS);
    expect(DEFAULT_LIMITS).toEqual({ sessionMaxSeconds: 360, warningSeconds: 30, silenceTimeoutSeconds: 15, countdownSeconds: 10 });
  });

  it('reads the same variables as the agent service, ignoring blank or invalid values', () => {
    expect(
      sessionLimitsFromEnv({ SESSION_MAX_SECONDS: '60', SILENCE_TIMEOUT_SECONDS: '5', SILENCE_COUNTDOWN_SECONDS: '' }),
    ).toEqual({ sessionMaxSeconds: 60, warningSeconds: 30, silenceTimeoutSeconds: 5, countdownSeconds: 10 });
    expect(sessionLimitsFromEnv({ SESSION_MAX_SECONDS: 'abc', SILENCE_TIMEOUT_SECONDS: '0' })).toEqual(DEFAULT_LIMITS);
  });

  it('keeps the warning window inside a short session', () => {
    expect(sessionLimitsFromEnv({ SESSION_MAX_SECONDS: '20', SESSION_WARNING_SECONDS: '30' }).warningSeconds).toBe(19);
  });
});

describe('deriveSessionView', () => {
  const T0 = 1_000_000;
  const input = (over: Partial<SessionViewInput> = {}): SessionViewInput => ({
    voiceState: 'listening',
    supportState: 'normal',
    limits: DEFAULT_LIMITS,
    startedAtMs: T0,
    quietSinceMs: T0,
    nowMs: T0,
    clockOffsetMs: 0,
    ...over,
  });
  const at = (seconds: number, over: Partial<SessionViewInput> = {}) =>
    deriveSessionView(input({ nowMs: T0 + seconds * 1000, ...over }));

  it('shows nothing without limits', () => {
    expect(deriveSessionView(input({ limits: null }))).toEqual({ silenceCountdown: null, secondsLeft: null, sessionWarning: false });
  });

  it('starts the countdown after 15s of quiet and counts 10 down to 1', () => {
    expect(at(14.9).silenceCountdown).toBeNull();
    expect(at(15).silenceCountdown).toBe(10);
    expect(at(16).silenceCountdown).toBe(9);
    expect(at(24).silenceCountdown).toBe(1);
    expect(at(30).silenceCountdown).toBe(1); // never below 1; the call is about to end
  });

  it('only counts while listening: speaking, thinking and the assistant talking all cancel it', () => {
    for (const voiceState of ['user-speaking', 'processing', 'assistant-speaking', 'connecting'] as const) {
      expect(at(20, { voiceState }).silenceCountdown).toBeNull();
    }
    expect(at(20, { quietSinceMs: null }).silenceCountdown).toBeNull();
  });

  it('is held while the escalation contact form is open', () => {
    expect(at(20, { supportState: 'escalation-required' }).silenceCountdown).toBeNull();
    expect(at(20, { supportState: 'escalating' }).silenceCountdown).toBeNull();
    expect(at(20, { supportState: 'escalated' }).silenceCountdown).toBe(5);
  });

  it('warns for the last 30 seconds of the session only', () => {
    expect(at(329).sessionWarning).toBe(false);
    expect(at(330)).toMatchObject({ sessionWarning: true, secondsLeft: 30 });
    expect(at(359)).toMatchObject({ sessionWarning: true, secondsLeft: 1 });
    expect(at(360)).toMatchObject({ sessionWarning: false, secondsLeft: 0 });
    expect(at(10).secondsLeft).toBe(350);
  });

  it('measures the session on the server clock, whatever the browser clock says', () => {
    // Browser is 40s behind the server: the session started 330s ago by the server's clock.
    expect(deriveSessionView(input({ nowMs: T0 + 290_000, clockOffsetMs: 40_000 }))).toMatchObject({ secondsLeft: 30, sessionWarning: true });
  });

  it('does not know the time left before the session start is known', () => {
    expect(at(100, { startedAtMs: null })).toMatchObject({ secondsLeft: null, sessionWarning: false });
  });
});

describe('provisionalEndReason', () => {
  it('blames silence only when a countdown was showing, and the time limit only at the limit', () => {
    expect(provisionalEndReason({ silenceCountdown: 1, secondsLeft: 200, sessionWarning: false })).toBe('silence-timeout');
    expect(provisionalEndReason({ silenceCountdown: null, secondsLeft: 1, sessionWarning: true })).toBe('session-timeout');
    expect(provisionalEndReason({ silenceCountdown: null, secondsLeft: 0, sessionWarning: false })).toBe('session-timeout');
    expect(provisionalEndReason({ silenceCountdown: null, secondsLeft: 120, sessionWarning: false })).toBeNull();
    expect(provisionalEndReason({ silenceCountdown: null, secondsLeft: null, sessionWarning: false })).toBeNull();
  });
});

describe('session copy and preview', () => {
  it('fills the seconds and uses the singular for one', () => {
    expect(withSeconds(COPY.session.silenceCountdown, COPY.session.silenceCountdownOne, 10)).toBe('Ending conversation in 10 seconds...');
    expect(withSeconds(COPY.session.silenceCountdown, COPY.session.silenceCountdownOne, 1)).toBe('Ending conversation in 1 second...');
    expect(withSeconds(COPY.session.warningBody, COPY.session.warningBodyOne, 30)).toBe('This support session will end in about 30 seconds.');
  });

  it('ends the preview call after the silence countdown would run out', () => {
    const script = silenceDemoScript(DEMO_SCRIPT);
    const last = script[script.length - 1];
    const lastSpeech = Math.max(...DEMO_SCRIPT.map((s) => s.at));
    expect(last.at).toBe(lastSpeech + (MOCK_LIMITS.silenceTimeoutSeconds + MOCK_LIMITS.countdownSeconds + 1) * 1000);
    expect(script).toHaveLength(DEMO_SCRIPT.length + 1);
  });
});
