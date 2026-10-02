// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import type { PublicConversationState } from '@/lib/conversation-state';
import { runPreflight, type PreflightResult } from '@/lib/support/preflight';
import { fetchConversationState } from '@/lib/support/state-client';
import { emptyBackendState } from '@/lib/support/derive';
import { MockVoiceClient } from '@/lib/voice/mock-client';

afterEach(() => vi.unstubAllGlobals());

/** Routes fetch by "METHOD /path"; each entry is a queue of statuses, the last one repeating. */
function stubFetch(routes: Record<string, { status: number; json?: unknown }[]>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      const queue = routes[key];
      if (!queue) return new Response('{}', { status: 404 });
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return new Response(JSON.stringify(next.json ?? {}), { status: next.status });
    }),
  );
  return calls;
}

const READY = 'GET /api/support/ready';
const START = 'POST /api/support/start';

describe('runPreflight', () => {
  it('is ok when support is available and the customer may begin', async () => {
    const calls = stubFetch({ [READY]: [{ status: 200 }], [START]: [{ status: 200, json: { authorized: true } }] });
    expect(await runPreflight()).toBe('ok');
    expect(calls).toEqual([READY, START]);
  });

  it('is unavailable (and never starts) when readiness keeps failing, after exactly one retry', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({ [READY]: [{ status: 503 }] });
    const result = runPreflight();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toBe('unavailable');
    expect(calls).toEqual([READY, READY]);
    vi.useRealTimers();
  });

  it('recovers when the single automatic retry succeeds', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({
      [READY]: [{ status: 503 }, { status: 200 }],
      [START]: [{ status: 200, json: { authorized: true } }],
    });
    const result = runPreflight();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toBe('ok');
    expect(calls).toEqual([READY, READY, START]);
    vi.useRealTimers();
  });

  it('sends a lapsed sign-in back to sign in, without retrying', async () => {
    const calls = stubFetch({ [READY]: [{ status: 401 }] });
    expect(await runPreflight()).toBe('unauthorized');
    expect(calls).toEqual([READY]);
  });

  it.each([
    [409, 'active-session'],
    [429, 'rate-limited'],
  ] as const)('reports a %s as %s without retrying it', async (status, reason) => {
    const calls = stubFetch({ [READY]: [{ status: 200 }], [START]: [{ status, json: { error: reason } }] });
    expect(await runPreflight()).toBe(reason);
    expect(calls.filter((c) => c === START)).toHaveLength(1);
  });
});

function setup(preflight: () => Promise<PreflightResult>, over: { mic?: 'microphone' | 'no-microphone' | null } = {}) {
  const client = new MockVoiceClient([], 'vapi_test-call');
  const createClient = vi.fn(() => client);
  const checkMic = vi.fn(async () => over.mic ?? null);
  const hook = renderHook(() =>
    useVoiceSession({
      createClient,
      fetchState: async (): Promise<PublicConversationState | null> => emptyBackendState,
      checkMic,
      preflight,
      pollMs: 20,
    }),
  );
  return { client, createClient, checkMic, hook };
}
const startCall = (s: ReturnType<typeof setup>) =>
  act(async () => {
    await s.hook.result.current.start();
  });

describe('useVoiceSession preflight', () => {
  it('starts normally when the preflight passes', async () => {
    const s = setup(async () => 'ok');
    await startCall(s);
    expect(s.createClient).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.voice.state).toBe('connecting');
  });

  it('shows the "unavailable" screen and neither asks for the microphone nor starts a call', async () => {
    const s = setup(async () => 'unavailable');
    await startCall(s);
    expect(s.hook.result.current.voice).toEqual({ state: 'error', error: 'unavailable' });
    expect(s.checkMic).not.toHaveBeenCalled();
    expect(s.createClient).not.toHaveBeenCalled();
  });

  it('returns to idle with a reason when a conversation limit applies', async () => {
    const s = setup(async () => 'active-session');
    await startCall(s);
    expect(s.hook.result.current.voice.state).toBe('idle');
    expect(s.hook.result.current.blocked).toBe('active-session');
    expect(s.createClient).not.toHaveBeenCalled();
  });

  it('flags a lapsed sign-in so the page can send the customer to sign in', async () => {
    const s = setup(async () => 'unauthorized');
    await startCall(s);
    expect(s.hook.result.current.signedOut).toBe(true);
    expect(s.createClient).not.toHaveBeenCalled();
  });

  it('a manual Try again runs the whole preflight again with a fresh budget', async () => {
    const preflight = vi.fn<() => Promise<PreflightResult>>().mockResolvedValueOnce('unavailable').mockResolvedValueOnce('ok');
    const s = setup(preflight);
    await startCall(s);
    expect(s.hook.result.current.voice.state).toBe('error');
    await startCall(s);
    expect(preflight).toHaveBeenCalledTimes(2);
    expect(s.hook.result.current.voice.state).toBe('connecting');
  });

  it.each(['microphone', 'no-microphone'] as const)(
    'does not start a call when the microphone check says %s, and does not retry on its own',
    async (kind) => {
      const s = setup(async () => 'ok', { mic: kind });
      await startCall(s);
      expect(s.hook.result.current.voice).toEqual({ state: 'error', error: kind });
      expect(s.createClient).not.toHaveBeenCalled();
      expect(s.checkMic).toHaveBeenCalledTimes(1);
    },
  );
});

describe('quiet notice while status updates fail', () => {
  it('keeps the last snapshot and raises, then clears, the notice', async () => {
    let fail = true;
    const client = new MockVoiceClient([], 'vapi_test-call');
    const good: PublicConversationState = { ...emptyBackendState, ticketReference: 'TKT-000001' };
    const { result } = renderHook(() =>
      useVoiceSession({
        createClient: () => client,
        fetchState: async () => (fail ? null : good),
        checkMic: async () => null,
        pollMs: 20,
      }),
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    await waitFor(() => expect(result.current.statusUnavailable).toBe(true));
    expect(result.current.backend).toEqual(emptyBackendState);
    fail = false;
    await waitFor(() => expect(result.current.statusUnavailable).toBe(false));
    expect(result.current.backend.ticketReference).toBe('TKT-000001');
  });
});

describe('state poll retry (AC-30.*, failure injection "state 503 once")', () => {
  it('retries a 503 once and returns the state', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({ 'GET /api/conversations/vapi_abc/state': [{ status: 503 }, { status: 200, json: { ended: false, ticketReference: 'TKT-000001' } }] });
    const result = fetchConversationState('vapi_abc');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toMatchObject({ ended: false, ticketReference: 'TKT-000001' });
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('gives up after the one retry (null, so the page keeps its last snapshot), and never retries a 404', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({ 'GET /api/conversations/vapi_abc/state': [{ status: 503 }] });
    const result = fetchConversationState('vapi_abc');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toBeNull();
    expect(calls).toHaveLength(2);
    vi.useRealTimers();

    const once = stubFetch({ 'GET /api/conversations/vapi_abc/state': [{ status: 404 }] });
    expect(await fetchConversationState('vapi_abc')).toBeNull();
    expect(once).toHaveLength(1);
  });
});
