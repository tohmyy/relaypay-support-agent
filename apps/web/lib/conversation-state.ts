import type { SessionLimits } from './session/limits';

/** Why a session stopped. Mirrors conversations.end_reason; every value is customer-safe. */
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
export type PublicEndReason = (typeof END_REASONS)[number];

/** Who is talking: the voice assistant, a support specialist (after a handoff), or nobody (the conversation is closed). */
export const SUPPORT_MODES = ['ai', 'human', 'ended'] as const;
export type SupportMode = (typeof SUPPORT_MODES)[number];

/** The only conversation data the browser ever receives. Customer-safe by construction. */
export interface PublicConversationState {
  answerType: 'direct_answer' | 'clarification' | 'escalation' | 'decline' | 'tool_result' | null;
  ticketReference: string | null;
  escalation: { requestedTime: string | null } | null;
  ended: boolean;
  /** Why the session ended, once it has. */
  endReason: PublicEndReason | null;
  /** `human` once the conversation has moved to a support specialist (the voice call is over, the conversation is not). */
  supportMode: SupportMode;
  /** When the session started and the server's clock at read time (ISO), so the UI can render the time limit. */
  startedAt: string | null;
  serverTime: string | null;
  /** Limits the UI counts down against. */
  limits: SessionLimits | null;
}

export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

const ANSWER_TYPES = ['direct_answer', 'clarification', 'escalation', 'decline', 'tool_result'] as const;

export const NEUTRAL_STATE: PublicConversationState = {
  answerType: null,
  ticketReference: null,
  escalation: null,
  ended: false,
  endReason: null,
  supportMode: 'ai',
  startedAt: null,
  serverTime: null,
  limits: null,
};

export interface ConversationRows {
  turns: { turn_number: number | null; answer_type: string | null }[];
  tickets: { ticket_id: string | null; created_at?: string | null }[];
  escalations: { preferred_time: string | null }[];
  conversation: {
    ended_at: string | null;
    end_reason?: string | null;
    started_at?: string | null;
    /** Used by the route to decide who may read a call tied to a customer; never part of the public state. */
    final_status?: string | null;
    customer_id?: string | null;
    support_mode?: string | null;
    assigned_staff_id?: string | null;
  }[];
}

function isoOrNull(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/**
 * Reduces raw rows to the public shape. Only the latest answer type, a ticket reference, an escalation
 * marker with its requested callback time, the session timing and why it ended leave the server.
 * No names, emails, transcripts, notes or internal identifiers.
 */
export function toPublicState(
  rows: ConversationRows,
  context: { limits?: SessionLimits; now?: Date } = {},
): PublicConversationState {
  const latest = [...rows.turns].sort((a, b) => (b.turn_number ?? 0) - (a.turn_number ?? 0))[0];
  const answerType = ANSWER_TYPES.find((t) => t === latest?.answer_type) ?? null;
  const ticket = [...rows.tickets]
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .find((t) => t.ticket_id);
  const escalation = rows.escalations[0];
  const conversation = rows.conversation[0];
  return {
    answerType,
    ticketReference: ticket?.ticket_id ?? null,
    escalation: escalation ? { requestedTime: escalation.preferred_time?.trim() || null } : null,
    ended: Boolean(conversation?.ended_at),
    endReason: END_REASONS.find((r) => r === conversation?.end_reason) ?? null,
    supportMode: SUPPORT_MODES.find((m) => m === conversation?.support_mode) ?? 'ai',
    startedAt: isoOrNull(conversation?.started_at),
    serverTime: (context.now ?? new Date()).toISOString(),
    limits: context.limits ?? null,
  };
}
