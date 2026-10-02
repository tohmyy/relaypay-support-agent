'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { fetchConversationState } from '@/lib/support/state-client';
import type { VoiceClientFactory } from '@/lib/voice/client';
import { DEMO_SCRIPT, MockVoiceClient } from '@/lib/voice/mock-client';
import { createMockStateFetcher, silenceDemoScript } from '@/lib/voice/mock-state';
import { createVapiClient } from '@/lib/voice/vapi-client';
import { COPY } from '@/lib/copy';
import Header from './Header';
import HumanSupport from './shell/HumanSupport';
import SupportWorkspace from './SupportWorkspace';

export type VoiceConfig =
  | { mode: 'vapi'; publicKey: string; assistantId: string }
  | { mode: 'mock' }
  | { mode: 'unconfigured' };

type Blocked = 'active-session' | 'rate-limited';

/**
 * Ties a started call to the signed-in customer so only they (and staff) can read it back, and so the server can
 * enforce its limits. Best effort, except that it reports when the customer already has another active conversation
 * or has started too many: the page then ends this call.
 */
async function linkConversation(conversationId: string): Promise<Blocked | null> {
  try {
    const res = await fetch('/api/support/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    });
    if (res.status === 409 || res.status === 429) {
      const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      if (reason === 'active-session' || reason === 'rate-limited') return reason;
    }
  } catch {
    // The call works without it; the conversation just stays unlinked.
  }
  return null;
}

/**
 * Owns the support session for the page and wires the voice provider to the presentational workspace.
 * `embedded` renders inside the signed-in shell (no page header or landmark of its own); `linkIdentity` also ties each
 * real call to the signed-in customer. Neither is set on the public page.
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
      return () => createVapiClient({ publicKey, assistantId });
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

  const session = useVoiceSession({ createClient, fetchState });

  const linkedId = useRef<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  useEffect(() => {
    const id = session.conversationId;
    if (!linkIdentity || config.mode !== 'vapi' || !id || linkedId.current === id) return;
    linkedId.current = id;
    void linkConversation(id).then(setBlocked);
  }, [linkIdentity, config.mode, session.conversationId]);

  // Another active conversation (or too many started): the server ends this call too; this ends it on the page.
  useEffect(() => {
    if (blocked) void session.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  const Container = embedded ? 'div' : 'main';
  return (
    <>
      {!embedded && <Header />}
      <Container className="flex-1">
        {blocked && (
          <div className="mx-auto w-full max-w-xl px-4 pt-6">
            <p
              role="alert"
              className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card"
            >
              {blocked === 'active-session'
                ? COPY.session.activeElsewhere
                : COPY.session.tooManyConversations}
            </p>
          </div>
        )}
        {session.support === 'human-support' && session.conversationId ? (
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
            onStart={session.start}
            onEnd={session.end}
            onSubmitContact={session.submitContact}
          />
        )}
      </Container>
    </>
  );
}
