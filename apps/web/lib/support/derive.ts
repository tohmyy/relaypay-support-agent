import { NEUTRAL_STATE, type PublicConversationState } from '../conversation-state';

/** Where the support request stands. Independent of the voice state. */
export type SupportState =
  | 'normal'
  | 'clarifying'
  | 'ticket-created'
  | 'escalation-required'
  | 'escalated'
  | 'human-support'
  | 'completed';

export interface ClientFlags {
  /** The call has finished. */
  callEnded: boolean;
}

export const emptyBackendState: PublicConversationState = NEUTRAL_STATE;

/**
 * Pure mapping from what the backend recorded (plus one client flag) to the support state.
 * Precedence: human-support, completed, escalated, escalation-required, ticket-created, clarifying, normal.
 */
export function deriveSupportState(backend: PublicConversationState, flags: ClientFlags): SupportState {
  // The voice call is over but the conversation continues with a specialist, so it is not "completed".
  if (backend.supportMode === 'human') return 'human-support';
  if (flags.callEnded) return 'completed';
  if (backend.escalation) return 'escalated';
  if (backend.answerType === 'escalation') return 'escalation-required';
  if (backend.ticketReference) return 'ticket-created';
  if (backend.answerType === 'clarification') return 'clarifying';
  return 'normal';
}
