import type { TranscriptTurn } from '@/lib/dashboard/data.server';
import { EmptyState } from './ui';

/** A read-only transcript. The labels are passed in so the customer and staff pages can word them differently. */
export default function TranscriptView({
  turns,
  customerLabel,
  supportLabel,
  emptyText,
}: {
  turns: TranscriptTurn[];
  customerLabel: string;
  supportLabel: string;
  emptyText: string;
}) {
  const lines = turns.flatMap((t, i) => [
    ...(t.user_transcript?.trim() ? [{ key: `${i}-u`, who: customerLabel, text: t.user_transcript.trim(), mine: true }] : []),
    ...(t.assistant_response?.trim() ? [{ key: `${i}-a`, who: supportLabel, text: t.assistant_response.trim(), mine: false }] : []),
  ]);
  if (lines.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  return (
    <ol className="space-y-3">
      {lines.map((l) => (
        <li key={l.key} className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${l.mine ? 'ml-auto bg-accent-soft text-ink' : 'border border-line bg-surface text-ink'}`}>
          <p className="mb-1 text-xs font-medium text-ink-muted">{l.who}</p>
          <p className="whitespace-pre-wrap">{l.text}</p>
        </li>
      ))}
    </ol>
  );
}
