import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerRow {
  customer_id: string;
  company_name: string;
  plan: string | null;
  account_status: string | null;
  kyc_status: string | null;
  support_notes: string | null;
}
export interface TransactionRow {
  transaction_id: string;
  customer_id: string;
  transaction_type: string | null;
  status: string | null;
  amount: number | string | null;
  currency: string | null;
  estimated_arrival: string | null;
  support_summary: string | null;
}
export interface PayoutRow {
  payout_id: string;
  transaction_id: string | null;
  customer_id: string;
  status: string | null;
  scheduled_for: string | null;
  failure_reason: string | null;
}
export interface ToolCallRecord {
  conversation_id?: string | null;
  tool_name: string;
  purpose?: string;
  duration_ms?: number;
  input_summary: string;
  result_summary: string;
  status: 'success' | 'failed' | 'not_found';
  error?: string | null;
}

export interface TicketRecord {
  ticket_id: string;
  status: string;
  /** False when an existing ticket was returned. */
  created: boolean;
}
export interface TicketEscalation {
  ticket_id: string;
  escalation_id: string;
  /** False when the conversation already had an open escalation and its pair was returned. */
  created: boolean;
}

/** Who a conversation belongs to: set by the web app's link, read back here so tools can be scoped to that customer. */
export interface ConversationIdentity {
  customer_id: string | null;
  user_id: string | null;
}
export interface AppUserRow {
  display_name: string;
  email: string;
}

/** Every database operation the tools need. Tools depend on this, so tests can fake it. */
export interface Store {
  /** Returns null when nothing matches, or when more than one record matches (ambiguous). */
  findCustomer(q: {
    customer_id?: string;
    email?: string;
    company_name?: string;
  }): Promise<CustomerRow | null>;
  /** The signed-in customer a conversation was linked to; null when the conversation does not exist. */
  getConversationIdentity(conversationId: string): Promise<ConversationIdentity | null>;
  /** Name and email of a signed-in account (app_users). */
  getAppUser(userId: string): Promise<AppUserRow | null>;
  /** With `customerId` the customer predicate is part of the query: another customer's record is simply not found. */
  getTransaction(transactionId: string, customerId?: string): Promise<TransactionRow | null>;
  findPayout(
    q: { payout_id?: string; transaction_id?: string },
    customerId?: string,
  ): Promise<PayoutRow | null>;
  customerExists(customerId: string): Promise<boolean>;
  ensureConversation(conversationId: string): Promise<void>;
  /** Logs a ticket once per conversation and summary: a repeat returns the existing ticket. */
  insertTicket(t: {
    customer_id: string;
    category: string;
    priority: string;
    summary: string;
    conversation_id: string;
  }): Promise<TicketRecord>;
  /**
   * Creates the ticket and the escalation in one transaction, or returns the pair already open for the conversation
   * (a ticket logged earlier in the conversation becomes the escalation's ticket).
   */
  createTicketAndEscalation(e: {
    conversation_id: string;
    customer_id: string;
    ticket_category: string;
    ticket_priority: string;
    ticket_summary: string;
    category: string;
    reason: string;
    user_name: string;
    user_email: string;
    preferred_time?: string;
    /** The callback instant (UTC ISO) and the customer's IANA timezone. */
    preferred_at?: string;
    preferred_timezone?: string;
    contact_preference?: 'text_chat' | 'callback';
  }): Promise<TicketEscalation>;
  insertEvent(e: {
    conversation_id: string;
    event_type: string;
    summary: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  recordToolCall(r: ToolCallRecord): Promise<void>;
}

/** Escapes LIKE wildcards so ilike behaves as a case-insensitive exact match. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function createStore(db: SupabaseClient): Store {
  return {
    async findCustomer(q) {
      let query = db
        .from('customers')
        .select('customer_id, company_name, plan, account_status, kyc_status, support_notes');
      if (q.customer_id) query = query.eq('customer_id', q.customer_id);
      if (q.email) query = query.ilike('contact_email', escapeLike(q.email));
      if (q.company_name) query = query.ilike('company_name', escapeLike(q.company_name));
      const rows = check(await query.limit(2)) as CustomerRow[];
      return rows.length === 1 ? rows[0] : null;
    },
    async getConversationIdentity(conversationId) {
      const rows = check(
        await db
          .from('conversations')
          .select('customer_id, user_id')
          .eq('conversation_id', conversationId)
          .limit(1),
      ) as ConversationIdentity[];
      return rows[0] ?? null;
    },
    async getAppUser(userId) {
      const rows = check(
        await db.from('app_users').select('display_name, email').eq('id', userId).limit(1),
      ) as AppUserRow[];
      return rows[0] ?? null;
    },
    async getTransaction(id, customerId) {
      let query = db
        .from('transactions')
        .select(
          'transaction_id, customer_id, transaction_type, status, amount, currency, estimated_arrival, support_summary',
        )
        .eq('transaction_id', id);
      if (customerId) query = query.eq('customer_id', customerId);
      return check(await query.maybeSingle()) as TransactionRow | null;
    },
    async findPayout(q, customerId) {
      let query = db
        .from('payouts')
        .select('payout_id, transaction_id, customer_id, status, scheduled_for, failure_reason');
      if (q.payout_id) query = query.eq('payout_id', q.payout_id);
      if (q.transaction_id) query = query.eq('transaction_id', q.transaction_id);
      if (customerId) query = query.eq('customer_id', customerId);
      const rows = check(await query.order('scheduled_for', { ascending: false }).limit(1));
      return (rows as PayoutRow[])[0] ?? null;
    },
    async customerExists(id) {
      const rows = check(
        await db.from('customers').select('customer_id').eq('customer_id', id).limit(1),
      );
      return (rows as unknown[]).length > 0;
    },
    async ensureConversation(id) {
      check(
        await db
          .from('conversations')
          .upsert(
            { conversation_id: id, channel: 'voice' },
            { onConflict: 'conversation_id', ignoreDuplicates: true },
          ),
      );
    },
    async insertTicket(t) {
      const row = check(
        await db.rpc('create_support_ticket_once', {
          p_conversation_id: t.conversation_id,
          p_customer_id: t.customer_id,
          p_category: t.category,
          p_priority: t.priority,
          p_summary: t.summary,
        }),
      );
      return row as TicketRecord;
    },
    async createTicketAndEscalation(e) {
      const row = check(
        await db.rpc('create_ticket_and_escalation', {
          p_conversation_id: e.conversation_id,
          p_customer_id: e.customer_id,
          p_category: e.ticket_category,
          p_priority: e.ticket_priority,
          p_summary: e.ticket_summary,
          p_escalation_category: e.category,
          p_reason: e.reason,
          p_user_name: e.user_name,
          p_user_email: e.user_email,
          p_contact_preference: e.contact_preference ?? null,
          p_preferred_time: e.preferred_time ?? null,
          p_preferred_at: e.preferred_at ?? null,
          p_preferred_timezone: e.preferred_timezone ?? null,
        }),
      );
      return row as TicketEscalation;
    },
    async insertEvent(e) {
      check(await db.from('conversation_events').insert(e));
    },
    async recordToolCall(r) {
      check(await db.from('tool_calls').insert(r));
    },
  };
}
