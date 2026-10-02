'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { fetchConversationState } from '@/lib/support/state-client';
import type { VoiceClientFactory } from '@/lib/voice/client';
import { DEMO_SCRIPT, MockVoiceClient } from '@/lib/voice/mock-client';
import { createMockStateFetcher, silenceDemoScript } from '@/lib/voice/mock-state';
import { createVapiClient } from '@/lib/voice/vapi-client';
import Header from './Header';
import SupportWorkspace from './SupportWorkspace';

export type VoiceConfig =
  | { mode: 'vapi'; publicKey: string; assistantId: string }
  | { mode: 'mock' }
  | { mode: 'unconfigured' };

/** Owns the support session for the page and wires the voice provider to the presentational workspace. */
export default function SupportPage({ config }: { config: VoiceConfig }) {
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

  return (
    <>
      <Header />
      <main className="flex-1">
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
      </main>
    </>
  );
}
