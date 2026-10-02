'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useChatThread, type SendError, type ThreadMeta } from '@/hooks/useChatThread';
import type { MessageAuthor } from '@/lib/human/messages';
import { SHELL_COPY } from '@/lib/shell-copy';
import Composer from './Composer';

interface CustomerThreadMeta extends ThreadMeta {
  staff: MessageAuthor | null;
  staffTyping: boolean;
}

const ERRORS: Record<SendError, string> = {
  'too-long': SHELL_COPY.human.tooLong,
  'rate-limited': SHELL_COPY.human.rateLimited,
  closed: SHELL_COPY.human.closedBody,
  taken: SHELL_COPY.human.sendFailed,
  failed: SHELL_COPY.human.sendFailed,
};

function Avatar({ author }: { author: MessageAuthor }) {
  const initial = author.name.trim().charAt(0).toUpperCase() || '?';
  return author.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={author.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
  ) : (
    <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-primary">
      {initial}
    </span>
  );
}

/**
 * The customer's text chat with a support specialist, after the voice call has handed over. A structured transcript
 * (not chat bubbles), the specialist's name and title, a typing line, and a message box. It never takes focus by
 * itself and it carries no landmark of its own, so it can sit in a page, a panel or (later) a widget.
 */
export default function HumanSupport({ conversationId }: { conversationId: string }) {
  const base = `/api/support/conversations/${encodeURIComponent(conversationId)}`;
  const chat = useChatThread<CustomerThreadMeta>({ messagesUrl: `${base}/messages`, typingUrl: `${base}/typing` });
  const copy = SHELL_COPY.human;
  const meta = chat.meta;
  const closed = Boolean(meta?.ended) || meta?.supportMode === 'ended';
  const staff = meta?.staff ?? null;

  const log = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  const typingText = meta?.staffTyping ? (staff ? copy.typing.replace('{name}', staff.name) : copy.typingGeneric) : '';

  return (
    <section aria-labelledby="human-heading" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      <h2 id="human-heading" className="text-lg font-semibold text-ink">
        {copy.title}
      </h2>
      {staff ? (
        <div className="mt-3 flex items-center gap-3">
          <Avatar author={staff} />
          <div>
            <p className="text-sm font-medium text-ink">{staff.name}</p>
            {staff.title && <p className="text-xs text-ink-muted">{staff.title}</p>}
          </div>
        </div>
      ) : (
        !closed && <p className="mt-2 text-sm text-ink-secondary">{copy.waiting}</p>
      )}

      <ol
        ref={log}
        role="log"
        aria-label={copy.logLabel}
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="mt-4 max-h-96 min-h-32 space-y-3 overflow-y-auto"
      >
        {chat.messages.map((m) => (
          <li key={m.id} className={m.sender === 'system' ? 'text-sm text-ink-muted' : 'text-sm text-ink'}>
            {m.sender !== 'system' && (
              <p className="text-xs font-medium text-ink-secondary">
                {m.sender === 'customer' ? copy.labelYou : (m.author?.name ?? copy.labelSpecialist)}
              </p>
            )}
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-secondary">
        {typingText}
      </p>
      {chat.trouble && <p className="mt-1 text-sm text-ink-muted">{copy.trouble}</p>}

      {closed ? (
        <div className="mt-4 rounded-md bg-surface-subtle p-4">
          <p className="text-base font-semibold text-ink">{copy.closedTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{copy.closedBody}</p>
          <Link href="/dashboard" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
            {copy.closedAction}
          </Link>
        </div>
      ) : (
        <Composer
          label={copy.messageLabel}
          placeholder={copy.placeholder}
          sendLabel={copy.send}
          sendingLabel={copy.sending}
          sending={chat.sending}
          errorText={chat.error ? ERRORS[chat.error] : null}
          tooLongText={copy.tooLong}
          onSend={(text) => chat.send(text)}
          onType={chat.signalTyping}
        />
      )}
    </section>
  );
}
