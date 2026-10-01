import { COPY } from '@/lib/copy';
import type { ConversationTurn as Turn } from '@/lib/transcript';

/** One line of the transcript: speaker label above the text, no chat bubbles. */
export default function ConversationTurn({ turn, isLatestSupport }: { turn: Turn; isLatestSupport: boolean }) {
  const mine = turn.speaker === 'user';
  return (
    <li
      data-speaker={turn.speaker}
      className={`rounded-md px-3 py-2 ${isLatestSupport ? 'bg-accent-soft' : ''} ${turn.final ? '' : 'opacity-80'}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {mine ? COPY.conversation.you : COPY.conversation.support}
      </p>
      <p className="mt-0.5 text-base text-ink">{turn.text}</p>
    </li>
  );
}
