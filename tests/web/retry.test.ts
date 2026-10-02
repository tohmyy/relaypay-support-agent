import { describe, expect, it, vi } from 'vitest';
import { failFor, isTransientStatus, PermanentError, withRetry, type RetryEvent } from '@/lib/retry';

const noSleep = async () => {};

describe('withRetry (max one automatic retry)', () => {
  it('returns the first result without retrying', async () => {
    const op = vi.fn(async () => 'ok');
    expect(await withRetry(op, { operation: 't', sleep: noSleep })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure exactly once, then succeeds (two attempts)', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce('ok');
    expect(await withRetry(op, { operation: 't', sleep: noSleep })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry and rethrows the last error', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));
    await expect(withRetry(op, { operation: 't', sleep: noSleep })).rejects.toThrow('second');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('never retries a permanent failure', async () => {
    const op = vi.fn().mockRejectedValue(new PermanentError('409'));
    await expect(withRetry(op, { operation: 't', sleep: noSleep })).rejects.toThrow('409');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('honours a custom transient test', async () => {
    const op = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(withRetry(op, { operation: 't', sleep: noSleep, isTransient: () => false })).rejects.toThrow('nope');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('waits 300–800 ms of jitter before the retry', async () => {
    const waits: number[] = [];
    const op = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok');
    await withRetry(op, { operation: 't', sleep: async (ms) => void waits.push(ms) });
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(300);
    expect(waits[0]).toBeLessThan(800);
  });

  it('reports telemetry: operation, attempt, class and outcome', async () => {
    const events: RetryEvent[] = [];
    const op = vi.fn().mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('y'));
    await expect(
      withRetry(op, { operation: 'link', sleep: noSleep, onEvent: (e) => events.push(e) }),
    ).rejects.toThrow();
    expect(events.map((e) => [e.operation, e.attempt, e.errorClass, e.outcome])).toEqual([
      ['link', 1, 'transient', 'retrying'],
      ['link', 2, 'transient', 'failed'],
    ]);
  });

  it('classifies HTTP statuses', () => {
    for (const s of [408, 429, 502, 503, 504]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 409]) expect(isTransientStatus(s)).toBe(false);
    expect(() => failFor(503)).toThrow(/transient/);
    expect(() => failFor(409)).toThrow(PermanentError);
    expect(() => failFor(500)).not.toThrow(PermanentError);
  });
});
