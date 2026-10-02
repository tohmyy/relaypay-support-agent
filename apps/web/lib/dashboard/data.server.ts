import 'server-only';
import type { Role } from '@/lib/auth/token';
import { onlineCutoff } from '@/lib/human/presence';
import { restSelect } from '@/lib/supabase.server';
import {
  ARCHIVE_PAGE_SIZE,
  buildArchiveRows,
  buildEscalationRows,
  clampPageSize,
  decodeConversationCursor,
  decodeEscalationCursor,
  encodeCursor,
  olderThan,
  orClauses,
  type ArchiveEscalationRow,
  type ArchiveRow,
  type EscalationConversationRow,
  type EscalationRecord,
  type EscalationRow,
  type EscalationStatusFilter,
  type Page,
  type PageCursor,
} from './archive';
import {
  CONVERSATION_COLUMNS,
  PAYOUT_COLUMNS,
  TRANSACTION_COLUMNS,
  type ConversationRow,
  type PayoutRow,
  type TransactionRow,
} from './customer';
import {
  parseCursor,
  toMessages,
  type HumanMessage,
  type MessageAuthor,
  type MessageRow,
} from '@/lib/human/messages';
import {
  ARCHIVE_CONVERSATION_COLUMNS,
  QUEUE_CONVERSATION_COLUMNS,
  startOfUtcDay,
  sumCosts,
  type QueueConversationRow,
  type QueueCostRow,
  type QueueCustomerRow,
  type QueueTicketRow,
} from './staff';

/**
 * Database reads for the signed-in pages. Every column is named; nothing here uses `select=*`, so an internal column
 * added to a table later cannot reach a page by accident. Callers have already checked who the user is; the customer
 * id always comes from the verified session, never from the URL.
 */
const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
/** `in.("a","b")`: quoted, so an id with an unusual character cannot break the filter. */
const inList = (ids: string[]) => `in.(${ids.map((id) => encodeURIComponent(`"${id}"`)).join(',')})`;
const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];

export async function getCustomerTransactions(customerId: string): Promise<TransactionRow[]> {
  return restSelect<TransactionRow>(
    'transactions',
    `select=${TRANSACTION_COLUMNS}&customer_id=${eq(customerId)}&order=created_at.desc&limit=100`,
  );
}

export async function getCustomerPayouts(customerId: string): Promise<PayoutRow[]> {
  return restSelect<PayoutRow>('payouts', `select=${PAYOUT_COLUMNS}&customer_id=${eq(customerId)}&order=scheduled_for.desc&limit=100`);
}

export async function getCustomerConversations(customerId: string, limit = 20, offset = 0): Promise<ConversationRow[]> {
  return restSelect<ConversationRow>(
    'conversations',
    `select=${CONVERSATION_COLUMNS}&customer_id=${eq(customerId)}&order=started_at.desc&limit=${limit}` +
      (offset > 0 ? `&offset=${offset}` : ''),
  );
}

export interface CustomerProfile {
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  plan: string | null;
}

export async function getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
  const [row] = await restSelect<CustomerProfile>(
    'customers',
    `select=company_name,contact_name,contact_email,plan&customer_id=${eq(customerId)}&limit=1`,
  );
  return row ?? null;
}

export interface AccessRow {
  conversation_id: string;
  customer_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  final_status: string | null;
  end_reason: string | null;
  support_mode: string | null;
  assigned_staff_id: string | null;
  staff_typing_at: string | null;
  customer_typing_at: string | null;
  customer_last_read_at: string | null;
  staff_last_read_at: string | null;
  handoff_at: string | null;
  last_customer_message_at: string | null;
}

export async function getConversation(conversationId: string): Promise<AccessRow | null> {
  const [row] = await restSelect<AccessRow>(
    'conversations',
    `select=${QUEUE_CONVERSATION_COLUMNS},staff_typing_at,customer_typing_at,customer_last_read_at&conversation_id=${eq(conversationId)}&limit=1`,
  );
  return row ?? null;
}

/** The customer's open conversation with a specialist, if there is one (so the chat survives a reload). */
export async function getOpenHumanConversation(customerId: string): Promise<{ conversation_id: string } | null> {
  const [row] = await restSelect<{ conversation_id: string }>(
    'conversations',
    `select=conversation_id&customer_id=${eq(customerId)}&support_mode=eq.human&ended_at=is.null&order=started_at.desc&limit=1`,
  );
  return row ?? null;
}

export interface StaffProfile extends MessageAuthor {
  id: string;
}

