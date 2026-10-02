'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendEntry,
  formatLog,
  summarizeError,
  summarizeMessage,
  type LabEntry,
  type LabKind,
} from '@/lib/dev/voice-lab-log';

/** The part of the Vapi web SDK the lab uses. A test can supply a stand-in. */
export interface VapiLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  start(...args: unknown[]): Promise<unknown>;
  stop(): Promise<void>;
  end(): void;
  reconnect(call: unknown): Promise<void>;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  send(message: unknown): void;
}

export interface VoiceLabProps {
  publicKey: string;
  assistantId: string;
  createVapi?: (publicKey: string) => Promise<VapiLike>;
  /** How long after a mute request to read the SDK's mute state again (it can lag behind the request). */
  verifyDelayMs?: number;
}

async function defaultCreateVapi(publicKey: string): Promise<VapiLike> {
  const { default: Vapi } = await import('@vapi-ai/web');
  return new Vapi(publicKey) as unknown as VapiLike;
}

type Status = 'idle' | 'starting' | 'live' | 'ended';

const BUTTON =
  'rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50';

const CHECKLIST = [
  'Before anything else: the agent service ends a quiet call after SILENCE_TIMEOUT_SECONDS + SILENCE_COUNTDOWN_SECONDS (about 26 seconds), which will cut any experiment that waits longer. For these experiments raise SILENCE_TIMEOUT_SECONDS (for example to 120) on the agent service and restart it; put it back afterwards.',
  'Mute the microphone and speak: is anything transcribed? Unmute and speak: does the assistant respond? (Check the "SDK says muted=" lines: the first reading can lag.)',
  'Mute the assistant (control message), then ask a question: is the assistant silent, does a turn reach the agent service (npm run trace), does the customer still get transcribed? Unmute it and ask again.',
  'Start "keep the call alive on leave", then Leave and Reconnect within 10 seconds: same call id? Can you HEAR the assistant after reconnecting (not just see events)? Does it continue the conversation?',
  'Leave and wait 60 seconds before Reconnect (with the silence timer raised): does it still work? What does the call report afterwards say?',
  'Then run `npm run trace -- vapi_<call id>` and `npm run report`: what did the server see (silence events, call ended, end reason, turns)?',
];

/**
 * Developer-only workbench for the Pause/Resume investigation (Build Plan V2, sections 30 and 31). It drives the real
 * Vapi SDK directly, so it uses the real assistant: it creates conversations and costs money. It logs the shape of
 * every event and message, never speech text.
 */
