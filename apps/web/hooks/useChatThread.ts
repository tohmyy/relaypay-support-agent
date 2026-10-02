'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TYPING_SIGNAL_INTERVAL_MS,
  cleanMessage,
  cursorOf,
  lastSeenMessageId,
  mergeMessages,
  type HumanMessage,
  type MessageAuthor,
  type MessageSender,
} from '@/lib/human/messages';
import { usePolling, type PollResult } from './usePolling';

/** What every thread response carries; each side adds its own fields (who is typing, who has the conversation). */
export interface ThreadMeta {
  supportMode: 'ai' | 'human' | 'ended';
  ended: boolean;
}

export type SendError = 'too-long' | 'closed' | 'taken' | 'rate-limited' | 'failed';

/** A message as shown: one the server stored, or one this browser is still sending (or could not send). */
export interface ThreadMessage extends HumanMessage {
  status?: 'sending' | 'failed';
  failure?: SendError;
}

export interface UseChatThreadOptions {
  /** `GET` for messages (with `?after=`) and `POST` to send. */
  messagesUrl: string;
  typingUrl: string;
  /** Tells the server this side has read the conversation (for "Seen" and unread counts). */
  readUrl: string;
  /** Which side this is, so the hook knows which messages are its own. */
  me: Extract<MessageSender, 'customer' | 'staff'>;
  /** The time the other side last read the conversation, from the meta, for the "Seen" mark. */
  otherReadAt?: (meta: ThreadMeta | null) => string | null | undefined;
  /** Whom the sender should be shown as (staff messages need their own name before the server echoes it). */
  author?: MessageAuthor | null;
  pollMs?: number;
  hiddenPollMs?: number;
  /** Stops polling (for example once a closed conversation has been read). */
  paused?: boolean;
  /** Injectable for tests. */
  newId?: () => string;
  random?: () => number;
}

const READ_SIGNAL_MIN_MS = 4000;

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Old browsers: a version-4 shaped id from random numbers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function failureFor(status: number, reason: string | undefined): SendError {
  if (status === 413) return 'too-long';
  if (status === 429) return 'rate-limited';
  if (status === 409) return reason === 'taken' ? 'taken' : 'closed';
  return 'failed';
}

/**
 * One text conversation, live. Polls for new messages (quickly while the page is in front, slowly while it is hidden),
 * shows a message the moment it is sent, and sends it again safely if the first attempt failed: every message has an id
 * made in the browser, so a retry that already got through is recognised and stored once. It also reports when this
 * side has read the conversation, and exposes what the other side has read so the latest own message can show "Seen".
 */
