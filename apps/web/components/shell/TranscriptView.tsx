import type { TranscriptTurn } from '@/lib/dashboard/data.server';
import { EmptyState } from './ui';

interface Line {
  key: string;
  who: string;
  text: string;
  kind: 'customer' | 'assistant' | 'staff' | 'system';
}

/**
 * A read-only transcript. The labels are passed in so the customer and staff pages can word them differently.
 * Voice-era turns are a customer/assistant pair; after a handoff each row is one message with a sender. Staff
 * messages carry the writer's name when `staffNames` has it.
 */
export default function TranscriptView({
  turns,
  customerLabel,
  supportLabel,
  emptyText,
  staffLabel = 'Support specialist',
  staffNames = {},
}: {
  turns: TranscriptTurn[];
  customerLabel: string;
  supportLabel: string;
  emptyText: string;
  staffLabel?: string;
  staffNames?: Record<string, string>;
}) {
  const lines: Line[] = turns.flatMap((t, i): Line[] => {
    if (t.sender) {
      const text = t.body?.trim();
      if (!text) return [];
      if (t.sender === 'system') return [{ key: `${i}-s`, who: '', text, kind: 'system' }];
      if (t.sender === 'staff') {
        const name = (t.staff_user_id && staffNames[t.staff_user_id]) || staffLabel;
        return [{ key: `${i}-h`, who: name, text, kind: 'staff' }];
      }
      if (t.sender === 'customer') return [{ key: `${i}-c`, who: customerLabel, text, kind: 'customer' }];
      return [{ key: `${i}-a`, who: supportLabel, text, kind: 'assistant' }];
    }
    return [
      ...(t.user_transcript?.trim() ? [{ key: `${i}-u`, who: customerLabel, text: t.user_transcript.trim(), kind: 'customer' as const }] : []),
      ...(t.assistant_response?.trim() ? [{ key: `${i}-a`, who: supportLabel, text: t.assistant_response.trim(), kind: 'assistant' as const }] : []),
    ];
  });
  if (lines.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  return (
    <ol className="space-y-3">
      {lines.map((l) =>
        l.kind === 'system' ? (
          <li key={l.key} className="text-center text-xs text-ink-muted">
            {l.text}
          </li>
        ) : (
          <li
            key={l.key}
            className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
              l.kind === 'customer' ? 'ml-auto bg-accent-soft text-ink' : 'border border-line bg-surface text-ink'
            }`}
          >
            <p className="mb-1 text-xs font-medium text-ink-muted">{l.who}</p>
            <p className="whitespace-pre-wrap">{l.text}</p>
          </li>
        ),
      )}
    </ol>
  );
}
