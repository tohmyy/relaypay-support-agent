'use client';

import { useEffect, useState } from 'react';
import type { DurableTranscriptTurn } from '@/lib/transcript';

/**
 * The AI conversation that led to this specialist chat. Both the customer and staff can open it; it only shows
 * assistant and customer voice-era turns, never the live specialist messages.
 */
export default function EarlierTranscript({
  url,
  title,
  empty,
}: {
  url: string;
  title: string;
  empty: string;
}) {
  const [turns, setTurns] = useState<DurableTranscriptTurn[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(url, { cache: 'no-store' })
      .then(async (res) => (res.ok ? ((await res.json()) as { turns?: DurableTranscriptTurn[] }) : null))
      .then((data) => {
        if (!cancelled) setTurns(Array.isArray(data?.turns) ? data.turns : []);
      })
      .catch(() => {
        if (!cancelled) setTurns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const lines = (turns ?? []).filter((t) => t.displayText?.trim());

  return (
    <details className="mt-4 rounded-md border border-line bg-surface-subtle p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">{title}</summary>
      {turns === null ? null : lines.length === 0 ? (
        <p className="mt-2 text-sm text-ink-secondary">{empty}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {lines.map((t) => (
            <li key={t.id} className="text-sm text-ink">
              <p className="text-xs font-medium text-ink-secondary">{t.role === 'assistant' ? 'Assistant' : 'You'}</p>
              <p className="whitespace-pre-wrap">{t.displayText}</p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
