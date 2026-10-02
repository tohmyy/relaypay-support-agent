import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';
import { hashPassword } from '@/lib/auth/password';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  restSelect: vi.fn(),
  restInsert: vi.fn(),
  restPatch: vi.fn(),
  restRpc: vi.fn(),
  cookieSets: [] as unknown[][],
  requestHeaders: {} as Record<string, string>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: (...a: unknown[]) => h.cookieSets.push(a), delete: () => undefined }),
  headers: async () => new Headers(h.requestHeaders),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/supabase.server', () => ({
  restSelect: (...a: unknown[]) => h.restSelect(...a),
  restInsert: (...a: unknown[]) => h.restInsert(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
  restRpc: (...a: unknown[]) => h.restRpc(...a),
}));

import { login } from '@/app/(auth)/login/actions';
import { POST as link } from '@/app/api/support/link/route';
import { rateLimit, rateLimitReset } from '@/lib/auth/rate-limit';
import { SHELL_COPY } from '@/lib/shell-copy';

const customer: CurrentUser = {
  id: 'u-1',
  email: 'amara@lagosledger.example',
  role: 'customer',
  customerId: 'CUS-1001',
  displayName: 'Amara Okafor',
  title: null,
  avatarUrl: null,
  available: false,
};

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeEach(() => {
  for (const f of [h.getCurrentUser, h.restSelect, h.restInsert, h.restPatch, h.restRpc]) f.mockReset();
  h.cookieSets.length = 0;
  h.requestHeaders = {};
  h.restInsert.mockResolvedValue(undefined);
  h.restPatch.mockResolvedValue([{ conversation_id: 'vapi_new' }]);
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/support/link limits', () => {
  const post = () =>
    link(
      new Request('http://localhost/api/support/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'vapi_new' }),
      }),
    );

  /** First read: this conversation's start; second: other open sessions; third: sessions started in the window. */
  function reads(opts: { thisStarted?: string; open?: unknown[]; recent?: unknown[] }) {
    h.restSelect.mockImplementation(async (_table: string, query: string) => {
      if (query.startsWith('select=started_at&')) return [{ started_at: opts.thisStarted ?? iso(5_000) }];
      if (query.includes('support_mode=eq.ai')) return opts.open ?? [];
      return opts.recent ?? [];
    });
  }

  beforeEach(() => h.getCurrentUser.mockResolvedValue(customer));

  it('links and says all is well when nothing is broken', async () => {
    reads({});
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true });
  });

  it('still links, but tells the page about an earlier active conversation (409 active-session)', async () => {
    reads({ open: [{ conversation_id: 'vapi_old', started_at: iso(60_000), last_activity_at: iso(2_000) }] });
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ linked: true, error: 'active-session' });
    expect(h.restPatch).toHaveBeenCalled();
  });

  it('ignores earlier sessions that look abandoned, and later ones', async () => {
    reads({
      open: [
        { conversation_id: 'stale', started_at: iso(40 * 60_000), last_activity_at: iso(30 * 60_000) },
        { conversation_id: 'later', started_at: iso(1_000), last_activity_at: iso(500) },
      ],
    });
    expect((await post()).status).toBe(200);
  });

  it('reports too many sessions in the window (429), and honours 0 = off', async () => {
    reads({ recent: Array.from({ length: 10 }, (_, i) => ({ conversation_id: `c${i}` })) });
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ linked: true, error: 'rate-limited' });

    vi.stubEnv('SESSION_RATE_MAX', '0');
    expect((await post()).status).toBe(200);
    vi.unstubAllEnvs();
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('skips session creation rate limits outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    reads({ recent: Array.from({ length: 10 }, (_, i) => ({ conversation_id: `c${i}` })) });
    expect((await post()).status).toBe(200);
  });

  it('answers 503 unavailable when a limit check cannot be made, instead of passing silently (AC-47.2)', async () => {
    h.restSelect.mockRejectedValue(new Error('conversations query failed (500)'));
    h.restPatch.mockResolvedValue([{ conversation_id: 'vapi_new' }]);
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });

  it('writes the customer and the account in one update, so an owner is complete or absent', async () => {
    reads({});
    await post();
    expect(h.restPatch).toHaveBeenCalledWith('conversations', expect.stringContaining('customer_id=is.null'), {
      customer_id: 'CUS-1001',
      user_id: 'u-1',
    });
  });

  it('reports active-session when the one-active-conversation guarantee rejects the update (race)', async () => {
    h.restPatch.mockRejectedValue(new Error('conversations update failed (409)'));
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'active-session' });
  });

  it('still refuses a call that belongs to someone else', async () => {
    h.restPatch.mockResolvedValue([]);
    h.restSelect.mockResolvedValue([{ customer_id: 'CUS-1002' }]);
    expect((await post()).status).toBe(409);
    expect(await (await post()).json()).toEqual({ error: 'conflict' });
  });
});

