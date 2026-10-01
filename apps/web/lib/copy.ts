import type { ErrorKind, VoiceState } from './voice/state';

/**
 * Every customer-visible string lives here (docs/UI.md). Customers talk to "RelayPay Support":
 * no technical or internal vocabulary. tests/web/copy.test.ts fails if any string breaks that rule.
 */

export const VOICE_STATUS: Record<VoiceState, { label: string; screenReader: string }> = {
  idle: { label: 'Ready to help', screenReader: 'Voice status: Ready to help' },
  connecting: {
    label: 'Connecting to RelayPay Support…',
    screenReader: 'Voice status: Connecting to RelayPay Support',
  },
  listening: { label: 'Listening…', screenReader: 'Voice status: Listening' },
  // Same visible text as listening; the visualizer and this screen-reader text tell them apart.
  'user-speaking': { label: 'Listening…', screenReader: 'Voice status: Listening, you are speaking' },
  processing: { label: 'Thinking…', screenReader: 'Voice status: Thinking' },
  'assistant-speaking': {
    label: 'RelayPay Support is responding…',
    screenReader: 'Voice status: RelayPay Support is responding',
  },
  ending: {
    label: 'Ending your support session…',
    screenReader: 'Voice status: Ending your support session',
  },
  ended: { label: 'Conversation ended', screenReader: 'Voice status: Conversation ended' },
  error: {
    label: "We couldn't connect to RelayPay Support.",
    screenReader: "Voice status: We couldn't connect to RelayPay Support",
  },
};

export const VOICE_PROMPT: Partial<Record<VoiceState, string>> = {
  listening: 'How can I help further?',
};

export const COPY = {
  brand: 'RelayPay',
  headerLabel: 'Customer Support',
  headerLabelCompact: 'Support',
  landingHeading: 'How can we help?',
  landingBody: 'Talk to RelayPay Support about payments, payouts, invoices, fees, or account support.',
  privacyNotice: 'Voice conversations may be recorded and logged to provide and improve support.',
  topicsHeading: 'You can ask about:',
  topics: ['Payments', 'Payouts', 'Invoices', 'Fees', 'Account support'],
  suggestedPrompts: [
    'How much are international payment fees?',
    'What is the status of my payout?',
    'How long do international payouts take?',
    'I need help with a failed payment.',
  ],
  buttons: {
    start: 'Start conversation',
    connecting: 'Connecting…',
    end: 'End conversation',
    startAnother: 'Start another conversation',
    requestSupport: 'Request support',
    tryAgain: 'Try again',
    checkMicrophone: 'Check microphone access',
  },
  conversation: {
    title: 'Conversation',
    you: 'You',
    support: 'RelayPay Support',
    empty: 'Your conversation will appear here.',
    transcriptLabel: 'Conversation transcript',
    detailsSent: 'Contact details sent to RelayPay Support.',
  },
  escalation: {
    heading: 'A support specialist needs to assist you',
    body: "We'll collect a few details so the team can follow up with you.",
    name: 'Name',
    email: 'Email',
    callbackTime: 'Preferred callback time',
    callbackHint: 'Optional. For example, Tuesday at 2:00 PM.',
    nameRequired: 'Enter your name.',
    emailRequired: 'Enter your email address.',
    emailInvalid: 'Enter a valid email address.',
    sending: 'Sending your request…',
    confirmed: 'Your request has been sent to RelayPay Support.',
    confirmedBody: 'A support specialist will follow up using the contact information you provided.',
    requestedCallback: 'Requested callback',
  },
  ticket: {
    heading: 'Support request created',
    body: 'Your issue has been submitted to RelayPay Support.',
    reference: 'Reference',
  },
  complete: {
    headingDefault: 'Conversation ended',
    headingWithRequest: 'Support session complete',
    bodyDefault: 'Thank you for contacting RelayPay Support.',
    bodyWithRequest: 'Is there anything else you need help with?',
    ticketCreated: 'Your support request has been created.',
    escalationSent: 'Your request has been sent to RelayPay Support.',
  },
  errors: {
    connection: {
      message: "We couldn't connect to RelayPay Support.",
      action: 'Try again',
    },
    microphone: {
      message: "We can't access your microphone.",
      detail: 'Microphone access is required to use voice support.',
      action: 'Check microphone access',
    },
    service: {
      message: 'Something went wrong while processing your request.',
      action: 'Try again',
    },
    unsupported: {
      message: "This browser can't be used for voice support.",
      detail: 'Please open this page in a recent version of Chrome, Edge, Safari or Firefox.',
      action: 'Try again',
    },
  } satisfies Record<ErrorKind, { message: string; detail?: string; action: string }>,
  notConfigured: "Voice support isn't available right now. Please try again later.",
};

/** Words that must never reach a customer (checked by tests against every string above). */
export const FORBIDDEN_CUSTOMER_TERMS = [
  'mcp',
  'rag',
  'retrieval',
  'embedding',
  'tool call',
  'claude',
  'supabase',
  'sdk',
  'vapi',
  'agent',
  'review_required',
  'in_progress',
  'api error',
];
