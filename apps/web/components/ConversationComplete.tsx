import type { PublicEndReason } from '@/lib/conversation-state';
import { COPY } from '@/lib/copy';

interface Props {
  ticketReference: string | null;
  escalated: boolean;
  /** Why the session ended, when it was not the customer's own choice. */
  endReason?: PublicEndReason | null;
  onStartAnother(): void;
}

/**
 * End-of-session screen. If a ticket or escalation was created the session counts as complete and the
 * screen acknowledges it; a session that ended on its own (no activity, time limit) says so and points the
 * customer to a new conversation; otherwise it simply says the conversation ended.
 */
export default function ConversationComplete({ ticketReference, escalated, endReason, onStartAnother }: Props) {
  const hasRequest = Boolean(ticketReference) || escalated;
  const reasonBody =
    endReason === 'silence-timeout'
      ? COPY.session.endedBodySilence
      : endReason === 'session-timeout'
        ? COPY.session.endedBodyTimeout
        : null;
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
      <button
        type="button"
        onClick={onStartAnother}
        className="mt-5 inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-hover"
      >
        {COPY.buttons.startAnother}
      </button>
    </section>
  );
}
