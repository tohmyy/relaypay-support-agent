'use client';

import { useEffect, useRef } from 'react';
import { COPY } from '@/lib/copy';
import type { ConversationTurn as Turn } from '@/lib/transcript';
import ConversationTurn from './ConversationTurn';

/**
 * Scrollable, keyboard-focusable transcript. It follows new turns, but stops following when the
 * customer scrolls up to read, so the view never jumps under them.
 */
export default function ConversationTranscript({ turns }: { turns: Turn[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const latestSupport = [...turns].reverse().find((t) => t.speaker === 'assistant')?.id;

  return (
    <div
      ref={ref}
      role="log"
      aria-label={COPY.conversation.transcriptLabel}
      aria-live="off"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="max-h-[50vh] min-h-40 overflow-y-auto rounded-md"
    >
      {turns.length === 0 ? (
        <p className="px-3 py-2 text-sm text-ink-muted">{COPY.conversation.empty}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {turns.map((t) => (
            <ConversationTurn key={t.id} turn={t} isLatestSupport={t.id === latestSupport} />
          ))}
        </ol>
      )}
    </div>
  );
}
