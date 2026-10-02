import type {
  AppUserRow,
  ConversationIdentity,
  CustomerRow,
  PayoutRow,
  Store,
  TicketEscalation,
  TicketRecord,
  ToolCallRecord,
  TransactionRow,
} from '../../services/mcp/src/db/store';

export const customers: CustomerRow[] = [
  {
    customer_id: 'CUS-1001',
    company_name: 'LagosLedger',
    plan: 'Growth',
    account_status: 'active',
    kyc_status: 'approved',
    support_notes: 'Normal support access.',
  },
];
export const transactions: TransactionRow[] = [
  {
    transaction_id: 'TXN-9001',
    customer_id: 'CUS-1001',
    transaction_type: 'outgoing payout',
    status: 'processing',
    amount: '2400.00',
    currency: 'USD',
    estimated_arrival: null,
    support_summary: 'Payout is processing.',
  },
  // Another customer's records, for the ownership tests.
  {
    transaction_id: 'TXN-9002',
    customer_id: 'CUS-2002',
    transaction_type: 'incoming transfer',
    status: 'completed',
    amount: '90.00',
    currency: 'EUR',
    estimated_arrival: null,
    support_summary: 'Transfer completed.',
  },
];
export const payouts: PayoutRow[] = [
  {
    payout_id: 'PAY-7001',
    transaction_id: 'TXN-9001',
    customer_id: 'CUS-1001',
    status: 'processing',
    scheduled_for: '2026-08-18',
    failure_reason: null,
  },
  {
    payout_id: 'PAY-7009',
    transaction_id: 'TXN-9002',
    customer_id: 'CUS-2002',
    status: 'completed',
    scheduled_for: '2026-08-19',
    failure_reason: null,
  },
];

export const appUsers: Record<string, AppUserRow> = {
  'user-1': { display_name: 'Amara Okafor', email: 'amara@lagosledger.example' },
  'user-2': { display_name: 'Bola Ade', email: 'bola@other.example' },
  // An account with no usable email: tools fail closed for it.
  'user-blank': { display_name: 'Chi Eze', email: '' },
};

/** What the fake keeps per ticket and escalation, like the rows the database functions write. */
export interface FakeTicket {
  ticket_id: string;
  conversation_id: string;
  customer_id: string;
  category: string;
  priority: string;
  summary: string;
  status: string;
}
export interface FakeEscalation {
  escalation_id: string;
  ticket_id: string;
  conversation_id: string;
  customer_id: string;
  user_name: string;
  user_email: string;
  category: string;
  reason: string;
  status: string;
  preferred_time?: string;
  preferred_at?: string;
  preferred_timezone?: string;
  contact_preference?: string;
}

export interface FakeStore extends Store {
  /** conversation_id -> who it is linked to (what the web app's link wrote). Absent = no such conversation. */
  identities: Map<string, ConversationIdentity>;
  calls: string[];
  toolCalls: ToolCallRecord[];
  events: unknown[];
  tickets: FakeTicket[];
  escalations: FakeEscalation[];
  conversations: Set<string>;
  failWith?: Error;
}

/** In-memory Store. Set `failWith` to make every operation throw, like a database outage. */
export function createFakeStore(): FakeStore {
  const nextTicket = () => `TKT-${String(s.tickets.length + 1).padStart(6, '0')}`;
  const s: FakeStore = {
    calls: [],
    toolCalls: [],
    events: [],
    tickets: [],
    escalations: [],
    conversations: new Set(),
    identities: new Map(),
    async getConversationIdentity(id) {
      if (s.failWith) throw s.failWith;
      return s.identities.get(id) ?? null;
    },
    async getAppUser(id) {
      if (s.failWith) throw s.failWith;
      return appUsers[id] ?? null;
    },
    async findCustomer(q) {
      s.calls.push('findCustomer');
      if (s.failWith) throw s.failWith;
      return (
        customers.find(
          (c) =>
            (!q.customer_id || c.customer_id === q.customer_id) &&
            (!q.company_name || c.company_name.toLowerCase() === q.company_name.toLowerCase()) &&
            (!q.email || q.email.toLowerCase() === 'amara@lagosledger.example'),
        ) ?? null
      );
    },
    // The customer predicate is part of the lookup, as in the real queries.
    async getTransaction(id, customerId) {
      s.calls.push(customerId ? `getTransaction:${customerId}` : 'getTransaction');
      if (s.failWith) throw s.failWith;
      return transactions.find((t) => t.transaction_id === id && (!customerId || t.customer_id === customerId)) ?? null;
    },
    async findPayout(q, customerId) {
      s.calls.push(customerId ? `findPayout:${customerId}` : 'findPayout');
      if (s.failWith) throw s.failWith;
      return (
        payouts.find(
          (p) =>
            (!q.payout_id || p.payout_id === q.payout_id) &&
            (!q.transaction_id || p.transaction_id === q.transaction_id) &&
            (!customerId || p.customer_id === customerId),
        ) ?? null
      );
    },
    async customerExists(id) {
      if (s.failWith) throw s.failWith;
      return customers.some((c) => c.customer_id === id);
    },
    async ensureConversation(id) {
      if (s.failWith) throw s.failWith;
      s.conversations.add(id);
    },
    // Once per conversation and summary, like create_support_ticket_once.
    async insertTicket(t): Promise<TicketRecord> {
      s.calls.push('insertTicket');
      if (s.failWith) throw s.failWith;
      const same = s.tickets.find(
        (x) => x.conversation_id === t.conversation_id && x.summary.trim().toLowerCase() === t.summary.trim().toLowerCase(),
      );
      if (same) return { ticket_id: same.ticket_id, status: same.status, created: false };
      const ticket: FakeTicket = { ...t, ticket_id: nextTicket(), status: 'open' };
      s.tickets.push(ticket);
      return { ticket_id: ticket.ticket_id, status: ticket.status, created: true };
    },
    // Ticket and escalation together, or the pair already open for the conversation, like create_ticket_and_escalation.
    async createTicketAndEscalation(e): Promise<TicketEscalation> {
      s.calls.push('createTicketAndEscalation');
      if (s.failWith) throw s.failWith;
      const open = s.escalations.find((x) => x.conversation_id === e.conversation_id && x.status !== 'closed');
      if (open) return { ticket_id: open.ticket_id, escalation_id: open.escalation_id, created: false };
      let ticket = [...s.tickets].reverse().find((t) => t.conversation_id === e.conversation_id && t.status !== 'closed');
      if (!ticket) {
        ticket = {
          ticket_id: nextTicket(),
          conversation_id: e.conversation_id,
          customer_id: e.customer_id,
          category: e.ticket_category,
          priority: e.ticket_priority,
          summary: e.ticket_summary,
          status: 'open',
        };
        s.tickets.push(ticket);
      }
      const { ticket_category: _c, ticket_priority: _p, ticket_summary: _s, ...rest } = e;
      const escalation: FakeEscalation = {
        ...rest,
        escalation_id: `ESC-${String(s.escalations.length + 1).padStart(6, '0')}`,
        ticket_id: ticket.ticket_id,
        status: 'open',
      };
      s.escalations.push(escalation);
      return { ticket_id: ticket.ticket_id, escalation_id: escalation.escalation_id, created: true };
    },
    async insertEvent(e) {
      s.calls.push('insertEvent');
      if (s.failWith) throw s.failWith;
      s.events.push(e);
    },
    async recordToolCall(r) {
      if (s.failWith) throw s.failWith;
      s.toolCalls.push(r);
    },
  };
  return s;
}
