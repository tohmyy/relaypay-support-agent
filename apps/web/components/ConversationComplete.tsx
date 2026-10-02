import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicEndReason } from '@/lib/conversation-state';
import { COPY, END_REASON_BODY } from '@/lib/copy';

/** Whether the call is tied to the customer's account (so it exists in their history). */
export type CompleteLinkStatus = 'linking' | 'linked' | 'failed' | null;

interface Props {
  ticketReference: string | null;
  escalated: boolean;
  /** Why the session ended, when it was not the customer's own choice. Null while it is still being read. */
  endReason?: PublicEndReason | null;
  /** The ended call's id and whether this page is the signed-in one, for the link to the saved transcript. */
  conversationId?: string | null;
  embedded?: boolean;
  linkStatus?: CompleteLinkStatus;
  onStartAnother(): void;
  /** Extra actions or prompts under the buttons (resume, rating). */
  children?: ReactNode;
}

/**
 * End-of-session screen. Says clearly that the conversation has ended and why (a calm default while the reason is still
 * being read), acknowledges a ticket or escalation if one was created, and offers the next step: view the saved
 * transcript (only when the call is really saved to the customer's account, never a link that would 404) or start another
 * conversation.
 */
export default function ConversationComplete({
  ticketReference,
  escalated,
  endReason,
  conversationId,
  embedded = false,
  linkStatus = null,
  onStartAnother,
  children,
}: Props) {
  const hasRequest = Boolean(ticketReference) || escalated;
  const reasonBody = endReason ? END_REASON_BODY[endReason] : null;
  const canViewTranscript = embedded && linkStatus === 'linked' && Boolean(conversationId);
  return (
    <section aria-labelledby="complete-heading" className="rounded-lg border border-line bg-surface p-6 text-center shadow-card">
      <h2 id="complete-heading" className="text-xl font-semibold text-ink">
        {reasonBody ? COPY.session.endedHeading : hasRequest ? COPY.complete.headingWithRequest : COPY.complete.headingDefault}
      </h2>
      <p className="mt-2 text-base text-ink-secondary">
        {reasonBody ?? (hasRequest ? COPY.complete.bodyWithRequest : COPY.complete.bodyDefault)}
      </p>
      {reasonBody && <p className="mt-2 text-base text-ink-secondary">{COPY.session.endedNewConversation}</p>}
      {ticketReference && (
        <p className="mt-3 text-sm text-ink">
          {COPY.complete.ticketCreated} {COPY.ticket.reference}: {ticketReference}
        </p>
      )}
      {escalated && <p className="mt-3 text-sm text-ink">{COPY.complete.escalationSent}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onStartAnother}
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-hover"
        >
          {COPY.buttons.startAnother}
        </button>
        {canViewTranscript && (
          <Link
            href={`/support/${encodeURIComponent(conversationId!)}`}
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-line bg-surface px-6 py-3 text-base font-medium text-ink hover:bg-surface-subtle"
          >
            {COPY.buttons.viewTranscript}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