export function useChatThread<M extends ThreadMeta>(options: UseChatThreadOptions) {
  const { messagesUrl, typingUrl, readUrl, me, otherReadAt, author = null, pollMs = 2000, hiddenPollMs = 10_000, paused = false, newId = uuid, random } = options;
  const [server, setServer] = useState<HumanMessage[]>([]);
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [meta, setMeta] = useState<M | null>(null);
  const [trouble, setTrouble] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  /** The newest message from the other side that arrived after the first load (for announcements and the tab title). */
  const [incoming, setIncoming] = useState<HumanMessage | null>(null);
  const [unseenIncoming, setUnseenIncoming] = useState(0);

  const cursor = useRef<string | null>(null);
  const serverRef = useRef<HumanMessage[]>([]);
  const loaded = useRef(false);
  const lastTypingSignal = useRef(0);
  const lastReadSignal = useRef(0);
  const lastReadOf = useRef<string | null>(null);
  const generation = useRef(0);

  const reportRead = useCallback(
    (messages: HumanMessage[]) => {
      if (typeof document === 'undefined' || document.visibilityState === 'hidden' || !document.hasFocus()) return;
      // Someone is looking at the conversation, so nothing in it is unseen any more.
      setUnseenIncoming(0);
      const newestOther = [...messages].reverse().find((m) => m.sender !== me && m.sender !== 'system');
      if (!newestOther || newestOther.at === lastReadOf.current) return;
      const now = Date.now();
      if (now - lastReadSignal.current < READ_SIGNAL_MIN_MS) return;
      lastReadSignal.current = now;
      lastReadOf.current = newestOther.at;
      void fetch(readUrl, { method: 'POST' }).catch(() => undefined);
    },
    [me, readUrl],
  );

  const poll = useCallback(async (): Promise<PollResult> => {
    const mine = generation.current;
    try {
      const url = cursor.current ? `${messagesUrl}?after=${encodeURIComponent(cursor.current)}` : messagesUrl;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as M & { messages?: HumanMessage[] };
      if (mine !== generation.current) return 'stop';
      setTrouble(false);
      const fresh = Array.isArray(data.messages) ? data.messages : [];
      const merged = mergeMessages(serverRef.current, fresh);
      const known = new Set(serverRef.current.map((m) => m.id));
      const added = fresh.filter((m) => !known.has(m.id) && m.sender !== me && m.sender !== 'system');
      serverRef.current = merged;
      cursor.current = cursorOf(merged);
      setServer(merged);
      // Messages this browser sent are shown from `pending` until the server's copy arrives (same client id).
      const confirmed = new Set(fresh.map((m) => m.clientId).filter(Boolean));
      if (confirmed.size) setPending((prev) => prev.filter((p) => !p.clientId || !confirmed.has(p.clientId)));
      if (loaded.current && added.length) {
        setIncoming(added[added.length - 1]);
        setUnseenIncoming((n) => n + added.length);
      }
      loaded.current = true;
      const rest = { ...data } as Record<string, unknown>;
      delete rest.messages;
      setMeta(rest as unknown as M);
      reportRead(merged);
      const ended = Boolean((rest as Partial<ThreadMeta>).ended) || (rest as Partial<ThreadMeta>).supportMode === 'ended';
      return ended ? 'stop' : 'ok';
    } catch {
      if (mine !== generation.current) return 'stop';
      setTrouble(true);
      return 'failed';
    }
  }, [messagesUrl, me, reportRead]);

  // A different conversation starts from nothing.
  useEffect(() => {
    generation.current += 1;
    cursor.current = null;
    serverRef.current = [];
    loaded.current = false;
    lastReadOf.current = null;
    return () => {
      generation.current += 1;
    };
  }, [messagesUrl]);

  usePolling(poll, { foregroundMs: pollMs, hiddenMs: hiddenPollMs, enabled: !paused, random });

  // Looking at the page again counts as reading what came in while it was hidden.
  useEffect(() => {
    const onFocus = () => reportRead(serverRef.current);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [reportRead]);

  const post = useCallback(
    async (clientId: string, body: string): Promise<SendError | null> => {
      try {
        const res = await fetch(messagesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, clientId }),
        });
        if (res.status === 201 || res.status === 200) return null;
        const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        return failureFor(res.status, reason);
      } catch {
        return 'failed';
      }
    },
    [messagesUrl],
  );

  const settle = useCallback(
    async (clientId: string, body: string) => {
      const failure = await post(clientId, body);
      if (failure === null) {
        setError(null);
        void poll(); // fetches the stored copy, which replaces the pending one
        return;
      }
      setPending((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: 'failed', failure } : p)));
      if (failure === 'closed' || failure === 'taken') {
        setError(failure);
        void poll();
      }
    },
    [post, poll],
  );

  /** Shows the message at once and sends it. Returns false only when the text itself is not allowed. */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const clean = cleanMessage(text);
      if (!clean.ok) {
        if (clean.error === 'too-long') setError('too-long');
        return false;
      }
      setError(null);
      const clientId = newId();
      setPending((prev) => [
        ...prev,
        { id: `pending-${clientId}`, clientId, sender: me, body: clean.body, at: new Date().toISOString(), author, status: 'sending' },
      ]);
      void settle(clientId, clean.body);
      return true;
    },
    [me, newId, author, settle],
  );

  /** Sends a message that failed again, with the same id, so it cannot be stored twice. */
  const retry = useCallback(
    (clientId: string) => {
      const item = pending.find((p) => p.clientId === clientId);
      if (!item) return;
      setPending((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: 'sending', failure: undefined } : p)));
      void settle(clientId, item.body);
    },
    [pending, settle],
  );

  const discard = useCallback((clientId: string) => setPending((prev) => prev.filter((p) => p.clientId !== clientId)), []);

  /** Tells the other side someone is typing. At most one request every few seconds; failures are ignored. */
  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSignal.current < TYPING_SIGNAL_INTERVAL_MS) return;
    lastTypingSignal.current = now;
    void fetch(typingUrl, { method: 'POST' }).catch(() => undefined);
  }, [typingUrl]);

  const clearError = useCallback(() => setError(null), []);

  const messages: ThreadMessage[] = useMemo(() => {
    // A pending message the server already stored (its copy arrived) is shown once, as the server's.
    const stored = new Set(server.map((m) => m.clientId).filter(Boolean));
    const waiting = pending.filter((p) => !p.clientId || !stored.has(p.clientId));
    return [...server, ...waiting];
  }, [server, pending]);

  const seenMessageId = useMemo(
    () => lastSeenMessageId(server, me, otherReadAt?.(meta) ?? null),
    [server, me, otherReadAt, meta],
  );

  return {
    messages,
    meta,
    trouble,
    error,
    send,
    retry,
    discard,
    signalTyping,
    refresh: poll,
    clearError,
    seenMessageId,
    incoming,
    unseenIncoming,
  };
}
