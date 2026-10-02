import { Headset } from 'lucide-react';
import { COPY } from '@/lib/copy';
import type { SupportState } from '@/lib/support/derive';
import EscalationConfirmation from './EscalationConfirmation';

interface Props {
  support: SupportState;
  requestedTime: string | null;
}

/**
 * Needing a specialist is a normal next step, not a failure, so this uses neutral styling. It never asks for anything:
 * the contact details come from the signed-in account and a callback time is agreed in the conversation (by voice or by
 * typing), so there is no form. It explains that while a specialist is needed, then confirms.
 */
export default function EscalationPanel({ support, requestedTime }: Props) {
  if (support === 'escalated') {
    return (
      <section aria-live="polite" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
        <EscalationConfirmation requestedTime={requestedTime} />
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
          <p className="mt-1 text-sm text-ink-secondary">{COPY.escalation.timeHint}</p>
        </div>
      </div>
    </section>
  );
}
