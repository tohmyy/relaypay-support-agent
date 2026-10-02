'use client';

import { useState } from 'react';
import { useChatThread, type SendError, type ThreadMeta } from '@/hooks/useChatThread';
import type { MessageAuthor } from '@/lib/human/messages';
import { STAFF_COPY } from '@/lib/shell-copy';
import Composer from './Composer';
import { Card } from './ui';

interface StaffThreadMeta extends ThreadMeta {
  assignedTo: MessageAuthor | null;
  assignedToMe: boolean;
  canReply: boolean;
  customerTyping: boolean;
}

const ERRORS: Record<SendError, string> = {
  'too-long': STAFF_COPY.chat.tooLong,
  'rate-limited': STAFF_COPY.chat.rateLimited,
  closed: STAFF_COPY.chat.closed,
  taken: STAFF_COPY.chat.taken,
  failed: STAFF_COPY.chat.sendFailed,
};

/**
 * The staff side of the text chat: who has the conversation, the messages as they arrive, a reply box, and the two
 * actions (take it, close it). Every action is re-checked on the server, so what shows here is only a convenience.
 */
export default function StaffChat({ conversationId }: { conversationId: string }) {
  const base = `/api/staff/conversations/${encodeURIComponent(conversationId)}`;
  const chat = useChatThread<StaffThreadMeta>({ messagesUrl: `${base}/messages`, typingUrl: `${base}/typing` });
  const copy = STAFF_COPY.chat;
  const meta = chat.meta;
  const closed = Boolean(meta?.ended) || meta?.supportMode === 'ended';
  const [action, setAction] = useState<'idle' | 'working' | 'confirm-close'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(path: 'claim' | 'close') {
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
      : copy.waiting;

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

      <ol role="log" aria-label={copy.title} aria-live="off" tabIndex={0} className="mt-4 max-h-96 min-h-24 space-y-3 overflow-y-auto">
        {chat.messages.map((m) => (
          <li key={m.id} className={m.sender === 'system' ? 'text-sm text-ink-muted' : 'text-sm text-ink'}>
            <p className="text-xs font-medium text-ink-secondary">
              {m.sender === 'customer' ? copy.customer : m.sender === 'staff' ? (m.author?.name ?? copy.system) : copy.system}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-secondary">
        {meta?.customerTyping ? copy.customerTyping : ''}
      </p>
      {chat.trouble && <p className="text-sm text-ink-muted">{copy.trouble}</p>}

      {!closed && meta && (
        <>
          {meta.canReply ? (
            <Composer
              label={copy.replyLabel}
              sendLabel={copy.send}
              sendingLabel={copy.sending}
              sending={chat.sending}
              errorText={chat.error ? ERRORS[chat.error] : null}
              tooLongText={copy.tooLong}
              onSend={(text) => chat.send(text)}
              onType={chat.signalTyping}
            />
          ) : (
            meta.assignedTo && <p className="mt-4 text-sm text-ink-secondary">{copy.notAllowed}</p>
          )}
          {(meta.canReply || meta.assignedToMe) &&
            (action === 'confirm-close' ? (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void act('close')}
                  className="inline-flex min-h-11 items-center rounded-md bg-danger px-4 text-sm font-semibold text-white"
                >
                  {copy.confirmClose}
                </button>
                <button
                  type="button"
                  onClick={() => setAction('idle')}
                  className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink"
                >
                  {copy.cancel}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={action === 'working'}
                onClick={() => setAction('confirm-close')}
                className="mt-4 inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-subtle disabled:opacity-60"
              >
                {copy.close}
              </button>
            ))}
        </>
      )}
    </Card>
  );
}
