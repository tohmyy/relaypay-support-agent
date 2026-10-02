import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  restSelect: vi.fn(),
  restInsert: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/dashboard/data.server', () => ({ getConversation: (...a: unknown[]) => h.getConversation(...a) }));
vi.mock('@/lib/supabase.server', () => ({
  restSelect: (...a: unknown[]) => h.restSelect(...a),
  restInsert: (...a: unknown[]) => h.restInsert(...a),
}));
vi.mock('@/lib/auth/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rate-limit')>('@/lib/auth/rate-limit');
  return { ...actual, rateLimit: (...a: unknown[]) => h.rateLimit(...a) };
});

import { POST } from '@/app/api/support/text-turn/route';

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
const staff = customer({ id: 'u-9', role: 'support_agent', customerId: null });

const openRow = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'text_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-05T09:00:00Z',
  ended_at: null,
  final_status: null,
  end_reason: null,
  support_mode: 'ai',
  assigned_staff_id: null,
  ...over,
});

let agentFetch: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.restSelect.mockResolvedValue([]);
  h.restInsert.mockResolvedValue(undefined);
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
  vi.stubEnv('AGENT_API_TOKEN', 'agent-token-0123456789');
  vi.stubEnv('AGENT_INTERNAL_URL', 'http://agent.internal:4100');
  agentFetch = vi.fn(async () => new Response(JSON.stringify({ response: 'It is processing.', ended: false }), { status: 200 }));
  vi.stubGlobal('fetch', agentFetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = realFetch;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/support/text-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('POST /api/support/text-turn', () => {
  it('requires a signed-in customer and a same-origin request', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await post({ message: 'hi' })).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(staff);
    expect((await post({ message: 'hi' })).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await post({ message: 'hi' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(agentFetch).not.toHaveBeenCalled();
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('validates the message and the conversation id before doing anything', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await post('not json')).status).toBe(400);
    expect((await post({ message: '   ' })).status).toBe(400);
    expect((await post({ message: 'x'.repeat(2001) })).status).toBe(413);
    expect((await post({ message: 'hi', conversationId: 'a b' })).status).toBe(400);
    expect((await post({ message: 'hi', conversationId: 42 })).status).toBe(400);
    expect(agentFetch).not.toHaveBeenCalled();
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('starts a conversation for the signed-in customer (never one named in the request) and runs the turn', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    const res = await post({ message: 'Where is my payout?', customerId: 'CUS-1002', customer_id: 'CUS-1002' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ response: 'It is processing.', ended: false });
    expect(body.conversationId).toMatch(/^text_[0-9a-f]{32}$/);

    const [table, row] = h.restInsert.mock.calls[0];
    expect(table).toBe('conversations');
    expect(row).toEqual({ conversation_id: body.conversationId, channel: 'text', customer_id: 'CUS-1001', user_id: 'u-1' });

    const [url, init] = agentFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://agent.internal:4100/text-turn');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer agent-token-0123456789');
    expect(JSON.parse(String(init.body))).toEqual({ conversationId: body.conversationId, message: 'Where is my payout?' });
  });

  it('continues the customer’s own open conversation', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.getConversation.mockResolvedValue(openRow());
    const res = await post({ message: 'And my invoice?', conversationId: 'text_abc' });
    expect(res.status).toBe(200);
    expect(h.restInsert).not.toHaveBeenCalled();
    expect(JSON.parse(String((agentFetch.mock.calls[0][1] as RequestInit).body))).toMatchObject({ conversationId: 'text_abc' });
  });

  it('treats someone else’s or an unknown conversation as not found, and a closed one as not open', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.getConversation.mockResolvedValue(openRow({ customer_id: 'CUS-1002' }));
    expect((await post({ message: 'hi', conversationId: 'text_abc' })).status).toBe(404);
    h.getConversation.mockResolvedValue(null);
    expect((await post({ message: 'hi', conversationId: 'text_abc' })).status).toBe(404);
    h.getConversation.mockResolvedValue(openRow({ ended_at: '2026-10-05T09:05:00Z' }));
    expect((await post({ message: 'hi', conversationId: 'text_abc' })).status).toBe(409);
    h.getConversation.mockResolvedValue(openRow({ support_mode: 'human' }));
    expect((await post({ message: 'hi', conversationId: 'text_abc' })).status).toBe(409);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it('refuses a second active conversation when starting a new one', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restSelect.mockResolvedValue([
      { conversation_id: 'vapi_other', started_at: new Date().toISOString(), last_activity_at: new Date().toISOString() },
    ]);
    const res = await post({ message: 'hi' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'active-session' });
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('is rate limited', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17, shared: true });
    const res = await post({ message: 'hi' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('17');
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it('never retries the turn automatically, and reports a failure without detail', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    agentFetch.mockResolvedValue(new Response('boom at db.internal', { status: 503 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ message: 'hi' });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/db\.internal|503/);
    expect(agentFetch).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('is unavailable without the agent token', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    vi.stubEnv('AGENT_API_TOKEN', '');
    expect((await post({ message: 'hi' })).status).toBe(503);
    expect(h.restInsert).not.toHaveBeenCalled();
  });
});
