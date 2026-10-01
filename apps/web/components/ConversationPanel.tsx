import { COPY } from '@/lib/copy';
import type { ConversationTurn } from '@/lib/transcript';
import ConversationTranscript from './ConversationTranscript';

export default function ConversationPanel({ turns }: { turns: ConversationTurn[] }) {
  return (
    <section aria-labelledby="conversation-heading" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      <h2 id="conversation-heading" className="mb-3 text-base font-semibold text-ink">
        {COPY.conversation.title}
      </h2>
      <ConversationTranscript turns={turns} />
    </section>
  );
}
