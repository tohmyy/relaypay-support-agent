'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSessionClock } from '@/hooks/useSessionClock';
import type { PublicConversationState, PublicEndReason } from '@/lib/conversation-state';
import type { SessionView } from '@/lib/session/derive';
import { deriveSupportState, emptyBackendState, type SupportState } from '@/lib/support/derive';
import { addTypedTurn, applyTranscript, type ConversationTurn } from '@/lib/transcript';
import type { VoiceClient, VoiceClientFactory, VoiceClientHandlers } from '@/lib/voice/client';
import { RESUMABLE_END_REASONS, RESUME_GRACE_MS } from '@/lib/session/limits';
import type { PreflightResult } from '@/lib/support/preflight';
import { createNoiseDetector } from '@/lib/voice/noise';
import { checkMicrophone } from '@/lib/voice/microphone';
import {
  initialVoiceModel,
  isActive,
  voiceReducer,
  type ErrorKind,
  type VoiceModel,
} from '@/lib/voice/state';

export interface VoiceSessionOptions {
  createClient: VoiceClientFactory;
  fetchState: (conversationId: string) => Promise<PublicConversationState | null>;
  /** Overridable for tests; defaults to a real browser microphone check. */
  checkMic?: () => Promise<ErrorKind | null>;
  /**
   * Asked before the microphone and before any call exists: is support available, and may this customer begin
   * another call? Absent (previews, tests) means yes.
   */
  preflight?: () => Promise<PreflightResult>;
  /**
   * Reopens the conversation that just ended so a new call can continue it (the 30 second resume). Absent means resuming
   * is not offered (previews). Resolves to 'ok', or why it cannot be done.
   */
  reopen?: (conversationId: string) => Promise<'ok' | 'expired' | 'unavailable'>;
  pollMs?: number;
  /** Overridable for tests; the clock the session notices and the resume countdown count against. */
  clock?: () => number;
}

/** The longest typed message (the assistant refuses anything longer). */
export const MAX_TYPED_CHARS = 2000;

/** A limit that stopped a new call from starting at all. */
export type StartBlocked = 'active-session' | 'rate-limited';

/** Looks at the state API again after a call ends, until the recorded end reason shows up. */
const END_REASON_POLL_MS = [1500, 3500, 6000];

export interface VoiceSession {
  voice: VoiceModel;
  support: SupportState;
  turns: ConversationTurn[];
  backend: PublicConversationState;
  level: number;
  /** Silence countdown and time-limit notices, derived from the voice state and the server's limits. */
  session: SessionView;
  /** Why the session ended, once known (the recorded reason, or a provisional one while it is read). */
  endReason: PublicEndReason | null;
  /** The current call's id once it has started (it stays after the call ends), otherwise null. */
  conversationId: string | null;
  /** Set when the last start was refused because of a conversation limit; cleared by the next start. */
  blocked: StartBlocked | null;
  /** True while the live status updates are failing (the last good snapshot stays on screen). */
  statusUnavailable: boolean;
  /** The sign-in lapsed while starting; the page should send the customer to sign in again. */
  signedOut: boolean;
  /** The microphone is muted (only ever true when the provider reported it). */
  muted: boolean;
  /** It sounds noisy where the customer is (best effort; false when nothing was measured). */
  noisy: boolean;
  /** The call ended and can be resumed, with the transcript kept, for this many more seconds (0 when it cannot). */
  resumeSecondsLeft: number;
  /** A resume was tried and the conversation could no longer be reopened. */
  resumeFailed: boolean;
  /** Resumes the ended conversation on a new call (same conversation, transcript kept). */
  resume(): Promise<void>;
  /** The customer chose not to resume: the window closes now. */
  declineResume(): void;
  start(): Promise<void>;
  end(): Promise<void>;
  /**
   * Types a message into the live call as if it had been said: it is sent to the assistant and shown in the transcript.
   * False (and nothing sent) when there is no live call, the call is ending, or the text is empty or too long.
   */
  sendText(text: string): Promise<boolean>;
}

