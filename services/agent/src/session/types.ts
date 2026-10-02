/** Why a session stopped (conversations.end_reason). final_status stays the coarse outcome. */
export const END_REASONS = [
  'user-ended',
  'silence-timeout',
  'session-timeout',
  'agent-ended',
  'human-closed',
  'low-confidence',
  'limit-reached',
  'error',
] as const;
export type ConversationEndReason = (typeof END_REASONS)[number];

/** Server-side, ephemeral session-control phase. Not a replacement for the client VoiceState / SupportState. */
export type SessionControlPhase =
  | 'active'
  | 'awaiting-confirmation'
  | 'silence-warning'
  | 'ending'
  | 'human-support'
  | 'ended';

/**
 * Abuse limits (Build Plan V2 Iteration 10). Each is enforced here, on the server, never by the browser. A value of 0
 * turns that one limit off.
 */
export interface AbuseLimits {
  /** Per conversation: model turns, tool calls (any MCP tool) and knowledge lookups. */
  maxAgentCalls: number;
  maxToolCalls: number;
  maxRetrievals: number;
  /** Active AI voice sessions one signed-in customer may have at once. */
  maxConcurrentSessions: number;
  /** New conversations one signed-in customer may start per window. */
  sessionRateMax: number;
  sessionRateWindowSeconds: number;
  /** New conversations by anyone per window: a circuit breaker for floods from callers the server cannot identify. */
  globalSessionRateMax: number;
  globalSessionRateWindowSeconds: number;
}

export const NO_LIMITS: AbuseLimits = {
  maxAgentCalls: 0,
  maxToolCalls: 0,
  maxRetrievals: 0,
  maxConcurrentSessions: 0,
  sessionRateMax: 0,
  sessionRateWindowSeconds: 3600,
  globalSessionRateMax: 0,
  globalSessionRateWindowSeconds: 600,
};

export interface SessionConfig {
  /** Absolute AI voice session lifetime. */
  maxSeconds: number;
  /** The "about to end" warning goes out this many seconds before the limit. */
  warningSeconds: number;
  /** Quiet time before the visible countdown starts. */
  silenceSeconds: number;
  /** Visible countdown length; the call ends when it reaches zero. */
  countdownSeconds: number;
  /** Mode B: after an escalation, stop the call and continue as a text chat with staff (signed-in customers only). */
  humanHandoff: boolean;
  /**
   * Every call must belong to a signed-in customer (docs/AUTH.md). When on, a call still not linked to a customer after
   * `linkGraceSeconds` is ended politely. Off by default in the library and in development so anonymous test calls work;
   * the running service turns it on in production (session/config.ts).
   */
  requireLink: boolean;
  /** How long the web app has to link a new call to the signed-in customer. */
  linkGraceSeconds: number;
  limits: AbuseLimits;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxSeconds: 360,
  warningSeconds: 30,
  silenceSeconds: 15,
  countdownSeconds: 10,
  humanHandoff: false,
  requireLink: false,
  linkGraceSeconds: 10,
  // Off here so the library default and the tests do not depend on a database; the running service takes its limits
  // from the environment (see session/config.ts), where they are on by default.
  limits: NO_LIMITS,
};

/** Fixed, deterministic replies: closing the session never costs a model call. */
export const SESSION_TEXT = {
  anythingElse: "You're welcome. Is there anything else I can help you with?",
  goodbye: 'Thanks for contacting RelayPay Support. Goodbye.',
  warning: 'This support session will end in about 30 seconds.',
  timeout: 'This support session has reached its time limit, so I need to end it now. Goodbye.',
  ended: 'This support session has ended. You can start a new conversation whenever you need help.',
  /** Replies the AI never gives in human mode: a request still reaching the voice path gets this, not the model. */
  humanActive: 'A support specialist is helping you by text in your support window.',
  /** Over a conversation budget. */
  budget: 'This request needs to be continued by a support specialist. Thanks for your patience. Goodbye.',
  budgetHandoff:
    "This request needs a support specialist. I'm connecting you now, and they will continue by text in this window.",
  concurrent: 'You already have an active support conversation. Please use that one. Goodbye.',
  rateLimited: "We're getting a lot of requests right now. Please try again in a little while. Goodbye.",
  /** Ended because no signed-in customer ever claimed the call. */
  notSignedIn:
    "I couldn't confirm that you're signed in, so I can't continue this conversation. Please sign in and start again. Goodbye.",
  /** Several turns in a row could not be understood: end politely. */
  lowConfidence:
    "I'm sorry, I'm having trouble understanding you, so I'll end this call for now. Please try again, or type your message instead. Goodbye.",
  /** The line stored in the conversation when it moves to a person (shown to the customer and to staff). */
  handoffNotice:
    "You're being connected to a support specialist. This voice conversation has ended, and a RelayPay support specialist will continue helping you here by text.",
} as const;
