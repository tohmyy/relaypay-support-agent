import 'server-only';
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
  QUEUE_CONVERSATION_COLUMNS,
  type QueueConversationRow,
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

export async function getCustomerConversations(customerId: string, limit = 20): Promise<ConversationRow[]> {
  return restSelect<ConversationRow>(
    'conversations',
    `select=${CONVERSATION_COLUMNS}&customer_id=${eq(customerId)}&order=started_at.desc&limit=${limit}`,
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
}

export async function getConversation(conversationId: string): Promise<AccessRow | null> {
  const [row] = await restSelect<AccessRow>(
    'conversations',
    `select=${QUEUE_CONVERSATION_COLUMNS}&conversation_id=${eq(conversationId)}&limit=1`,
  );
  return row ?? null;
}

export interface TranscriptTurn {
  turn_number: number | null;
  user_transcript: string | null;
  assistant_response: string | null;
}

export async function getTranscript(conversationId: string): Promise<TranscriptTurn[]> {
  return restSelect<TranscriptTurn>(
    'conversation_turns',
    `select=turn_number,user_transcript,assistant_response&conversation_id=${eq(conversationId)}&order=turn_number.asc&limit=200`,
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

export async function getStaffQueueRows(): Promise<{
  conversations: QueueConversationRow[];
  tickets: QueueTicketRow[];
  customers: QueueCustomerRow[];
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
  return { conversations, tickets, customers };
}

export async function getStaffCustomer(customerId: string): Promise<(CustomerProfile & { customer_id: string }) | null> {
  const [row] = await restSelect<CustomerProfile & { customer_id: string }>(
    'customers',
    `select=customer_id,company_name,contact_name,contact_email,plan&customer_id=${eq(customerId)}&limit=1`,
  );
  return row ?? null;
}
