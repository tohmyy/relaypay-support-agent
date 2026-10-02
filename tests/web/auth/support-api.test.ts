import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  restSelect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/supabase.server', () => ({ restSelect: (...a: unknown[]) => h.restSelect(...a) }));

import { GET as ready } from '@/app/api/support/ready/route';
import { POST as start } from '@/app/api/support/start/route';
import { agentBaseUrl, agentIsReady } from '@/lib/support/agent.server';

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

const postStart = (headers: Record<string, string> = {}) =>
  start(new Request('http://localhost/api/support/start', { method: 'POST', headers }));

beforeEach(() => {
  h.getCurrentUser.mockReset();
  h.restSelect.mockReset();
  h.restSelect.mockResolvedValue([]);
  vi.unstubAllEnvs();
});

describe('POST /api/support/start', () => {
  it('requires a signed-in customer (401 / 403)', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await postStart()).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(staff);
    expect((await postStart()).status).toBe(403);
    expect(h.restSelect).not.toHaveBeenCalled();
  });

  it('refuses requests from another site', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await postStart({ Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('authorizes a customer within their limits and never caches', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    const res = await postStart();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ authorized: true });
  });

  it('refuses a second active conversation', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restSelect.mockResolvedValue([
      { conversation_id: 'vapi_other', started_at: new Date().toISOString(), last_activity_at: new Date().toISOString() },
    ]);
    const res = await postStart();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ authorized: false, error: 'active-session' });
  });

  it('ignores an abandoned open conversation', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    h.restSelect.mockResolvedValue([{ conversation_id: 'vapi_old', started_at: old, last_activity_at: old }]);
    expect((await postStart()).status).toBe(200);
  });

  it('reports a database failure without leaking detail', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restSelect.mockRejectedValue(new Error('conversations query failed (500) db.internal'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await postStart();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/db\.internal|500/);
    spy.mockRestore();
  });
});

describe('GET /api/support/ready', () => {
  it('requires a signed-in customer (401 / 403)', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await ready()).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(staff);
    expect((await ready()).status).toBe(403);
  });

  it('says only available or unavailable, never which part is down', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    vi.stubEnv('AGENT_API_TOKEN', 'agent-token-0123456789');
    // The agent is not running in tests, so the call fails and the answer is the safe "unavailable".
    vi.stubEnv('AGENT_INTERNAL_URL', 'http://127.0.0.1:1');
    const res = await ready();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(body)).not.toMatch(/mcp|supabase|127\.0\.0\.1|vapi/i);
  });
});

describe('agentIsReady', () => {
  const env = { AGENT_API_TOKEN: 'agent-token-0123456789', AGENT_HOST: '10.0.0.5', AGENT_PORT: '4100' };
  const noSleep = async () => {};

  it('builds the agent URL from the environment', () => {
    expect(agentBaseUrl(env)).toBe('http://10.0.0.5:4100');
    expect(agentBaseUrl({ AGENT_INTERNAL_URL: 'https://agent.internal/' })).toBe('https://agent.internal');
    expect(agentBaseUrl({})).toBe('http://127.0.0.1:4100');
  });

  it('sends the bearer token and is true on a 200', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await agentIsReady({ env, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:4100/ready');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer agent-token-0123456789');
  });

  it('retries a 503 exactly once, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await agentIsReady({ env, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('is false after the one retry also fails (never a third attempt)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    expect(await agentIsReady({ env, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent failure, and is false without a token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await agentIsReady({ env, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await agentIsReady({ env: {}, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })).toBe(false);
  });
});