describe('shared rate limiter', () => {
  it('counts a hit through the database function and reports the answer', async () => {
    h.restRpc.mockResolvedValue([{ allowed: true, hits: 1, retry_after_seconds: 0 }]);
    expect(await rateLimit('chat:c:vapi_abc', { windowSeconds: 60, max: 30 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      shared: true,
    });
    expect(h.restRpc).toHaveBeenCalledWith('rate_limit_hit', { p_key: 'chat:c:vapi_abc', p_window_seconds: 60, p_max: 30 });

    h.restRpc.mockResolvedValue([{ allowed: false, hits: 31, retry_after_seconds: 42 }]);
    expect(await rateLimit('k', { windowSeconds: 60, max: 30 })).toEqual({ allowed: false, retryAfterSeconds: 42, shared: true });
  });

  it('allows every request without touching the store outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(await rateLimit('k', { windowSeconds: 60, max: 1 })).toEqual({ allowed: true, retryAfterSeconds: 0, shared: true });
    expect(h.restRpc).not.toHaveBeenCalled();
  });

  it('fails open, and says it is not the shared answer, when the store cannot be reached', async () => {
    h.restRpc.mockRejectedValue(new Error('rate_limit_hit call failed (500)'));
    expect(await rateLimit('k', { windowSeconds: 60, max: 1 })).toEqual({ allowed: true, retryAfterSeconds: 0, shared: false });
    h.restRpc.mockResolvedValue(null);
    expect((await rateLimit('k', { windowSeconds: 60, max: 1 })).shared).toBe(false);
  });

  it('bounds the key length, and a reset never throws', async () => {
    h.restRpc.mockResolvedValue([{ allowed: true, hits: 1, retry_after_seconds: 0 }]);
    await rateLimit('x'.repeat(500), { windowSeconds: 60, max: 1 });
    expect((h.restRpc.mock.calls[0][1] as { p_key: string }).p_key).toHaveLength(200);
    h.restRpc.mockRejectedValue(new Error('down'));
    await expect(rateLimitReset('k')).resolves.toBeUndefined();
  });
});

describe('sign-in with the shared limiter', () => {
  const form = (email: string) => {
    const f = new FormData();
    f.set('email', email);
    f.set('password', 'correct horse battery');
    return f;
  };
  let hash: string;
  let n = 0;

  beforeEach(async () => {
    hash ??= await hashPassword('correct horse battery');
    h.requestHeaders = { 'x-forwarded-for': `10.1.0.${++n}` };
    h.restSelect.mockResolvedValue([{ id: 'u-1', password_hash: hash, role: 'customer', customer_id: 'CUS-1001', disabled: false }]);
  });

  it('refuses once the shared count is used up, without looking anyone up', async () => {
    h.restRpc.mockResolvedValue([{ allowed: false, hits: 6, retry_after_seconds: 600 }]);
    const r = await login({ error: null }, form('a@x.example'));
    expect(r.error).toBe(SHELL_COPY.signIn.tooMany);
    expect(h.restSelect).not.toHaveBeenCalled();
  });

  it('signs in and clears the count on success', async () => {
    h.restRpc.mockResolvedValue([{ allowed: true, hits: 1, retry_after_seconds: 0 }]);
    await expect(login({ error: null }, form('a@x.example'))).rejects.toThrow('REDIRECT:/dashboard');
    const calls = h.restRpc.mock.calls.map((c) => c[0]);
    expect(calls).toContain('rate_limit_hit');
    expect(calls).toContain('rate_limit_reset');
  });

  it('falls back to the in-memory limit when the shared store is down', async () => {
    h.restRpc.mockRejectedValue(new Error('down'));
    h.restSelect.mockResolvedValue([]);
    const attempt = () => login({ error: null }, form('fallback@x.example'));
    for (let i = 0; i < 5; i++) expect((await attempt()).error).toBe(SHELL_COPY.signIn.invalid);
    expect((await attempt()).error).toBe(SHELL_COPY.signIn.tooMany);
  });
});
