import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  getTranscriptAfter: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/dashboard/data.server', () => ({
  getConversation: (...a: unknown[]) => h.getConversation(...a),
  getTranscriptAfter: (...a: unknown[]) => h.getTranscriptAfter(...a),
}));

import { GET as customerGet } from '@/app/api/support/conversations/[id]/transcript/route';
import { GET as staffGet } from '@/app/api/staff/conversations/[id]/transcript/route';

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u-1',
  email: 'amara@lagosledger.example',
  role: 'customer',
  customerId: 'CUS-1001',
  displayName: 'Amara Okafor',
  title: null,
  avatarUrl: null,
  available: false,
  ...over,
});

const conv = {
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-01T12:00:00Z',
  ended_at: null,
  final_status: null,
  support_mode: 'ai',
  assigned_staff_id: null,
};

const page = {
  turns: [{ id: 'u-1:assistant', role: 'assistant', displayText: 'Transaction TXN-9001 is processing.', createdAt: '2026-10-01T12:00:01Z' }],
  cursor: 'next',
};

beforeEach(() => {
  h.getCurrentUser.mockReset();
  h.getConversation.mockReset();
  h.getTranscriptAfter.mockReset();
  h.getConversation.mockResolvedValue(conv);
  h.getTranscriptAfter.mockResolvedValue(page);
});

const get = (fn: typeof customerGet, query = '') =>
  fn(new Request(`http://localhost/x${query}`), { params: Promise.resolve({ id: 'vapi_abc' }) });

describe('transcript routes', () => {
  it('lets the owner read incremental turns', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    const res = await get(customerGet, '?after=abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(page);
    expect(h.getTranscriptAfter).toHaveBeenCalledWith('vapi_abc', 'abc');
  });

  it('hides another customer\'s conversation', async () => {
    h.getCurrentUser.mockResolvedValue(user({ customerId: 'CUS-2002' }));
    expect((await get(customerGet)).status).toBe(404);
    expect(h.getTranscriptAfter).not.toHaveBeenCalled();
  });

  it('lets staff read the same page', async () => {
    h.getCurrentUser.mockResolvedValue(user({ id: 'u-9', role: 'support_agent', customerId: null }));
    const res = await get(staffGet);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(page);
  });
});
