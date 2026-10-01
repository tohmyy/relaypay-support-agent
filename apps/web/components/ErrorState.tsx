import { AlertCircle } from 'lucide-react';
import { COPY } from '@/lib/copy';
import type { ErrorKind } from '@/lib/voice/state';

/** Calm, non-technical error with one clear action. Technical detail never reaches this component. */
export default function ErrorState({ kind, onRetry }: { kind: ErrorKind; onRetry(): void }) {
  const e: { message: string; detail?: string; action: string } = COPY.errors[kind];
  return (
    <div role="alert" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden className="mt-1 h-5 w-5 shrink-0 text-danger" />
        <div>
          <h2 className="text-base font-semibold text-ink">{e.message}</h2>
          {e.detail && <p className="mt-1 text-sm text-ink-secondary">{e.detail}</p>}
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-2.5 text-base font-semibold text-white hover:bg-primary-hover"
          >
            {e.action}
          </button>
        </div>
      </div>
    </div>
  );
}
