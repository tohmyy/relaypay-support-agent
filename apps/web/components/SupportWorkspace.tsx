import type { ContactValues } from '@/lib/contact';
import type { PublicEndReason } from '@/lib/conversation-state';
import { COPY } from '@/lib/copy';
import type { SessionView } from '@/lib/session/derive';
import type { SupportState } from '@/lib/support/derive';
import type { ConversationTurn } from '@/lib/transcript';
import type { VoiceModel } from '@/lib/voice/state';
import CapabilityHints from './CapabilityHints';
import ConversationComplete from './ConversationComplete';
import ConversationPanel from './ConversationPanel';
import ErrorState from './ErrorState';
import EscalationPanel from './EscalationPanel';
import { SessionWarning, SilenceCountdown } from './SessionNotices';
import TicketConfirmation from './TicketConfirmation';
import VoicePanel from './VoicePanel';

export interface WorkspaceProps {
  voice: VoiceModel;
  support: SupportState;
  turns: ConversationTurn[];
  ticketReference: string | null;
  requestedTime: string | null;
  escalated: boolean;
  level: number;
  /** Silence countdown and time-limit notices; absent means none are showing. */
  session?: SessionView;
  /** Why the session ended, when it ended on its own. */
  endReason?: PublicEndReason | null;
  /** Voice support is not configured, so a call cannot be started. */
  unavailable?: boolean;
  onStart(): void;
  onEnd(): void;
  onSubmitContact(values: ContactValues): void;
}

/** Purely presentational: every decision about what to show comes from the state it is given. */
export default function SupportWorkspace(p: WorkspaceProps) {
  const { state } = p.voice;

  if (state === 'idle') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-8 px-4 py-10 text-center sm:py-16">
        <div>
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{COPY.landingHeading}</h1>
          <p className="mt-3 text-lg text-ink-secondary">{COPY.landingBody}</p>
        </div>
        <VoicePanel
          state={state}
          level={0}
          hasConversation={false}
          onStart={p.onStart}
          onEnd={p.onEnd}
          unavailable={p.unavailable}
        />
        {p.unavailable && (
          <p role="status" className="text-sm text-ink-secondary">
            {COPY.notConfigured}
          </p>
        )}
        <CapabilityHints />
        <p className="max-w-md text-xs text-ink-muted">{COPY.privacyNotice}</p>
      </div>
    );
  }

  if (state === 'error' && p.voice.error) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
        <ErrorState kind={p.voice.error} onRetry={p.onStart} />
      </div>
    );
  }

  if (state === 'ended') {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2">
        <ConversationComplete
          ticketReference={p.ticketReference}
          escalated={p.escalated}
          endReason={p.endReason}
          onStartAnother={p.onStart}
        />
        {p.turns.length > 0 && <ConversationPanel turns={p.turns} />}
      </div>
    );
  }

  const callOpen = state !== 'ending';
  return (
    <div className="mx-auto grid w-full max-w-5xl items-start gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        {p.session?.silenceCountdown != null ? (
          <SilenceCountdown seconds={p.session.silenceCountdown} />
        ) : (
          p.session?.sessionWarning &&
          p.session.secondsLeft != null && <SessionWarning secondsLeft={p.session.secondsLeft} />
        )}
        <section className="rounded-lg border border-line bg-surface p-6 shadow-card" aria-label="Voice">
          <VoicePanel
            state={state}
            level={p.level}
            hasConversation={p.turns.length > 0}
            onStart={p.onStart}
            onEnd={p.onEnd}
          />
        </section>
        <EscalationPanel
          support={p.support}
          requestedTime={p.requestedTime}
          canSubmit={callOpen}
          onSubmit={p.onSubmitContact}
        />
        {p.support === 'ticket-created' && <TicketConfirmation reference={p.ticketReference} />}
      </div>
      <ConversationPanel turns={p.turns} />
    </div>
  );
}
