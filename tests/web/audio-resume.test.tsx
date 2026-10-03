// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AudioNotices from '@/components/AudioNotices';
import ResumePrompt from '@/components/ResumePrompt';
import { useVoiceSession, type VoiceSessionOptions } from '@/hooks/useVoiceSession';
import type { PublicConversationState } from '@/lib/conversation-state';
import { COPY } from '@/lib/copy';
import { RESUMABLE_END_REASONS as WEB_REASONS, RESUME_GRACE_MS } from '@/lib/session/limits';
import { emptyBackendState } from '@/lib/support/derive';
import { MockVoiceClient } from '@/lib/voice/mock-client';
import { createNoiseDetector } from '@/lib/voice/noise';
import { RESUMABLE_END_REASONS as AGENT_REASONS, RESUME_GRACE_MS as AGENT_GRACE } from '../../services/agent/src/session/persist';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('@vapi-ai/web');
});

describe('noise detector with hysteresis (AC-28.2)', () => {
  it('says nothing for a quiet room, or when it is never given a reading (AC-28.3)', () => {
    const d = createNoiseDetector();
    expect(d.noisy).toBe(false);
    for (let t = 0; t < 30_000; t += 500) expect(d.sample(0.05, t)).toBe(false);
  });

  it('needs the room to stay loud for a while before it reports noise', () => {
    const d = createNoiseDetector({ enterAfterMs: 4000 });
    expect(d.sample(0.6, 0)).toBe(false);
    expect(d.sample(0.6, 3999)).toBe(false);
    expect(d.sample(0.6, 4000)).toBe(true);
  });

  it('ignores a short burst (a cough or a door)', () => {
    const d = createNoiseDetector({ enterAfterMs: 4000 });
    d.sample(0.9, 0);
    d.sample(0.9, 1500);
    expect(d.sample(0.05, 2000)).toBe(false); // quiet again: the clock for "loud" starts over
    d.sample(0.9, 2500);
    expect(d.sample(0.9, 5000)).toBe(false);
  });

  it('keeps reporting noise through dips between the two lines, and only stops after a sustained quiet', () => {
    const d = createNoiseDetector({ enterLevel: 0.35, exitLevel: 0.2, enterAfterMs: 1000, exitAfterMs: 3000 });
    d.sample(0.5, 0);
    expect(d.sample(0.5, 1000)).toBe(true);
    // 0.25 is below the enter line but above the exit line: still noisy, nothing building towards quiet.
    for (let t = 1500; t <= 10_000; t += 500) expect(d.sample(0.25, t)).toBe(true);
    d.sample(0.1, 10_500);
    expect(d.sample(0.1, 13_000)).toBe(true);
    expect(d.sample(0.1, 13_500)).toBe(false);
  });

  it('does not flicker around a single threshold', () => {
    const d = createNoiseDetector({ enterLevel: 0.35, exitLevel: 0.2, enterAfterMs: 500, exitAfterMs: 2000 });
    d.sample(0.4, 0);
    d.sample(0.4, 500);
    const seen: boolean[] = [];
    for (let t = 1000; t < 6000; t += 250) seen.push(d.sample(t % 500 === 0 ? 0.3 : 0.36, t));
    expect(seen.every(Boolean)).toBe(true);
  });

  it('ignores readings that are not numbers and can be reset', () => {
    const d = createNoiseDetector({ enterAfterMs: 0 });
    expect(d.sample(NaN, 0)).toBe(false);
    d.sample(0.9, 0);
    expect(d.noisy).toBe(true);
    d.reset();
    expect(d.noisy).toBe(false);
  });
});

