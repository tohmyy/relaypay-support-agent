'use client';

import type { ConversationTurn } from '@/lib/transcript';
import type { SupportState } from '@/lib/support/derive';
import type { VoiceModel } from '@/lib/voice/state';
import Header from '../Header';
import SupportWorkspace from '../SupportWorkspace';

const t = (id: number, speaker: 'user' | 'assistant', text: string, final = true): ConversationTurn => ({
  id,
  speaker,
  text,
  final,
  timestamp: 0,
});

const FEES = [
  t(1, 'user', 'How much are international payment fees?'),
  t(2, 'assistant', 'Fees vary by transaction type, corridor and payment method. RelayPay shows the applicable fees before you confirm a transaction.'),
];
const ESCALATION = [
  t(1, 'user', 'My account was restricted and nobody is helping me.'),
  t(2, 'assistant', "I'm sorry about that. A support specialist needs to help with this. I can arrange a callback for you."),
];

interface Fixture {
  name: string;
  voice: VoiceModel;
  support: SupportState;
  turns: ConversationTurn[];
  ticketReference?: string | null;
  requestedTime?: string | null;
  escalated?: boolean;
  unavailable?: boolean;
}

const FIXTURES: Fixture[] = [
  { name: 'idle', voice: { state: 'idle' }, support: 'normal', turns: [] },
  { name: 'connecting', voice: { state: 'connecting' }, support: 'normal', turns: [] },
  { name: 'listening', voice: { state: 'listening' }, support: 'normal', turns: [] },
  {
    name: 'user-speaking',
    voice: { state: 'user-speaking' },
    support: 'normal',
    turns: [t(1, 'user', 'How much are international', false)],
  },
  { name: 'processing', voice: { state: 'processing' }, support: 'normal', turns: FEES.slice(0, 1) },
  { name: 'assistant-speaking', voice: { state: 'assistant-speaking' }, support: 'normal', turns: FEES },
  { name: 'clarifying', voice: { state: 'listening' }, support: 'clarifying', turns: [t(1, 'user', 'My payment is stuck.'), t(2, 'assistant', 'Is this an outgoing payout, an incoming transfer, or an invoice payment?')] },
  { name: 'escalation-required', voice: { state: 'assistant-speaking' }, support: 'escalation-required', turns: ESCALATION },
  { name: 'escalating', voice: { state: 'processing' }, support: 'escalating', turns: [...ESCALATION, t(3, 'user', 'Contact details sent to RelayPay Support.')] },
  {
    name: 'escalated',
    voice: { state: 'listening' },
    support: 'escalated',
    turns: ESCALATION,
    requestedTime: 'Tuesday at 2:00 PM',
    escalated: true,
  },
  {
    name: 'ticket-created',
    voice: { state: 'listening' },
    support: 'ticket-created',
    turns: [t(1, 'user', 'My invoice payment failed.'), t(2, 'assistant', "I've created a support request. Your reference is TKT-000123.")],
    ticketReference: 'TKT-000123',
  },
  { name: 'error-microphone', voice: { state: 'error', error: 'microphone' }, support: 'normal', turns: [] },
  { name: 'error-connection', voice: { state: 'error', error: 'connection' }, support: 'normal', turns: [] },
  {
    name: 'ended',
    voice: { state: 'ended' },
    support: 'completed',
    turns: FEES,
    ticketReference: 'TKT-000123',
  },
  { name: 'unavailable', voice: { state: 'idle' }, support: 'normal', turns: [], unavailable: true },
];

const noop = () => {};

/** Every interface state side by side, for visual review. Development only (see app/dev/states). */
export default function StatesGallery() {
  return (
    <div>
      {FIXTURES.map((f) => (
        <section key={f.name} id={`state-${f.name}`} className="mb-10 bg-background pb-6">
          <p className="bg-ink px-4 py-1 text-xs font-medium text-white">{f.name}</p>
          <Header />
          <SupportWorkspace
            voice={f.voice}
            support={f.support}
            turns={f.turns}
            ticketReference={f.ticketReference ?? null}
            requestedTime={f.requestedTime ?? null}
            escalated={f.escalated ?? false}
            level={0.6}
            unavailable={f.unavailable}
            onStart={noop}
            onEnd={noop}
            onSubmitContact={noop}
          />
        </section>
      ))}
    </div>
  );
}