/** Name, title and picture only: the parts of a staff account a customer is allowed to see. */
export async function getStaffProfiles(ids: string[]): Promise<Map<string, MessageAuthor>> {
  const wanted = [...new Set(ids.filter(Boolean))].slice(0, 50);
  const out = new Map<string, MessageAuthor>();
  if (wanted.length === 0) return out;
  const rows = await restSelect<{ id: string; display_name: string; title: string | null; avatar_url: string | null }>(
    'app_users',
    `select=id,display_name,title,avatar_url&id=in.(${wanted.map(encodeURIComponent).join(',')})`,
  );
  for (const r of rows) out.set(r.id, { name: r.display_name, title: r.title, avatarUrl: r.avatar_url });
  return out;
}

/** Messages of the text chat at or after the cursor, oldest first. */
export async function getHumanMessages(conversationId: string, after?: string | null): Promise<HumanMessage[]> {
  const since = parseCursor(after);
  const rows = await restSelect<MessageRow>(
    'conversation_turns',
    `select=id,sender,body,staff_user_id,created_at,client_msg_id&conversation_id=${eq(conversationId)}&sender=not.is.null` +
      `${since ? `&created_at=gte.${encodeURIComponent(since)}` : ''}&order=created_at.asc&limit=200`,
  );
  const authors = await getStaffProfiles(rows.map((r) => r.staff_user_id ?? ''));
  return toMessages(rows, authors);
}

export interface TranscriptTurn {
  turn_number: number | null;
  user_transcript: string | null;
  /** The assistant's reply for display: the canonical `display_text` when stored, else the legacy spoken text. */
  assistant_response: string | null;
  /** Stable id of the turn (`conversation_turns.turn_uid`), the key a durable bubble reconciles on. */
  turn_uid?: string | null;
  spoken_text?: string | null;
  /** Set on messages from people and the system after a handoff; null on the voice-era pairs. */
  sender?: string | null;
  body?: string | null;
  staff_user_id?: string | null;
  created_at?: string | null;
}

export async function getTranscript(conversationId: string): Promise<TranscriptTurn[]> {
  const rows = await restSelect<TranscriptTurn & { display_text?: string | null }>(
    'conversation_turns',
    `select=turn_uid,turn_number,user_transcript,assistant_response,display_text,spoken_text,sender,body,staff_user_id,created_at&conversation_id=${eq(conversationId)}&order=created_at.asc&limit=300`,
  );
  // Canonical display text keeps reference numbers exact; rows from before it was stored fall back to the spoken text.
  return rows.map(({ display_text, ...turn }) => ({
    ...turn,
    assistant_response: display_text?.trim() ? display_text : turn.assistant_response,
  }));
}

export interface IncrementalTranscriptTurn {
  id: string;
  role: 'user' | 'assistant';
  displayText: string;
  spokenText?: string | null;
  createdAt: string;
}

const decodeTranscriptCursor = (cursor?: string | null): { at: string; id: string } | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { at?: unknown; id?: unknown };
    return typeof value.at === 'string' && typeof value.id === 'string' ? { at: value.at, id: value.id } : null;
  } catch {
    return null;
  }
};

/**
 * Incremental AI-era transcript for live reconciliation. A persisted pair becomes two stable display turns; human-chat
 * rows are omitted because they already use the specialist message APIs.
 */
export async function getTranscriptAfter(
  conversationId: string,
  cursor?: string | null,
): Promise<{ turns: IncrementalTranscriptTurn[]; cursor: string | null }> {
  const after = decodeTranscriptCursor(cursor);
  const rows = await restSelect<TranscriptTurn & { display_text?: string | null }>(
    'conversation_turns',
    `select=turn_uid,turn_number,user_transcript,assistant_response,display_text,spoken_text,sender,body,created_at` +
      `&conversation_id=${eq(conversationId)}&sender=is.null` +
      `${after ? `&created_at=gte.${encodeURIComponent(after.at)}` : ''}&order=created_at.asc,turn_uid.asc&limit=100`,
  );
  const filtered = after
    ? rows.filter((row) => {
        const at = row.created_at ?? '';
        const id = row.turn_uid ?? '';
        return at > after.at || (at === after.at && id > after.id);
      })
    : rows;
  const turns: IncrementalTranscriptTurn[] = [];
  for (const row of filtered) {
    const uid = row.turn_uid;
    const at = row.created_at;
    if (!uid || !at) continue;
    const userText = row.user_transcript?.trim();
    const display = row.display_text?.trim() || row.assistant_response?.trim();
    if (userText) turns.push({ id: `${uid}:user`, role: 'user', displayText: userText, createdAt: at });
    if (display) {
      turns.push({
        id: `${uid}:assistant`,
        role: 'assistant',
        displayText: display,
        spokenText: row.spoken_text,
        createdAt: at,
      });
    }
  }
  const last = filtered.at(-1);
  return {
    turns,
    cursor:
      last?.turn_uid && last.created_at
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.turn_uid })).toString('base64url')
        : cursor ?? null,
  };
}

