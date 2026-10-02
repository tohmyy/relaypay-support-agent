'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ConversationSummaryText } from '@/lib/dashboard/summary';
import { STAFF_COPY } from '@/lib/shell-copy';
import { Card } from './ui';

export interface AcceptConversationProps {
  conversationId: string;
  customer: string;
  topic: string;
  ticket: string | null;
  /** How long the escalation has existed ("5 minutes"), worked out on the server so it matches what was rendered. */
  age: string | null;
  summary: ConversationSummaryText | null;
  /** The chat is with a specialist and nobody has it yet: show Accept. */
  canAccept: boolean;
  /** The call already ended and the escalation is still open (a callback): show Close escalation. */
  canClose: boolean;
}

const button =
  'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold disabled:opacity-60';

/**
 * What a member of staff needs before taking a conversation, in one card: who, about what, which ticket, how long it has
 * waited and a summary (labelled by where it came from). Accept claims the conversation; the database decides who got it,
 * so a stale click shows the refusal instead of taking over. For a callback with no chat, the card closes the escalation.
 */
export default function AcceptConversation(props: AcceptConversationProps) {
  const copy = STAFF_COPY.accept;
  const router = useRouter();
  const base = `/api/staff/conversations/${encodeURIComponent(props.conversationId)}`;
  const [working, setWorking] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(path: 'claim' | 'close', failed: string) {
    setWorking(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/${path}`, { method: 'POST' });
      if (!res.ok) {
        const reason = res.status === 409 ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
        setMessage(reason === 'taken' ? copy.taken : reason === 'not-open' ? copy.notOpen : failed);
      }
    } catch {
      setMessage(failed);
    } finally {
      setWorking(false);
      setConfirmClose(false);
      // Whatever happened, show what is true now.
      router.refresh();
    }
  }

  const facts: [string, string][] = [
    [copy.customer, props.customer],
    [copy.topic, props.topic],
    ...(props.ticket ? ([[copy.ticket, props.ticket]] as [string, string][]) : []),
    ...(props.age ? ([[copy.age, props.age]] as [string, string][]) : []),
  ];

  return (
    <Card title={props.canAccept ? copy.title : STAFF_COPY.detail.escalation}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium text-ink-secondary">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 text-sm">
        <p className="font-medium text-ink-secondary">{copy.summary}</p>
        {props.summary ? (
          <>
            <p className="mt-1 text-xs text-ink-muted">{copy.summarySource[props.summary.source]}</p>
            <p className="mt-1 whitespace-pre-wrap text-ink">{props.summary.text}</p>
          </>
        ) : (
          <p className="mt-1 text-ink-secondary">{copy.summaryNone}</p>
        )}
      </div>
      {message && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {message}
        </p>
      )}
      {props.canAccept && (
        <button
          type="button"
          disabled={working}
          onClick={() => void act('claim', copy.failed)}
          className={`${button} mt-4 bg-primary text-white hover:bg-primary-hover`}
        >
          {working ? copy.accepting : copy.accept}
        </button>
      )}
      {props.canClose && (
        <div className="mt-4 flex flex-wrap gap-2">
          {confirmClose ? (
            <>
              <button type="button" disabled={working} onClick={() => void act('close', copy.closeFailed)} className={`${button} bg-danger text-white`}>
                {copy.closeConfirm}
              </button>
              <button type="button" onClick={() => setConfirmClose(false)} className={`${button} border border-line bg-surface font-medium text-ink`}>
                {copy.closeKeep}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={working}
              onClick={() => setConfirmClose(true)}
              className={`${button} border border-line bg-surface font-medium text-ink hover:bg-surface-subtle`}
            >
              {copy.closeEscalation}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
