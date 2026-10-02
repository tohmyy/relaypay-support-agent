import { COPY } from '@/lib/copy';
import type { ConversationTurn } from '@/lib/transcript';
import ConversationTranscript from './ConversationTranscript';

/** The transcript with its heading. `embeddedInCard` drops the card chrome when a parent card already provides it. */
export default function ConversationPanel({
  turns,
  embeddedInCard = false,
  children,
}: {
  turns: ConversationTurn[];
  embeddedInCard?: boolean;
  children?: React.ReactNode;
}) {
  const inner = (
    <>
      <h2 id="conversation-heading" className="mb-3 text-base font-semibold text-ink">
        {COPY.conversation.title}
      </h2>
      <ConversationTranscript turns={turns} />
      {children && <div className="mt-4 border-t border-line pt-4">{children}</div>}
    </>
  );
  if (embeddedInCard) return <div aria-labelledby="conversation-heading">{inner}</div>;
  return (
    <section aria-labelledby="conversation-heading" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
      {inner}
    </section>
  );
}
