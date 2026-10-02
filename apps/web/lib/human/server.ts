import 'server-only';
import { SUPPORT_MODES, type SupportMode } from '@/lib/conversation-state';
import { json } from '@/lib/http';
import { restPatch, restRpc } from '@/lib/supabase.server';

/**
 * Shared by the customer and staff routes. Every change of who has a conversation, and of its ticket and escalation, is
 * one database function (supabase/migrations/20261007000017_ticket_escalation_ownership.sql): it locks the conversation,
 * checks the current state, changes conversation, ticket and escalation together, and writes the note the customer sees
 * and one event. A stale or repeated action changes nothing and gets the current state back, so a race has one winner.
 */
export const modeOf = (mode: string | null | undefined): SupportMode =>
  SUPPORT_MODES.find((m) => m === mode) ?? 'ai';

const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
/** Matches a conversation only while it is with a specialist and still open. */
const openHuman = (id: string) => `conversation_id=${eq(id)}&support_mode=eq.human&ended_at=is.null`;

/**
 * Bumps activity on an open human conversation and says whether it was still open. Used for the typing signals and the
 * customer's message gate; nothing is written to a conversation that was closed a moment ago.
 */
export async function touchOpenHuman(
  conversationId: string,
  extra: Record<string, unknown> = {},
  extraFilter = '',
): Promise<boolean> {
  const rows = await restPatch(
    'conversations',
    `${openHuman(conversationId)}${extraFilter}`,
    { last_activity_at: new Date().toISOString(), ...extra },
  );
  return rows.length > 0;
}

/** Records that one side has read the conversation up to now. Only for a conversation that is with a person. */
export async function markRead(conversationId: string, side: 'customer' | 'staff'): Promise<void> {
  await restPatch(
    'conversations',
    `conversation_id=${eq(conversationId)}&support_mode=in.(human,ended)`,
    { [side === 'customer' ? 'customer_last_read_at' : 'staff_last_read_at']: new Date().toISOString() },
  );
}

/** The conversation, ticket and escalation as the database function saw them after (or instead of) the change. */
export interface LifecycleState {
  support_mode: string | null;
  assigned_staff_id: string | null;
  ended_at: string | null;
  end_reason: string | null;
  final_status: string | null;
  ticket_id: string | null;
  ticket_status: string | null;
  escalation_id: string | null;
  escalation_status: string | null;
}

export interface LifecycleResult<O extends string> {
  outcome: O;
  /** Null when the conversation does not exist. */
  state: LifecycleState | null;
}

export type ClaimOutcome = 'claimed' | 'already-mine' | 'taken' | 'not-open' | 'not-found' | 'not-authorized';
export type ReleaseOutcome = 'released' | 'not-assigned' | 'taken' | 'not-open' | 'not-found' | 'not-authorized';
export type CloseOutcome = 'closed' | 'taken' | 'not-open' | 'not-found' | 'not-authorized';
export type EndOutcome = 'ended' | 'not-open' | 'not-found';
export type MessageOutcome = 'ok' | 'duplicate' | 'closed' | 'not-found';

/**
 * The answer for an action that did not happen: 404 for a conversation that is not there, 403 for someone who may not act,
 * otherwise 409 with the reason and the current state, so the screen can show what is true now instead of guessing.
 */
export function lifecycleRefusal(result: LifecycleResult<string>): Response {
  if (result.outcome === 'not-found') return json({ error: 'not found' }, 404);
  if (result.outcome === 'not-authorized') return json({ error: 'forbidden' }, 403);
  return json({ error: result.outcome, state: result.state }, 409);
}

/** Takes an unassigned conversation (two people clicking at once give one winner). Joined note and event included. */
export const claimConversation = (staffId: string, conversationId: string) =>
  restRpc<LifecycleResult<ClaimOutcome>>('staff_claim_escalation', { p_conversation_id: conversationId, p_staff_id: staffId });

/** Gives a conversation back to the queue: the person who has it, or an admin. */
export const releaseConversation = (staffId: string, conversationId: string) =>
  restRpc<LifecycleResult<ReleaseOutcome>>('staff_release_escalation', { p_conversation_id: conversationId, p_staff_id: staffId });

/** Closes conversation, ticket and escalation together. `final_status` keeps the assistant's outcome. */
export const closeConversation = (staffId: string, conversationId: string) =>
  restRpc<LifecycleResult<CloseOutcome>>('staff_close_escalation', { p_conversation_id: conversationId, p_staff_id: staffId });

/** The customer ends their own open chat; the ticket and escalation close with it. Anyone else's: `not-found`. */
export const endConversationAsCustomer = (customerId: string, conversationId: string) =>
  restRpc<LifecycleResult<EndOutcome>>('customer_end_escalation', { p_conversation_id: conversationId, p_customer_id: customerId });

/**
 * Stores a message only while the chat is open. The database locks the conversation, so a close that wins the race makes
 * the message come back `closed` instead of landing after it; a retry with the same client id is `duplicate`.
 */
export const addHumanMessage = (message: {
  conversationId: string;
  sender: 'customer' | 'staff';
  body: string;
  staffUserId?: string | null;
  clientId?: string | null;
}) =>
  restRpc<{ outcome: MessageOutcome }>('add_human_message', {
    p_conversation_id: message.conversationId,
    p_sender: message.sender,
    p_body: message.body,
    p_staff_user_id: message.staffUserId ?? null,
    p_client_msg_id: message.clientId ?? null,
  });
