import type {
  CustomerRow,
  PayoutRow,
  Store,
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
];

export interface FakeStore extends Store {
  calls: string[];
  toolCalls: ToolCallRecord[];
  events: unknown[];
  tickets: unknown[];
  escalations: unknown[];
  conversations: Set<string>;
  failWith?: Error;
}

/** In-memory Store. Set `failWith` to make every operation throw, like a database outage. */
export function createFakeStore(): FakeStore {
  const s: FakeStore = {
    calls: [],
    toolCalls: [],
    events: [],
    tickets: [],
    escalations: [],
    conversations: new Set(),
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
    async getTransaction(id) {
      s.calls.push('getTransaction');
      if (s.failWith) throw s.failWith;
      return transactions.find((t) => t.transaction_id === id) ?? null;
    },
    async findPayout(q) {
      s.calls.push('findPayout');
      if (s.failWith) throw s.failWith;
      return (
        payouts.find(
          (p) =>
            (!q.payout_id || p.payout_id === q.payout_id) &&
            (!q.transaction_id || p.transaction_id === q.transaction_id),
        ) ?? null
      );
    },
    async customerExists(id) {
      if (s.failWith) throw s.failWith;
      return customers.some((c) => c.customer_id === id);
    },
    async ticketExists(id) {
      if (s.failWith) throw s.failWith;
      return id === 'TKT-000001';
    },
    async ensureConversation(id) {
      if (s.failWith) throw s.failWith;
      s.conversations.add(id);
    },
    async insertTicket(t) {
      s.calls.push('insertTicket');
      if (s.failWith) throw s.failWith;
      s.tickets.push(t);
      return 'TKT-000001';
    },
    async insertEscalation(e) {
      s.calls.push('insertEscalation');
      if (s.failWith) throw s.failWith;
      s.escalations.push(e);
      return 'ESC-000001';
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
