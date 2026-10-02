'use client';

import { useCallback, useRef, useState } from 'react';
import { addTypedTurn, applyTranscript, type ConversationTurn } from '@/lib/transcript';

export type TextSessionError = 'failed' | 'rate-limited' | 'active-session';

export interface TextSession {
  turns: ConversationTurn[];
  /** A message is with the assistant and its answer has not come back yet. */
  sending: boolean;
  /** The conversation was ended (the customer said they were done, or it could not continue). */
  ended: boolean;
  conversationId: string | null;
  error: TextSessionError | null;
  /** Sends a typed message. False (and the text stays in the box) when it could not be sent. */
  send(text: string): Promise<boolean>;
  /** Forgets this conversation so the next message starts a new one. */
  restart(): void;
}

/**
 * A conversation carried on entirely by typing, for a customer who cannot use a microphone (Build Plan V3, V3.12). The
 * first message creates the conversation on the server (tied to the signed-in customer); later ones continue it. Turns
 * are not retried automatically: a retried turn would be answered twice.
 */
export function useTextSession(): TextSession {
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<TextSessionError | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const busy = useRef(false);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || busy.current) return false;
    busy.current = true;
    setSending(true);
    setError(null);
    const before = turns;
    setTurns((prev) => addTypedTurn(prev, clean));
    try {
      const res = await fetch('/api/support/text-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: idRef.current ?? undefined, message: clean }),
      });
      if (!res.ok) {
        const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        setTurns(before);
        setError(res.status === 429 || reason === 'rate-limited' ? 'rate-limited' : reason === 'active-session' ? 'active-session' : 'failed');
        return false;
      }
      const data = (await res.json()) as { conversationId?: string; response?: string; ended?: boolean };
      if (data.conversationId) {
        idRef.current = data.conversationId;
        setConversationId(data.conversationId);
      }
      if (data.response) setTurns((prev) => applyTranscript(prev, { role: 'assistant', text: data.response!, final: true }));
      if (data.ended) setEnded(true);
      return true;
    } catch {
      setTurns(before);
      setError('failed');
      return false;
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [turns]);

  const restart = useCallback(() => {
    idRef.current = null;
    setConversationId(null);
    setTurns([]);
    setEnded(false);
    setError(null);
  }, []);

  return { turns, sending, ended, conversationId, error, send, restart };
}
