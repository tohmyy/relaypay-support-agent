import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import {
  channelBadge,
  conversationOutcomeBadge,
  workStatusBadge,
  type Badge,
} from './badges';
import {
  issueLabel,
  sumCosts,
  type QueueConversationRow,
  type QueueCostRow,
  type QueueCustomerRow,
  type QueueTicketRow,
} from './staff';

/**
 * Pure parts of the staff archive and escalation inbox: the page cursor, the filters it becomes, and the rows built
 * from what one page of conversations (or escalations) needs. The reads themselves are in data.server.ts.
 */

export const ARCHIVE_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

export const clampPageSize = (limit: number | undefined, fallback = ARCHIVE_PAGE_SIZE) =>
  Number.isInteger(limit) && (limit as number) >= 1 ? Math.min(limit as number, MAX_PAGE_SIZE) : fallback;

/** Where a page starts: strictly after this (time, id) pair in newest-first order. */
export interface PageCursor {
  at: string;
  id: string;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
export const ESCALATION_ID_PATTERN = /^ESC-\d{6,}$/;

/** Opaque to the browser: a base64url of the last row's time and id. The time is kept as the database wrote it. */
export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify({ a: cursor.at, i: cursor.id }), 'utf8').toString('base64url');
}

/** The cursor, or null when it is missing, damaged or not for this list (the caller then starts at page 1). */
export function decodeCursor(raw: string | null | undefined, idPattern: RegExp): PageCursor | null {
  if (!raw || raw.length > 300) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { a?: unknown; i?: unknown };
    if (typeof parsed.a !== 'string' || typeof parsed.i !== 'string') return null;
    if (!TIMESTAMP.test(parsed.a) || !idPattern.test(parsed.i)) return null;
    return { at: parsed.a, id: parsed.i };
  } catch {
    return null;
  }
}

export const decodeConversationCursor = (raw: string | null | undefined) => decodeCursor(raw, CONVERSATION_ID_PATTERN);
export const decodeEscalationCursor = (raw: string | null | undefined) => decodeCursor(raw, ESCALATION_ID_PATTERN);

const enc = encodeURIComponent;

/** The inside of a PostgREST `or(...)`: rows strictly older than the cursor, ties on time broken by the id. */
export function olderThan(cursor: PageCursor, atColumn: string, idColumn: string): string {
  return `${atColumn}.lt.${enc(cursor.at)},and(${atColumn}.eq.${enc(cursor.at)},${idColumn}.lt.${enc(cursor.id)})`;
}

/** One `or(...)` clause per condition; several are combined with `and`, so a filter and a cursor can apply together. */
export function orClauses(clauses: string[]): string {
  if (clauses.length === 0) return '';
  if (clauses.length === 1) return `&or=(${clauses[0]})`;
  return `&and=(${clauses.map((c) => `or(${c})`).join(',')})`;
}

/** A page of rows and where the next page starts (null on the last page). */
export interface Page<T> {
  rows: T[];
  nextCursor: string | null;
  /** The cursor was unusable (damaged, or it pointed at rows that are gone), so this is page 1 instead. */
  restarted: boolean;
}

/** "TKT-000007". Accepts any case, and a bare number ("7", "000007"); anything else is not a ticket number. */
export function normalizeTicketId(input: string | null | undefined): string | null {
  const text = (input ?? '').trim().toUpperCase();
  const match = /^(?:TKT-?)?(\d{1,6})$/.exec(text);
  return match ? `TKT-${match[1].padStart(6, '0')}` : null;
}

export const ESCALATION_STATUSES = ['open', 'in_progress', 'closed'] as const;
export type EscalationStatusFilter = (typeof ESCALATION_STATUSES)[number];

export function parseEscalationStatus(value: string | string[] | undefined): EscalationStatusFilter | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return ESCALATION_STATUSES.find((s) => s === raw) ?? null;
}

export interface ArchiveEscalationRow {
  escalation_id: string;
  ticket_id: string | null;
  conversation_id: string | null;
  status: string | null;
}

export interface ArchiveRow {
  conversationId: string;
  startedAt: string;
  endedAt: string | null;
  channel: Badge;
  customer: string;
  outcome: Badge;
  /** The conversation's escalation, if it has one: open, in progress or closed. */
  escalation: Badge | null;
  ticket: string | null;
  assignee: string | null;
  /** Estimated model cost (USD); null when costs could not be read. */
  costUsd: number | null;
}

export interface ArchiveInput {
  conversations: QueueConversationRow[];
  tickets: QueueTicketRow[];
  escalations: ArchiveEscalationRow[];
  customers: QueueCustomerRow[];
  /** Display names of assigned staff, by id. */
  staff: Map<string, { name: string }>;
  costs?: QueueCostRow[];
}

