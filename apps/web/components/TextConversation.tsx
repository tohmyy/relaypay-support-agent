'use client';

import { useTextSession, type TextSessionError } from '@/hooks/useTextSession';
import { COPY } from '@/lib/copy';
import ConversationComplete from './ConversationComplete';
import ConversationPanel from './ConversationPanel';
import SessionFeedback from './SessionFeedback';
import TypedComposer from './TypedComposer';

const ERRORS: Record<TextSessionError, string> = {
  failed: COPY.typed.failed,
  'rate-limited': COPY.typed.rateLimited,
  'active-session': COPY.session.activeElsewhere,
};

/**
 * A support conversation carried on entirely by typing, used when voice cannot start (no microphone, permission refused)
 * or the customer prefers it. The same assistant, the same account, the same saved history; only the way of talking differs.
 */
export default function TextConversation({ onUseVoice }: { onUseVoice(): void }) {
  const text = useTextSession();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <section aria-labelledby="typed-heading" className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
        <h1 id="typed-heading" className="text-xl font-semibold text-ink">
          {COPY.typed.heading}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">{COPY.typed.intro}</p>
        {!text.ended && (
          <button
            type="button"
            onClick={onUseVoice}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            {COPY.typed.useVoice}
          </button>
        )}
      </section>

      {text.ended && (
        <ConversationComplete
          ticketReference={null}
          escalated={false}
          endReason="user-ended"
          conversationId={text.conversationId}
          embedded
          linkStatus="linked"
          onStartAnother={text.restart}
        >
          {text.conversationId && <SessionFeedback key={text.conversationId} conversationId={text.conversationId} stage="ai" />}
        </ConversationComplete>
      )}

      <section aria-label={COPY.conversation.title} className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6">
        <ConversationPanel turns={text.turns} embeddedInCard />
        {text.sending && (
          <p role="status" className="mt-2 text-sm text-ink-secondary">
            {COPY.typed.thinking}
          </p>
        )}
        {!text.ended && (
          <TypedComposer onSend={text.send} sending={text.sending} error={text.error ? ERRORS[text.error] : null} />
        )}
      </section>
    </div>
  );
}
