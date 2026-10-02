'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useChatThread, type SendError, type ThreadMeta } from '@/hooks/useChatThread';
import { useChime, useTabTitle } from '@/hooks/useAttention';
import { formatWait, waitedLongEnough } from '@/lib/human/notify';
import type { MessageAuthor } from '@/lib/human/messages';
import { SHELL_COPY } from '@/lib/shell-copy';
import ChatLog from './ChatLog';
import EarlierTranscript from './EarlierTranscript';
import SessionFeedback from '../SessionFeedback';
import Composer from './Composer';

interface CustomerThreadMeta extends ThreadMeta {
  staff: MessageAuthor | null;
  staffTyping: boolean;
  staffReadAt: string | null;
  waitingSince: string | null;
  staffOnline: boolean;
  /** False when an administrator has switched callbacks off. */
  callbackAvailable?: boolean;
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

/** The current time, refreshed every so often, so "waiting for 3 minutes" stays true without a poll. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/**
 * The customer's text chat with a support specialist, after the voice call has handed over. A structured transcript
 * (not chat bubbles), the specialist's name and title, what is happening while they wait, a typing line, and a message
 * box. There is no callback form: a customer who would rather be called says so in the message box and the specialist
 * arranges it with them in the conversation. It never takes focus by itself and it carries no landmark of its own, so
 * it can sit in a page, a panel or (later) a widget.
 */
export default function HumanSupport({ conversationId }: { conversationId: string }) {
  const base = `/api/support/conversations/${encodeURIComponent(conversationId)}`;
  const chat = useChatThread<CustomerThreadMeta>({
    messagesUrl: `${base}/messages`,
    typingUrl: `${base}/typing`,
    readUrl: `${base}/read`,
    me: 'customer',
    otherReadAt: (m) => (m as CustomerThreadMeta | null)?.staffReadAt,
  });
  const copy = SHELL_COPY.human;
  const meta = chat.meta;
  const [closedByYou, setClosedByYou] = useState(false);
  const closed = Boolean(meta?.ended) || meta?.supportMode === 'ended' || closedByYou;
  const staff = meta?.staff ?? null;
  const now = useNow(15_000);
  const { play } = useChime();
  const chimedJoin = useRef(false);

  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useTabTitle(closed ? 1 : chat.unseenIncoming);

  useEffect(() => {
    if (!staff || chimedJoin.current) return;
    chimedJoin.current = true;
    try {
      play();
    } catch {
      // Browsers may refuse sound before a click; a missing chime is not worth an error.
    }
  }, [staff, play]);

  useEffect(() => {
    if (!closed || typeof document === 'undefined') return;
    const original = document.title;
    document.title = copy.closedTitle;
    return () => {
      document.title = original;
    };
  }, [closed, copy.closedTitle]);

  const typingText = meta?.staffTyping ? (staff ? copy.typing.replace('{name}', staff.name) : copy.typingGeneric) : '';
  const incomingText = chat.incoming
    ? chat.incoming.author
      ? copy.newMessage.replace('{name}', chat.incoming.author.name)
      : copy.newMessageGeneric
    : '';

  const waiting = !closed && !staff && Boolean(meta);
  const longWait = waiting && waitedLongEnough(meta?.waitingSince, now);
  const callbackOk = meta?.callbackAvailable !== false;

  async function endChat() {
    setWorking(true);
    setActionError(null);
    try {
      const res = await fetch(`${base}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      setClosedByYou(true);
      setConfirmingEnd(false);
      void chat.refresh();
    } catch {
      setActionError(copy.endFailed);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="human-heading" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      <h2 id="human-heading" className="text-lg font-semibold text-ink">
        {copy.title}
      </h2>
      {staff ? (
        <div className="mt-3">
          <p aria-live="polite" className="rounded-md border border-line bg-accent-soft px-4 py-3 text-sm font-medium text-ink">
            {copy.joined.replace('{name}', staff.name)}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Avatar author={staff} />
            <div>
              <p className="text-sm font-medium text-ink">{staff.name}</p>
              {staff.title && <p className="text-xs text-ink-muted">{staff.title}</p>}
            </div>
          </div>
        </div>
      ) : (
        waiting && (
          <div className="mt-2 text-sm text-ink-secondary">
            <p>{meta?.staffOnline ? copy.waitingOnline : callbackOk ? copy.waitingOffline : copy.waitingOfflineNoCallback}</p>
            {meta?.waitingSince && <p className="mt-1 text-ink-muted">{copy.waited.replace('{time}', formatWait(meta.waitingSince, now))}</p>}
            {longWait && <p className="mt-1 font-medium text-ink">{callbackOk ? copy.stillWaiting : copy.stillWaitingNoCallback}</p>}
          </div>
        )
      )}

      <ChatLog
        messages={chat.messages}
        me="customer"
        label={copy.logLabel}
        labels={{
          you: copy.labelYou,
          other: (m) => m.author?.name ?? copy.labelSpecialist,
          sending: copy.sendingLabel,
          notSent: copy.notSent,
          retry: copy.retry,
          remove: copy.remove,
          seen: copy.seen,
        }}
        seenMessageId={chat.seenMessageId}
        onRetry={chat.retry}
        onDiscard={chat.discard}
      />

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-secondary">
        {typingText || incomingText}
      </p>
      {chat.trouble && <p className="mt-1 text-sm text-ink-muted">{copy.trouble}</p>}

      <EarlierTranscript
        url={`/api/support/conversations/${encodeURIComponent(conversationId)}/transcript`}
        title={copy.earlierTitle}
        empty={copy.earlierEmpty}
      />

      {closed ? (
        <div className="mt-4 rounded-md bg-surface-subtle p-4" role="status" aria-live="polite">
          <p className="text-base font-semibold text-ink">{copy.closedTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{copy.closedBody}</p>
          <Link href="/dashboard" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
            {copy.closedAction}
          </Link>
          {/* Rating the specialist's help: once the chat is closed (by staff, or by the customer ending it). */}
          {meta?.supportMode === 'ended' && <SessionFeedback conversationId={conversationId} stage="human" />}
        </div>
      ) : (
        <>
          <Composer
            label={copy.messageLabel}
            placeholder={copy.placeholder}
            sendLabel={copy.send}
            sendingLabel={copy.sending}
            sending={false}
            errorText={chat.error ? ERRORS[chat.error] : null}
            tooLongText={copy.tooLong}
            onSend={(text) => chat.send(text)}
            onType={chat.signalTyping}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {!confirmingEnd && (
              <button
                type="button"
                onClick={() => setConfirmingEnd(true)}
                className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-subtle"
              >
                {copy.endChat}
              </button>
            )}
          </div>

          {confirmingEnd && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={working}
                onClick={() => void endChat()}
                className="inline-flex min-h-11 items-center rounded-md bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {copy.endConfirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingEnd(false)}
                className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink"
              >
                {copy.endKeep}
              </button>
            </div>
          )}
          {actionError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {actionError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
