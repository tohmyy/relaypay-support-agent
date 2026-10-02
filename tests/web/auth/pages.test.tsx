import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  requireStaff: vi.fn(),
  data: {
    getConversation: vi.fn(),
    getTranscript: vi.fn(),
    getConversationTicket: vi.fn(),
    getConversationEscalation: vi.fn(),
    getStaffCustomer: vi.fn(),
    getCustomerTransactions: vi.fn(),
    getCustomerPayouts: vi.fn(),
    getCustomerConversations: vi.fn(),
    getStaffQueueRows: vi.fn(),
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => '/',
}));
vi.mock('@/lib/auth/dal', () => ({
  requireCustomer: (...a: unknown[]) => h.requireCustomer(...a),
  requireStaff: (...a: unknown[]) => h.requireStaff(...a),
}));
vi.mock('@/lib/dashboard/data.server', () => h.data);

import PaymentsPage from '@/app/(customer)/payments/page';
import InvoicesPage from '@/app/(customer)/invoices/page';
import CustomerConversation from '@/app/(customer)/support/[conversationId]/page';
import StaffConversation from '@/app/(staff)/staff/conversations/[conversationId]/page';
import StaffQueuePage from '@/app/(staff)/staff/page';

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u-1',
  email: 'amara@lagosledger.example',
  role: 'customer',
  customerId: 'CUS-1001',
  displayName: 'Amara Okafor',
  title: null,
  avatarUrl: null,
  ...over,
});

const conv = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-02T09:00:00Z',
  ended_at: '2026-10-02T09:05:00Z',
  final_status: 'resolved',
  end_reason: 'user-ended',
  ...over,
});

const html = async (page: Promise<React.ReactElement>) => renderToStaticMarkup(await page);
const params = (conversationId: string) => ({ params: Promise.resolve({ conversationId }) });

