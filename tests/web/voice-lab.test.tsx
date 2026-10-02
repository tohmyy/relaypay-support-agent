// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceLab, { type VapiLike } from '@/components/dev/VoiceLab';

afterEach(cleanup);

function fakeVapi(over: Partial<Record<keyof VapiLike, unknown>> = {}) {
  const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
  const emit = (event: string, ...args: unknown[]) =>
    act(() => {
      for (const l of listeners.get(event) ?? []) l(...args);
    });
  let muted = false;
  const started = { id: 'abc123', webCallUrl: 'https://example.daily.co/room' };
  const api = {
    on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    }),
    start: vi.fn(async () => started),
    stop: vi.fn(async () => {
      emit('call-end');
    }),
    end: vi.fn(() => {
      emit('call-end');
    }),
    reconnect: vi.fn(async () => {
      emit('call-start');
    }),
    setMuted: vi.fn((m: boolean) => {
      muted = m;
    }),
    isMuted: vi.fn(() => muted),
    send: vi.fn(),
    ...over,
  } as unknown as { [K in keyof VapiLike]: ReturnType<typeof vi.fn> };
  return { api, emit, started };
}

function setup(over: Partial<Record<keyof VapiLike, unknown>> = {}) {
  const f = fakeVapi(over);
  const createVapi = vi.fn(async () => f.api as unknown as VapiLike);
  render(<VoiceLab publicKey="pk_test" assistantId="asst_1" createVapi={createVapi} verifyDelayMs={20} />);
  const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
  const log = () => screen.queryByTestId('lab-log')?.textContent ?? '';
  return { ...f, createVapi, button, log };
}

async function startLive(s: ReturnType<typeof setup>, name: string | RegExp = 'Start (normal)') {
  await userEvent.click(s.button(name));
  await s.emit('call-start');
}

