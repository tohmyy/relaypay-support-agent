'use client';

import { useState } from 'react';
import { useChatThread, type SendError, type ThreadMeta } from '@/hooks/useChatThread';
import { formatWait } from '@/lib/human/notify';
import type { MessageAuthor } from '@/lib/human/messages';
import { STAFF_COPY } from '@/lib/shell-copy';
import ChatLog from './ChatLog';
import Composer from './Composer';
import { Card } from './ui';

interface StaffThreadMeta extends ThreadMeta {
  assignedTo: MessageAuthor | null;
  assignedToMe: boolean;
  canReply: boolean;
  customerTyping: boolean;
  customerReadAt: string | null;
  waitingSince: string | null;
}

const ERRORS: Record<SendError, string> = {
  'too-long': STAFF_COPY.chat.tooLong,
  'rate-limited': STAFF_COPY.chat.rateLimited,
  closed: STAFF_COPY.chat.closed,
  taken: STAFF_COPY.chat.taken,
  failed: STAFF_COPY.chat.sendFailed,
};

/**
 * The staff side of the text chat: who has the conversation, the messages as they arrive (with "Seen" and a retry for
 * any that did not send), a reply box, and the actions (take it, return it to the queue, close it). Every action is
 * re-checked on the server, so what shows here is only a convenience.
 */
export default function StaffChat({ conversationId }: { conversationId: string }) {
  const base = `/api/staff/conversations/${encodeURIComponent(conversationId)}`;
  const chat = useChatThread<StaffThreadMeta>({
    messagesUrl: `${base}/messages`,
    typingUrl: `${base}/typing`,
    readUrl: `${base}/read`,
    me: 'staff',
    otherReadAt: (m) => (m as StaffThreadMeta | null)?.customerReadAt,
  });
  const copy = STAFF_COPY.chat;
  const meta = chat.meta;
  const closed = Boolean(meta?.ended) || meta?.supportMode === 'ended';
  const [action, setAction] = useState<'idle' | 'working' | 'confirm-close' | 'confirm-release'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(path: 'claim' | 'close' | 'release') {
    setAction('working');
    setActionError(null);
    try {
      const res = await fetch(`${base}/${path}`, { method: 'POST' });
      if (!res.ok) setActionError(res.status === 409 ? copy.taken : copy.sendFailed);
    } catch {
      setActionError(copy.sendFailed);
    } finally {
      setAction('idle');
      void chat.refresh();
    }
  }

  const status = closed
    ? copy.closed
    : meta?.assignedTo
      ? meta.assignedToMe
        ? copy.assignedToYou
        : copy.assignedTo.replace('{name}', meta.assignedTo.name)
      : `${copy.waiting}${meta?.waitingSince ? ` ${copy.waitingSince.replace('{time}', formatWait(meta.waitingSince))}.` : ''}`;

  const mine = Boolean(meta?.assignedToMe);
  const incomingText = chat.incoming ? copy.newMessage : '';

  return (
    <Card title={copy.title}>
      <p className="text-sm text-ink-secondary">{status}</p>
      {actionError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      {!closed && meta && !meta.assignedTo && (
        <button
          type="button"
          disabled={action === 'working'}
          onClick={() => void act('claim')}
          className="mt-3 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {copy.take}
        </button>
      )}

      <ChatLog
        messages={chat.messages}
        me="staff"
        label={copy.title}
        labels={{
          you: copy.staffYou,
          other: (m) => (m.sender === 'customer' ? copy.customer : copy.system),
          sending: STAFF_COPY.chat.sending,
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
        {meta?.customerTyping ? copy.customerTyping : incomingText}
      </p>
      {chat.trouble && <p className="text-sm text-ink-muted">{copy.trouble}</p>}

      {!closed && meta && (
        <>
          {meta.canReply ? (
            <Composer
              label={copy.replyLabel}
              sendLabel={copy.send}
              sendingLabel={copy.sending}
              sending={false}
              errorText={chat.error ? ERRORS[chat.error] : null}
              tooLongText={copy.tooLong}
              onSend={(text) => chat.send(text)}
              onType={chat.signalTyping}
            />
          ) : (
            meta.assignedTo && <p className="mt-4 text-sm text-ink-secondary">{copy.notAllowed}</p>
          )}
          {(meta.canReply || mine) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {action === 'confirm-close' || action === 'confirm-release' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void act(action === 'confirm-close' ? 'close' : 'release')}
                    className="inline-flex min-h-11 items-center rounded-md bg-danger px-4 text-sm font-semibold text-white"
                  >
                    {action === 'confirm-close' ? copy.confirmClose : copy.releaseConfirm}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('idle')}
                    className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink"
                  >
                    {copy.cancel}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={action === 'working'}
                    onClick={() => setAction('confirm-close')}
                    className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-subtle disabled:opacity-60"
                  >
                    {copy.close}
                  </button>
                  {meta.assignedTo && (
                    <button
                      type="button"
                      disabled={action === 'working'}
                      onClick={() => setAction('confirm-release')}
                      className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-subtle disabled:opacity-60"
                    >
                      {copy.release}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
