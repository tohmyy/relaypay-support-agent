'use client';

import { useEffect, useRef } from 'react';
import type { ThreadMessage } from '@/hooks/useChatThread';
import type { MessageSender } from '@/lib/human/messages';

export interface ChatLogLabels {
  /** Label for the viewer's own messages. */
  you: string;
  /** Label for someone else's message (a staff name, "Customer", ...). */
  other: (message: ThreadMessage) => string;
  sending: string;
  notSent: string;
  retry: string;
  remove: string;
  seen: string;
}

/**
 * A chat transcript as a labelled log: structured rows, not speech bubbles. Own messages show "Sending…" until the server
 * has them and "Not sent" with a way to try again if they never get there; the newest own message the other side has
 * read says "Seen". It keeps its place if the reader scrolls up, and takes no focus.
 */
export default function ChatLog({
  messages,
  me,
  label,
  labels,
  seenMessageId,
  onRetry,
  onDiscard,
}: {
  messages: ThreadMessage[];
  me: Extract<MessageSender, 'customer' | 'staff'>;
  label: string;
  labels: ChatLogLabels;
  seenMessageId: string | null;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}) {
  const log = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <ol
      ref={log}
      role="log"
      aria-label={label}
      aria-live="off"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="mt-4 max-h-96 min-h-32 space-y-3 overflow-y-auto"
    >
      {messages.map((m) => {
        const own = m.sender === me;
        return (
          <li key={m.id} className={m.sender === 'system' ? 'text-center text-sm text-ink-muted' : 'text-sm text-ink'}>
            {m.sender !== 'system' && (
              <p className="text-xs font-medium text-ink-secondary">{own ? labels.you : labels.other(m)}</p>
            )}
            <p className={`whitespace-pre-wrap ${m.status === 'sending' ? 'text-ink-secondary' : ''}`}>{m.body}</p>
            {m.status === 'sending' && <p className="text-xs text-ink-muted">{labels.sending}</p>}
            {m.status === 'failed' && m.clientId && (
              <p className="text-xs text-danger">
                {labels.notSent}{' '}
                <button type="button" onClick={() => onRetry(m.clientId as string)} className="font-medium underline">
                  {labels.retry}
                </button>{' '}
                <button type="button" onClick={() => onDiscard(m.clientId as string)} className="font-medium underline">
                  {labels.remove}
                </button>
              </p>
            )}
            {own && !m.status && m.id === seenMessageId && <p className="text-xs text-ink-muted">{labels.seen}</p>}
          </li>
        );
      })}
    </ol>
  );
}
