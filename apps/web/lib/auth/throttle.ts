/**
 * Slows down password guessing: after too many failed sign-ins for the same email and address within a window,
 * further attempts are refused until the window passes. A success clears the count.
 *
 * In-memory, so it applies per server instance and resets on restart. That is enough for the demo shell; a limiter
 * shared across instances belongs with the abuse-prevention work (Build Plan V2, Iteration 10).
 */
export interface ThrottleOptions {
  maxFailures?: number;
  windowMs?: number;
  /** Most distinct keys remembered, so a flood of made-up emails cannot grow memory without bound. */
  maxKeys?: number;
  now?: () => number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(opts: ThrottleOptions = {}) {
    this.maxFailures = opts.maxFailures ?? 5;
    this.windowMs = opts.windowMs ?? 15 * 60_000;
    this.maxKeys = opts.maxKeys ?? 5000;
    this.now = opts.now ?? Date.now;
  }

  static key(email: string, address: string): string {
    return `${email.trim().toLowerCase().slice(0, 254)}|${address.slice(0, 64)}`;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  /** Milliseconds until another attempt is allowed, or 0 if one is allowed now. */
  retryAfterMs(key: string): number {
    const list = this.recent(key);
    if (list.length < this.maxFailures) return 0;
    return Math.max(0, list[0] + this.windowMs - this.now());
  }

  recordFailure(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
    if (this.failures.size > this.maxKeys) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  get size(): number {
    return this.failures.size;
  }
}

/** The shared limiter the sign-in action uses. */
export const loginThrottle = new LoginThrottle();
