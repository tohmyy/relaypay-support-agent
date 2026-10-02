import { Clock, MicOff } from 'lucide-react';
import { COPY, withSeconds } from '@/lib/copy';

/**
 * The visible number changes every second, so it is hidden from assistive technology; the live region says
 * once that the conversation is about to end and how to stop it.
 */
export function SilenceCountdown({ seconds }: { seconds: number }) {
  return (
    <section role="status" className="rounded-lg border border-warning bg-surface p-4 shadow-card sm:p-6">
      <span className="sr-only">{COPY.session.silenceScreenReader}</span>
      <div aria-hidden className="flex items-start gap-3">
        <MicOff className="mt-1 h-5 w-5 shrink-0 text-warning" />
        <div>
          <h2 className="text-base font-semibold text-ink">{COPY.session.silenceHeading}</h2>
          <p className="mt-1 text-base text-ink">
            {withSeconds(COPY.session.silenceCountdown, COPY.session.silenceCountdownOne, seconds)}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">{COPY.session.silenceHint}</p>
        </div>
      </div>
    </section>
  );
}

/** Final-minute notice for the session time limit. */
export function SessionWarning({ secondsLeft }: { secondsLeft: number }) {
  return (
    <section role="status" className="rounded-lg border border-warning bg-surface p-4 shadow-card sm:p-6">
      <span className="sr-only">{COPY.session.warningScreenReader}</span>
      <div aria-hidden className="flex items-start gap-3">
        <Clock className="mt-1 h-5 w-5 shrink-0 text-warning" />
        <div>
          <h2 className="text-base font-semibold text-ink">{COPY.session.warningHeading}</h2>
          <p className="mt-1 text-base text-ink">
            {withSeconds(COPY.session.warningBody, COPY.session.warningBodyOne, secondsLeft)}
          </p>
        </div>
      </div>
    </section>
  );
}
