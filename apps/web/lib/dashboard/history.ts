import { conversationOutcomeBadge, type Badge } from './badges';
import type { ConversationRow } from './customer';
import { conversationOutcome } from './customer';
import { formatDate } from './format';

export const HISTORY_PAGE_SIZE = 10;

/** `?page=` as a whole number of at least 1; anything else is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export interface HistoryLine {
  id: string;
  started: string;
  outcome: string;
  badge: Badge;
}

export interface HistoryPage {
  page: number;
  lines: HistoryLine[];
  hasNewer: boolean;
  hasOlder: boolean;
}

/**
 * One page of the customer's conversations, newest first. The caller reads one row more than a page, so "older" is
 * known without counting every conversation.
 */
export function buildHistoryPage(rows: ConversationRow[], page: number, pageSize: number = HISTORY_PAGE_SIZE): HistoryPage {
  return {
    page,
    lines: rows.slice(0, pageSize).map((c) => ({
      id: c.conversation_id,
      started: formatDate(c.started_at),
      outcome: conversationOutcome(c),
      badge: conversationOutcomeBadge(c, 'customer'),
    })),
    hasNewer: page > 1,
    hasOlder: rows.length > pageSize,
  };
}
