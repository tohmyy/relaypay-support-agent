/** The only conversation data the browser ever receives. Customer-safe by construction. */
export interface PublicConversationState {
  answerType: 'direct_answer' | 'clarification' | 'escalation' | 'decline' | 'tool_result' | null;
  ticketReference: string | null;
  escalation: { requestedTime: string | null } | null;
  ended: boolean;
}

export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

const ANSWER_TYPES = ['direct_answer', 'clarification', 'escalation', 'decline', 'tool_result'] as const;

export const NEUTRAL_STATE: PublicConversationState = {
  answerType: null,
  ticketReference: null,
  escalation: null,
  ended: false,
};

export interface ConversationRows {
  turns: { turn_number: number | null; answer_type: string | null }[];
  tickets: { ticket_id: string | null; created_at?: string | null }[];
  escalations: { preferred_time: string | null }[];
  conversation: { ended_at: string | null }[];
}

/**
 * Reduces raw rows to the public shape. Only the latest answer type, a ticket reference, an escalation
 * marker with its requested callback time, and an ended flag leave the server. No names, emails,
 * transcripts, notes or internal identifiers.
 */
export function toPublicState(rows: ConversationRows): PublicConversationState {
  const latest = [...rows.turns].sort((a, b) => (b.turn_number ?? 0) - (a.turn_number ?? 0))[0];
  const answerType = ANSWER_TYPES.find((t) => t === latest?.answer_type) ?? null;
  const ticket = [...rows.tickets]
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .find((t) => t.ticket_id);
  const escalation = rows.escalations[0];
  return {
    answerType,
    ticketReference: ticket?.ticket_id ?? null,
    escalation: escalation ? { requestedTime: escalation.preferred_time?.trim() || null } : null,
    ended: Boolean(rows.conversation[0]?.ended_at),
  };
}