/** Owns the voice state, transcript and backend snapshot for one support session. */
export function useVoiceSession(options: VoiceSessionOptions): VoiceSession {
  const { createClient, fetchState, checkMic = checkMicrophone, preflight, reopen, pollMs = 3000, clock } = options;
  const [voice, dispatch] = useReducer(voiceReducer, initialVoiceModel);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [backend, setBackend] = useState<PublicConversationState>(emptyBackendState);
  const [level, setLevel] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<StartBlocked | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  // The customer pressed "End conversation" themselves (so it is never reported as silence or a time limit).
  const [customerEnded, setCustomerEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [noisy, setNoisy] = useState(false);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [declined, setDeclined] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [now, setNow] = useState(0);
  const noise = useRef(createNoiseDetector());
  const nowMs = clock ?? Date.now;

  const clientRef = useRef<VoiceClient | null>(null);
  const idRef = useRef<string | null>(null);
  const stateRef = useRef(voice.state);
  useEffect(() => {
    stateRef.current = voice.state;
  }, [voice.state]);

  /** Bumped whenever a call starts, so a slow answer about an earlier call can never overwrite the new call's state. */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const gen = generation.current;
    const next = await fetchState(id);
    if (idRef.current !== id || generation.current !== gen) return;
    // A failed read (after its one automatic retry) keeps the last good snapshot and only raises a quiet notice.
    setStatusUnavailable(next === null);
    if (next) setBackend(next);
  }, [fetchState]);

  /** Records that the call just ended: the moment the resume window starts counting from. */
  const markEnded = useCallback(() => {
    const t = nowMs();
    setEndedAt((prev) => prev ?? t);
    setNow(t);
    setMuted(false);
    setNoisy(false);
    noise.current.reset();
  }, [nowMs]);

  /**
   * Starts a call. With `resumeId` it continues that conversation instead: the transcript stays, the conversation is
   * reopened on the server (only within the grace period), and the new call carries the same conversation id.
   */
  const launch = useCallback(
    async (resumeId?: string) => {
      if (!['idle', 'ended', 'error'].includes(stateRef.current)) return;
      generation.current += 1;
      dispatch({ type: 'START' });
      setBackend(emptyBackendState);
      setLevel(0);
      setCustomerEnded(false);
      setBlocked(null);
      setStatusUnavailable(false);
      setSignedOut(false);
      setMuted(false);
      setNoisy(false);
      noise.current.reset();
      setEndedAt(null);
      setDeclined(false);
      setResumeFailed(false);
      if (!resumeId) {
        setTurns([]);
        idRef.current = null;
        setConversationId(null);
      }

      // Before anything is asked of the customer's browser: is support up, and may they begin a call? (For a resume this
      // comes before the conversation is reopened, because an open conversation counts against the customer's limits.)
      if (preflight) {
        const result = await preflight();
        if (result === 'unavailable') {
          dispatch({ type: 'ERROR', kind: 'unavailable' });
          return;
        }
        if (result === 'unauthorized') {
          setSignedOut(true);
          dispatch({ type: 'ERROR', kind: 'unavailable' });
          return;
        }
        if (result === 'active-session' || result === 'rate-limited') {
          setBlocked(result);
          if (resumeId) {
            setResumeFailed(true);
            dispatch({ type: 'RESUME_FAILED' });
          } else {
            dispatch({ type: 'ABORT' });
          }
          return;
        }
      }

      const micProblem = await checkMic();
      if (micProblem) {
        dispatch({ type: 'ERROR', kind: micProblem });
        return;
      }

      if (resumeId) {
        const reopened = reopen ? await reopen(resumeId) : 'unavailable';
        if (reopened !== 'ok') {
          setResumeFailed(true);
          dispatch({ type: 'RESUME_FAILED' });
          return;
        }
      }

      const handlers: VoiceClientHandlers = {
        onCallStart: () => dispatch({ type: 'CALL_STARTED' }),
        onCallEnd: () => {
          dispatch({ type: 'CALL_ENDED' });
          markEnded();
          void refresh();
        },
        onUserSpeech: (active) => dispatch({ type: active ? 'USER_SPEECH_START' : 'USER_SPEECH_END' }),
        onAssistantSpeech: (active) => {
          dispatch({ type: active ? 'ASSISTANT_SPEECH_START' : 'ASSISTANT_SPEECH_END' });
          if (!active) void refresh();
        },
        onVolume: setLevel,
        onTranscript: (event) => {
          setTurns((prev) => applyTranscript(prev, event));
          if (event.role === 'assistant' && event.final) void refresh();
        },
        onError: (kind) => dispatch({ type: 'ERROR', kind }),
        // Only providers that can tell call these; with no signal nothing is ever shown.
        onMuteChange: setMuted,
        onAmbientLevel: (ambient) => {
          if (stateRef.current === 'user-speaking') return;
          setNoisy(noise.current.sample(ambient, nowMs()));
        },
      };

      const client = createClient(resumeId ? { resumeConversationId: resumeId } : undefined);
      clientRef.current = client;
      try {
        const { conversationId: id } = await client.start(handlers);
        idRef.current = id;
        setConversationId(id);
      } catch {
        dispatch({ type: 'ERROR', kind: 'connection' });
      }
    },
    [checkMic, createClient, markEnded, nowMs, preflight, refresh, reopen],
  );

  const start = useCallback(() => launch(), [launch]);

  const hangUp = useCallback(async () => {
    if (!isActive(stateRef.current)) return;
    dispatch({ type: 'END_REQUESTED' });
    try {
      await clientRef.current?.stop();
    } catch {
      // The call is over either way.
    }
    dispatch({ type: 'CALL_ENDED' });
    markEnded();
    void refresh();
  }, [markEnded, refresh]);

  // The conversation moved to a support specialist: the voice call is over for this page too. The server hangs it up;
  // this covers the moment before that reaches the browser, and a hang-up that failed.
  useEffect(() => {
    if (backend.supportMode === 'human' && isActive(voice.state)) void hangUp();
  }, [backend.supportMode, voice.state, hangUp]);

  const sendText = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || clean.length > MAX_TYPED_CHARS) return false;
    // Only while the call is up: not while connecting, ending, or after it ended.
    if (!['listening', 'user-speaking', 'processing', 'assistant-speaking'].includes(stateRef.current)) return false;
    const client = clientRef.current;
    if (!client) return false;
    client.send(clean);
    setTurns((prev) => addTypedTurn(prev, clean));
    return true;
  }, []);

  // The server recorded the conversation as ended (a closer, a time limit, silence, a limit, noise) while this page still
  // thinks the call is up: the server's hang-up did not reach the browser, so end the call here. This is the page's half of
  // "the call always really stops" (no listening-but-over call is left running).
  useEffect(() => {
    if (backend.ended && isActive(voice.state)) void hangUp();
  }, [backend.ended, voice.state, hangUp]);

  /** The customer's own "End conversation": never reported as silence or a time limit. */
  const end = useCallback(async () => {
    if (isActive(stateRef.current)) setCustomerEnded(true);
    await hangUp();
  }, [hangUp]);

  // Keep the support state fresh while the call is going.
  useEffect(() => {
    if (!conversationId || !(isActive(voice.state) || voice.state === 'ending')) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [conversationId, voice.state, pollMs, refresh]);

  // Leave nothing running if the page is closed mid-call.
  useEffect(() => {
    return () => {
      if (isActive(stateRef.current)) void clientRef.current?.stop();
    };
  }, []);

  const support = useMemo(
    () => deriveSupportState(backend, { callEnded: voice.state === 'ended' }),
    [backend, voice.state],
  );

  const { view: session, provisionalEnd } = useSessionClock({
    voiceState: voice.state,
    supportState: support,
    backend,
    onExpired: () => void hangUp(),
    now: clock,
  });

  // The agent service records why it ended the call, which can land just after the call drops (and, for a
  // customer-ended call, arrives with Vapi's report), so look a few more times until it does.
  useEffect(() => {
    if (voice.state !== 'ended' || !conversationId || backend.endReason) return;
    const timers = END_REASON_POLL_MS.map((ms) => setTimeout(() => void refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [voice.state, conversationId, backend.endReason, refresh]);

  const endReason =
    backend.endReason ?? (voice.state === 'ended' && !customerEnded ? provisionalEnd : null);

  // The resume window: counted from the moment the call ended, only for an ending the customer could pick up again.
  const reasonResumable = backend.endReason
    ? (RESUMABLE_END_REASONS as readonly string[]).includes(backend.endReason)
    : customerEnded;
  const leftMs = endedAt === null ? 0 : endedAt + RESUME_GRACE_MS - now;
  const resumeOpen =
    voice.state === 'ended' &&
    Boolean(reopen) &&
    Boolean(conversationId) &&
    !declined &&
    !resumeFailed &&
    backend.supportMode !== 'human' &&
    reasonResumable &&
    leftMs > 0;
  const resumeSecondsLeft = resumeOpen ? Math.ceil(leftMs / 1000) : 0;

  // Count the window down once a second while it is open. The clock only moves here, never during rendering.
  useEffect(() => {
    if (!resumeOpen) return;
    const timer = setInterval(() => setNow(nowMs()), 500);
    return () => clearInterval(timer);
  }, [resumeOpen, nowMs]);

  const resume = useCallback(async () => {
    const id = idRef.current;
    if (id) await launch(id);
  }, [launch]);
  const declineResume = useCallback(() => setDeclined(true), []);

  return {
    voice,
    support,
    turns,
    backend,
    level,
    session,
    endReason,
    conversationId,
    blocked,
    statusUnavailable,
    signedOut,
    muted,
    noisy,
    resumeSecondsLeft,
    resumeFailed,
    resume,
    declineResume,
    start,
    end,
    sendText,
  };
}
