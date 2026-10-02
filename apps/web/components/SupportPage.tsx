'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { failFor, withRetry } from '@/lib/retry';
import { runPreflight } from '@/lib/support/preflight';
import { fetchConversationState } from '@/lib/support/state-client';
import type { VoiceClientFactory } from '@/lib/voice/client';
import { DEMO_SCRIPT, MockVoiceClient } from '@/lib/voice/mock-client';
import { createMockStateFetcher, silenceDemoScript } from '@/lib/voice/mock-state';
import { createVapiClient } from '@/lib/voice/vapi-client';
import { COPY } from '@/lib/copy';
import Header from './Header';
import HumanSupport from './shell/HumanSupport';
import ResumePrompt from './ResumePrompt';
import SessionFeedback from './SessionFeedback';
import TextConversation from './TextConversation';
import SupportWorkspace from './SupportWorkspace';

export type VoiceConfig =
  | { mode: 'vapi'; publicKey: string; assistantId: string }
  | { mode: 'mock' }
  | { mode: 'unconfigured' };

type Blocked = 'active-session' | 'rate-limited';

/** Whether this call is tied to the signed-in customer's account (null when linking does not apply). */
export type LinkStatus = 'linking' | 'linked' | 'failed';

/** Asks the server to reopen the conversation that just ended (only possible within 30 seconds). */
async function reopenConversation(conversationId: string): Promise<'ok' | 'expired' | 'unavailable'> {
  try {
    const res = await fetch(`/api/support/conversations/${encodeURIComponent(conversationId)}/resume`, { method: 'POST' });
    if (res.ok) return 'ok';
    return res.status === 409 || res.status === 404 ? 'expired' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

type LinkOutcome = { status: 'linked' } | { status: 'failed' } | { status: 'blocked'; reason: Blocked };

/**
 * Ties a started call to the signed-in customer so only they (and staff) can read it back, and so the server can
 * enforce its limits. A temporary failure is tried once more automatically; a permanent one (another owner, signed
 * out) is not. It reports when the customer already has another active conversation or has started too many: the
 * page then ends this call.
 */
async function linkConversation(conversationId: string): Promise<LinkOutcome> {
  try {
    return await withRetry(
      async (): Promise<LinkOutcome> => {
        const res = await fetch('/api/support/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId }),
        });
        if (res.ok) return { status: 'linked' };
        if (res.status === 409 || res.status === 429) {
          const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
          if (reason === 'active-session' || reason === 'rate-limited') return { status: 'blocked', reason };
        }
        return failFor(res.status);
      },
      { operation: 'link' },
    );
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Owns the support session for the page and wires the voice provider to the presentational workspace.
 * `embedded` renders inside the signed-in shell (no page header or landmark of its own); `linkIdentity` also ties each
 * real call to the signed-in customer.
 */
export default function SupportPage({
  config,
  embedded = false,
  linkIdentity = false,
}: {
  config: VoiceConfig;
  embedded?: boolean;
  linkIdentity?: boolean;
}) {
  // Preview mode has no backend: each preview call gets a fresh stand-in snapshot with short limits.
  const mockFetcher = useRef(createMockStateFetcher());
  const createClient = useMemo<VoiceClientFactory>(() => {
    if (config.mode === 'vapi') {
      const { publicKey, assistantId } = config;
      return (options) => createVapiClient({ publicKey, assistantId, resumeConversationId: options?.resumeConversationId });
    }
    // Preview mode plays a short scripted conversation, then goes quiet; "unconfigured" never starts a call.
    return () => {
      mockFetcher.current = createMockStateFetcher();
      return new MockVoiceClient(config.mode === 'mock' ? silenceDemoScript(DEMO_SCRIPT) : []);
    };
  }, [config]);
  const fetchState = useCallback(
    (id: string) => (config.mode === 'mock' ? mockFetcher.current() : fetchConversationState(id)),
    [config.mode],
  );

  // A real call checks that support is available and that the customer may begin one before anything else happens.
  const preflight = config.mode === 'vapi' ? runPreflight : undefined;
  // Picking a call back up within 30 seconds of its end needs the server to reopen the conversation first.
  const reopen = config.mode === 'vapi' ? reopenConversation : undefined;
  const session = useVoiceSession({ createClient, fetchState, preflight, reopen });

  useEffect(() => {
    if (session.signedOut) window.location.replace('/login');
  }, [session.signedOut]);

  const linkedId = useRef<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // The link status belongs to one conversation: a new call never inherits the previous one's.
  const [linkState, setLinkState] = useState<{ id: string; status: LinkStatus } | null>(null);
  const linkStatus: LinkStatus | null =
    linkState && linkState.id === session.conversationId ? linkState.status : null;

  const link = useCallback((id: string) => {
    setLinkState({ id, status: 'linking' });
    void linkConversation(id).then((outcome) => {
      if (outcome.status === 'blocked') {
        setBlocked(outcome.reason);
        setLinkState({ id, status: 'linked' });
      } else {
        setLinkState({ id, status: outcome.status });
      }
    });
  }, []);

  useEffect(() => {
    const id = session.conversationId;
    if (!linkIdentity || config.mode !== 'vapi' || !id || linkedId.current === id) return;
    linkedId.current = id;
    setBlocked(null);
    link(id);
  }, [linkIdentity, config.mode, session.conversationId, link]);

  // Another active conversation (or too many started): the server ends this call too; this ends it on the page.
  useEffect(() => {
    if (blocked) void session.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  // Typing instead of talking: offered when the microphone cannot be used, and for any customer who prefers it.
  const [typedOnly, setTypedOnly] = useState(false);

  const shownBlock = blocked ?? session.blocked;
  const Container = embedded ? 'div' : 'main';
  return (
    <>
      {!embedded && <Header />}
      <Container className="flex-1">
        {shownBlock && (
          <div className="mx-auto w-full max-w-xl px-4 pt-6">
            <p
              role="alert"
              className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card"
            >
              {shownBlock === 'active-session'
                ? COPY.session.activeElsewhere
                : COPY.session.tooManyConversations}
            </p>
          </div>
        )}
        {linkStatus === 'failed' && (
          <div className="mx-auto w-full max-w-xl px-4 pt-6">
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card"
            >
              <span>{COPY.link.failed}</span>
              <button
                type="button"
                onClick={() => session.conversationId && link(session.conversationId)}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-4 py-2 font-medium text-ink hover:bg-surface-subtle"
              >
                {COPY.link.saveAction}
              </button>
            </div>
          </div>
        )}
        {session.statusUnavailable && session.voice.state !== 'idle' && session.voice.state !== 'error' && (
          <div className="mx-auto w-full max-w-xl px-4 pt-6">
            <p role="status" className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-secondary">
              {COPY.statusUnavailable}
            </p>
          </div>
        )}
        {typedOnly ? (
          <TextConversation onUseVoice={() => setTypedOnly(false)} />
        ) : session.support === 'human-support' && session.conversationId ? (
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            <HumanSupport conversationId={session.conversationId} />
          </div>
        ) : (
          <SupportWorkspace
            voice={session.voice}
            support={session.support}
            turns={session.turns}
            ticketReference={session.backend.ticketReference}
            requestedTime={session.backend.escalation?.requestedTime ?? null}
            escalated={Boolean(session.backend.escalation)}
            level={session.level}
            session={session.session}
            endReason={session.endReason}
            unavailable={config.mode === 'unconfigured'}
            conversationId={session.conversationId}
            embedded={embedded}
            linkStatus={linkStatus}
            onStart={session.start}
            onEnd={session.end}
            onSendText={session.sendText}
            onTypeInstead={config.mode === 'vapi' ? () => setTypedOnly(true) : undefined}
            muted={session.muted}
            noisy={session.noisy}
            endedExtra={
              <>
                {session.resumeSecondsLeft > 0 && (
                  <ResumePrompt secondsLeft={session.resumeSecondsLeft} onResume={session.resume} onDecline={session.declineResume} />
                )}
                {session.resumeFailed && (
                  <p role="status" className="mt-4 text-sm text-ink-secondary">
                    {COPY.resume.failed}
                  </p>
                )}
                {/* Not while the 30 seconds to resume are running: the rating comes once they are over or declined. */}
                {session.resumeSecondsLeft === 0 && linkStatus === 'linked' && session.conversationId && (
                  // Only offered for a call that really is in the customer's account (it is stored against it).
                  <SessionFeedback key={session.conversationId} conversationId={session.conversationId} stage="ai" />
                )}
              </>
            }
          />
        )}
      </Container>
    </>
  );
}
