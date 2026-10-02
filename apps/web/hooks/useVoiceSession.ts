'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSessionClock } from '@/hooks/useSessionClock';
import type { PublicConversationState, PublicEndReason } from '@/lib/conversation-state';
import { COPY } from '@/lib/copy';
import type { SessionView } from '@/lib/session/derive';
import { deriveSupportState, emptyBackendState, type SupportState } from '@/lib/support/derive';
import { addTypedTurn, applyTranscript, type ConversationTurn } from '@/lib/transcript';
import type { VoiceClient, VoiceClientFactory, VoiceClientHandlers } from '@/lib/voice/client';
import { checkMicrophone } from '@/lib/voice/microphone';
import {
  initialVoiceModel,
  isActive,
  voiceReducer,
  type ErrorKind,
  type VoiceModel,
} from '@/lib/voice/state';

export interface ContactDetails {
  name: string;
  email: string;
  preferredTime?: string;
}

export interface VoiceSessionOptions {
  createClient: VoiceClientFactory;
  fetchState: (conversationId: string) => Promise<PublicConversationState | null>;
  /** Overridable for tests; defaults to a real browser microphone check. */
  checkMic?: () => Promise<ErrorKind | null>;
  pollMs?: number;
  /** Overridable for tests; the clock the session notices count against. */
  clock?: () => number;
}

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
  start(): Promise<void>;
  end(): Promise<void>;
  submitContact(details: ContactDetails): void;
}

/** The sentence typed into the call when the customer submits the contact form. */
export function contactMessage({ name, email, preferredTime }: ContactDetails): string {
  const time = preferredTime?.trim();
  return `My name is ${name.trim()}. My email address is ${email.trim()}.${time ? ` The best time for a callback is ${time}.` : ''}`;
}

/** Owns the voice state, transcript and backend snapshot for one support session. */
export function useVoiceSession(options: VoiceSessionOptions): VoiceSession {
  const { createClient, fetchState, checkMic = checkMicrophone, pollMs = 3000, clock } = options;
  const [voice, dispatch] = useReducer(voiceReducer, initialVoiceModel);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [backend, setBackend] = useState<PublicConversationState>(emptyBackendState);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [level, setLevel] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const clientRef = useRef<VoiceClient | null>(null);
  const idRef = useRef<string | null>(null);
  const endedByCustomer = useRef(false);
  const stateRef = useRef(voice.state);
  useEffect(() => {
    stateRef.current = voice.state;
  }, [voice.state]);

  const refresh = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const next = await fetchState(id);
    if (next && idRef.current === id) setBackend(next);
  }, [fetchState]);

  const start = useCallback(async () => {
    if (!['idle', 'ended', 'error'].includes(stateRef.current)) return;
    dispatch({ type: 'START' });
    setTurns([]);
    setBackend(emptyBackendState);
    setContactSubmitted(false);
    setLevel(0);
    idRef.current = null;
    endedByCustomer.current = false;
    setConversationId(null);

    const micProblem = await checkMic();
    if (micProblem) {
      dispatch({ type: 'ERROR', kind: micProblem });
      return;
    }

    const handlers: VoiceClientHandlers = {
      onCallStart: () => dispatch({ type: 'CALL_STARTED' }),
      onCallEnd: () => {
        dispatch({ type: 'CALL_ENDED' });
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
    };

    const client = createClient();
    clientRef.current = client;
    try {
      const { conversationId: id } = await client.start(handlers);
      idRef.current = id;
      setConversationId(id);
    } catch {
      dispatch({ type: 'ERROR', kind: 'connection' });
    }
  }, [checkMic, createClient, refresh]);

  const hangUp = useCallback(async () => {
    if (!isActive(stateRef.current)) return;
    dispatch({ type: 'END_REQUESTED' });
    try {
      await clientRef.current?.stop();
    } catch {
      // The call is over either way.
    }
    dispatch({ type: 'CALL_ENDED' });
    void refresh();
  }, [refresh]);

  /** The customer's own "End conversation": never reported as silence or a time limit. */
  const end = useCallback(async () => {
    if (isActive(stateRef.current)) endedByCustomer.current = true;
    await hangUp();
  }, [hangUp]);

  const submitContact = useCallback(
    (details: ContactDetails) => {
      clientRef.current?.send(contactMessage(details));
      setTurns((prev) => addTypedTurn(prev, COPY.conversation.detailsSent));
      setContactSubmitted(true);
      setTimeout(() => void refresh(), 1500);
    },
    [refresh],
  );

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
    () => deriveSupportState(backend, { callEnded: voice.state === 'ended', contactSubmitted }),
    [backend, voice.state, contactSubmitted],
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
    backend.endReason ?? (voice.state === 'ended' && !endedByCustomer.current ? provisionalEnd : null);

  return { voice, support, turns, backend, level, session, endReason, start, end, submitContact };
}