describe('audio notices (AC-28.1, AC-28.3)', () => {
  it('shows nothing by default, inside a polite live region', () => {
    render(<AudioNotices muted={false} noisy={false} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
  });

  it('says plainly that the microphone is muted', () => {
    render(<AudioNotices muted noisy={false} />);
    expect(screen.getByRole('status').textContent).toBe(COPY.audio.muted);
  });

  it('gives a noise advisory that claims nothing and shows only one notice at a time', () => {
    const { rerender } = render(<AudioNotices muted={false} noisy />);
    expect(screen.getByRole('status').textContent).toBe(COPY.audio.noisy);
    expect(COPY.audio.noisy).toMatch(/sounds noisy|try a quieter/i);
    rerender(<AudioNotices muted noisy />);
    expect(screen.getByRole('status').textContent).toBe(COPY.audio.muted);
  });
});

describe('the Vapi client reports mute status when the SDK can tell, and resumes onto the same conversation', () => {
  async function load() {
    class FakeVapi {
      static instances: FakeVapi[] = [];
      handlers: Record<string, (...a: unknown[]) => void> = {};
      muted = false;
      startArgs: unknown[] = [];
      constructor() {
        FakeVapi.instances.push(this);
      }
      on(event: string, fn: (...a: unknown[]) => void) {
        this.handlers[event] = fn;
      }
      isMuted() {
        return this.muted;
      }
      async start(...args: unknown[]) {
        this.startArgs = args;
        return { id: 'call-xyz' };
      }
      async stop() {}
      send() {}
    }
    vi.resetModules();
    vi.doMock('@vapi-ai/web', () => ({ default: FakeVapi }));
    const { createVapiClient } = await import('@/lib/voice/vapi-client');
    return { createVapiClient, FakeVapi };
  }

  const handlers = () => ({
    onCallStart: vi.fn(),
    onCallEnd: vi.fn(),
    onUserSpeech: vi.fn(),
    onAssistantSpeech: vi.fn(),
    onVolume: vi.fn(),
    onTranscript: vi.fn(),
    onError: vi.fn(),
    onMuteChange: vi.fn(),
  });

  it('reports muted and unmuted once each, on change only', async () => {
    vi.useFakeTimers();
    const { createVapiClient, FakeVapi } = await load();
    const h = handlers();
    const client = createVapiClient({ publicKey: 'pk', assistantId: 'as' });
    await client.start(h);
    const vapi = FakeVapi.instances[0];
    vapi.handlers['call-start']();
    expect(h.onMuteChange).toHaveBeenLastCalledWith(false);
    vapi.muted = true;
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.onMuteChange).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.onMuteChange.mock.calls.filter((c) => c[0] === true)).toHaveLength(1);
    vapi.muted = false;
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.onMuteChange).toHaveBeenLastCalledWith(false);
    await client.stop();
  });

  it('a fresh call has no metadata and takes its id from the call; a resumed call names the conversation it continues', async () => {
    const { createVapiClient, FakeVapi } = await load();
    const fresh = await createVapiClient({ publicKey: 'pk', assistantId: 'as' }).start(handlers());
    expect(fresh.conversationId).toBe('vapi_call-xyz');
    expect(FakeVapi.instances[0].startArgs).toEqual(['as', undefined]);

    const resumed = await createVapiClient({ publicKey: 'pk', assistantId: 'as', resumeConversationId: 'vapi_old-call' }).start(handlers());
    expect(resumed.conversationId).toBe('vapi_old-call');
    expect(FakeVapi.instances[1].startArgs).toEqual(['as', { metadata: { conversation_id: 'vapi_old-call' } }]);
  });
});

