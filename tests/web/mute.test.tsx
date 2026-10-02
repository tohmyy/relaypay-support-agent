// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { NEUTRAL_STATE } from '@/lib/conversation-state';
import { DEFAULT_LIMITS } from '@/lib/session/limits';
import { MockVoiceClient } from '@/lib/voice/mock-client';

afterEach(() => vi.useRealTimers());

describe('mute control', () => {
  it('keeps the actual provider state when setMuted rejects the change', async () => {
    const client = new MockVoiceClient([], 'vapi_test-call');
    client.setMuted = vi.fn(async () => false);
    const fetchState = vi.fn(async () => ({
      ...NEUTRAL_STATE,
      startedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      limits: DEFAULT_LIMITS,
    }));
    const hook = renderHook(() =>
      useVoiceSession({ createClient: () => client, fetchState, checkMic: async () => null, pollMs: 500 }),
    );

    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());

    expect(hook.result.current.muted).toBe(false);
    await act(async () => {
      await hook.result.current.toggleMute();
    });
    expect(client.setMuted).toHaveBeenCalledWith(true);
    expect(hook.result.current.muted).toBe(false);
    expect(hook.result.current.muteFailed).toBe(true);
  });
});