/**
 * The ticket staff work on for this conversation: the one the escalation points at when `ticketId` is given, otherwise
 * the conversation's latest.
 */
export async function getConversationTicket(conversationId: string, ticketId?: string | null): Promise<QueueTicketRow | null> {
  const [row] = await restSelect<QueueTicketRow>(
    'support_tickets',
    `select=ticket_id,conversation_id,category,priority,status,summary,created_at&conversation_id=${eq(conversationId)}` +
      `${ticketId ? `&ticket_id=${eq(ticketId)}` : ''}&order=created_at.desc&limit=1`,
  );
  return row ?? null;
}

export interface EscalationDetail {
  escalation_id: string | null;
  ticket_id?: string | null;
  category: string | null;
  reason: string | null;
  preferred_time: string | null;
  user_name: string | null;
  user_email: string | null;
  status: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Staff only: the escalation of a conversation and the callback details the customer gave. Found by the conversation,
 * which every escalation has, never through the ticket link. An unfinished escalation wins over a closed one. Never
 * selected for customer pages.
 */
export async function getConversationEscalation(conversationId: string): Promise<EscalationDetail | null> {
  const rows = await restSelect<EscalationDetail>(
    'escalations',
    `select=escalation_id,ticket_id,category,reason,preferred_time,user_name,user_email,status,created_at,updated_at&conversation_id=${eq(conversationId)}&order=created_at.desc&limit=5`,
  );
  return rows.find((r) => r.status !== 'closed') ?? rows[0] ?? null;
}

/** The conversation behind a ticket number (for the inbox's ticket links), or null when there is no such escalation. */
export async function getEscalationByTicket(
  ticketId: string,
): Promise<{ escalation_id: string; ticket_id: string; conversation_id: string; status: string | null } | null> {
  const [row] = await restSelect<{ escalation_id: string; ticket_id: string; conversation_id: string; status: string | null }>(
    'escalations',
    `select=escalation_id,ticket_id,conversation_id,status&ticket_id=${eq(ticketId)}&order=created_at.desc&limit=1`,
  );
  return row ?? null;
}

/** Staff detail extras: the channel and the assistant's stored summary (null until one is written). */
export async function getConversationExtras(conversationId: string): Promise<{ channel: string | null; summary: string | null } | null> {
  const [row] = await restSelect<{ channel: string | null; summary: string | null }>(
    'conversations',
    `select=channel,summary&conversation_id=${eq(conversationId)}&limit=1`,
  );
  return row ?? null;
}

/** Turn costs are read a few conversations at a time so a single request never runs into the row limit. */
const COST_CHUNK = 25;

/** The recorded model cost of every turn of these conversations (staff only). */
export async function getCostRows(conversationIds: string[]): Promise<QueueCostRow[]> {
  const ids = [...new Set(conversationIds)].filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += COST_CHUNK) chunks.push(ids.slice(i, i + COST_CHUNK));
  const rows = await Promise.all(
    chunks.map((chunk) =>
      restSelect<QueueCostRow>(
        'conversation_turns',
        `select=conversation_id,cost_usd&cost_usd=not.is.null&conversation_id=in.(${chunk
          .map((id) => encodeURIComponent(`"${id}"`))
          .join(',')})&limit=1000`,
      ),
    ),
  );
  return rows.flat();
}

/** Estimated model cost of one conversation (USD), for the staff detail page. */
export async function getConversationCost(conversationId: string): Promise<number> {
  return sumCosts(await getCostRows([conversationId])).get(conversationId) ?? 0;
}

/**
 * The estimated model cost of every conversation that started in the current UTC calendar day (staff only): the sum of
 * each one's turn costs. Model usage only; the voice provider's own call cost is not included and this is not a bill.
 */
export async function getTodayCostTotal(now: Date = new Date()): Promise<number> {
  const since = startOfUtcDay(now).toISOString();
  const today = await restSelect<{ conversation_id: string }>(
    'conversations',
    `select=conversation_id&started_at=gte.${encodeURIComponent(since)}&order=started_at.desc&limit=500`,
  );
  const costs = sumCosts(await getCostRows(today.map((c) => c.conversation_id)));
  return [...costs.values()].reduce((a, b) => a + b, 0);
}

export interface FeedbackRow {
  stage: 'ai' | 'human';
  rating: number;
  comment: string | null;
  created_at: string;
}