describe('mute and noise in the session', () => {
  function setup() {
    const client = new MockVoiceClient([], 'vapi_test-call');
    const hook = renderHook(() =>
      useVoiceSession({ createClient: () => client, fetchState: async () => emptyBackendState, checkMic: async () => null, pollMs: 20 }),
    );
    return { client, hook };
  }

  it('is never muted or noisy unless the provider says so (AC-28.3)', async () => {
    const { client, hook } = setup();
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    expect(hook.result.current.muted).toBe(false);
    expect(hook.result.current.noisy).toBe(false);
  });

  it('follows the provider’s mute status and clears it when the call ends', async () => {
    const { client, hook } = setup();
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    act(() => client.handlers!.onMuteChange!(true));
    expect(hook.result.current.muted).toBe(true);
    act(() => client.handlers!.onMuteChange!(false));
    expect(hook.result.current.muted).toBe(false);
    act(() => client.handlers!.onMuteChange!(true));
    await act(async () => {
      await hook.result.current.end();
    });
    expect(hook.result.current.muted).toBe(false);
  });

  it('turns loud readings into the advisory only after they last, and not while the customer is speaking', async () => {
    let t = 0;
    const client = new MockVoiceClient([], 'vapi_test-call');
    const hook = renderHook(() =>
      useVoiceSession({ createClient: () => client, fetchState: async () => emptyBackendState, checkMic: async () => null, pollMs: 20, clock: () => t }),
    );
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    for (t = 0; t <= 5000; t += 500) act(() => client.handlers!.onAmbientLevel!(0.7));
    expect(hook.result.current.noisy).toBe(true);
    for (t = 6000; t <= 20_000; t += 500) act(() => client.handlers!.onAmbientLevel!(0.05));
    expect(hook.result.current.noisy).toBe(false);

    act(() => client.handlers!.onUserSpeech(true));
    for (t = 21_000; t <= 30_000; t += 500) act(() => client.handlers!.onAmbientLevel!(0.9));
    expect(hook.result.current.noisy).toBe(false);
  });
});