/** The escalation a conversation shows: an unfinished one if there is one, otherwise the most recent. */
function pickEscalation(rows: ArchiveEscalationRow[]): ArchiveEscalationRow | undefined {
  return rows.find((e) => e.status !== 'closed') ?? rows[0];
}

/**
 * The rows of one page. Everything passed in was read for this page's conversations only, so building a row is a lookup,
 * never another query. `escalations` and `tickets` are expected newest first.
 */
export function buildArchiveRows(input: ArchiveInput): ArchiveRow[] {
  const customers = new Map(input.customers.map((c) => [c.customer_id, c]));
  const costs = input.costs ? sumCosts(input.costs) : null;
  const tickets = new Map<string, QueueTicketRow>();
  for (const t of input.tickets) if (t.conversation_id && !tickets.has(t.conversation_id)) tickets.set(t.conversation_id, t);
  const escalations = new Map<string, ArchiveEscalationRow[]>();
  for (const e of input.escalations) {
    if (!e.conversation_id) continue;
    escalations.set(e.conversation_id, [...(escalations.get(e.conversation_id) ?? []), e]);
  }

  return input.conversations.map((c): ArchiveRow => {
    const escalation = pickEscalation(escalations.get(c.conversation_id) ?? []);
    const customer = c.customer_id ? customers.get(c.customer_id) : undefined;
    return {
      conversationId: c.conversation_id,
      startedAt: c.started_at ?? '',
      endedAt: c.ended_at,
      channel: channelBadge(c.channel),
      customer: customer?.company_name ?? c.customer_id ?? 'Unknown caller',
      outcome: conversationOutcomeBadge(c, 'staff'),
      escalation: escalation ? workStatusBadge(escalation.status) : null,
      // The escalation's ticket is the one staff work on; otherwise the conversation's latest ticket.
      ticket: escalation?.ticket_id ?? tickets.get(c.conversation_id)?.ticket_id ?? null,
      assignee: c.assigned_staff_id ? (input.staff.get(c.assigned_staff_id)?.name ?? null) : null,
      costUsd: costs ? (costs.get(c.conversation_id) ?? 0) : null,
    };
  });
}

/** The inbox list's escalation row as read from the database. */
export interface EscalationRecord {
  escalation_id: string;
  ticket_id: string;
  conversation_id: string;
  customer_id: string | null;
  status: string | null;
  category: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string | null;
}

/** What a page of escalations needs from the conversation behind each one (and who may open it). */
export interface EscalationConversationRow {
  conversation_id: string;
  customer_id: string | null;
  ended_at: string | null;
  final_status: string | null;
  support_mode: string | null;
  assigned_staff_id: string | null;
}

export interface EscalationRow {
  escalationId: string;
  ticketId: string;
  conversationId: string;
  status: Badge;
  /** The ticket's own status when it differs from the escalation's (they are meant to move together). */
  ticketStatus: Badge | null;
  customer: string;
  topic: string;
  reasonPreview: string | null;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  /** The conversation row, so the page can tell whether this viewer may open it. */
  conversation: EscalationConversationRow | null;
}

export const REASON_PREVIEW_LENGTH = 120;

export function preview(text: string | null | undefined, max = REASON_PREVIEW_LENGTH): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function buildEscalationRows(input: {
  escalations: EscalationRecord[];
  tickets: QueueTicketRow[];
  conversations: EscalationConversationRow[];
  customers: QueueCustomerRow[];
  staff: Map<string, { name: string }>;
}): EscalationRow[] {
  const tickets = new Map(input.tickets.map((t) => [t.ticket_id ?? '', t]));
  const conversations = new Map(input.conversations.map((c) => [c.conversation_id, c]));
  const customers = new Map(input.customers.map((c) => [c.customer_id, c]));
  return input.escalations.map((e): EscalationRow => {
    const ticket = tickets.get(e.ticket_id);
    const conversation = conversations.get(e.conversation_id) ?? null;
    const customerId = e.customer_id ?? conversation?.customer_id ?? null;
    const customer = customerId ? customers.get(customerId) : undefined;
    return {
      escalationId: e.escalation_id,
      ticketId: e.ticket_id,
      conversationId: e.conversation_id,
      status: workStatusBadge(e.status),
      ticketStatus: ticket && ticket.status !== e.status ? workStatusBadge(ticket.status) : null,
      customer: customer?.company_name ?? customerId ?? 'Unknown caller',
      topic: issueLabel(ticket?.category ?? e.category),
      reasonPreview: preview(e.reason),
      assignee: conversation?.assigned_staff_id ? (input.staff.get(conversation.assigned_staff_id)?.name ?? null) : null,
      createdAt: e.created_at,
      updatedAt: e.updated_at ?? e.created_at,
      conversation,
    };
  });
}