/** Staff only: the ratings and comments a customer left for this conversation. */
export async function getConversationFeedback(conversationId: string): Promise<FeedbackRow[]> {
  return restSelect<FeedbackRow>(
    'conversation_feedback',
    `select=stage,rating,comment,created_at&conversation_id=${eq(conversationId)}&order=created_at.asc&limit=2`,
  );
}

export async function getStaffQueueRows(): Promise<{
  conversations: QueueConversationRow[];
  tickets: QueueTicketRow[];
  customers: QueueCustomerRow[];
  costs?: QueueCostRow[];
  todayCostUsd?: number | null;
}> {
  const [conversations, tickets, customers] = await Promise.all([
    restSelect<QueueConversationRow>(
      'conversations',
      `select=${QUEUE_CONVERSATION_COLUMNS}&order=started_at.desc&limit=100`,
    ),
    restSelect<QueueTicketRow>(
      'support_tickets',
      'select=ticket_id,conversation_id,category,priority,status&order=created_at.desc&limit=200',
    ),
    restSelect<QueueCustomerRow>('customers', 'select=customer_id,company_name,contact_name&limit=200'),
  ]);
  // Costs are extra information: if they cannot be read the queue still works and shows the cost as unavailable.
  const [costs, todayCostUsd] = await Promise.all([
    getCostRows(conversations.map((c) => c.conversation_id)).catch(() => undefined),
    getTodayCostTotal().catch(() => null),
  ]);
  return { conversations, tickets, customers, costs, todayCostUsd };
}

/**
 * One page of a newest-first list. `read` returns up to `take` rows after the cursor; one extra row says whether another
 * page follows, so nobody pages into an empty screen. A cursor that cannot be used (damaged, or pointing at rows that no
 * longer exist) starts again at page 1 instead of failing.
 */
async function readKeyset<T>(opts: {
  cursor: string | null | undefined;
  decode: (raw: string | null | undefined) => PageCursor | null;
  limit: number;
  read: (after: PageCursor | null, take: number) => Promise<T[]>;
  cursorOf: (row: T) => PageCursor;
}): Promise<{ rows: T[]; nextCursor: string | null; restarted: boolean }> {
  const parsed = opts.decode(opts.cursor);
  let restarted = Boolean(opts.cursor) && !parsed;
  let rows = await opts.read(parsed, opts.limit + 1);
  if (parsed && rows.length === 0) {
    rows = await opts.read(null, opts.limit + 1);
    restarted = true;
  }
  const more = rows.length > opts.limit;
  const pageRows = rows.slice(0, opts.limit);
  const last = pageRows[pageRows.length - 1];
  return { rows: pageRows, nextCursor: more && last ? encodeCursor(opts.cursorOf(last)) : null, restarted };
}

/** Conversations an agent may open (see canAccessConversation); admins see all, so they add no condition. */
const AGENT_VISIBLE = 'ended_at.is.null,final_status.eq.escalated,support_mode.eq.human';

/**
 * The staff conversation archive, newest first, ordered by (started_at, conversation_id) so rows that share a start time
 * still have one fixed order and no page repeats or skips a row. Tickets, escalations, customers, assignees and costs are
 * read only for the ids on this page.
 */
export async function getStaffConversationsPage(
  opts: { cursor?: string | null; limit?: number; role?: Role } = {},
): Promise<Page<ArchiveRow>> {
  const limit = clampPageSize(opts.limit, ARCHIVE_PAGE_SIZE);
  const page = await readKeyset<QueueConversationRow>({
    cursor: opts.cursor,
    decode: decodeConversationCursor,
    limit,
    cursorOf: (c) => ({ at: c.started_at ?? '', id: c.conversation_id }),
    read: (after, take) =>
      restSelect<QueueConversationRow>(
        'conversations',
        `select=${ARCHIVE_CONVERSATION_COLUMNS}&order=started_at.desc,conversation_id.desc&limit=${take}` +
          orClauses([
            ...(after ? [olderThan(after, 'started_at', 'conversation_id')] : []),
            ...(opts.role === 'support_admin' ? [] : [AGENT_VISIBLE]),
          ]),
      ),
  });
  if (page.rows.length === 0) return { rows: [], nextCursor: null, restarted: page.restarted };

  const ids = unique(page.rows.map((c) => c.conversation_id));
  const customerIds = unique(page.rows.map((c) => c.customer_id));
  const [tickets, escalations, customers, staff, costs] = await Promise.all([
    restSelect<QueueTicketRow>(
      'support_tickets',
      `select=ticket_id,conversation_id,category,priority,status&conversation_id=${inList(ids)}&order=created_at.desc&limit=500`,
    ),
    restSelect<ArchiveEscalationRow>(
      'escalations',
      `select=escalation_id,ticket_id,conversation_id,status&conversation_id=${inList(ids)}&order=created_at.desc&limit=500`,
    ),
    customerIds.length
      ? restSelect<QueueCustomerRow>('customers', `select=customer_id,company_name,contact_name&customer_id=${inList(customerIds)}`)
      : Promise.resolve([] as QueueCustomerRow[]),
    getStaffProfiles(unique(page.rows.map((c) => c.assigned_staff_id))),
    // Costs are extra information: without them the rows say "not available" and the page still works.
    getCostRows(ids).catch(() => undefined),
  ]);
  const names = new Map([...staff].map(([id, a]) => [id, { name: a.name }]));
  return {
    rows: buildArchiveRows({ conversations: page.rows, tickets, escalations, customers, staff: names, costs }),
    nextCursor: page.nextCursor,
    restarted: page.restarted,
  };
}

