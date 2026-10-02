import { failFor, PermanentError, withRetry } from '../retry';

/** What the browser learns before it begins a call (docs/BUILD-PLAN-V3.md V3.1 and V3.7). */
export type PreflightStatus =
  | 'ok'
  /** Support is not reachable right now. */
  | 'unavailable'
  /** The sign-in has lapsed; the page should send the customer to sign in again. */
  | 'unauthorized'
  | 'active-session'
  | 'rate-limited';

export type PreflightResult =
  | PreflightStatus
  | { status: PreflightStatus; activeConversationId?: string };

export function preflightStatus(result: PreflightResult): PreflightStatus {
  return typeof result === 'string' ? result : result.status;
}

export function preflightActiveId(result: PreflightResult): string | undefined {
  return typeof result === 'string' ? undefined : result.activeConversationId;
}

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
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          activeConversationId?: unknown;
        };
        if (res.status === 409 && body.error === 'active-session') {
          return typeof body.activeConversationId === 'string'
            ? { status: 'active-session', activeConversationId: body.activeConversationId }
            : 'active-session';
        }
        if (res.status === 429 && body.error === 'rate-limited') return 'rate-limited';
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
