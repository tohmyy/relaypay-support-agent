/**
 * How long to wait before the next poll. Pure, so the rules are plain tests: quick while the page is in front, slow
 * while it is hidden, slower after failures, and a little randomised so many tabs do not all ask at the same instant.
 */
export const MAX_POLL_DELAY_MS = 30_000;

export interface DelayOptions {
  /** Delay while the page is visible. */
  foregroundMs: number;
  /** Delay while the page is hidden (another tab or a minimised window). */
  hiddenMs: number;
  visible: boolean;
  /** Polls in a row that failed. */
  failures: number;
  /** A number in [0, 1); injectable for tests. */
  random?: number;
}

export function nextDelay({ foregroundMs, hiddenMs, visible, failures, random = 0.5 }: DelayOptions): number {
  const base = visible ? foregroundMs : hiddenMs;
  const backedOff = Math.min(MAX_POLL_DELAY_MS, base * 2 ** Math.min(Math.max(failures, 0), 3));
  // ±15 %: random 0.5 is exactly the base.
  const jitter = 1 + (random - 0.5) * 0.3;
  return Math.max(250, Math.round(backedOff * jitter));
}
