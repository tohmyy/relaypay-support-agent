/** Session limits the customer UI renders around. The agent service enforces them; the browser never decides. */
export interface SessionLimits {
  /** Absolute AI voice session lifetime. */
  sessionMaxSeconds: number;
  /** The "session ending soon" notice shows for this many seconds before the limit. */
  warningSeconds: number;
  /** Quiet time before the visible countdown starts. */
  silenceTimeoutSeconds: number;
  /** Visible countdown length. */
  countdownSeconds: number;
}

/** After a call ends the customer can resume it for this long, keeping the transcript (Build Plan V3, V3.14). */
export const RESUME_GRACE_MS = 30_000;

/** Ends a conversation can be resumed from. Mirrors `RESUMABLE_END_REASONS` in the agent service; a test keeps them equal. */
export const RESUMABLE_END_REASONS = ['user-ended', 'agent-ended', 'silence-timeout', 'error'] as const;

export const DEFAULT_LIMITS: SessionLimits = {
  sessionMaxSeconds: 360,
  warningSeconds: 30,
  silenceTimeoutSeconds: 15,
  countdownSeconds: 10,
};

function seconds(value: string | undefined, fallback: number, min: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= min ? n : fallback;
}

/** Same variables the agent service reads, so both sides always agree. Invalid or blank values use defaults. */
export function sessionLimitsFromEnv(
  env: Record<string, string | undefined> = process.env,
): SessionLimits {
  const sessionMaxSeconds = seconds(env.SESSION_MAX_SECONDS, DEFAULT_LIMITS.sessionMaxSeconds, 10);
  return {
    sessionMaxSeconds,
    warningSeconds: Math.min(
      seconds(env.SESSION_WARNING_SECONDS, DEFAULT_LIMITS.warningSeconds, 1),
      sessionMaxSeconds - 1,
    ),
    silenceTimeoutSeconds: seconds(env.SILENCE_TIMEOUT_SECONDS, DEFAULT_LIMITS.silenceTimeoutSeconds, 1),
    countdownSeconds: seconds(env.SILENCE_COUNTDOWN_SECONDS, DEFAULT_LIMITS.countdownSeconds, 1),
  };
}
