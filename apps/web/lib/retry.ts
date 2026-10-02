// Shared retry policy (docs/BUILD-PLAN-V3.md V3.2): the initial attempt plus at most ONE automatic retry, only for
// transient, idempotent work. The agent service has a twin of this file (services/agent/src/retry.ts); keep them in
// step. A manual "Try again" is a new logical operation and gets a fresh budget.

export interface RetryEvent {
  operation: string;
  /** 1 for the first try, 2 for the single automatic retry. */
  attempt: 1 | 2;
  errorClass: 'transient' | 'permanent' | null;
  durationMs: number;
  outcome: 'ok' | 'retrying' | 'failed';
}

export interface RetryOptions {
  /** Names the operation in telemetry. */
  operation: string;
  /** True when the failure is worth one more try. Defaults to: everything except a `PermanentError`. */
  isTransient?: (error: unknown) => boolean;
  /** Overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Backoff before the retry. Defaults to 300–800 ms of jitter. */
  backoffMs?: () => number;
  onEvent?: (event: RetryEvent) => void;
}

/** Marks a failure that must not be retried (401/403/404/409, validation, a missing microphone). */
export class PermanentError extends Error {
  constructor(message = 'permanent failure') {
    super(message);
    this.name = 'PermanentError';
  }
}

export function jitterMs(): number {
  return 300 + Math.floor(Math.random() * 500);
}

/** HTTP statuses worth one more try. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

/** Throws `PermanentError` for statuses that retrying cannot fix, a plain `Error` for transient ones. */
export function failFor(status: number): never {
  if (isTransientStatus(status) || status >= 500) throw new Error(`transient status ${status}`);
  throw new PermanentError(`status ${status}`);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `op`; if it throws a transient error, waits briefly and runs it once more. Never more than two attempts. */
export async function withRetry<T>(op: () => Promise<T>, options: RetryOptions): Promise<T> {
  const isTransient = options.isTransient ?? ((e) => !(e instanceof PermanentError));
  const sleep = options.sleep ?? defaultSleep;
  const emit = options.onEvent ?? (() => undefined);
  const backoff = options.backoffMs ?? jitterMs;

  const started = Date.now();
  try {
    const value = await op();
    emit({ operation: options.operation, attempt: 1, errorClass: null, durationMs: Date.now() - started, outcome: 'ok' });
    return value;
  } catch (first) {
    const transient = isTransient(first);
    emit({
      operation: options.operation,
      attempt: 1,
      errorClass: transient ? 'transient' : 'permanent',
      durationMs: Date.now() - started,
      outcome: transient ? 'retrying' : 'failed',
    });
    if (!transient) throw first;
    await sleep(backoff());
  }

  const retryStarted = Date.now();
  try {
    const value = await op();
    emit({ operation: options.operation, attempt: 2, errorClass: null, durationMs: Date.now() - retryStarted, outcome: 'ok' });
    return value;
  } catch (second) {
    emit({
      operation: options.operation,
      attempt: 2,
      errorClass: isTransient(second) ? 'transient' : 'permanent',
      durationMs: Date.now() - retryStarted,
      outcome: 'failed',
    });
    throw second;
  }
}
