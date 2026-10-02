/**
 * Abuse limits as the web app sees them (Build Plan V2 Iteration 10). The voice agent enforces the same limits on its
 * side from the same environment variables (docs/ABUSE.md); the web app only uses them to answer the browser quickly.
 * 0 turns a limit off.
 */
export interface WebAbuseLimits {
  maxConcurrentSessions: number;
  sessionRateMax: number;
  sessionRateWindowSeconds: number;
  /** Used to tell an abandoned conversation from a live one. */
  sessionMaxSeconds: number;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function abuseLimitsFromEnv(env: Record<string, string | undefined> = process.env): WebAbuseLimits {
  return {
    maxConcurrentSessions: int(env.MAX_CONCURRENT_SESSIONS, 1, 0, 20),
    sessionRateMax: int(env.SESSION_RATE_MAX, 8, 0, 1000),
    sessionRateWindowSeconds: int(env.SESSION_RATE_WINDOW_SECONDS, 3600, 10, 86400),
    sessionMaxSeconds: int(env.SESSION_MAX_SECONDS, 360, 10, 86400),
  };
}

export interface OpenSessionRow {
  conversation_id: string;
  started_at: string | null;
  last_activity_at: string | null;
}

/**
 * Other open AI voice sessions of the same customer that began before this one. Open and recently active only, so a
 * row left behind by a crashed call cannot block the customer for ever.
 */
export function activeEarlierIds(
  rows: OpenSessionRow[],
  thisStartedAtMs: number,
  opts: { maxSeconds: number; now?: number },
): string[] {
  const now = opts.now ?? Date.now();
  const staleAfterMs = (opts.maxSeconds + 120) * 1000;
  return rows
    .filter((r) => {
      const started = Date.parse(r.started_at ?? '');
      const last = Date.parse(r.last_activity_at ?? '') || started;
      return Number.isFinite(started) && started < thisStartedAtMs && now - last < staleAfterMs;
    })
    .map((r) => r.conversation_id);
}
