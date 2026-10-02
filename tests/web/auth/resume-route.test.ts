import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/dashboard/data.server', () => ({ getConversation: (...a: unknown[]) => h.getConversation(...a) }));
vi.mock('@/lib/auth/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rate-limit')>('@/lib/auth/rate-limit');
  return { ...actual, rateLimit: (...a: unknown[]) => h.rateLimit(...a) };
});

import { POST } from '@/app/api/support/conversations/[id]/resume/route';

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
const row = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-05T09:00:00Z',
  ended_at: '2026-10-05T09:05:00Z',
  final_status: 'resolved',
  end_reason: 'user-ended',
  support_mode: 'ai',
  assigned_staff_id: null,
  ...over,
});

let agent: ReturnType<typeof vi.fn>;
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.getCurrentUser.mockResolvedValue(customer());
  h.getConversation.mockResolvedValue(row());
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
  vi.stubEnv('AGENT_API_TOKEN', 'agent-token-0123456789');
  vi.stubEnv('AGENT_INTERNAL_URL', 'http://agent.internal:4100');
  agent = vi.fn(async () => new Response(JSON.stringify({ reopened: true }), { status: 200 }));
  vi.stubGlobal('fetch', agent);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (id = 'vapi_abc', headers: Record<string, string> = {}) =>
  POST(new Request(`http://localhost/api/support/conversations/${id}/resume`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  });

describe('POST /api/support/conversations/[id]/resume', () => {
  it('requires a signed-in customer on this site, and a valid id', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(customer({ role: 'support_agent', customerId: null }));
    expect((await post()).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await post('vapi_abc', { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('a b')).status).toBe(400);
    expect(agent).not.toHaveBeenCalled();
  });

  it('passes the customer from the session to the voice agent, which owns the rule, and reports success', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resumed: true });
    const [url, init] = agent.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://agent.internal:4100/resume');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer agent-token-0123456789');
    expect(JSON.parse(String(init.body))).toEqual({ conversationId: 'vapi_abc', customerId: 'CUS-1001' });
  });

  it('treats a conversation that is already open as resumable (a double click)', async () => {
    agent.mockResolvedValue(new Response(JSON.stringify({ reopened: false, reason: 'not-ended' }), { status: 200 }));
    expect(await (await post()).json()).toEqual({ resumed: true });
  });

  it.each(['expired', 'not-resumable', 'human', 'raced'])('says the window has passed when the agent refuses with %s (AC-16.4)', async (reason) => {
    agent.mockResolvedValue(new Response(JSON.stringify({ reopened: false, reason }), { status: 200 }));
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ resumed: false, error: 'expired' });
  });

  it("treats someone else's and unknown conversations as not found without asking the agent", async () => {
    h.getConversation.mockResolvedValue(row({ customer_id: 'CUS-1002' }));
    expect((await post()).status).toBe(404);
    h.getConversation.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(agent).not.toHaveBeenCalled();
  });

  it('is rate limited, and unavailable without detail when the agent cannot be reached', async () => {
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 5, shared: true });
    expect((await post()).status).toBe(429);
    h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
    agent.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:4100'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(agent).toHaveBeenCalledTimes(1); // never retried automatically
    spy.mockRestore();
  });
});
