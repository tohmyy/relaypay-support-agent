'use client';

import { useEffect, useRef } from 'react';
import { COPY } from '@/lib/copy';
import type { ConversationTurn as Turn } from '@/lib/transcript';
import ConversationTurn from './ConversationTurn';

/** How close to the bottom (in pixels) still counts as "following" the conversation. */
export const FOLLOW_THRESHOLD_PX = 24;

/**
 * Scrollable, keyboard-focusable transcript of chat bubbles. It sticks to the bottom as turns arrive and grow, but stops
 * following as soon as the customer scrolls up to read (more than 24px from the bottom), and follows again when they
 * scroll back down, so the view never jumps under them. The transcript scrolls inside its own region; the page itself
 * does not have to.
 */
export default function ConversationTranscript({ turns }: { turns: Turn[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  // Runs for new turns and for a turn's text growing (partials replace the open turn in place).
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
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
      }}
      className="max-h-[60vh] min-h-40 overflow-y-auto rounded-md"
    >
      {turns.length === 0 ? (
        <p className="px-3 py-2 text-sm text-ink-muted">{COPY.conversation.empty}</p>
      ) : (
        <ol className="flex flex-col gap-3 p-1">
          {turns.map((t) => (
            <ConversationTurn key={t.id} turn={t} isLatestSupport={t.id === latestSupport} />
          ))}
        </ol>
      )}
    </div>
  );
}
