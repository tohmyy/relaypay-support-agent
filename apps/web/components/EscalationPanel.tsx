import { Headset, Loader2 } from 'lucide-react';
import type { ContactValues } from '@/lib/contact';
import { COPY } from '@/lib/copy';
import type { SupportState } from '@/lib/support/derive';
import ContactForm from './ContactForm';
import EscalationConfirmation from './EscalationConfirmation';

interface Props {
  support: SupportState;
  requestedTime: string | null;
  /** The form only makes sense while the call is open, because the details are typed into it. */
  canSubmit: boolean;
  onSubmit(values: ContactValues): void;
}

/**
 * Needing a specialist is a normal next step, not a failure, so this uses neutral styling.
 * Shows the form while required, a quiet progress line while sending, then the confirmation.
 */
export default function EscalationPanel({ support, requestedTime, canSubmit, onSubmit }: Props) {
  if (support === 'escalated') {
    return (
      <section aria-live="polite" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
        <EscalationConfirmation requestedTime={requestedTime} />
      </section>
    );
  }
  if (support === 'escalating') {
    return (
      <section className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
        <p role="status" className="flex items-center gap-2 text-base text-ink">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin-slow text-accent" />
          {COPY.escalation.sending}
        </p>
      </section>
    );
  }
  if (support !== 'escalation-required') return null;
  return (
    <section aria-labelledby="escalation-heading" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <Headset aria-hidden className="mt-1 h-5 w-5 shrink-0 text-accent" />
        <div>
          <h2 id="escalation-heading" className="text-base font-semibold text-ink">
            {COPY.escalation.heading}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">{COPY.escalation.body}</p>
        </div>
      </div>
      {canSubmit && <ContactForm onSubmit={onSubmit} />}
    </section>
  );
}
