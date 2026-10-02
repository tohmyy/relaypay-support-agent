import { failFor, PermanentError, withRetry } from '../retry';

/** What the browser learns before it begins a call (docs/BUILD-PLAN-V3.md V3.1 and V3.7). */
export type PreflightResult =
  | 'ok'
  /** Support is not reachable right now. */
  | 'unavailable'
  /** The sign-in has lapsed; the page should send the customer to sign in again. */
  | 'unauthorized'
  | 'active-session'
  | 'rate-limited';

/**
 * 1. Is support available? (`GET /api/support/ready`, one automatic retry on a transient failure)
 * 2. May this customer begin another call? (`POST /api/support/start`, same retry rule; limits are not retried)
 *
 * A manual "Try again" calls this again, which gives it a fresh retry budget.
 */
export async function runPreflight(): Promise<PreflightResult> {
  try {
    await withRetry(
      async () => {
        const res = await fetch('/api/support/ready', { cache: 'no-store' });
        if (res.status === 401 || res.status === 403) throw new SignedOut();
        if (!res.ok) failFor(res.status);
      },
      { operation: 'ready' },
    );
  } catch (error) {
    return error instanceof SignedOut ? 'unauthorized' : 'unavailable';
  }

  try {
    return await withRetry(
      async (): Promise<PreflightResult> => {
        const res = await fetch('/api/support/start', { method: 'POST', cache: 'no-store' });
        if (res.ok) return 'ok';
        if (res.status === 401 || res.status === 403) throw new SignedOut();
        const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        if (res.status === 409 && reason === 'active-session') return 'active-session';
        if (res.status === 429 && reason === 'rate-limited') return 'rate-limited';
        return failFor(res.status);
      },
      { operation: 'start' },
    );
  } catch (error) {
    return error instanceof SignedOut ? 'unauthorized' : 'unavailable';
  }
}

class SignedOut extends PermanentError {
  constructor() {
    super('signed out');
  }
}