export default function VoiceLab({
  publicKey,
  assistantId,
  createVapi = defaultCreateVapi,
  verifyDelayMs = 500,
}: VoiceLabProps) {
  const [entries, setEntries] = useState<LabEntry[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [micMuted, setMicMuted] = useState(false);
  const [assistantMuted, setAssistantMuted] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const vapi = useRef<VapiLike | null>(null);
  const call = useRef<unknown>(null);
  // Whether there is a call to reconnect to, for the button (a ref cannot be read while rendering).
  const [hasCall, setHasCall] = useState(false);
  const t0 = useRef<number | null>(null);

  const log = useCallback((kind: LabKind, text: string) => {
    const now = Date.now();
    t0.current ??= now;
    setEntries((prev) => appendEntry(prev, { at: now - (t0.current ?? now), kind, text }));
  }, []);

  const getVapi = useCallback(async (): Promise<VapiLike> => {
    if (vapi.current) return vapi.current;
    const instance = await createVapi(publicKey);
    instance.on('call-start', () => {
      setStatus('live');
      log('event', 'call-start');
    });
    instance.on('call-end', () => {
      setStatus('ended');
      setMicMuted(false);
      setAssistantMuted(false);
      log('event', 'call-end');
    });
    instance.on('speech-start', () => log('event', 'assistant audio started (speech-start)'));
    instance.on('speech-end', () => log('event', 'assistant audio stopped (speech-end)'));
    instance.on('message', (message) => log('message', summarizeMessage(message)));
    instance.on('error', (error) => log('error', summarizeError(error)));
    vapi.current = instance;
    return instance;
  }, [createVapi, publicKey, log]);

  const start = useCallback(
    async (keepRoom: boolean) => {
      setStatus('starting');
      log('action', keepRoom ? 'start (keep the call alive when the browser leaves)' : 'start (normal)');
      try {
        const instance = await getVapi();
        const started = keepRoom
          ? await instance.start(assistantId, undefined, undefined, undefined, undefined, {
              roomDeleteOnUserLeaveEnabled: false,
            })
          : await instance.start(assistantId);
        const id = (started as { id?: unknown } | null)?.id;
        if (!started || typeof id !== 'string') {
          setStatus('idle');
          log('error', 'start returned no call');
          return;
        }
        call.current = started;
        setHasCall(Boolean(started));
        setCallId(id);
        log('note', `call id ${id}; conversation id vapi_${id}`.slice(0, 120));
      } catch (error) {
        setStatus('idle');
        log('error', summarizeError(error));
      }
    },
    [assistantId, getVapi, log],
  );

  const run = useCallback(
    async (label: string, action: (instance: VapiLike) => void | Promise<void>) => {
      log('action', label);
      try {
        await action(await getVapi());
      } catch (error) {
        log('error', summarizeError(error));
      }
    },
    [getVapi, log],
  );

  // The SDK applies a mute asynchronously, so asking "are you muted?" straight away can still say no (a real call showed
  // exactly that). Read it twice, show both, and let the later reading decide what the button says.
  const toggleMic = () => {
    const wanted = !micMuted;
    return run(wanted ? 'mute microphone' : 'unmute microphone', (v) => {
      v.setMuted(wanted);
      log('note', `asked for muted=${wanted}; the SDK says muted=${v.isMuted()} straight away`);
      setMicMuted(wanted);
      setTimeout(() => {
        try {
          const actual = v.isMuted();
          log(
            'note',
            `the SDK says muted=${actual} ${(verifyDelayMs / 1000).toFixed(1)}s later${actual === wanted ? '' : ' (not what was asked)'}`,
          );
          setMicMuted(actual);
        } catch (error) {
          log('error', summarizeError(error));
        }
      }, verifyDelayMs);
    });
  };

  const toggleAssistant = () =>
    run(assistantMuted ? 'unmute assistant (control message)' : 'mute assistant (control message)', (v) => {
      v.send({ type: 'control', control: assistantMuted ? 'unmute-assistant' : 'mute-assistant' });
      setAssistantMuted(!assistantMuted);
    });

  const leave = () => run('leave (stop)', (v) => v.stop());
  const end = () => run('end call (end-call message, then stop)', (v) => v.end());
  const reconnect = () =>
    run('reconnect to the same call', async (v) => {
      if (!call.current) throw new Error('no call to reconnect to');
      await v.reconnect(call.current);
      log('note', 'reconnect returned');
    });

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(formatLog(entries));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      log('error', 'could not copy to the clipboard');
    }
  }

  // Leave nothing running if the page is closed mid-experiment.
  useEffect(() => {
    return () => {
      try {
        vapi.current?.end();
      } catch {
        // Already gone.
      }
    };
  }, []);

  const live = status === 'live';
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Voice lab (developer only)</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Experiments for the pause and resume investigation (docs/PAUSE-RESUME.md). This uses the{' '}
          <strong>real assistant</strong>: it creates conversations and costs money. The log shows the shape of events and
          messages, never what anyone said.
        </p>
      </header>

      <section aria-label="Controls" className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-ink" role="status">
          Status: <strong>{status}</strong>
          {callId ? ` · call ${callId}` : ''}
          {live ? ` · microphone ${micMuted ? 'muted' : 'on'} · assistant ${assistantMuted ? 'muted' : 'on'}` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={status === 'starting' || live} onClick={() => start(false)}>
            Start (normal)
          </button>
          <button type="button" className={BUTTON} disabled={status === 'starting' || live} onClick={() => start(true)}>
            Start (keep the call alive when I leave)
          </button>
          <button type="button" className={BUTTON} disabled={!live} onClick={toggleMic}>
            {micMuted ? 'Unmute microphone' : 'Mute microphone'}
          </button>
          <button type="button" className={BUTTON} disabled={!live} onClick={toggleAssistant}>
            {assistantMuted ? 'Unmute assistant' : 'Mute assistant'}
          </button>
          <button type="button" className={BUTTON} disabled={!live} onClick={leave}>
            Leave (stop)
          </button>
          <button type="button" className={BUTTON} disabled={live || status === 'starting' || !hasCall} onClick={reconnect}>
            Reconnect
          </button>
          <button type="button" className={BUTTON} disabled={!live} onClick={end}>
            End call
          </button>
        </div>
      </section>

      <section aria-label="Experiments" className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-base font-semibold text-ink">Experiments to run</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
          {CHECKLIST.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section aria-label="Log" className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Log</h2>
          <button type="button" className={BUTTON} disabled={entries.length === 0} onClick={copyLog}>
            {copied ? 'Copied' : 'Copy log'}
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <pre
            data-testid="lab-log"
            className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 text-xs text-ink"
          >
            {formatLog(entries)}
          </pre>
        )}
      </section>
    </main>
  );
}
