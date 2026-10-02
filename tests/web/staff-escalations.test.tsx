import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  getEscalationsPage: vi.fn(),
  getEscalationByTicket: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth/dal', () => ({ requireStaff: (...a: unknown[]) => h.requireStaff(...a) }));
vi.mock('@/lib/dashboard/data.server', () => ({
  getEscalationsPage: (...a: unknown[]) => h.getEscalationsPage(...a),
  getEscalationByTicket: (...a: unknown[]) => h.getEscalationByTicket(...a),
}));

import StaffEscalationsPage from '@/app/(staff)/staff/escalations/page';
import StaffEscalationPage from '@/app/(staff)/staff/escalations/[ticketId]/page';

const staff = (): CurrentUser => ({
  id: 'u-9',
  email: 'sarah@relaypay.example',
  role: 'support_agent',
  customerId: null,
  displayName: 'Sarah Adeyemi',
  title: 'Support Specialist',
  avatarUrl: null,
  available: true,
});

const row = (over: Record<string, unknown> = {}) => ({
  escalationId: 'ESC-000001',
  ticketId: 'TKT-000007',
  conversationId: 'vapi_abc',
  status: { label: 'Open', tone: 'warning' },
  ticketStatus: null,
  customer: 'LagosLedger',
  topic: 'Account',
  reasonPreview: 'Review needed',
  assignee: null,
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:05:00Z',
  conversation: {
    conversation_id: 'vapi_abc',
    customer_id: 'CUS-1001',
    ended_at: null,
    final_status: 'escalated',
    support_mode: 'human',
    assigned_staff_id: null,
  },
  ...over,
});

beforeEach(() => {
  h.requireStaff.mockReset();
  h.getEscalationsPage.mockReset();
  h.getEscalationByTicket.mockReset();
  h.requireStaff.mockResolvedValue(staff());
  h.getEscalationsPage.mockResolvedValue({ rows: [row()], nextCursor: null, restarted: false });
});

describe('staff escalations page', () => {
  it('lists ticket, customer, topic, assignee and datetimes', async () => {
    const html = renderToStaticMarkup(await StaffEscalationsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('TKT-000007');
    expect(html).toContain('LagosLedger');
    expect(html).toContain('Account');
    expect(html).toContain('Review needed');
    expect(html).toContain('1 Oct 2026, 12:00 UTC');
  });

  it('passes a status filter and a normalised ticket search to the reader', async () => {
    await StaffEscalationsPage({ searchParams: Promise.resolve({ status: 'open', ticket: '7' }) });
    expect(h.getEscalationsPage).toHaveBeenCalledWith({ status: 'open', ticket: 'TKT-000007', cursor: null });
  });

  it('says so when the typed ticket number is not a ticket number', async () => {
    const html = renderToStaticMarkup(
      await StaffEscalationsPage({ searchParams: Promise.resolve({ ticket: 'not-a-ticket' }) }),
    );
    expect(html).toContain('Enter a ticket number like TKT-000123.');
    expect(h.getEscalationsPage).toHaveBeenCalledWith({ status: null, ticket: null, cursor: null });
  });
});

describe('staff escalation ticket jump', () => {
  it('opens the conversation that owns the ticket', async () => {
    h.getEscalationByTicket.mockResolvedValue({ conversation_id: 'vapi_abc', ticket_id: 'TKT-000007' });
    await expect(StaffEscalationPage({ params: Promise.resolve({ ticketId: 'TKT-000007' }) })).rejects.toThrow(
      'REDIRECT:/staff/conversations/vapi_abc',
    );
  });

  it('is not found for a missing or malformed ticket', async () => {
    await expect(StaffEscalationPage({ params: Promise.resolve({ ticketId: 'nope' }) })).rejects.toThrow('NOT_FOUND');
    h.getEscalationByTicket.mockResolvedValue(null);
    await expect(StaffEscalationPage({ params: Promise.resolve({ ticketId: 'TKT-000007' }) })).rejects.toThrow('NOT_FOUND');
  });
});
