import 'server-only';
import { onlineCutoff } from '@/lib/human/presence';
import { restSelect } from '@/lib/supabase.server';
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
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 20);
  const out = new Map<string, MessageAuthor>();
  if (unique.length === 0) return out;
  const rows = await restSelect<{ id: string; display_name: string; title: string | null; avatar_url: string | null }>(
    'app_users',
    `select=id,display_name,title,avatar_url&id=in.(${unique.map(encodeURIComponent).join(',')})`,
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
  assistant_response: string | null;
  /** Set on messages from people and the system after a handoff; null on the voice-era pairs. */
  sender?: string | null;
  body?: string | null;
  staff_user_id?: string | null;
  created_at?: string | null;
}

export async function getTranscript(conversationId: string): Promise<TranscriptTurn[]> {
  return restSelect<TranscriptTurn>(
    'conversation_turns',
    `select=turn_number,user_transcript,assistant_response,sender,body,staff_user_id,created_at&conversation_id=${eq(conversationId)}&order=created_at.asc&limit=300`,
  );
}

export async function getConversationTicket(conversationId: string): Promise<QueueTicketRow | null> {
  const [row] = await restSelect<QueueTicketRow>(
    'support_tickets',
    `select=ticket_id,conversation_id,category,priority,status&conversation_id=${eq(conversationId)}&order=created_at.desc&limit=1`,
  );
  return row ?? null;
}

export interface EscalationDetail {
  escalation_id: string | null;
  category: string | null;
  reason: string | null;
  preferred_time: string | null;
  user_name: string | null;
  user_email: string | null;
  status: string | null;
}

/** Staff only: the callback details a customer gave. Never selected for customer pages. */
export async function getConversationEscalation(ticketId: string): Promise<EscalationDetail | null> {
  const [row] = await restSelect<EscalationDetail>(
    'escalations',
    `select=escalation_id,category,reason,preferred_time,user_name,user_email,status&ticket_id=${eq(ticketId)}&order=created_at.desc&limit=1`,
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
