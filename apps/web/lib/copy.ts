import type { PublicEndReason } from './conversation-state';
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
    viewTranscript: 'View transcript',
    tryAgain: 'Try again',
    checkMicrophone: 'Check microphone access',
  },
  conversation: {
    title: 'Conversation',
    you: 'You',
    support: 'RelayPay Support',
    empty: 'Your conversation will appear here.',
    transcriptLabel: 'Conversation transcript',
  },
  escalation: {
    heading: 'A support specialist needs to assist you',
    // No form: contact details come from the signed-in account, and a callback time is agreed in the conversation.
    body: "We'll use the contact details on your account, so there is nothing to fill in.",
    timeHint: 'To arrange a callback, tell RelayPay Support the day and time you would like to be called, by voice or by typing it below.',
    confirmed: 'Your request has been sent to RelayPay Support.',
    confirmedBody: 'A support specialist will follow up using the contact details on your account.',
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
  session: {
    silenceHeading: 'No activity detected',
    silenceCountdown: 'Ending conversation in {seconds} seconds...',
    silenceCountdownOne: 'Ending conversation in 1 second...',
    silenceHint: 'Say something to keep the conversation going.',
    silenceScreenReader: 'No activity detected. The conversation will end soon. Say something to keep it going.',
    warningHeading: 'Session ending soon',
    warningBody: 'This support session will end in about {seconds} seconds.',
    warningBodyOne: 'This support session will end in about 1 second.',
    warningScreenReader: 'This support session will end in about 30 seconds.',
    endedHeading: 'Session ended',
    endedBodySilence: 'The conversation ended because there was no activity.',
    activeElsewhere: 'You already have an active support conversation. Please continue in that one.',
    tooManyConversations: 'You have started several conversations recently. Please try again in a little while.',
    endedBodyLimit:
      'This request needs to be continued by a support specialist. You can start a new conversation whenever you need help.',
    endedBodyTimeout: 'This support session reached its time limit.',
    endedNewConversation: 'You can start a new support conversation whenever you need help.',
    endedBodyLowConfidence:
      "We had trouble hearing you, so the conversation ended. You can type your message instead, or start a new conversation.",
    endedBodyError: 'Something went wrong and the conversation ended. You can start a new conversation whenever you need help.',
    endedBodyHumanClosed: 'A support specialist has closed this conversation.',
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
    'no-microphone': {
      message: "We couldn't find a microphone.",
      detail: 'Connect a microphone or headset, then try again.',
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
    unavailable: {
      message: "Voice support isn't available right now.",
      detail: 'Please try again in a little while.',
      action: 'Try again',
    },
  } satisfies Record<ErrorKind, { message: string; detail?: string; action: string }>,
  /** Said while the microphone is muted or the room is loud. Best effort: shown only when the browser could tell. */
  audio: {
    muted: 'Your microphone is muted, so RelayPay Support cannot hear you. Unmute it to carry on talking.',
    noisy: 'It sounds noisy where you are. If RelayPay Support has trouble hearing you, try a quieter spot or a headset.',
  },
  /** The 30 second window to pick a conversation back up after it ends. */
  resume: {
    prompt: 'You can pick this conversation back up for {seconds} more seconds. Your transcript will be kept.',
    promptOne: 'You can pick this conversation back up for 1 more second. Your transcript will be kept.',
    action: 'Resume conversation',
    decline: 'No, thanks',
    failed: "We couldn't resume that conversation. You can start another one.",
  },
  /** Typing as an alternative to talking (the same conversation, or a typed-only one when the microphone cannot be used). */
  typed: {
    heading: 'Type to RelayPay Support',
    intro: 'Type your question and RelayPay Support will answer in writing.',
    label: 'Type a message',
    placeholder: 'Type here instead of speaking',
    send: 'Send',
    sending: 'Sending…',
    tooLong: 'That message is too long. Please shorten it.',
    failed: "We couldn't send that. Please try again.",
    rateLimited: 'You are sending messages quickly. Please wait a moment and try again.',
    typeInstead: 'Type instead',
    useVoice: 'Use voice instead',
    thinking: 'RelayPay Support is typing…',
  },
  /** Offered beside the error when the customer cannot (or cannot right now) use voice support. */
  errorHelp: {
    unavailable: { text: 'If it is urgent, you can reach a support specialist from your dashboard.', linkLabel: 'Go to your dashboard', href: '/dashboard' },
  },
  /** Said under the Start button before the browser asks for the microphone. */
  microphone: {
    heading: 'Before you start',
    instruction:
      'Voice support needs your microphone. When you start, your browser will ask for permission. Choose Allow to talk with RelayPay Support.',
  },
  /** Saving the conversation to the customer's account (so it shows in their history). */
  link: {
    saving: 'Saving this conversation to your account…',
    failed: "We couldn't save this conversation to your account yet.",
    saveAction: 'Save this conversation to your account',
    saved: 'Saved to your account.',
    signedIn: 'You are signed in. Your conversation is saved to your account.',
  },
  /** A calm, non-blocking notice while the live status updates are not arriving. */
  statusUnavailable: "We're having trouble refreshing the status of your conversation. It will keep trying.",
  notConfigured: "Voice support isn't available right now. Please try again later.",
};

/** Fills `{seconds}` in a notice, using the singular string for one second. */
export function withSeconds(template: string, one: string, seconds: number): string {
  return seconds === 1 ? one : template.replace('{seconds}', String(seconds));
}

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

/**
 * What the ended screen says for each recorded end reason (docs/BUILD-PLAN-V3.md V3.4). `null` means the ordinary ending,
 * which uses the default completion wording. Every public end reason has an entry, so none can fall through unexplained;
 * while the reason is still being read the screen uses the same calm default.
 */
export const END_REASON_BODY: Record<PublicEndReason, string | null> = {
  'user-ended': null,
  'agent-ended': null,
  'silence-timeout': COPY.session.endedBodySilence,
  'session-timeout': COPY.session.endedBodyTimeout,
  'limit-reached': COPY.session.endedBodyLimit,
  'low-confidence': COPY.session.endedBodyLowConfidence,
  'human-closed': COPY.session.endedBodyHumanClosed,
  error: COPY.session.endedBodyError,
};
