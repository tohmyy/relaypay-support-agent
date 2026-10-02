import type { KbResult } from '../retrieval/retrieve';
import type { ContactContext } from './chat-offer';
import type { AuthenticatedCustomer } from './identity';

export interface HistoryTurn {
  user: string;
  assistant: string;
}

export interface PromptParts {
  conversationId: string;
  userMessage: string;
  history: HistoryTurn[];
  knowledge: KbResult[];
  escalationRaised: boolean;
  /**
   * Which ways of reaching a person may be offered to this caller (an administrator's setting, and whether a live text chat
   * is possible for them), and for a text chat the customer's own account details. Absent means the normal callback procedure.
   */
  contact?: ContactContext;
  /**
   * The signed-in customer this conversation is linked to, read from the database (never from the caller). Absent while
   * the link has not landed yet.
   */
  authenticated?: AuthenticatedCustomer | null;
  /** The current time, so words like "tomorrow at 2 pm" can become an exact date. Omitted in tests that compare prompts. */
  now?: Date;
}

/** Stops user, document or history text from closing or forging a prompt block. */
export function escapeBlock(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatKnowledge(chunks: KbResult[]): string {
  if (chunks.length === 0) {
    return 'No relevant approved knowledge was found for this message.';
  }
  return chunks
    .map((c, i) => `[${i + 1}] ${escapeBlock(c.title)} (${c.category})\n${escapeBlock(c.content)}`)
    .join('\n\n');
}

export function formatHistory(history: HistoryTurn[]): string {
  if (history.length === 0) return 'This is the first message of the call.';
  return history
    .map((t) => `Customer: ${escapeBlock(t.user)}\nAssistant: ${escapeBlock(t.assistant)}`)
    .join('\n\n');
}

/** The verified identity block. The email is for escalation contact only; the assistant never reads it aloud. */
export function formatAuthenticated(c: AuthenticatedCustomer): string {
  const lines = [`customer_id: ${escapeBlock(c.customerId)}`];
  if (c.displayName) lines.push(`display_name: ${escapeBlock(c.displayName)}`);
  if (c.email) lines.push(`email: ${escapeBlock(c.email)}`);
  if (c.companyName) lines.push(`company_name: ${escapeBlock(c.companyName)}`);
  return `<authenticated_customer>\n${lines.join('\n')}\n</authenticated_customer>`;
}

export function buildPrompt(p: PromptParts): string {
  const blocks = [
    `<conversation_id>${escapeBlock(p.conversationId)}</conversation_id>`,
    `<retrieved_knowledge>\n${formatKnowledge(p.knowledge)}\n</retrieved_knowledge>`,
    `<conversation_history>\n${formatHistory(p.history)}\n</conversation_history>`,
  ];
  if (p.now) blocks.push(`<current_time>${p.now.toISOString()}</current_time>`);
  if (p.escalationRaised) {
    blocks.push(
      '<escalation_already_raised>A human handoff was already created on this call. Do not re-diagnose.</escalation_already_raised>',
    );
  }
  if (p.contact) {
    const yn = (v: boolean) => (v ? 'yes' : 'no');
    blocks.push(
      `<contact_methods text_chat="${yn(p.contact.textChat)}" callback="${yn(p.contact.callback)}" staff_online="${yn(p.contact.staffOnline)}">Ways of reaching a person for this caller. If escalation is required, follow "Contact methods".</contact_methods>`,
    );
  }
  if (p.authenticated) blocks.push(formatAuthenticated(p.authenticated));
  blocks.push(`<current_user_message>\n${escapeBlock(p.userMessage)}\n</current_user_message>`);
  return blocks.join('\n\n');
}

/** Retrieval query: the current message plus the previous customer message, so follow-ups still match. */
export function retrievalQuery(userMessage: string, history: HistoryTurn[]): string {
  const previous = history.at(-1)?.user;
  return previous ? `${userMessage} ${previous}` : userMessage;
}