beforeEach(() => {
  for (const f of [h.requireCustomer, h.requireStaff, ...Object.values(h.data)]) f.mockReset();
  h.data.getTranscript.mockResolvedValue([{ turn_number: 1, user_transcript: 'Where is my payout?', assistant_response: 'It is processing.' }]);
  h.data.getConversationTicket.mockResolvedValue(null);
  h.data.getConversationEscalation.mockResolvedValue(null);
  h.data.getStaffCustomer.mockResolvedValue({ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara Okafor', contact_email: 'amara@lagosledger.example', plan: 'Growth' });
});

describe('customer conversation page', () => {
  it('shows a customer their own conversation', async () => {
    h.requireCustomer.mockResolvedValue(user());
    h.data.getConversation.mockResolvedValue(conv());
    const out = await html(CustomerConversation(params('vapi_abc')));
    expect(out).toContain('Where is my payout?');
    expect(out).toContain('It is processing.');
  });

  it("answers not found for someone else's conversation, an unknown one and a malformed id alike", async () => {
    h.requireCustomer.mockResolvedValue(user());
    h.data.getConversation.mockResolvedValue(conv({ customer_id: 'CUS-1002' }));
    await expect(CustomerConversation(params('vapi_abc'))).rejects.toThrow('NOT_FOUND');
    h.data.getConversation.mockResolvedValue(conv({ customer_id: null }));
    await expect(CustomerConversation(params('vapi_abc'))).rejects.toThrow('NOT_FOUND');
    h.data.getConversation.mockResolvedValue(null);
    await expect(CustomerConversation(params('vapi_nope'))).rejects.toThrow('NOT_FOUND');
    await expect(CustomerConversation(params('bad id!'))).rejects.toThrow('NOT_FOUND');
    expect(h.data.getTranscript).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to the login page before reading anything', async () => {
    h.requireCustomer.mockRejectedValue(new Error('REDIRECT:/login?next=%2Fsupport%2Fvapi_abc'));
    await expect(CustomerConversation(params('vapi_abc'))).rejects.toThrow('REDIRECT:/login');
    expect(h.data.getConversation).not.toHaveBeenCalled();
  });
});

describe('staff conversation page', () => {
  it('shows staff the transcript, the customer and the escalation details', async () => {
    h.requireStaff.mockResolvedValue(user({ role: 'support_agent', customerId: null }));
    h.data.getConversation.mockResolvedValue(conv({ ended_at: null, final_status: null }));
    h.data.getConversationTicket.mockResolvedValue({ ticket_id: 'TKT-000007', category: 'compliance' });
    h.data.getConversationEscalation.mockResolvedValue({ escalation_id: 'ESC-000001', reason: 'Account review', user_name: 'Amara', user_email: 'amara@lagosledger.example', preferred_time: 'Friday', status: 'open' });
    const out = await html(StaffConversation(params('vapi_abc')));
    for (const text of ['Where is my payout?', 'LagosLedger', 'TKT-000007', 'Compliance review', 'ESC-000001', 'Friday']) expect(out).toContain(text);
  });

  it('never reads account notes or verification status', async () => {
    h.requireStaff.mockResolvedValue(user({ role: 'support_admin', customerId: null }));
    h.data.getConversation.mockResolvedValue(conv());
    const out = await html(StaffConversation(params('vapi_abc')));
    expect(out).not.toMatch(/kyc|support_notes/i);
  });

  it('hides a closed, resolved conversation from a support agent but not from an admin', async () => {
    h.data.getConversation.mockResolvedValue(conv());
    h.requireStaff.mockResolvedValue(user({ role: 'support_agent', customerId: null }));
    await expect(StaffConversation(params('vapi_abc'))).rejects.toThrow('NOT_FOUND');
    h.requireStaff.mockResolvedValue(user({ role: 'support_admin', customerId: null }));
    await expect(StaffConversation(params('vapi_abc'))).resolves.toBeTruthy();
  });

  it('is not available to a customer', async () => {
    h.requireStaff.mockRejectedValue(new Error('REDIRECT:/dashboard'));
    await expect(StaffConversation(params('vapi_abc'))).rejects.toThrow('REDIRECT:/dashboard');
    expect(h.data.getConversation).not.toHaveBeenCalled();
  });
});

describe('list pages', () => {
  it('reads data only for the customer in the session', async () => {
    h.requireCustomer.mockResolvedValue(user());
    h.data.getCustomerTransactions.mockResolvedValue([
      { transaction_id: 'TXN-9001', transaction_type: 'outgoing payout', amount: 2400, currency: 'USD', status: 'processing', created_at: '2026-08-16', estimated_arrival: null, destination_country: 'Kenya' },
      { transaction_id: 'TXN-9002', transaction_type: 'invoice payment', amount: 1200, currency: 'EUR', status: 'review required', created_at: '2026-08-12', estimated_arrival: null, destination_country: null },
    ]);
    const payments = await html(PaymentsPage());
    expect(payments).toContain('TXN-9001');
    expect(payments).toContain('Under review');
    expect(payments).toContain('USD 2,400.00');
    expect(h.data.getCustomerTransactions).toHaveBeenCalledWith('CUS-1001');
    const invoices = await html(InvoicesPage());
    expect(invoices).toContain('TXN-9002');
    expect(invoices).not.toContain('TXN-9001');
  });

  it('shows an empty state', async () => {
    h.requireCustomer.mockResolvedValue(user());
    h.data.getCustomerTransactions.mockResolvedValue([]);
    expect(await html(PaymentsPage())).toContain('No payments yet.');
  });

  it('shows the staff queue with counts, hiding resolved rows from agents', async () => {
    h.data.getStaffQueueRows.mockResolvedValue({
      conversations: [
        conv({ conversation_id: 'a', ended_at: null, final_status: null }),
        conv({ conversation_id: 'b', final_status: 'resolved', ended_at: new Date().toISOString() }),
      ],
      tickets: [],
      customers: [{ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara' }],
    });
    h.requireStaff.mockResolvedValue(user({ role: 'support_agent', customerId: null }));
    const agentView = await html(StaffQueuePage());
    expect(agentView).toContain('/staff/conversations/a');
    expect(agentView).not.toContain('/staff/conversations/b');
    h.requireStaff.mockResolvedValue(user({ role: 'support_admin', customerId: null }));
    expect(await html(StaffQueuePage())).toContain('/staff/conversations/b');
  });
});
