import type { PublicEndReason } from '@/lib/conversation-state';
import { COPY } from '@/lib/copy';
import type { SessionView } from '@/lib/session/derive';
import type { SupportState } from '@/lib/support/derive';
import type { ConversationTurn } from '@/lib/transcript';
import type { VoiceModel } from '@/lib/voice/state';
import AudioNotices from './AudioNotices';
import CapabilityHints from './CapabilityHints';
import ConversationComplete, { type CompleteLinkStatus } from './ConversationComplete';
import ConversationPanel from './ConversationPanel';
import ErrorState from './ErrorState';
import EscalationPanel from './EscalationPanel';
import { SessionWarning, SilenceCountdown } from './SessionNotices';
import TicketConfirmation from './TicketConfirmation';
import TypedComposer from './TypedComposer';
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
  /** The call's id and whether this page links it to the customer's account, for the saved-transcript link. */
  conversationId?: string | null;
  embedded?: boolean;
  linkStatus?: CompleteLinkStatus;
  onStart(): void;
  onEnd(): void;
  /** Types a message into the live call. When absent the text box is not shown. */
  onSendText?(text: string): Promise<boolean>;
  /** Carry on by typing when voice cannot be used (shown on the microphone errors). */
  onTypeInstead?(): void;
  /** Extra content on the ended screen (resume, rating). */
  endedExtra?: React.ReactNode;
  /** The microphone is muted / the room is loud, when the browser could tell. */
  muted?: boolean;
  noisy?: boolean;
}

const LIVE_STATES = ['listening', 'user-speaking', 'processing', 'assistant-speaking'];

/**
 * Purely presentational: every decision about what to show comes from the state it is given. One column at every width:
 * the voice and status panels on top, the conversation underneath, so each gets the full width and more height.
 */
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
        {!p.unavailable && (
          <p className="max-w-md text-sm text-ink-secondary" data-testid="mic-instruction">
            <span className="font-medium text-ink">{COPY.microphone.heading}.</span> {COPY.microphone.instruction}
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
        <ErrorState kind={p.voice.error} onRetry={p.onStart} onTypeInstead={p.onTypeInstead} />
      </div>
    );
  }

  if (state === 'ended') {
    return (
      <div data-layout="stack" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <ConversationComplete
          ticketReference={p.ticketReference}
          escalated={p.escalated}
          endReason={p.endReason}
          conversationId={p.conversationId}
          embedded={p.embedded}
          linkStatus={p.linkStatus}
          onStartAnother={p.onStart}
        >
          {p.endedExtra}
        </ConversationComplete>
        {p.turns.length > 0 && <ConversationPanel turns={p.turns} />}
      </div>
    );
  }

  return (
    <div data-layout="stack" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      {p.session?.silenceCountdown != null ? (
        <SilenceCountdown seconds={p.session.silenceCountdown} />
      ) : (
        p.session?.sessionWarning &&
        p.session.secondsLeft != null && <SessionWarning secondsLeft={p.session.secondsLeft} />
      )}
      <AudioNotices muted={Boolean(p.muted)} noisy={Boolean(p.noisy)} />
      <section className="rounded-lg border border-line bg-surface p-6 shadow-card" aria-label="Voice">
        <VoicePanel
          state={state}
          level={p.level}
          hasConversation={p.turns.length > 0}
          onStart={p.onStart}
          onEnd={p.onEnd}
        />
        {p.onSendText && LIVE_STATES.includes(state) && <TypedComposer onSend={p.onSendText} />}
      </section>
      <EscalationPanel support={p.support} requestedTime={p.requestedTime} />
      {p.support === 'ticket-created' && <TicketConfirmation reference={p.ticketReference} />}
      <ConversationPanel turns={p.turns} />
    </div>
  );
}
