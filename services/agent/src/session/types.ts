/** Why a session stopped (conversations.end_reason). final_status stays the coarse outcome. */
export const END_REASONS = [
  'user-ended',
  'silence-timeout',
  'session-timeout',
  'agent-ended',
  'human-closed',
  'low-confidence',
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

export interface SessionConfig {
  /** Absolute AI voice session lifetime. */
  maxSeconds: number;
  /** The "about to end" warning goes out this many seconds before the limit. */
  warningSeconds: number;
  /** Quiet time before the visible countdown starts. */
  silenceSeconds: number;
  /** Visible countdown length; the call ends when it reaches zero. */
  countdownSeconds: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxSeconds: 360,
  warningSeconds: 30,
  silenceSeconds: 15,
  countdownSeconds: 10,
};

/** Fixed, deterministic replies: closing the session never costs a model call. */
export const SESSION_TEXT = {
  anythingElse: "You're welcome. Is there anything else I can help you with?",
  goodbye: 'Thanks for contacting RelayPay Support. Goodbye.',
  warning: 'This support session will end in about 30 seconds.',
  timeout: 'This support session has reached its time limit, so I need to end it now. Goodbye.',
  ended: 'This support session has ended. You can start a new conversation whenever you need help.',
} as const;
