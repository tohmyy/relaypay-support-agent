import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  restSelect: vi.fn(),
  restRpc: vi.fn(),
  sendAgentControl: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/supabase.server', () => ({
  restSelect: (...a: unknown[]) => h.restSelect(...a),
  restRpc: (...a: unknown[]) => h.restRpc(...a),
}));
vi.mock('@/lib/support/agent.server', () => ({ sendAgentControl: (...a: unknown[]) => h.sendAgentControl(...a) }));

import { POST } from '@/app/api/support/start/route';

const customer = (over: Partial<CurrentUser> = {}): CurrentUser => ({
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

const post = (body: unknown = {}) =>
  POST(
    new Request('http://localhost/api/support/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  h.getCurrentUser.mockReset();
  h.restSelect.mockReset();
  h.restRpc.mockReset();
  h.sendAgentControl.mockReset();
  h.getCurrentUser.mockResolvedValue(customer());
  h.restSelect.mockResolvedValue([]);
  h.sendAgentControl.mockResolvedValue(true);
  h.restRpc.mockResolvedValue({ outcome: 'replaced' });
});

describe('POST /api/support/start replace', () => {
  it('lets the owner end the active conversation and start a new one', async () => {
    h.restSelect.mockResolvedValue([{ customer_id: 'CUS-1001' }]);
    const res = await post({ replace: true, conversationId: 'vapi_old' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: true });
    expect(h.sendAgentControl).toHaveBeenCalledWith('/end-session', { conversationId: 'vapi_old' });
    expect(h.restRpc).toHaveBeenCalledWith('replace_active_conversation', {
      p_customer_id: 'CUS-1001',
      p_old_id: 'vapi_old',
    });
  });

  it('hides another customer\'s conversation (AC-44.2)', async () => {
    h.restSelect.mockResolvedValue([{ customer_id: 'CUS-2002' }]);
    const res = await post({ replace: true, conversationId: 'vapi_other' });
    expect(res.status).toBe(404);
    expect(h.sendAgentControl).not.toHaveBeenCalled();
    expect(h.restRpc).not.toHaveBeenCalled();
  });

  it('returns the active conversation id when a second start is blocked', async () => {
    h.restSelect.mockResolvedValue([
      { conversation_id: 'vapi_live', started_at: new Date().toISOString(), last_activity_at: new Date().toISOString() },
    ]);
    const res = await post({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      authorized: false,
      error: 'active-session',
      activeConversationId: 'vapi_live',
    });
  });

  it('converges concurrent replacements on the database function', async () => {
    h.restSelect.mockResolvedValue([{ customer_id: 'CUS-1001' }]);
    const [a, b] = await Promise.all([
      post({ replace: true, conversationId: 'vapi_old' }),
      post({ replace: true, conversationId: 'vapi_old' }),
    ]);
    expect([a.status, b.status].every((s) => s === 200)).toBe(true);
    expect(h.restRpc).toHaveBeenCalledTimes(2);
  });
});