/**
 * The escalation inbox, newest first, ordered by (created_at, escalation_id). `status` and `ticket` narrow it; both come
 * from the page's validated query, never raw input. Tickets, conversations, customers and assignees are read for this
 * page's rows only.
 */
export async function getEscalationsPage(
  opts: { status?: EscalationStatusFilter | null; ticket?: string | null; cursor?: string | null; limit?: number } = {},
): Promise<Page<EscalationRow>> {
  const limit = clampPageSize(opts.limit, ARCHIVE_PAGE_SIZE);
  const filters =
    (opts.status ? `&status=${eq(opts.status)}` : '') + (opts.ticket ? `&ticket_id=${eq(opts.ticket)}` : '');
  const page = await readKeyset<EscalationRecord>({
    cursor: opts.cursor,
    decode: decodeEscalationCursor,
    limit,
    cursorOf: (e) => ({ at: e.created_at, id: e.escalation_id }),
    read: (after, take) =>
      restSelect<EscalationRecord>(
        'escalations',
        'select=escalation_id,ticket_id,conversation_id,customer_id,status,category,reason,created_at,updated_at' +
          `${filters}&order=created_at.desc,escalation_id.desc&limit=${take}` +
          orClauses(after ? [olderThan(after, 'created_at', 'escalation_id')] : []),
      ),
  });
  if (page.rows.length === 0) return { rows: [], nextCursor: null, restarted: page.restarted };

  const ticketIds = unique(page.rows.map((e) => e.ticket_id));
  const conversationIds = unique(page.rows.map((e) => e.conversation_id));
  const conversations = await restSelect<EscalationConversationRow>(
    'conversations',
    `select=conversation_id,customer_id,ended_at,final_status,support_mode,assigned_staff_id&conversation_id=${inList(conversationIds)}`,
  );
  const customerIds = unique([...page.rows.map((e) => e.customer_id), ...conversations.map((c) => c.customer_id)]);
  const [tickets, customers, staff] = await Promise.all([
    restSelect<QueueTicketRow>(
      'support_tickets',
      `select=ticket_id,conversation_id,category,priority,status&ticket_id=${inList(ticketIds)}`,
    ),
    customerIds.length
      ? restSelect<QueueCustomerRow>('customers', `select=customer_id,company_name,contact_name&customer_id=${inList(customerIds)}`)
      : Promise.resolve([] as QueueCustomerRow[]),
    getStaffProfiles(unique(conversations.map((c) => c.assigned_staff_id))),
  ]);
  const names = new Map([...staff].map(([id, a]) => [id, { name: a.name }]));
  return {
    rows: buildEscalationRows({ escalations: page.rows, tickets, conversations, customers, staff: names }),
    nextCursor: page.nextCursor,
    restarted: page.restarted,
  };
}

export async function getStaffCustomer(customerId: string): Promise<(CustomerProfile & { customer_id: string }) | null> {
  const [row] = await restSelect<CustomerProfile & { customer_id: string }>(
    'customers',
    `select=customer_id,company_name,contact_name,contact_email,plan&customer_id=${eq(customerId)}&limit=1`,
  );
  return row ?? null;
}

/** Whether any member of staff is online right now (available, and seen within the last 90 seconds). */
export async function isAnyStaffOnline(): Promise<boolean> {
  const rows = await restSelect<{ id: string }>(
    'app_users',
    `select=id&role=in.(support_agent,support_admin)&available=eq.true&disabled=eq.false` +
      `&last_seen_at=gte.${encodeURIComponent(onlineCutoff())}&limit=1`,
  );
  return rows.length > 0;
}
