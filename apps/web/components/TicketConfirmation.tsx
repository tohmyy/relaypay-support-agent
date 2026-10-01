import { Check } from 'lucide-react';
import { COPY } from '@/lib/copy';

/** Concise confirmation. The reference is shown because the customer can quote it later. */
export default function TicketConfirmation({ reference }: { reference: string | null }) {
  return (
    <section aria-live="polite" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <Check aria-hidden className="mt-1 h-5 w-5 shrink-0 text-success" />
        <div>
          <h2 className="text-base font-semibold text-ink">{COPY.ticket.heading}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{COPY.ticket.body}</p>
          {reference && (
            <p className="mt-2 text-sm font-medium text-ink">
              {COPY.ticket.reference}: {reference}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
