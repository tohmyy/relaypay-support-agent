import { preview } from './archive';

/**
 * The summary a member of staff reads before taking a conversation. `conversations.summary` is used when it exists.
 * Otherwise a fallback is built from the ticket, the escalation reason and the assistant's last two replies, and it is
 * labelled as generated so nobody mistakes it for the assistant's own summary. Deterministic: the same inputs always
 * give the same text.
 */
export type SummarySource = 'stored' | 'generated';

export interface ConversationSummaryText {
  source: SummarySource;
  text: string;
}

export interface SummaryInput {
  /** `conversations.summary` */
  stored?: string | null;
  ticketSummary?: string | null;
  escalationReason?: string | null;
  /** The transcript, oldest first. Only the assistant's replies from the voice-era turns are used. */
  turns?: { sender?: string | null; assistant_response?: string | null }[];
}

const PART_LENGTH = 280;
const REPLIES_USED = 2;

export function buildConversationSummary(input: SummaryInput): ConversationSummaryText | null {
  const stored = (input.stored ?? '').trim();
  if (stored) return { source: 'stored', text: stored };

  const lines: string[] = [];
  const ticket = preview(input.ticketSummary, PART_LENGTH);
  if (ticket) lines.push(`Ticket: ${ticket}`);
  const reason = preview(input.escalationReason, PART_LENGTH);
  if (reason) lines.push(`Reason for escalation: ${reason}`);
  const replies = (input.turns ?? [])
    .filter((t) => !t.sender)
    .map((t) => preview(t.assistant_response, PART_LENGTH))
    .filter((r): r is string => Boolean(r))
    .slice(-REPLIES_USED);
  if (replies.length) lines.push(`Latest assistant replies: ${replies.join(' / ')}`);
  return lines.length ? { source: 'generated', text: lines.join('\n') } : null;
}
