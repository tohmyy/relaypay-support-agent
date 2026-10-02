'use client';

import { useCallback, useEffect, useRef } from 'react';
import { TYPING_HEARTBEAT_MS, type ComposerActivity } from '@/lib/session/typing';

const send = (conversationId: string, type: ComposerActivity) =>
  fetch(`/api/support/conversations/${encodeURIComponent(conversationId)}/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
    keepalive: type === 'stop',
  }).catch(() => undefined);

/** Converts noisy textarea changes into a bounded start/heartbeat/stop lease. */
export function useTypingActivity(conversationId: string | null) {
  const active = useRef(false);
  const lastSent = useRef(0);

  const stop = useCallback(() => {
    if (!active.current || !conversationId) return;
    active.current = false;
    lastSent.current = 0;
    void send(conversationId, 'stop');
  }, [conversationId]);

  const setTyping = useCallback(
    (typing: boolean) => {
      if (!typing) return stop();
      if (!conversationId) return;
      const now = Date.now();
      if (!active.current) {
        active.current = true;
        lastSent.current = now;
        void send(conversationId, 'start');
      } else if (now - lastSent.current >= TYPING_HEARTBEAT_MS) {
        lastSent.current = now;
        void send(conversationId, 'heartbeat');
      }
    },
    [conversationId, stop],
  );

  useEffect(() => stop, [stop]);
  return setTyping;
}
