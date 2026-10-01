import { COPY } from '@/lib/copy';

interface Props {
  ticketReference: string | null;
  escalated: boolean;
  onStartAnother(): void;
}

/**
 * End-of-session screen. If a ticket or escalation was created the session counts as complete and the
 * screen acknowledges it; otherwise it simply says the conversation ended.
 */
export default function ConversationComplete({ ticketReference, escalated, onStartAnother }: Props) {
  const hasRequest = Boolean(ticketReference) || escalated;
  return (
    <section aria-labelledby="complete-heading" className="rounded-lg border border-line bg-surface p-6 text-center shadow-card">
      <h2 id="complete-heading" className="text-xl font-semibold text-ink">
        {hasRequest ? COPY.complete.headingWithRequest : COPY.complete.headingDefault}
      </h2>
      <p className="mt-2 text-base text-ink-secondary">
        {hasRequest ? COPY.complete.bodyWithRequest : COPY.complete.bodyDefault}
      </p>
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
