'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TYPING_SIGNAL_INTERVAL_MS,
  cursorOf,
  mergeMessages,
  type HumanMessage,
} from '@/lib/human/messages';

/** What every thread response carries; each side adds its own fields (who is typing, who has the conversation). */
export interface ThreadMeta {
  supportMode: 'ai' | 'human' | 'ended';
  ended: boolean;
}

export type SendError = 'too-long' | 'closed' | 'taken' | 'rate-limited' | 'failed';

export interface UseChatThreadOptions {
  /** `GET` for messages (with `?after=`) and `POST` to send; the typing signal goes to `typingUrl`. */
  messagesUrl: string;
  typingUrl: string;
  pollMs?: number;
  /** Stops polling (for example once a closed conversation has been read). */
  paused?: boolean;
}

const MAX_BACKOFF_MS = 10_000;

/**
 * Polls one text conversation: new messages since the last one seen, plus whatever else the endpoint reports. A failed
 * poll keeps what is on screen, says so, and tries again more slowly. Once the conversation is closed it stops.
 */
export function useChatThread<M extends ThreadMeta>(options: UseChatThreadOptions) {
  const { messagesUrl, typingUrl, pollMs = 2000, paused = false } = options;
  const [messages, setMessages] = useState<HumanMessage[]>([]);
  const [meta, setMeta] = useState<M | null>(null);
  const [trouble, setTrouble] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);

  const cursor = useRef<string | null>(null);
  const failures = useRef(0);
  const lastTypingSignal = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopped = useRef(false);
  const generation = useRef(0);

  const poll = useCallback(async (): Promise<M | null> => {
    const mine = generation.current;
    try {
      const url = cursor.current ? `${messagesUrl}?after=${encodeURIComponent(cursor.current)}` : messagesUrl;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as M & { messages?: HumanMessage[] };
      if (mine !== generation.current) return null;
      failures.current = 0;
      setTrouble(false);
      const incoming = Array.isArray(data.messages) ? data.messages : [];
      setMessages((prev) => {
        const next = mergeMessages(prev, incoming);
        cursor.current = cursorOf(next);
        return next;
      });
      const rest = { ...data } as Record<string, unknown>;
      delete rest.messages;
      setMeta(rest as unknown as M);
      return rest as unknown as M;
    } catch {
      if (mine !== generation.current) return null;
      failures.current += 1;
      setTrouble(true);
      return null;
    }
  }, [messagesUrl]);

  useEffect(() => {
    stopped.current = false;
    generation.current += 1;
    cursor.current = null;
    failures.current = 0;
    if (paused) return;

    const loop = async () => {
      const data = await poll();
      if (stopped.current) return;
      // A closed conversation has nothing more to say.
      if (data?.ended || data?.supportMode === 'ended') return;
      const delay = Math.min(MAX_BACKOFF_MS, pollMs * 2 ** Math.min(failures.current, 3));
      timer.current = setTimeout(() => void loop(), delay);
    };
    void loop();
    return () => {
      stopped.current = true;
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll, pollMs, paused]);

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      setSending(true);
      setError(null);
      try {
        const res = await fetch(messagesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        if (res.status === 201) {
          void poll();
          return true;
        }
        const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        if (res.status === 413) setError('too-long');
        else if (res.status === 429) setError('rate-limited');
        else if (res.status === 409) setError(reason === 'taken' ? 'taken' : 'closed');
        else setError('failed');
        if (res.status === 409) void poll();
        return false;
      } catch {
        setError('failed');
        return false;
      } finally {
        setSending(false);
      }
    },
    [messagesUrl, poll],
  );

  /** Tells the other side someone is typing. At most one request every few seconds; failures are ignored. */
  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSignal.current < TYPING_SIGNAL_INTERVAL_MS) return;
    lastTypingSignal.current = now;
    void fetch(typingUrl, { method: 'POST' }).catch(() => undefined);
  }, [typingUrl]);

  const clearError = useCallback(() => setError(null), []);

  return { messages, meta, trouble, sending, error, send, signalTyping, refresh: poll, clearError };
}
