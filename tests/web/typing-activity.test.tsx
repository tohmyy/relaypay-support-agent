// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypingActivity } from '@/hooks/useTypingActivity';
import { TYPING_HEARTBEAT_MS } from '@/lib/session/typing';

describe('useTypingActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends start on the first keystroke, a heartbeat at most every 3s, and stop on idle/unmount', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(({ id }: { id: string | null }) => useTypingActivity(id), {
      initialProps: { id: 'vapi_abc' },
    });

    act(() => hook.result.current(true));
    expect(fetchMock.mock.calls.length).toBe(1);
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(first[0])).toContain('/activity');
    expect(JSON.parse(String(first[1].body))).toEqual({ type: 'start' });

    act(() => hook.result.current(true));
    expect(fetchMock.mock.calls.length).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TYPING_HEARTBEAT_MS);
    });
    act(() => hook.result.current(true));
    expect(fetchMock.mock.calls.length).toBe(2);
    const heartbeat = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(heartbeat[1].body))).toEqual({ type: 'heartbeat' });

    act(() => hook.result.current(false));
    const stop = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(String(stop[1].body))).toEqual({ type: 'stop' });

    act(() => hook.unmount());
  });
});
