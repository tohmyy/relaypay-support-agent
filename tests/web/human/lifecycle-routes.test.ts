import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  restRpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/dashboard/data.server', () => ({ getConversation: (...a: unknown[]) => h.getConversation(...a) }));
vi.mock('@/lib/supabase.server', () => ({ restRpc: (...a: unknown[]) => h.restRpc(...a) }));

import { POST as staffPost } from '@/app/api/staff/conversations/[id]/messages/route';
import { POST as claim } from '@/app/api/staff/conversations/[id]/claim/route';
import { POST as close } from '@/app/api/staff/conversations/[id]/close/route';

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

const human = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-03T11:55:00Z',
  ended_at: null,
  final_status: 'escalated',
  end_reason: null,
  support_mode: 'human',
  assigned_staff_id: 'u-9',
  staff_typing_at: null,
  customer_typing_at: null,
  ...over,
});

const ctx = { params: Promise.resolve({ id: 'vapi_abc' }) };
const post = (fn: typeof staffPost, body?: unknown) =>
  fn(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  h.getCurrentUser.mockReset();
  h.getConversation.mockReset();
  h.restRpc.mockReset();
  h.getCurrentUser.mockResolvedValue(staff());
  h.getConversation.mockResolvedValue(human());
  h.restRpc.mockResolvedValue({ outcome: 'ok' });
});

describe('lifecycle routes (AC-46, close-during-send)', () => {
  it('returns 409 with the current state for a stale or repeated claim', async () => {
    h.restRpc.mockResolvedValue({ outcome: 'taken', state: { assigned_staff_id: 'u-8' } });
    const res = await post(claim);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'taken', state: { assigned_staff_id: 'u-8' } });
  });

  it('returns 409 with the current state for a double close', async () => {
    h.restRpc.mockResolvedValue({ outcome: 'not-open', state: { support_mode: 'ended', ended_at: 'x' } });
    const res = await post(close);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not-open', state: { support_mode: 'ended' } });
  });

  it('refuses a message that loses the race to a close (409 closed)', async () => {
    h.restRpc.mockResolvedValue({ outcome: 'closed' });
    const res = await post(staffPost, { body: 'Still here?' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(h.restRpc).toHaveBeenCalledWith('add_human_message', expect.objectContaining({ p_conversation_id: 'vapi_abc' }));
  });
});
