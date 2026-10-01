'use client';

import { useMemo } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { fetchConversationState } from '@/lib/support/state-client';
import type { VoiceClientFactory } from '@/lib/voice/client';
import { DEMO_SCRIPT, MockVoiceClient } from '@/lib/voice/mock-client';
import { createVapiClient } from '@/lib/voice/vapi-client';
import Header from './Header';
import SupportWorkspace from './SupportWorkspace';

export type VoiceConfig =
  | { mode: 'vapi'; publicKey: string; assistantId: string }
  | { mode: 'mock' }
  | { mode: 'unconfigured' };

/** Owns the support session for the page and wires the voice provider to the presentational workspace. */
export default function SupportPage({ config }: { config: VoiceConfig }) {
  const createClient = useMemo<VoiceClientFactory>(() => {
    if (config.mode === 'vapi') {
      const { publicKey, assistantId } = config;
      return () => createVapiClient({ publicKey, assistantId });
    }
    // Preview mode plays a short scripted conversation; "unconfigured" never starts a call.
    return () => new MockVoiceClient(config.mode === 'mock' ? DEMO_SCRIPT : []);
  }, [config]);

  const session = useVoiceSession({ createClient, fetchState: fetchConversationState });

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
          unavailable={config.mode === 'unconfigured'}
          onStart={session.start}
          onEnd={session.end}
          onSubmitContact={session.submitContact}
        />
      </main>
    </>
  );
}
