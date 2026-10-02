import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDemoAccounts } from '../../../scripts/db/users';
import {
  PAYOUT_COLUMNS,
  TRANSACTION_COLUMNS,
  buildCustomerOverview,
  conversationOutcome,
  type TransactionRow,
} from '@/lib/dashboard/customer';
import { formatDate, formatMoney, greeting, statusLabel, statusTone } from '@/lib/dashboard/format';
import { QUEUE_CONVERSATION_COLUMNS, buildStaffQueue, customerLabel, queueState } from '@/lib/dashboard/staff';
import { FORBIDDEN_CUSTOMER_TERMS } from '@/lib/copy';
import { SHELL_COPY, STAFF_COPY, allStrings } from '@/lib/shell-copy';
import { parseCsv } from '../../../scripts/db/csv';

describe('format helpers', () => {
  it('greets by time of day with the first name only', () => {
    expect(greeting(new Date(2026, 9, 2, 8), 'Amara Okafor')).toBe('Good morning, Amara');
    expect(greeting(new Date(2026, 9, 2, 14), 'Amara Okafor')).toBe('Good afternoon, Amara');
    expect(greeting(new Date(2026, 9, 2, 20), 'Amara')).toBe('Good evening, Amara');
    expect(greeting(new Date(2026, 9, 2, 8), '  ')).toBe('Good morning');
  });

  it('turns internal status wording into friendly labels', () => {
    expect(statusLabel('review required')).toBe('Under review');
    expect(statusLabel('completed')).toBe('Completed');
    expect(statusLabel('something new')).toBe('Something new');
    expect(statusLabel(null)).toBe('Unknown');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('weird')).toBe('neutral');
  });

  it('formats money and dates, and survives bad input', () => {
    expect(formatMoney(2400, 'USD')).toBe('USD 2,400.00');
    expect(formatMoney('5300', 'GBP')).toBe('GBP 5,300.00');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(10, 'not a code')).toBe('10.00');
    expect(formatDate('2026-08-16')).toBe('16 Aug 2026');
    expect(formatDate('nonsense')).toBe('—');
    expect(formatDate(null)).toBe('—');
  });
});

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  transaction_id: 'TXN-1',
  transaction_type: 'outgoing payout',
  amount: 100,
  currency: 'USD',
  status: 'completed',
  created_at: '2026-08-01',
  estimated_arrival: null,
  destination_country: null,
  ...over,
});

describe('customer overview', () => {
  it('counts payments, payouts and invoices (invoice payments only) and lists recent activity newest first', () => {
    const overview = buildCustomerOverview({
      transactions: [
        tx({ transaction_id: 'TXN-1', created_at: '2026-08-01' }),
        tx({ transaction_id: 'TXN-2', transaction_type: 'invoice payment', created_at: '2026-08-12', currency: 'EUR', amount: 1200 }),
      ],
      payouts: [{ payout_id: 'PAY-1', recipient_name: 'Bright Studio', amount: 50, currency: 'USD', status: 'processing', scheduled_for: '2026-08-18' }],
      conversations: [],
    });
    expect(overview.payments.count).toBe(2);
    expect(overview.payouts.count).toBe(1);
    expect(overview.invoices.count).toBe(1);
    expect(overview.invoices.latest).toContain('EUR 1,200.00');
    expect(overview.recent.map((r) => r.reference)).toEqual(['PAY-1', 'TXN-2', 'TXN-1']);
    expect(overview.recent[0].title).toBe('To Bright Studio');
  });

  it('handles a customer with no data', () => {
    const overview = buildCustomerOverview({ transactions: [], payouts: [], conversations: [] });
    expect(overview.payments).toEqual({ count: 0, latest: null });
    expect(overview.recent).toEqual([]);
    expect(overview.conversations).toEqual([]);
  });

  it('describes conversations in plain words and keeps the newest five', () => {
    expect(conversationOutcome({ ended_at: null, final_status: null })).toBe('In progress');
    expect(conversationOutcome({ ended_at: 'x', final_status: 'resolved' })).toBe('Resolved');
    expect(conversationOutcome({ ended_at: 'x', final_status: 'escalated' })).toBe('Passed to our team');
    const many = Array.from({ length: 8 }, (_, i) => ({
      conversation_id: `c${i}`,
      started_at: `2026-09-0${i + 1}`,
      ended_at: null,
      final_status: null,
      end_reason: null,
    }));
    const { conversations } = buildCustomerOverview({ transactions: [], payouts: [], conversations: many });
    expect(conversations).toHaveLength(5);
    expect(conversations[0].id).toBe('c7');
  });

  it('only ever selects customer-safe columns and never maps internal ones', () => {
    for (const internal of ['support_notes', 'kyc_status', 'support_summary', 'failure_reason']) {
      expect(TRANSACTION_COLUMNS).not.toContain(internal);
      expect(PAYOUT_COLUMNS).not.toContain(internal);
    }
    const out = JSON.stringify(
      buildCustomerOverview({
        transactions: [{ ...tx({}), support_summary: 'INTERNAL', failure_reason: 'INTERNAL' } as TransactionRow],
        payouts: [],
        conversations: [],
      }),
    );
    expect(out).not.toContain('INTERNAL');
  });
});

