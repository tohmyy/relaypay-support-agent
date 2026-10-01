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
  input_summary: string;
  result_summary: string;
  status: 'success' | 'failed' | 'not_found';
  error?: string | null;
}

/** Every database operation the tools need. Tools depend on this, so tests can fake it. */
export interface Store {
  /** Returns null when nothing matches, or when more than one record matches (ambiguous). */
  findCustomer(q: {
    customer_id?: string;
    email?: string;
    company_name?: string;
  }): Promise<CustomerRow | null>;
  getTransaction(transactionId: string): Promise<TransactionRow | null>;
  findPayout(q: { payout_id?: string; transaction_id?: string }): Promise<PayoutRow | null>;
  customerExists(customerId: string): Promise<boolean>;
  ticketExists(ticketId: string): Promise<boolean>;
  ensureConversation(conversationId: string): Promise<void>;
  insertTicket(t: {
    customer_id?: string;
    category: string;
    priority: string;
    summary: string;
    conversation_id: string;
  }): Promise<string>;
  insertEscalation(e: {
    ticket_id?: string;
    customer_id?: string;
    user_name: string;
    user_email: string;
    category: string;
    reason: string;
    preferred_time?: string;
    conversation_id?: string;
  }): Promise<string>;
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
    async getTransaction(id) {
      const row = check(
        await db
          .from('transactions')
          .select(
            'transaction_id, customer_id, transaction_type, status, amount, currency, estimated_arrival, support_summary',
          )
          .eq('transaction_id', id)
          .maybeSingle(),
      );
      return row as TransactionRow | null;
    },
    async findPayout(q) {
      let query = db
        .from('payouts')
        .select('payout_id, transaction_id, customer_id, status, scheduled_for, failure_reason');
      if (q.payout_id) query = query.eq('payout_id', q.payout_id);
      if (q.transaction_id) query = query.eq('transaction_id', q.transaction_id);
      const rows = check(await query.order('scheduled_for', { ascending: false }).limit(1));
      return (rows as PayoutRow[])[0] ?? null;
    },
    async customerExists(id) {
      const rows = check(
        await db.from('customers').select('customer_id').eq('customer_id', id).limit(1),
      );
      return (rows as unknown[]).length > 0;
    },
    async ticketExists(id) {
      const rows = check(
        await db.from('support_tickets').select('ticket_id').eq('ticket_id', id).limit(1),
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
        await db
          .from('support_tickets')
          .insert({ ...t, status: 'open' })
          .select('ticket_id')
          .single(),
      );
      return (row as { ticket_id: string }).ticket_id;
    },
    async insertEscalation(e) {
      const row = check(
        await db
          .from('escalations')
          .insert({ ...e, status: 'open' })
          .select('escalation_id')
          .single(),
      );
      return (row as { escalation_id: string }).escalation_id;
    },
    async insertEvent(e) {
      check(await db.from('conversation_events').insert(e));
    },
    async recordToolCall(r) {
      check(await db.from('tool_calls').insert(r));
    },
  };
}
