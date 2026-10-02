import { NEUTRAL_STATE, type PublicConversationState } from '../conversation-state';
import type { SessionLimits } from '../session/limits';
import type { MockStep } from './mock-client';

/** Short limits so the silence countdown and the end screen can be seen within seconds in preview mode. */
export const MOCK_LIMITS: SessionLimits = {
  sessionMaxSeconds: 120,
  warningSeconds: 30,
  silenceTimeoutSeconds: 6,
  countdownSeconds: 5,
};

/**
 * Stands in for the state API in preview mode, where there is no backend: the session "started" when the
 * first snapshot was asked for, and the limits are the short preview ones.
 */
export function createMockStateFetcher(limits: SessionLimits = MOCK_LIMITS) {
  let startedAt: string | null = null;
  return async (): Promise<PublicConversationState> => {
    const now = new Date().toISOString();
    startedAt ??= now;
    return { ...NEUTRAL_STATE, startedAt, serverTime: now, limits };
  };
}

/** The demo conversation, then silence: the countdown shows and the call ends like the agent service would end it. */
export function silenceDemoScript(base: MockStep[], limits: SessionLimits = MOCK_LIMITS): MockStep[] {
  const lastAt = Math.max(0, ...base.map((s) => s.at));
  const endAt = lastAt + (limits.silenceTimeoutSeconds + limits.countdownSeconds + 1) * 1000;
  return [...base, { at: endAt, run: (h) => h.onCallEnd() }];
}
