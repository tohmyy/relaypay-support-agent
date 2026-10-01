import { COPY } from '@/lib/copy';

/** Plain-language topics and a few example questions. Hidden once the conversation has begun. */
export default function CapabilityHints() {
  return (
    <div className="w-full text-center">
      <h2 className="text-sm font-semibold text-ink-secondary">{COPY.topicsHeading}</h2>
      <ul className="mt-2 flex flex-wrap justify-center gap-2">
        {COPY.topics.map((t) => (
          <li key={t} className="rounded-md border border-line bg-surface px-3 py-1 text-sm text-ink-secondary">
            {t}
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-1 text-sm text-ink-muted">
        {COPY.suggestedPrompts.map((p) => (
          <li key={p}>“{p}”</li>
        ))}
      </ul>
    </div>
  );
}
