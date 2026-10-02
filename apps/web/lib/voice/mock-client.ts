import type { VoiceClient, VoiceClientHandlers } from './client';

export interface MockStep {
  at: number;
  run(h: VoiceClientHandlers): void;
}

/** A short, self-playing conversation so the interface can be previewed without a microphone. */
export const DEMO_SCRIPT: MockStep[] = [
  { at: 400, run: (h) => h.onCallStart() },
  { at: 1200, run: (h) => h.onUserSpeech(true) },
  { at: 1500, run: (h) => h.onTranscript({ role: 'user', text: 'How much are international', final: false }) },
  {
    at: 2200,
    run: (h) => h.onTranscript({ role: 'user', text: 'How much are international payment fees?', final: true }),
  },
  { at: 2300, run: (h) => h.onUserSpeech(false) },
  { at: 4200, run: (h) => h.onAssistantSpeech(true) },
  {
    at: 4300,
    run: (h) =>
      h.onTranscript({
        role: 'assistant',
        text: 'Fees vary by transaction type, corridor and payment method. RelayPay shows the applicable fees before you confirm a transaction.',
        final: true,
      }),
  },
  { at: 9000, run: (h) => h.onAssistantSpeech(false) },
];

/**
 * Scripted voice client for previews and tests. With no script it does nothing on its own, and a test
 * can drive it through `handlers`. Enabled in the app only with NEXT_PUBLIC_VOICE_MOCK=1.
 */
export class MockVoiceClient implements VoiceClient {
  handlers?: VoiceClientHandlers;
  sent: string[] = [];
  stopped = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  /** Test and preview helpers: the signals a real provider may give. */
  muted?: boolean;

  constructor(
    private readonly script: MockStep[] = [],
    private readonly conversationId = 'vapi_mock-call',
    private readonly failWith?: Error,
  ) {}

  async start(handlers: VoiceClientHandlers) {
    if (this.failWith) throw this.failWith;
    this.handlers = handlers;
    this.stopped = false;
    for (const step of this.script) {
      this.timers.push(setTimeout(() => !this.stopped && step.run(handlers), step.at));
    }
    return { conversationId: this.conversationId };
  }

  async stop() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.handlers?.onCallEnd();
  }

  send(text: string) {
    this.sent.push(text);
  }
}
