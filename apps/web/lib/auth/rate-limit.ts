import 'server-only';
import { restRpc } from '@/lib/supabase.server';

/**
 * A rate limiter shared by every instance of the web app: fixed-window counters kept in Postgres by the
 * `rate_limit_hit` function (one atomic upsert, so two requests cannot both take the last slot). The in-memory
 * `LoginThrottle` cannot do this on its own because each server instance would keep a separate count.
 */
export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** False when the shared store could not be reached and the answer is only a default. */
  shared: boolean;
}

interface HitRow {
  allowed: boolean;
  hits: number;
  retry_after_seconds: number;
}

/**
 * Counts one hit for `key`. If the store is unreachable it fails open (`allowed: true, shared: false`) so a
 * database hiccup does not stop people messaging each other; callers that want a stricter fallback check `shared`.
 */
export async function rateLimit(key: string, opts: { windowSeconds: number; max: number }): Promise<LimitResult> {
  try {
    const rows = await restRpc<HitRow[]>('rate_limit_hit', {
      p_key: key.slice(0, 200),
      p_window_seconds: opts.windowSeconds,
      p_max: opts.max,
    });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || typeof row.allowed !== 'boolean') throw new Error('rate_limit_hit returned nothing');
    return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds ?? 0, shared: true };
  } catch (error) {
    console.error(`[web] rate limit unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { allowed: true, retryAfterSeconds: 0, shared: false };
  }
}

/** Forgets a key (a successful sign-in clears its failed-attempt count). Best effort. */
export async function rateLimitReset(key: string): Promise<void> {
  try {
    await restRpc('rate_limit_reset', { p_key: key.slice(0, 200) });
  } catch {
    // The window will expire by itself.
  }
}

/** Limits used by the human chat, in one place. */
export const CHAT_LIMITS = {
  customerMessages: { windowSeconds: 60, max: 30 },
  staffMessages: { windowSeconds: 60, max: 60 },
  /** Typing signals are cheap but still bounded. */
  typing: { windowSeconds: 60, max: 40 },
  /** "I have read up to here" signals. */
  read: { windowSeconds: 60, max: 60 },
  /** Staff heartbeat (every ~30 s) and the availability switch. */
  presence: { windowSeconds: 60, max: 12 },
  /** Changes to administrator settings. */
  settings: { windowSeconds: 60, max: 10 },
} as const;
