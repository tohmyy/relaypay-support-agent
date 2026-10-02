import type { WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WarmPool } from '../../services/agent/src/warm';

function fakeWarm(label: string) {
  return { label, query: vi.fn(), close: vi.fn(), [Symbol.asyncDispose]: async () => {} } as unknown as WarmQuery & {
    label: string;
    close: ReturnType<typeof vi.fn>;
  };
}

function pool(over: Partial<ConstructorParameters<typeof WarmPool>[0]> = {}) {
  const started: { id: string; warm: ReturnType<typeof fakeWarm> }[] = [];
  const startup = vi.fn(async (params: { options?: unknown }) => {
    const id = (params.options as { conversationId: string }).conversationId;
    const warm = fakeWarm(id);
    started.push({ id, warm });
    return warm;
  });
  const p = new WarmPool({
    build: (conversationId) => ({ conversationId }) as never,
    startup: startup as never,
    ...over,
  });
  return { p, startup, started };
}

describe('WarmPool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts one warm process per conversation, with that conversation\'s options', async () => {
    const { p, startup } = pool();
    p.warm('vapi_a');
    p.warm('vapi_a'); // already warming
    p.warm('vapi_b');
    expect(startup).toHaveBeenCalledTimes(2);
    expect(startup.mock.calls.map(([x]) => (x.options as { conversationId: string }).conversationId)).toEqual(['vapi_a', 'vapi_b']);
    expect(p.size).toBe(2);
  });

  it('hands a warm process to its own conversation exactly once', async () => {
    const { p } = pool();
    p.warm('vapi_a');
    const first = await p.take('vapi_a');
    expect((first as unknown as { label: string }).label).toBe('vapi_a');
    expect(await p.take('vapi_a')).toBeUndefined();
    expect(p.size).toBe(0);
  });

  it('never hands one conversation another\'s process (the MCP headers carry the conversation id)', async () => {
    const { p } = pool();
    p.warm('vapi_a');
    expect(await p.take('vapi_b')).toBeUndefined();
    expect((await p.take('vapi_a')) as unknown as { label: string }).toMatchObject({ label: 'vapi_a' });
  });

  it('can be warmed again after it was taken (the next turn)', async () => {
    const { p, startup } = pool();
    p.warm('vapi_a');
    await p.take('vapi_a');
    p.warm('vapi_a');
    expect(startup).toHaveBeenCalledTimes(2);
    expect(p.size).toBe(1);
  });

  it('waits for a process that is still starting rather than starting a second one', async () => {
    let finish!: (w: WarmQuery) => void;
    const startup = vi.fn(() => new Promise<WarmQuery>((resolve) => (finish = resolve)));
    const p = new WarmPool({ build: () => ({}) as never, startup: startup as never });
    p.warm('vapi_a');
    const pending = p.take('vapi_a');
    const w = fakeWarm('late');
    finish(w);
    expect(await pending).toBe(w);
    expect(startup).toHaveBeenCalledOnce();
  });

  it('falls back to a cold start when warming fails, and never throws', async () => {
    const startup = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const p = new WarmPool({ build: () => ({}) as never, startup: startup as never });
    expect(() => p.warm('vapi_a')).not.toThrow();
    expect(await p.take('vapi_a')).toBeUndefined();
    expect(p.size).toBe(0);
    // And it can try again afterwards.
    p.warm('vapi_a');
    expect(startup).toHaveBeenCalledTimes(2);
  });

  it('skips warming when building the options fails', async () => {
    const startup = vi.fn();
    const p = new WarmPool({
      build: () => {
        throw new Error('missing MCP_SERVER_URL');
      },
      startup: startup as never,
    });
    expect(() => p.warm('vapi_a')).not.toThrow();
    expect(startup).not.toHaveBeenCalled();
    expect(p.size).toBe(0);
  });

  it('respects the cap: calls beyond it simply start cold, and nothing is evicted', async () => {
    const { p, startup } = pool({ max: 2 });
    p.warm('vapi_a');
    p.warm('vapi_b');
    p.warm('vapi_c');
    expect(startup).toHaveBeenCalledTimes(2);
    expect(p.size).toBe(2);
    expect(await p.take('vapi_c')).toBeUndefined();
    // Room frees up once one is used.
    await p.take('vapi_a');
    p.warm('vapi_c');
    expect(startup).toHaveBeenCalledTimes(3);
  });

  it('closes a process nobody used once it is old enough', async () => {
    const { p, started } = pool({ ttlMs: 60_000 });
    p.warm('vapi_a');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(started[0].warm.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started[0].warm.close).toHaveBeenCalledOnce();
    expect(p.size).toBe(0);
    expect(await p.take('vapi_a')).toBeUndefined();
  });

  it('does not close a process that was taken before it expired', async () => {
    const { p, started } = pool({ ttlMs: 60_000 });
    p.warm('vapi_a');
    await p.take('vapi_a');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(started[0].warm.close).not.toHaveBeenCalled();
  });

  it('closes a conversation\'s process when the call ends', async () => {
    const { p, started } = pool();
    p.warm('vapi_a');
    p.warm('vapi_b');
    await p.release('vapi_a');
    expect(started[0].warm.close).toHaveBeenCalledOnce();
    expect(started[1].warm.close).not.toHaveBeenCalled();
    expect(p.size).toBe(1);
    await p.release('vapi_a'); // already gone: harmless
    await p.release('unknown');
  });

  it('closes everything on dispose and refuses new warm-ups', async () => {
    const { p, started, startup } = pool();
    p.warm('vapi_a');
    p.warm('vapi_b');
    await p.dispose();
    expect(started.every((s) => s.warm.close.mock.calls.length === 1)).toBe(true);
    p.warm('vapi_c');
    expect(startup).toHaveBeenCalledTimes(2);
    expect(p.size).toBe(0);
  });

  it('survives a process that fails to close', async () => {
    const { p, started } = pool();
    p.warm('vapi_a');
    await vi.advanceTimersByTimeAsync(0);
    started[0].warm.close.mockImplementation(() => {
      throw new Error('already exited');
    });
    await expect(p.release('vapi_a')).resolves.toBeUndefined();
  });
});
