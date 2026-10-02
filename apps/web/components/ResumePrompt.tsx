'use client';

import { COPY, withSeconds } from '@/lib/copy';

/**
 * Offered for 30 seconds after a call ends: pick the same conversation back up, transcript kept. The countdown text is
 * not read out second by second (it would talk over everything else); the button is what a screen-reader user finds.
 */
export default function ResumePrompt({
  secondsLeft,
  onResume,
  onDecline,
}: {
  secondsLeft: number;
  onResume(): void;
  onDecline(): void;
}) {
  return (
    <div className="mt-5 rounded-md bg-surface-subtle p-4 text-left" data-testid="resume-prompt">
      <p aria-live="off" className="text-sm text-ink">
        {withSeconds(COPY.resume.prompt, COPY.resume.promptOne, secondsLeft)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResume}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {COPY.resume.action}
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink hover:bg-surface-subtle"
        >
          {COPY.resume.decline}
        </button>
      </div>
    </div>
  );
}