describe('resume within 30 seconds (AC-16.*)', () => {
  const ended = (over: Partial<PublicConversationState> = {}): PublicConversationState => ({
    ...emptyBackendState,
    ended: true,
    endReason: 'user-ended',
    ...over,
  });

  function setup(opts: { backend?: () => PublicConversationState; reopen?: VoiceSessionOptions['reopen']; clockStart?: number } = {}) {
    const clock = { now: opts.clockStart ?? 1_000_000 };
    const clients: MockVoiceClient[] = [];
    const createClient = vi.fn((options?: { resumeConversationId?: string }) => {
      const c = new MockVoiceClient([], options?.resumeConversationId ?? 'vapi_first-call');
      clients.push(c);
      return c;
    });
    const reopen = opts.reopen ?? vi.fn(async () => 'ok' as const);
    let backend: PublicConversationState = emptyBackendState;
    const preflight = vi.fn(async () => 'ok' as const);
    const hook = renderHook(() =>
      useVoiceSession({
        createClient,
        fetchState: async () => (opts.backend ? opts.backend() : backend),
        checkMic: async () => null,
        preflight,
        reopen,
        pollMs: 20,
        clock: () => clock.now,
      }),
    );
    return { clock, clients, createClient, reopen, preflight, hook, setBackend: (b: PublicConversationState) => (backend = b) };
  }

  async function callThatEnded(s: ReturnType<typeof setup>, endedBy: 'customer' | 'server' = 'customer') {
    await act(async () => {
      await s.hook.result.current.start();
    });
    act(() => s.clients[0].handlers!.onCallStart());
    act(() => s.clients[0].handlers!.onTranscript({ role: 'user', text: 'Where is my payout?', final: true }));
    act(() => s.clients[0].handlers!.onTranscript({ role: 'assistant', text: 'It is processing.', final: true }));
    if (endedBy === 'customer') {
      await act(async () => {
        await s.hook.result.current.end();
      });
    } else {
      act(() => s.clients[0].handlers!.onCallEnd());
    }
  }

  it('is the same 30 seconds and the same resumable endings as the agent decides (AC-16.4 parity)', () => {
    expect(RESUME_GRACE_MS).toBe(30_000);
    expect(RESUME_GRACE_MS).toBe(AGENT_GRACE);
    expect([...WEB_REASONS].sort()).toEqual([...AGENT_REASONS].sort());
  });

  it('keeps the transcript and offers Resume with a 30 second countdown after the call ends (AC-16.1)', async () => {
    const s = setup();
    await callThatEnded(s);
    expect(s.hook.result.current.voice.state).toBe('ended');
    expect(s.hook.result.current.turns.map((t) => t.text)).toEqual(['Where is my payout?', 'It is processing.']);
    expect(s.hook.result.current.resumeSecondsLeft).toBe(30);

    s.clock.now += 12_000;
    await waitFor(() => expect(s.hook.result.current.resumeSecondsLeft).toBe(18));
  });

  it('closes the window after 30 seconds: Resume disappears and Start another is a brand new conversation (AC-16.3)', async () => {
    const s = setup();
    await callThatEnded(s);
    s.clock.now += 30_001;
    await waitFor(() => expect(s.hook.result.current.resumeSecondsLeft).toBe(0));
    expect(s.hook.result.current.turns).toHaveLength(2); // the transcript is still on screen

    await act(async () => {
      await s.hook.result.current.start();
    });
    expect(s.createClient).toHaveBeenLastCalledWith(undefined); // not a resume
    expect(s.hook.result.current.turns).toEqual([]);
    expect(s.reopen).not.toHaveBeenCalled();
  });

  it('resumes onto the same conversation id with the transcript kept (AC-16.2)', async () => {
    const s = setup();
    await callThatEnded(s);
    const id = s.hook.result.current.conversationId;
    expect(id).toBe('vapi_first-call');
    s.clock.now += 5_000;

    await act(async () => {
      await s.hook.result.current.resume();
    });
    // The window counts against the limits first, then the conversation is reopened, then a new call carries the same id.
    expect(s.preflight).toHaveBeenCalledTimes(2);
    expect(s.reopen).toHaveBeenCalledWith('vapi_first-call');
    expect(s.createClient).toHaveBeenLastCalledWith({ resumeConversationId: 'vapi_first-call' });
    expect(s.hook.result.current.conversationId).toBe('vapi_first-call');
    expect(s.hook.result.current.voice.state).toBe('connecting');
    expect(s.hook.result.current.turns.map((t) => t.text)).toEqual(['Where is my payout?', 'It is processing.']);

    act(() => s.clients[1].handlers!.onCallStart());
    expect(s.hook.result.current.voice.state).toBe('listening');
    expect(s.hook.result.current.resumeSecondsLeft).toBe(0);
    // New turns continue the same transcript.
    act(() => s.clients[1].handlers!.onTranscript({ role: 'user', text: 'And my invoice?', final: true }));
    expect(s.hook.result.current.turns.at(-1)?.text).toBe('And my invoice?');
    expect(s.hook.result.current.turns).toHaveLength(3);
  });

  it('can resume again after the resumed call ends, with a fresh window', async () => {
    const s = setup();
    await callThatEnded(s);
    await act(async () => {
      await s.hook.result.current.resume();
    });
    act(() => s.clients[1].handlers!.onCallStart());
    s.clock.now += 100_000;
    await act(async () => {
      await s.hook.result.current.end();
    });
    expect(s.hook.result.current.resumeSecondsLeft).toBe(30);
  });

  it('goes back to the ended screen, with the transcript, when the server says the window has passed', async () => {
    const s = setup({ reopen: vi.fn(async () => 'expired' as const) });
    await callThatEnded(s);
    await act(async () => {
      await s.hook.result.current.resume();
    });
    expect(s.hook.result.current.voice.state).toBe('ended');
    expect(s.hook.result.current.resumeFailed).toBe(true);
    expect(s.hook.result.current.resumeSecondsLeft).toBe(0);
    expect(s.hook.result.current.turns).toHaveLength(2);
    expect(s.createClient).toHaveBeenCalledTimes(1); // no second call was made
  });

  it('is not offered when the customer chooses not to resume', async () => {
    const s = setup();
    await callThatEnded(s);
    expect(s.hook.result.current.resumeSecondsLeft).toBe(30);
    act(() => s.hook.result.current.declineResume());
    expect(s.hook.result.current.resumeSecondsLeft).toBe(0);
  });

  it.each(['session-timeout', 'limit-reached', 'low-confidence', 'human-closed'] as const)(
    'is not offered after a %s ending',
    async (reason) => {
      const s = setup({ backend: () => ended({ endReason: reason }) });
      await callThatEnded(s, 'server');
      await waitFor(() => expect(s.hook.result.current.backend.endReason).toBe(reason));
      expect(s.hook.result.current.resumeSecondsLeft).toBe(0);
    },
  );

  it.each(['silence-timeout', 'agent-ended', 'error', 'user-ended'] as const)('is offered after a %s ending', async (reason) => {
    const s = setup({ backend: () => ended({ endReason: reason }) });
    await callThatEnded(s, 'server');
    await waitFor(() => expect(s.hook.result.current.resumeSecondsLeft).toBeGreaterThan(0));
  });

  it('is not offered when the conversation moved to a specialist, or when previews have no way to reopen it', async () => {
    const handed = setup({ backend: () => ended({ supportMode: 'human', endReason: 'user-ended' }) });
    await callThatEnded(handed, 'server');
    await waitFor(() => expect(handed.hook.result.current.backend.supportMode).toBe('human'));
    expect(handed.hook.result.current.resumeSecondsLeft).toBe(0);
    cleanup();

    const client = new MockVoiceClient([], 'vapi_test-call');
    const preview = renderHook(() =>
      useVoiceSession({ createClient: () => client, fetchState: async () => emptyBackendState, checkMic: async () => null, pollMs: 20 }),
    );
    await act(async () => {
      await preview.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    await act(async () => {
      await preview.result.current.end();
    });
    expect(preview.result.current.resumeSecondsLeft).toBe(0);
  });
});

describe('ResumePrompt', () => {
  it('shows the countdown and two plain choices', async () => {
    const onResume = vi.fn();
    const onDecline = vi.fn();
    render(<ResumePrompt secondsLeft={17} onResume={onResume} onDecline={onDecline} />);
    expect(screen.getByText(/17 more seconds/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: COPY.resume.action }));
    await userEvent.click(screen.getByRole('button', { name: COPY.resume.decline }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('says "1 more second" in the singular, and uses no technical words', () => {
    const { container } = render(<ResumePrompt secondsLeft={1} onResume={() => {}} onDecline={() => {}} />);
    expect(screen.getByText(/1 more second\./)).toBeTruthy();
    expect(container.textContent!.toLowerCase()).not.toMatch(/\b(mcp|rag|supabase|vapi|sdk|agent|claude)\b/);
  });
});

describe('saved rows during a live call', () => {
  const saved = {
    turns: [
      { id: 'u1:user', role: 'user' as const, displayText: 'T x n dash 9', createdAt: '2026-10-02T12:00:01.000Z' },
      { id: 'u1:assistant', role: 'assistant' as const, displayText: 'I only caught the start of that.', createdAt: '2026-10-02T12:00:02.000Z' },
    ],
    cursor: 'c1',
  };

  it('does not put the saved rows beside the live bubbles', async () => {
    const client = new MockVoiceClient([], 'vapi_test-call');
    // Nothing is saved when the call starts; the rows appear once the agent has run turns.
    let rows = { turns: [] as typeof saved.turns, cursor: null as string | null };
    const fetchTranscript = vi.fn(async () => rows);
    const hook = renderHook(() =>
      useVoiceSession({
        createClient: () => client,
        fetchState: async () => emptyBackendState,
        fetchTranscript,
        checkMic: async () => null,
        pollMs: 20,
      }),
    );
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    act(() => client.handlers!.onTranscript({ role: 'user', text: 'T x n dash 9 double 0, 1.', final: true }));
    rows = saved;
    await waitFor(() => expect(fetchTranscript).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80)); // a few more polls
    });
    expect(hook.result.current.turns.map((t) => t.text)).toEqual(['T x n dash 9 double 0, 1.']);
  });
});
