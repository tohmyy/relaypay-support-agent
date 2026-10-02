'use client';

import { Star } from 'lucide-react';
import { useId, useState } from 'react';
import type { FeedbackStage } from '@/lib/feedback';
import { MAX_FEEDBACK_COMMENT } from '@/lib/feedback';
import { SHELL_COPY } from '@/lib/shell-copy';

/**
 * An optional 1 to 5 star rating with a comment, once per stage (the voice or typed conversation, and later the
 * specialist chat). Always skippable, and it sits beside "Start another conversation" and "View transcript", never in
 * place of them. It only ever asks the server to record the rating: it cannot change the status of anything.
 */
export default function SessionFeedback({ conversationId, stage }: { conversationId: string; stage: FeedbackStage }) {
  const copy = SHELL_COPY.feedback;
  const id = useId();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'skipped'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (state === 'skipped') return null;
  if (state === 'done') {
    return (
      <p role="status" className="mt-5 text-sm text-ink-secondary">
        {copy.thanks}
      </p>
    );
  }

  async function submit() {
    if (rating < 1) {
      setError(copy.needRating);
      return;
    }
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`/api/support/conversations/${encodeURIComponent(conversationId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, rating, comment: comment.trim() || undefined }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('done');
    } catch {
      setState('idle');
      setError(copy.failed);
    }
  }

  return (
    <form
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="mt-6 border-t border-line pt-5 text-left"
    >
      <h3 id={`${id}-title`} className="text-base font-semibold text-ink">
        {stage === 'human' ? copy.humanTitle : copy.aiTitle}
      </h3>
      <p className="mt-1 text-sm text-ink-secondary">{copy.optional}</p>
      <div role="radiogroup" aria-label={copy.group} className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={copy.star.replace('{n}', String(n))}
            onClick={() => {
              setRating(n);
              setError(null);
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface-subtle"
          >
            <Star aria-hidden className={`h-6 w-6 ${n <= rating ? 'fill-warning text-warning' : 'text-ink-muted'}`} />
          </button>
        ))}
      </div>
      <label htmlFor={`${id}-comment`} className="mt-3 block text-sm font-medium text-ink">
        {copy.commentLabel}
      </label>
      <textarea
        id={`${id}-comment`}
        value={comment}
        rows={2}
        maxLength={MAX_FEEDBACK_COMMENT}
        onChange={(e) => setComment(e.target.value)}
        className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {state === 'sending' ? copy.submitting : copy.submit}
        </button>
        <button
          type="button"
          onClick={() => setState('skipped')}
          className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink hover:bg-surface-subtle"
        >
          {copy.skip}
        </button>
      </div>
    </form>
  );
}
