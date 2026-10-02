import { NEUTRAL_STATE, type PublicConversationState } from '../conversation-state';

/** Where the support request stands. Independent of the voice state. */
export type SupportState =
  | 'normal'
  | 'clarifying'
  | 'ticket-created'
  | 'escalation-required'
  | 'escalating'
  | 'escalated'
  | 'completed';

export interface ClientFlags {
  /** The call has finished. */
  callEnded: boolean;
  /** The customer submitted the contact form and the request is not recorded yet. */
  contactSubmitted: boolean;
}

export const emptyBackendState: PublicConversationState = NEUTRAL_STATE;

/**
 * Pure mapping from what the backend recorded (plus two client flags) to the support state.
 * Precedence: completed, escalated, escalating, escalation-required, ticket-created, clarifying, normal.
 */
export function deriveSupportState(backend: PublicConversationState, flags: ClientFlags): SupportState {
  if (flags.callEnded) return 'completed';
  if (backend.escalation) return 'escalated';
  if (flags.contactSubmitted) return 'escalating';
  if (backend.answerType === 'escalation') return 'escalation-required';
  if (backend.ticketReference) return 'ticket-created';
  if (backend.answerType === 'clarification') return 'clarifying';
  return 'normal';
}
