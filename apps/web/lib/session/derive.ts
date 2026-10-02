import type { PublicEndReason } from '../conversation-state';
import type { SupportState } from '../support/derive';
import type { VoiceState } from '../voice/state';
import type { SessionLimits } from './limits';

/** What the session-timing notices show right now. Derived each tick; never a state of its own. */
export interface SessionView {
  /** Whole seconds left on the silence countdown, or null when it is not showing. */
  silenceCountdown: number | null;
  /** Whole seconds left in the session, or null when unknown. */
  secondsLeft: number | null;
  /** True during the final warning window. */
  sessionWarning: boolean;
}

export const IDLE_SESSION_VIEW: SessionView = { silenceCountdown: null, secondsLeft: null, sessionWarning: false };

/** While the contact form is open the customer is expected to be quiet; the agent service does not measure silence then. */
// While a callback time is being agreed in the conversation the customer is expected to be quiet or typing.
const HOLDS_SILENCE: SupportState[] = ['escalation-required'];

export interface SessionViewInput {
  voiceState: VoiceState;
  supportState: SupportState;
  limits: SessionLimits | null;
  /** Server-clock ms when the session started, once known. */
  startedAtMs: number | null;
  /** Client-clock ms when the customer's quiet time began (entered `listening`), else null. */
  quietSinceMs: number | null;
  /** Client clock now, ms. */
  nowMs: number;
  /** serverNow - clientNow, ms, from the last snapshot. */
  clockOffsetMs: number;
  /** The customer is typing: hold the silence countdown only, never the hard session deadline. */
  typingActive?: boolean;
}

export function deriveSessionView(i: SessionViewInput): SessionView {
  const { limits } = i;
  if (!limits) return IDLE_SESSION_VIEW;

  let secondsLeft: number | null = null;
  if (i.startedAtMs !== null) {
    const endsAt = i.startedAtMs + limits.sessionMaxSeconds * 1000;
    secondsLeft = Math.ceil((endsAt - (i.nowMs + i.clockOffsetMs)) / 1000);
  }
  const sessionWarning =
    secondsLeft !== null && secondsLeft > 0 && secondsLeft <= limits.warningSeconds;

  let silenceCountdown: number | null = null;
  if (
    !i.typingActive &&
    i.quietSinceMs !== null &&
    i.voiceState === 'listening' &&
    !HOLDS_SILENCE.includes(i.supportState)
  ) {
    const quietMs = i.nowMs - i.quietSinceMs;
    const afterTimeoutMs = quietMs - limits.silenceTimeoutSeconds * 1000;
    if (afterTimeoutMs >= 0) {
      // Counts 10, 9 ... 1; the call ends when it would reach 0.
      silenceCountdown = Math.max(1, limits.countdownSeconds - Math.floor(afterTimeoutMs / 1000));
    }
  }
  return { silenceCountdown, secondsLeft, sessionWarning };
}

/**
 * A reason to show the moment the call drops, before the server's recorded reason has been read:
 * a visible countdown that ran out, or a session already at its limit.
 */
export function provisionalEndReason(view: SessionView): PublicEndReason | null {
  if (view.silenceCountdown !== null) return 'silence-timeout';
  if (view.secondsLeft !== null && view.secondsLeft <= 1) return 'session-timeout';
  return null;
}
