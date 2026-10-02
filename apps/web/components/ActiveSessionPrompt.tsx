'use client';

import { COPY } from '@/lib/copy';

/**
 * The customer already has an active conversation: they can continue that one or end it and start a new one.
 */
export default function ActiveSessionPrompt({
  conversationId,
  replacing,
  failed,
  onContinue,
  onReplace,
}: {
  conversationId: string | null;
  replacing?: boolean;
  failed?: boolean;
  onContinue(): void;
  onReplace(): void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <div role="alert" className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card">
        <p>{COPY.session.activeElsewhere}</p>
        {failed && (
          <p className="mt-2 text-danger" role="status">
            {COPY.session.replaceFailed}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {conversationId && (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-4 py-2 font-medium text-ink hover:bg-surface-subtle"
            >
              {COPY.session.continueExisting}
            </button>
          )}
          <button
            type="button"
            onClick={onReplace}
            disabled={replacing || !conversationId}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {COPY.session.endAndStartNew}
          </button>
        </div>
      </div>
    </div>
  );
}
