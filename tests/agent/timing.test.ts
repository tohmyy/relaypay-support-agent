import { describe, expect, it } from 'vitest';
import { TurnTimer } from '../../services/agent/src/timing';

function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('TurnTimer', () => {
  it('measures from when it was created', () => {
    const c = clock();
    const timer = new TurnTimer(c.now);
    expect(timer.elapsed()).toBe(0);
    c.advance(250);
    expect(timer.elapsed()).toBe(250);
    c.advance(1);
    expect(timer.time()).toBe(1251);
  });

  it('records how long a step took, whatever it returns', async () => {
    const c = clock();
    const timer = new TurnTimer(c.now);
    const value = await timer.span('retrieval_ms', async () => {
      c.advance(80);
      return 'chunks';
    });
    expect(value).toBe('chunks');
    expect(timer.get('retrieval_ms')).toBe(80);
  });

  it('still records the time and passes the error on when a step fails', async () => {
    const c = clock();
    const timer = new TurnTimer(c.now);
    await expect(
      timer.span('history_ms', async () => {
        c.advance(30);
        throw new Error('db down');
      }),
    ).rejects.toThrow('db down');
    expect(timer.get('history_ms')).toBe(30);
  });

  it('rounds to whole milliseconds and never goes negative', () => {
    const timer = new TurnTimer(() => 0);
    timer.set('save_ms', 12.6);
    timer.set('queue_ms', -5);
    expect(timer.get('save_ms')).toBe(13);
    expect(timer.get('queue_ms')).toBe(0);
  });

  it('keeps labels and flags as they are', () => {
    const timer = new TurnTimer(() => 0);
    timer.set('ack_category', 'payout_lookup');
    timer.set('prewarmed', false);
    expect(timer.toJSON()).toEqual({ ack_category: 'payout_lookup', prewarmed: false });
  });

  it('adds tool calls and keeps mcp_ms as their sum', () => {
    const timer = new TurnTimer(() => 0);
    timer.addTool('lookup_transaction', 310.4);
    timer.addTool('lookup_payout', 190);
    expect(timer.toJSON().tools).toEqual([
      { name: 'lookup_transaction', ms: 310 },
      { name: 'lookup_payout', ms: 190 },
    ]);
    expect(timer.get('mcp_ms')).toBe(500);
  });

  it('derives model time from the whole agent loop minus start-up and tools', () => {
    const timer = new TurnTimer(() => 0);
    timer.set('agent_ms', 5000);
    timer.set('sdk_start_ms', 1200);
    timer.addTool('lookup_payout', 800);
    timer.finishAgent();
    expect(timer.get('model_ms')).toBe(3000);
  });

  it('does not derive model time when the agent never ran', () => {
    const timer = new TurnTimer(() => 0);
    timer.finishAgent();
    expect(timer.get('model_ms')).toBeUndefined();
  });

  it('never reports negative model time', () => {
    const timer = new TurnTimer(() => 0);
    timer.set('agent_ms', 100);
    timer.set('sdk_start_ms', 90);
    timer.addTool('lookup_customer', 50);
    timer.finishAgent();
    expect(timer.get('model_ms')).toBe(0);
  });

  it('hands out a copy, so later changes do not leak into what was stored', () => {
    const timer = new TurnTimer(() => 0);
    timer.set('queue_ms', 5);
    const snapshot = timer.toJSON();
    timer.set('queue_ms', 99);
    expect(snapshot.queue_ms).toBe(5);
  });
});