describe('staff queue', () => {
  const conv = (id: string, over: Record<string, string | null> = {}) => ({
    conversation_id: id,
    customer_id: 'CUS-1001',
    started_at: '2026-10-02T09:00:00Z',
    ended_at: null as string | null,
    final_status: null as string | null,
    end_reason: null as string | null,
    support_mode: null as string | null,
    assigned_staff_id: null as string | null,
    ...over,
  });
  const now = new Date('2026-10-02T12:00:00Z');

  it('classifies and counts conversations', () => {
    expect(queueState(conv('a'))).toBe('open');
    expect(queueState(conv('b', { final_status: 'escalated' }))).toBe('escalated');
    // Escalated for a callback (the voice call has ended) stays in the queue.
    expect(queueState(conv('c', { final_status: 'escalated', ended_at: '2026-10-02T09:30:00Z' }))).toBe('escalated');
    expect(queueState(conv('d', { final_status: 'resolved', ended_at: '2026-10-02T09:30:00Z' }))).toBe('resolved');
    // With a specialist: waiting until someone takes it, then in progress; closed is resolved.
    expect(queueState(conv('h1', { final_status: 'escalated', support_mode: 'human' }))).toBe('waiting');
    expect(queueState(conv('h2', { final_status: 'escalated', support_mode: 'human', assigned_staff_id: 'u-9' }))).toBe('in-progress');
    expect(
      queueState(conv('h3', { final_status: 'escalated', support_mode: 'ended', ended_at: '2026-10-02T09:30:00Z' })),
    ).toBe('resolved');

    const queue = buildStaffQueue(
      {
        conversations: [
          conv('a'),
          conv('b', { final_status: 'escalated' }),
          conv('c', { final_status: 'escalated', ended_at: '2026-10-02T09:30:00Z' }),
          conv('d', { final_status: 'resolved', ended_at: '2026-10-02T09:30:00Z' }),
          conv('e', { final_status: 'resolved', ended_at: '2026-10-01T09:30:00Z' }),
          conv('f', { final_status: 'escalated', support_mode: 'human' }),
          conv('g', { final_status: 'escalated', support_mode: 'human', assigned_staff_id: 'u-9' }),
        ],
        tickets: [{ ticket_id: 'TKT-000001', conversation_id: 'b', category: 'compliance', priority: 'high', status: 'open' }],
        customers: [{ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara Okafor' }],
      },
      now,
    );
    expect(queue.counts).toEqual({ open: 1, waiting: 1, inProgress: 1, escalated: 2, resolvedToday: 1 });
    expect(queue.items.map((i) => i.state)).toEqual([
      'waiting',
      'escalated',
      'escalated',
      'in-progress',
      'open',
      'resolved',
      'resolved',
    ]);
    const escalated = queue.items.find((i) => i.conversationId === 'b')!;
    expect(escalated).toMatchObject({ customer: 'Amara Okafor', issue: 'Compliance review', ticket: 'TKT-000001' });
  });

  it('labels unlinked callers and empty queues', () => {
    const queue = buildStaffQueue({ conversations: [conv('x', { customer_id: null })], tickets: [], customers: [] }, now);
    expect(queue.items[0].customer).toBe('Unknown caller');
    expect(queue.items[0].issue).toBe('General question');
    expect(buildStaffQueue({ conversations: [], tickets: [], customers: [] }, now).counts.open).toBe(0);
  });

  it('never selects account notes or verification status', () => {
    expect(QUEUE_CONVERSATION_COLUMNS).not.toMatch(/notes|kyc/);
  });
});

describe('shell copy', () => {
  it('keeps customer-facing wording free of internal vocabulary', () => {
    const strings = allStrings(SHELL_COPY);
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings) {
      for (const term of FORBIDDEN_CUSTOMER_TERMS) {
        const re = new RegExp(`(^|[^a-z])${term.replace(' ', '\\s')}([^a-z]|$)`, 'i');
        expect(re.test(s), `"${s}" contains "${term}"`).toBe(false);
      }
    }
  });

  it('has staff wording of its own', () => {
    expect(allStrings(STAFF_COPY).length).toBeGreaterThan(20);
  });
});

describe('demo accounts', () => {
  const customers = parseCsv(readFileSync('supabase/seed/customers.csv', 'utf8'));
  const accounts = buildDemoAccounts(customers);

  it('creates one customer account per seeded customer, linked to it, plus staff', () => {
    expect(accounts.filter((a) => a.role === 'customer')).toHaveLength(5);
    expect(accounts.find((a) => a.email === 'amara@lagosledger.example')).toMatchObject({ role: 'customer', customerId: 'CUS-1001' });
    expect(accounts.filter((a) => a.role === 'support_agent')).toHaveLength(2);
    expect(accounts.filter((a) => a.role === 'support_admin')).toHaveLength(1);
  });

  it('gives only customers a customer id, and unique lowercase example emails', () => {
    for (const a of accounts) {
      expect(a.role === 'customer').toBe(a.customerId !== null);
      expect(a.email).toBe(a.email.toLowerCase());
      expect(a.email).toMatch(/\.example$/);
    }
    expect(new Set(accounts.map((a) => a.email)).size).toBe(accounts.length);
  });

  it('skips customers without a contact email', () => {
    expect(buildDemoAccounts([{ customer_id: 'CUS-9', contact_email: null, contact_name: 'X' }]).filter((a) => a.role === 'customer')).toEqual([]);
  });
});

describe('customerLabel', () => {
  const amara = { company_name: 'LagosLedger', contact_name: 'Amara Okafor' };

  it('names the person, not the company', () => {
    expect(customerLabel(amara, 'CUS-1001')).toBe('Amara Okafor');
  });

  it('falls back to the company, then the customer id, when there is no name', () => {
    expect(customerLabel({ company_name: 'LagosLedger', contact_name: null }, 'CUS-1001')).toBe('LagosLedger');
    expect(customerLabel({ company_name: 'LagosLedger', contact_name: '  ' }, 'CUS-1001')).toBe('LagosLedger');
    expect(customerLabel({ company_name: null, contact_name: null }, 'CUS-1001')).toBe('CUS-1001');
  });

  it('is "Unknown caller" when there is no customer at all', () => {
    expect(customerLabel(undefined, null)).toBe('Unknown caller');
    expect(customerLabel(null)).toBe('Unknown caller');
  });
});