describe('VoiceLab', () => {
  beforeEach(() => vi.useRealTimers());

  it('says plainly that it uses the real assistant', () => {
    setup();
    expect(screen.getByText(/real assistant/i)).toBeTruthy();
    expect(screen.getByText(/never what anyone said/i)).toBeTruthy();
  });

  it('starts a normal call with just the assistant, and logs the call and conversation ids', async () => {
    const s = setup();
    await startLive(s);
    expect(s.createVapi).toHaveBeenCalledWith('pk_test');
    expect(s.api.start).toHaveBeenCalledOnce();
    expect(s.api.start.mock.calls[0]).toEqual(['asst_1']);
    expect(s.log()).toContain('start (normal)');
    expect(s.log()).toContain('call id abc123; conversation id vapi_abc123');
    expect(s.log()).toContain('call-start');
    expect(screen.getByRole('status').textContent).toContain('live');
  });

  it('starts with the call kept alive when the browser leaves', async () => {
    const s = setup();
    await startLive(s, /keep the call alive/);
    const args = s.api.start.mock.calls[0];
    expect(args[0]).toBe('asst_1');
    expect(args[5]).toEqual({ roomDeleteOnUserLeaveEnabled: false });
  });

  it('only offers the controls that make sense', async () => {
    const s = setup();
    expect(s.button('Mute microphone').disabled).toBe(true);
    expect(s.button('Leave (stop)').disabled).toBe(true);
    expect(s.button('Reconnect').disabled).toBe(true);
    expect(s.button('End call').disabled).toBe(true);
    await startLive(s);
    expect(s.button('Mute microphone').disabled).toBe(false);
    expect(s.button('Start (normal)').disabled).toBe(true);
    expect(s.button('Reconnect').disabled).toBe(true); // still live
  });

  it('mutes and unmutes the microphone through the SDK and says what the SDK reports', async () => {
    const s = setup();
    await startLive(s);
    await userEvent.click(s.button('Mute microphone'));
    expect(s.api.setMuted).toHaveBeenLastCalledWith(true);
    expect(s.log()).toContain('asked for muted=true; the SDK says muted=true straight away');
    expect(screen.getByRole('status').textContent).toContain('microphone muted');
    await waitFor(() => expect(s.log()).toContain('the SDK says muted=true 0.0s later'));
    await userEvent.click(s.button('Unmute microphone'));
    expect(s.api.setMuted).toHaveBeenLastCalledWith(false);
    expect(s.log()).toContain('asked for muted=false');
    await waitFor(() => expect(s.log()).toContain('the SDK says muted=false 0.0s later'));
    expect(screen.getByRole('status').textContent).toContain('microphone on');
  });

  it('shows what really happened when the SDK is slow to apply a mute (a real call said "false" at first)', async () => {
    let applied = false;
    const s = setup({
      setMuted: vi.fn(() => {
        setTimeout(() => (applied = true), 5);
      }),
      isMuted: vi.fn(() => applied),
    });
    await startLive(s);
    await userEvent.click(s.button('Mute microphone'));
    // Straight away the SDK still says "not muted"; the log says so instead of pretending.
    expect(s.log()).toContain('asked for muted=true; the SDK says muted=false straight away');
    // A little later it has caught up, and the lab agrees with it.
    await waitFor(() => expect(s.log()).toContain('the SDK says muted=true 0.0s later'));
    expect(s.log()).not.toContain('not what was asked');
    expect(screen.getByRole('status').textContent).toContain('microphone muted');
    expect(s.button('Unmute microphone')).toBeTruthy();
  });

  it('says so, and goes back to "on", when the SDK never mutes', async () => {
    const s = setup({ isMuted: vi.fn(() => false) });
    await startLive(s);
    await userEvent.click(s.button('Mute microphone'));
    await waitFor(() => expect(s.log()).toContain('not what was asked'));
    expect(screen.getByRole('status').textContent).toContain('microphone on');
    expect(s.button('Mute microphone')).toBeTruthy();
  });

  it('folds a stream of identical messages into one line with a count', async () => {
    const s = setup();
    await startLive(s);
    for (let i = 0; i < 5; i++) await s.emit('message', { type: 'transcript', role: 'assistant', transcriptType: 'partial' });
    await s.emit('message', { type: 'transcript', role: 'assistant', transcriptType: 'final' });
    const lines = s.log().split('\n').filter((l) => l.includes('transcript role=assistant'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('x5');
  });

  it('prints the reason for an SDK error object instead of "[object Object]"', async () => {
    const s = setup();
    await startLive(s);
    await s.emit('error', { error: { type: 'ejected', msg: 'Meeting has ended' } });
    expect(s.log()).toContain('Meeting has ended');
    expect(s.log()).not.toContain('[object Object]');
  });

  it('mutes and unmutes the assistant with a control message', async () => {
    const s = setup();
    await startLive(s);
    await userEvent.click(s.button('Mute assistant'));
    expect(s.api.send).toHaveBeenLastCalledWith({ type: 'control', control: 'mute-assistant' });
    await userEvent.click(s.button('Unmute assistant'));
    expect(s.api.send).toHaveBeenLastCalledWith({ type: 'control', control: 'unmute-assistant' });
  });

  it('leaves, then reconnects to the very call it started', async () => {
    const s = setup();
    await startLive(s, /keep the call alive/);
    await userEvent.click(s.button('Leave (stop)'));
    expect(s.api.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('ended');
    expect(s.button('Reconnect').disabled).toBe(false);
    await userEvent.click(s.button('Reconnect'));
    expect(s.api.reconnect).toHaveBeenCalledWith(s.started);
    expect(s.log()).toContain('reconnect returned');
    expect(s.log()).toContain('reconnect to the same call');
  });

  it('ends the call', async () => {
    const s = setup();
    await startLive(s);
    await userEvent.click(s.button('End call'));
    expect(s.api.end).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('ended');
  });

  it('logs the shape of every message and never what was said', async () => {
    const s = setup();
    await startLive(s);
    await s.emit('message', {
      type: 'transcript',
      role: 'user',
      transcriptType: 'final',
      transcript: 'my card number is 4111 1111 1111 1111',
    });
    await s.emit('message', { type: 'speech-update', role: 'assistant', status: 'stopped' });
    expect(s.log()).toContain('transcript role=user transcriptType=final');
    expect(s.log()).toContain('speech-update role=assistant status=stopped');
    expect(s.log()).not.toContain('4111');
    expect(s.log()).not.toContain('card number');
  });

  it('logs assistant audio starting and stopping', async () => {
    const s = setup();
    await startLive(s);
    await s.emit('speech-start');
    await s.emit('speech-end');
    expect(s.log()).toContain('assistant audio started');
    expect(s.log()).toContain('assistant audio stopped');
  });

  it('logs errors on one short line instead of crashing', async () => {
    const s = setup();
    await startLive(s);
    await s.emit('error', { error: { message: `Meeting has ended ${'x'.repeat(300)}` } });
    const line = s.log().split('\n').find((l) => l.includes('Meeting has ended'))!;
    expect(line).toContain('error');
    expect(line.length).toBeLessThan(200);
  });

  it('survives a mute that the SDK refuses', async () => {
    const s = setup({
      setMuted: vi.fn(() => {
        throw new Error('Call object is not available.');
      }),
    });
    await startLive(s);
    await userEvent.click(s.button('Mute microphone'));
    expect(s.log()).toContain('Call object is not available.');
    expect(screen.getByRole('status').textContent).toContain('microphone on');
  });

  it('goes back to idle when starting fails, and says why', async () => {
    const s = setup({
      start: vi.fn(async () => {
        throw new Error('Permission denied');
      }),
    });
    await userEvent.click(s.button('Start (normal)'));
    expect(s.log()).toContain('Permission denied');
    expect(screen.getByRole('status').textContent).toContain('idle');
    expect(s.button('Start (normal)').disabled).toBe(false);
  });

  it('treats a start that returns no call as a failure', async () => {
    const s = setup({ start: vi.fn(async () => null) });
    await userEvent.click(s.button('Start (normal)'));
    expect(s.log()).toContain('start returned no call');
    expect(screen.getByRole('status').textContent).toContain('idle');
  });

  it('copies the log for pasting into the document', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const s = setup();
    await startLive(s);
    await userEvent.click(s.button('Copy log'));
    expect(writeText).toHaveBeenCalledOnce();
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain('start (normal)');
    expect(text).toContain('call-start');
    expect(s.button('Copied')).toBeTruthy();
  });

  it('has nothing to copy until something happens', () => {
    const s = setup();
    expect(s.button('Copy log').disabled).toBe(true);
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
  });

  it('lists the experiments to run', () => {
    setup();
    const steps = screen.getByRole('region', { name: 'Experiments' });
    expect(steps.textContent).toMatch(/Mute the microphone/);
    expect(steps.textContent).toMatch(/Reconnect/);
  });

  it('ends the call if the page is left mid-experiment', async () => {
    const f = fakeVapi();
    const { unmount } = render(<VoiceLab publicKey="pk" assistantId="a" createVapi={async () => f.api as unknown as VapiLike} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start (normal)' }));
    unmount();
    expect(f.api.end).toHaveBeenCalled();
  });
});

describe('/dev/voice-lab page', () => {
  const notFound = vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  });

  async function page() {
    vi.resetModules();
    vi.doMock('next/navigation', () => ({ notFound }));
    return (await import('@/app/dev/voice-lab/page')).default;
  }

  beforeEach(() => {
    notFound.mockClear();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('next/navigation');
  });

  it('is not served in production unless explicitly enabled (like /dev/states)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_STATES', '');
    const Page = await page();
    expect(() => Page()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('is served in production when enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_STATES', '1');
    vi.stubEnv('NEXT_PUBLIC_VAPI_PUBLIC_KEY', 'pk');
    vi.stubEnv('VAPI_ASSISTANT_ID', 'asst');
    const Page = await page();
    expect(() => Page()).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('is served in development, and says what is missing instead of failing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_VAPI_PUBLIC_KEY', '');
    vi.stubEnv('VAPI_ASSISTANT_ID', '');
    const Page = await page();
    const element = Page() as { props: { children: unknown[] } };
    expect(JSON.stringify(element.props.children)).toContain('NEXT_PUBLIC_VAPI_PUBLIC_KEY');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('passes the same public key and assistant id the main page uses', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_VAPI_PUBLIC_KEY', 'pk_live');
    vi.stubEnv('VAPI_ASSISTANT_ID', 'asst_live');
    const Page = await page();
    const element = Page() as { props: { publicKey: string; assistantId: string } };
    expect(element.props).toMatchObject({ publicKey: 'pk_live', assistantId: 'asst_live' });
  });
});
