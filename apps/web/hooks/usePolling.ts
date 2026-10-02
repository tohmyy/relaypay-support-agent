'use client';

import { useEffect, useRef } from 'react';
import { nextDelay } from '@/lib/human/schedule';

/** What one poll reports: it worked, it failed (so the next wait grows), or there is nothing more to poll for. */
export type PollResult = 'ok' | 'failed' | 'stop';

export interface UsePollingOptions {
  /** Wait between polls while the page is in front. */
  foregroundMs?: number;
  /** Wait while the page is hidden. */
  hiddenMs?: number;
  enabled?: boolean;
  /** Injectable for tests. */
  random?: () => number;
}

/**
 * Runs `poll` over and over: quickly while the page is visible, slowly while hidden, paused while the device is offline,
 * with a growing wait after failures. It polls straight away when the page becomes visible or the connection returns, and
 * stops for good when a poll answers `stop`. The latest `poll` function is always used, so it can close over fresh state.
 */
export function usePolling(poll: () => Promise<PollResult>, options: UsePollingOptions = {}): void {
  const { foregroundMs = 2000, hiddenMs = 10_000, enabled = true, random } = options;
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });
  const rng = useRef(random);
  useEffect(() => {
    rng.current = random;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;

    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

    const schedule = () => {
      if (cancelled) return;
      const delay = nextDelay({
        foregroundMs,
        hiddenMs,
        visible: visible(),
        failures,
        random: rng.current ? rng.current() : Math.random(),
      });
      timer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled || running) return;
      if (timer) clearTimeout(timer);
      if (!online()) return schedule(); // nothing to ask while offline; look again later
      running = true;
      let result: PollResult = 'failed';
      try {
        result = await latest.current();
      } catch {
        result = 'failed';
      } finally {
        running = false;
      }
      if (cancelled || result === 'stop') return;
      failures = result === 'ok' ? 0 : failures + 1;
      schedule();
    };

    const wake = () => {
      if (cancelled || !visible() || !online()) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [enabled, foregroundMs, hiddenMs]);
}
