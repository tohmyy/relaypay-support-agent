import type { KbResult } from '../retrieval/retrieve';

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
  /** Mode B: after an escalation this customer continues by text with a specialist and the call ends. */
  humanHandoffAvailable?: boolean;
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

export function buildPrompt(p: PromptParts): string {
  const blocks = [
    `<conversation_id>${escapeBlock(p.conversationId)}</conversation_id>`,
    `<retrieved_knowledge>\n${formatKnowledge(p.knowledge)}\n</retrieved_knowledge>`,
    `<conversation_history>\n${formatHistory(p.history)}\n</conversation_history>`,
  ];
  if (p.escalationRaised) {
    blocks.push(
      '<escalation_already_raised>A human handoff was already created on this call. Do not re-diagnose.</escalation_already_raised>',
    );
  }
  if (p.humanHandoffAvailable) {
    blocks.push(
      '<human_handoff_available>This customer is signed in. After you create the escalation, tell them a support specialist will continue helping them by text in this same window, that this call is about to end, and that they do not need to do anything. Do not promise a time.</human_handoff_available>',
    );
  }
  blocks.push(`<current_user_message>\n${escapeBlock(p.userMessage)}\n</current_user_message>`);
  return blocks.join('\n\n');
}

/** Retrieval query: the current message plus the previous customer message, so follow-ups still match. */
export function retrievalQuery(userMessage: string, history: HistoryTurn[]): string {
  const previous = history.at(-1)?.user;
  return previous ? `${userMessage} ${previous}` : userMessage;
}
