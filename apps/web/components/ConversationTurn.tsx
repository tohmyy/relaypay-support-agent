import { COPY } from '@/lib/copy';
import type { ConversationTurn as Turn } from '@/lib/transcript';

/**
 * One turn of the live transcript as a single chat bubble: the customer's on the right, RelayPay Support's on the left,
 * each with a small speaker label. Same direction as the saved transcript (`TranscriptView`), so what the customer sees
 * live is what they find in their history.
 */
export default function ConversationTurn({ turn, isLatestSupport }: { turn: Turn; isLatestSupport: boolean }) {
  const mine = turn.speaker === 'user';
  return (
    <li
      data-speaker={turn.speaker}
      data-bubble=""
      className={`max-w-[85%] rounded-lg px-4 py-3 text-base text-ink ${
        mine ? 'ml-auto bg-accent-soft' : `mr-auto border bg-surface ${isLatestSupport ? 'border-accent' : 'border-line'}`
      } ${turn.final ? '' : 'opacity-80'}`}
    >
      <p className="mb-1 text-xs font-medium text-ink-secondary">{mine ? COPY.conversation.you : COPY.conversation.support}</p>
      <p className="whitespace-pre-wrap">{turn.text}</p>
    </li>
  );
}
