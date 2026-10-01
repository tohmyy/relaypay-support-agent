// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { contactMessage, useVoiceSession } from '@/hooks/useVoiceSession';
import type { PublicConversationState } from '@/lib/conversation-state';
import { emptyBackendState } from '@/lib/support/derive';
import { MockVoiceClient } from '@/lib/voice/mock-client';

function setup(over: { backend?: () => PublicConversationState; mic?: 'microphone' | null; client?: MockVoiceClient } = {}) {
  const client = over.client ?? new MockVoiceClient([], 'vapi_test-call');
  const createClient = vi.fn(() => client);
  let backend: PublicConversationState = emptyBackendState;
  const fetchState = vi.fn(async () => (over.backend ? over.backend() : backend));
  const hook = renderHook(() =>
    useVoiceSession({ createClient, fetchState, checkMic: async () => over.mic ?? null, pollMs: 20 }),
  );
  return {
    client,
    createClient,
    fetchState,
    hook,
    setBackend: (b: PublicConversationState) => {
      backend = b;
    },
  };
}

async function startCall(s: ReturnType<typeof setup>) {
  await act(async () => {
    await s.hook.result.current.start();
  });
}

describe('useVoiceSession', () => {
  it('connects, listens, and follows the call through a full exchange', async () => {
    const s = setup();
    expect(s.hook.result.current.voice.state).toBe('idle');
    await startCall(s);
    expect(s.hook.result.current.voice.state).toBe('connecting');
    const h = s.client.handlers!;

    act(() => h.onCallStart());
    expect(s.hook.result.current.voice.state).toBe('listening');

    act(() => {
      h.onUserSpeech(true);
      h.onTranscript({ role: 'user', text: 'Check TXN', final: false });
    });
    expect(s.hook.result.current.voice.state).toBe('user-speaking');

    act(() => {
      h.onTranscript({ role: 'user', text: 'Check TXN-9001', final: true });
      h.onUserSpeech(false);
    });
    expect(s.hook.result.current.voice.state).toBe('processing');
    expect(s.hook.result.current.turns).toHaveLength(1);

    act(() => {
      h.onAssistantSpeech(true);
      h.onVolume(0.7);
      h.onTranscript({ role: 'assistant', text: 'It is processing.', final: true });
    });
    expect(s.hook.result.current.voice.state).toBe('assistant-speaking');
    expect(s.hook.result.current.level).toBe(0.7);

    act(() => h.onAssistantSpeech(false));
    expect(s.hook.result.current.voice.state).toBe('listening');
    expect(s.hook.result.current.turns.map((t) => t.speaker)).toEqual(['user', 'assistant']);
  });

  it('shows the microphone message and never creates a call when access is refused', async () => {
    const s = setup({ mic: 'microphone' });
    await startCall(s);
    expect(s.hook.result.current.voice).toEqual({ state: 'error', error: 'microphone' });
    expect(s.createClient).not.toHaveBeenCalled();
  });

  it('shows a connection error when the call cannot start, and can retry', async () => {
    const s = setup({ client: new MockVoiceClient([], 'x', new Error('boom')) });
    await startCall(s);
    expect(s.hook.result.current.voice).toEqual({ state: 'error', error: 'connection' });
    await startCall(s);
    expect(s.createClient).toHaveBeenCalledTimes(2);
  });

  it('reports provider errors from inside a call', async () => {
    const s = setup();
    await startCall(s);
    act(() => s.client.handlers!.onCallStart());
    act(() => s.client.handlers!.onError('connection'));
    expect(s.hook.result.current.voice).toEqual({ state: 'error', error: 'connection' });
  });

  it('ends the call and offers a fresh start that clears the old session', async () => {
    const s = setup();
    await startCall(s);
    act(() => s.client.handlers!.onCallStart());
    act(() => s.client.handlers!.onTranscript({ role: 'user', text: 'Hello', final: true }));
    await act(async () => {
      await s.hook.result.current.end();
    });
    expect(s.client.stopped).toBe(true);
    expect(s.hook.result.current.voice.state).toBe('ended');
    expect(s.hook.result.current.support).toBe('completed');
    await startCall(s);
    expect(s.hook.result.current.voice.state).toBe('connecting');
    expect(s.hook.result.current.turns).toEqual([]);
  });

  it('does not start a second call while one is running', async () => {
    const s = setup();
    await startCall(s);
    await startCall(s);
    expect(s.createClient).toHaveBeenCalledTimes(1);
  });

  it('follows the backend into escalation, sends the typed details, and confirms', async () => {
    let backend: PublicConversationState = { ...emptyBackendState, answerType: 'escalation' };
    const s = setup({ backend: () => backend });
    await startCall(s);
    act(() => s.client.handlers!.onCallStart());

    // Poll picks up the escalation requirement.
    await waitFor(() => expect(s.hook.result.current.support).toBe('escalation-required'));
    expect(s.fetchState).toHaveBeenCalledWith('vapi_test-call');

    act(() => s.hook.result.current.submitContact({ name: ' Ada ', email: 'ada@example.com', preferredTime: 'Tuesday at 2 PM' }));
    expect(s.client.sent).toEqual([
      'My name is Ada. My email address is ada@example.com. The best time for a callback is Tuesday at 2 PM.',
    ]);
    expect(s.hook.result.current.support).toBe('escalating');
    expect(s.hook.result.current.turns.at(-1)?.speaker).toBe('user');
    expect(s.hook.result.current.turns.at(-1)?.text).not.toContain('ada@example.com');

    backend = { ...emptyBackendState, answerType: 'escalation', escalation: { requestedTime: 'Tuesday at 2 PM' } };
    await waitFor(() => expect(s.hook.result.current.support).toBe('escalated'));
    expect(s.hook.result.current.backend.escalation?.requestedTime).toBe('Tuesday at 2 PM');
  });

  it('keeps its last state when the backend cannot be reached', async () => {
    const s = setup({ backend: () => null as never });
    await startCall(s);
    act(() => s.client.handlers!.onCallStart());
    await new Promise((r) => setTimeout(r, 60));
    expect(s.hook.result.current.backend).toEqual(emptyBackendState);
  });
});

describe('contactMessage', () => {
  it('reads as a natural sentence, with the time only when given', () => {
    expect(contactMessage({ name: 'Ada', email: 'a@b.co' })).toBe('My name is Ada. My email address is a@b.co.');
    expect(contactMessage({ name: 'Ada', email: 'a@b.co', preferredTime: '  ' })).toBe(
      'My name is Ada. My email address is a@b.co.',
    );
  });
});
