'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicConversationState, PublicEndReason } from '@/lib/conversation-state';
import {
  deriveSessionView,
  IDLE_SESSION_VIEW,
  provisionalEndReason,
  type SessionView,
} from '@/lib/session/derive';
import type { SupportState } from '@/lib/support/derive';
import { isActive, type VoiceState } from '@/lib/voice/state';

/** The agent service ends the call at the limit; if the call is somehow still up this long after, the browser hangs up. */
const EXPIRY_GRACE_SECONDS = 3;

export interface SessionClock {
  view: SessionView;
  /**
   * Best guess at why the call just dropped (a countdown that ran out, a session at its limit), for the moment
   * before the recorded reason is read. The caller ignores it when the customer ended the call themselves.
   */
  provisionalEnd: PublicEndReason | null;
}

/**
 * Ticks once a second while a call is live and turns the voice state plus the server's limits into the notices
 * the customer sees. It decides nothing durable: the agent service enforces silence and the time limit.
 */
export function useSessionClock(input: {
  voiceState: VoiceState;
  supportState: SupportState;
  backend: PublicConversationState;
  /** Last-resort local hang-up when the time limit has long passed. */
  onExpired: () => void;
  now?: () => number;
  /** Composer typing holds the visible silence countdown only. */
  typingActive?: boolean;
}): SessionClock {
  const { voiceState, supportState, backend, onExpired, now = Date.now, typingActive = false } = input;
  const [view, setView] = useState<SessionView>(IDLE_SESSION_VIEW);
  const [provisionalEnd, setProvisionalEnd] = useState<PublicEndReason | null>(null);
  const quietSince = useRef<number | null>(null);
  const offset = useRef(0);
  const expired = useRef(onExpired);
  const lastView = useRef<SessionView>(IDLE_SESSION_VIEW);

  useEffect(() => {
    expired.current = onExpired;
  }, [onExpired]);

  // Quiet time starts each time the call settles into `listening`, and any other state (or typing) cancels it.
  useEffect(() => {
    quietSince.current = voiceState === 'listening' && !typingActive ? now() : null;
  }, [voiceState, typingActive, now]);

  useEffect(() => {
    const server = backend.serverTime ? Date.parse(backend.serverTime) : NaN;
    if (Number.isFinite(server)) offset.current = server - now();
  }, [backend.serverTime, now]);

  const startedAtMs = backend.startedAt ? Date.parse(backend.startedAt) : null;
  const live = isActive(voiceState);

  useEffect(() => {
    if (!live) {
      // A call that drops while a countdown was showing, or at the limit, was ended for the customer. Whether
      // the customer pressed End themselves is known to the voice session, which withholds this guess then.
      setProvisionalEnd(voiceState === 'ended' ? provisionalEndReason(lastView.current) : null);
      lastView.current = IDLE_SESSION_VIEW;
      setView(IDLE_SESSION_VIEW);
      return;
    }
    setProvisionalEnd(null);
    const tick = () => {
      const next = deriveSessionView({
        voiceState,
        supportState,
        limits: backend.limits,
        startedAtMs: startedAtMs !== null && Number.isFinite(startedAtMs) ? startedAtMs : null,
        quietSinceMs: quietSince.current,
        nowMs: now(),
        clockOffsetMs: offset.current,
        typingActive,
      });
      lastView.current = next;
      setView((prev) =>
        prev.silenceCountdown === next.silenceCountdown &&
        prev.secondsLeft === next.secondsLeft &&
        prev.sessionWarning === next.sessionWarning
          ? prev
          : next,
      );
      if (next.secondsLeft !== null && next.secondsLeft <= -EXPIRY_GRACE_SECONDS) expired.current();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live, voiceState, supportState, backend.limits, startedAtMs, now, typingActive]);

  return { view, provisionalEnd };
}
