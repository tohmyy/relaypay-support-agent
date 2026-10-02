import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/token';

const SECRET = 's'.repeat(40);

const h = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  cookieSets: [] as unknown[][],
  cookieDeletes: [] as string[],
  requestHeaders: {} as Record<string, string>,
  restSelect: vi.fn(),
  restPatch: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookieJar.has(name) ? { name, value: h.cookieJar.get(name) } : undefined),
    set: (...args: unknown[]) => h.cookieSets.push(args),
    delete: (name: string) => h.cookieDeletes.push(name),
  }),
  headers: async () => new Headers(h.requestHeaders),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/supabase.server', () => ({
  restSelect: (...a: unknown[]) => h.restSelect(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
}));

import { login, logout } from '@/app/(auth)/login/actions';
import { getCurrentUser, requireCustomer, requireStaff, requireUser } from '@/lib/auth/dal';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { SHELL_COPY } from '@/lib/shell-copy';

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u-1',
  email: 'amara@lagosledger.example',
  role: 'customer',
  customer_id: 'CUS-1001',
  display_name: 'Amara Okafor',
  title: null,
  avatar_url: null,
  disabled: false,
  password_hash: 'must-never-be-returned',
  ...over,
});

const cookieFor = (claims: Parameters<typeof signSession>[0]) => signSession(claims, SECRET);

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', SECRET);
  h.cookieJar.clear();
  h.cookieSets.length = 0;
  h.cookieDeletes.length = 0;
  h.requestHeaders = {};
  h.restSelect.mockReset();
  h.restPatch.mockReset();
  h.restPatch.mockResolvedValue([]);
});

describe('data-access layer', () => {
  const signIn = (claims: Parameters<typeof signSession>[0] = { uid: 'u-1', role: 'customer', cid: 'CUS-1001' }) =>
    h.cookieJar.set(SESSION_COOKIE, cookieFor(claims));

  it('has no user without a cookie, with a forged one, or without a configured secret', async () => {
    expect(await getCurrentUser()).toBeNull();
    h.cookieJar.set(SESSION_COOKIE, 'forged.value');
    expect(await getCurrentUser()).toBeNull();
    signIn();
    vi.stubEnv('SESSION_SECRET', '');
    expect(await getCurrentUser()).toBeNull();
    expect(h.restSelect).not.toHaveBeenCalled();
  });

  it('returns the user from the database and never the password hash', async () => {
    signIn();
    h.restSelect.mockResolvedValue([userRow()]);
    const user = await getCurrentUser();
    expect(user).toMatchObject({ id: 'u-1', role: 'customer', customerId: 'CUS-1001', displayName: 'Amara Okafor' });
    expect(JSON.stringify(user)).not.toContain('must-never-be-returned');
    expect(h.restSelect.mock.calls[0][1]).not.toContain('password_hash');
  });

  it('signs out a disabled user, a changed role, a changed customer and a missing row at once', async () => {
    signIn();
    h.restSelect.mockResolvedValue([userRow({ disabled: true })]);
    expect(await getCurrentUser()).toBeNull();
    h.restSelect.mockResolvedValue([userRow({ role: 'support_admin', customer_id: null })]);
    expect(await getCurrentUser()).toBeNull();
    h.restSelect.mockResolvedValue([userRow({ customer_id: 'CUS-1002' })]);
    expect(await getCurrentUser()).toBeNull();
    h.restSelect.mockResolvedValue([]);
    expect(await getCurrentUser()).toBeNull();
  });

  it('fails closed when the database cannot be reached', async () => {
    signIn();
    h.restSelect.mockRejectedValue(new Error('app_users query failed (500)'));
    expect(await getCurrentUser()).toBeNull();
  });

  it('requireUser sends visitors to the login page with a way back', async () => {
    await expect(requireUser('/payments')).rejects.toThrow('REDIRECT:/login?next=%2Fpayments');
    await expect(requireUser()).rejects.toThrow('REDIRECT:/login?signedout=1');
  });

  it('keeps each role in its own area', async () => {
    signIn();
    h.restSelect.mockResolvedValue([userRow()]);
    await expect(requireCustomer()).resolves.toMatchObject({ role: 'customer' });
    await expect(requireStaff()).rejects.toThrow('REDIRECT:/dashboard');

    signIn({ uid: 'u-2', role: 'support_agent' });
    h.restSelect.mockResolvedValue([userRow({ id: 'u-2', role: 'support_agent', customer_id: null })]);
    await expect(requireStaff()).resolves.toMatchObject({ role: 'support_agent' });
    await expect(requireCustomer()).rejects.toThrow('REDIRECT:/staff');
  });
});

describe('login action', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  let hash: string;
  let n = 0;
  const unique = () => `10.0.0.${++n}`;

  beforeEach(async () => {
    hash ??= await hashPassword('correct horse battery');
    h.requestHeaders = { 'x-forwarded-for': unique() };
  });

  const dbUser = (over: Record<string, unknown> = {}) => ({
    id: 'u-1',
    password_hash: hash,
    role: 'customer',
    customer_id: 'CUS-1001',
    disabled: false,
    ...over,
  });

  it('signs in, sets a hardened cookie and sends the customer to the dashboard', async () => {
    h.restSelect.mockResolvedValue([dbUser()]);
    await expect(login({ error: null }, form({ email: ' Amara@LagosLedger.example ', password: 'correct horse battery' }))).rejects.toThrow(
      'REDIRECT:/dashboard',
    );
    expect(h.restSelect.mock.calls[0][1]).toContain('email=eq.amara%40lagosledger.example');
    const [name, value, options] = h.cookieSets[0] as [string, string, Record<string, unknown>];
    expect(name).toBe(SESSION_COOKIE);
    expect(value).toContain('.');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 });
    expect(h.restPatch).toHaveBeenCalledWith('app_users', 'id=eq.u-1', expect.objectContaining({ last_login_at: expect.any(String) }));
  });

  it('sends staff to the queue and honours a safe next path', async () => {
    h.restSelect.mockResolvedValue([dbUser({ role: 'support_agent', customer_id: null })]);
    await expect(login({ error: null }, form({ email: 's@relaypay.example', password: 'correct horse battery' }))).rejects.toThrow(
      'REDIRECT:/staff',
    );
    h.requestHeaders = { 'x-forwarded-for': unique() };
    h.restSelect.mockResolvedValue([dbUser()]);
    await expect(
      login({ error: null }, form({ email: 'a@x.example', password: 'correct horse battery', next: '/payments' })),
    ).rejects.toThrow('REDIRECT:/payments');
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example'])('ignores the unsafe next %s', async (next) => {
    h.requestHeaders = { 'x-forwarded-for': unique() };
    h.restSelect.mockResolvedValue([dbUser()]);
    await expect(login({ error: null }, form({ email: 'a@x.example', password: 'correct horse battery', next }))).rejects.toThrow(
      'REDIRECT:/dashboard',
    );
  });

  it('gives one message for a wrong password, an unknown email and a disabled account', async () => {
    h.restSelect.mockResolvedValue([dbUser()]);
    const wrong = await login({ error: null }, form({ email: 'a@x.example', password: 'not the password' }));
    h.restSelect.mockResolvedValue([]);
    const unknown = await login({ error: null }, form({ email: 'nobody@x.example', password: 'correct horse battery' }));
    h.restSelect.mockResolvedValue([dbUser({ disabled: true })]);
    const disabled = await login({ error: null }, form({ email: 'a@x.example', password: 'correct horse battery' }));
    for (const r of [wrong, unknown, disabled]) expect(r.error).toBe(SHELL_COPY.signIn.invalid);
    expect(h.cookieSets).toHaveLength(0);
  });

  it('still spends hashing time for an unknown email', async () => {
    h.restSelect.mockResolvedValue([]);
    await login({ error: null }, form({ email: 'warm@x.example', password: 'whatever12345' })); // builds the decoy once
    const start = performance.now();
    await login({ error: null }, form({ email: 'nobody@x.example', password: 'whatever12345' }));
    expect(performance.now() - start).toBeGreaterThan(5);
  });

  it('rejects malformed input without touching the database', async () => {
    const r = await login({ error: null }, form({ email: 'not-an-email', password: '' }));
    expect(r.error).toBe(SHELL_COPY.signIn.invalid);
    expect(h.restSelect).not.toHaveBeenCalled();
  });

  it('blocks further attempts after five failures, before looking anyone up', async () => {
    h.restSelect.mockResolvedValue([dbUser()]);
    const attempt = () => login({ error: null }, form({ email: 'a@x.example', password: 'wrong password!' }));
    for (let i = 0; i < 5; i++) expect((await attempt()).error).toBe(SHELL_COPY.signIn.invalid);
    h.restSelect.mockClear();
    expect((await attempt()).error).toBe(SHELL_COPY.signIn.tooMany);
    expect(h.restSelect).not.toHaveBeenCalled();
  });

  it('reports a database failure as unavailable, without detail', async () => {
    h.restSelect.mockRejectedValue(new Error('app_users query failed (500)'));
    const r = await login({ error: null }, form({ email: 'a@x.example', password: 'correct horse battery' }));
    expect(r.error).toBe(SHELL_COPY.signIn.unavailable);
    expect(r.error).not.toContain('500');
  });

  it('fails without a configured secret instead of signing anyone in', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    h.restSelect.mockResolvedValue([dbUser()]);
    const r = await login({ error: null }, form({ email: 'a@x.example', password: 'correct horse battery' }));
    expect(r.error).toBe(SHELL_COPY.signIn.unavailable);
    expect(h.cookieSets).toHaveLength(0);
  });

  it('logout clears the cookie and goes to the login page', async () => {
    await expect(logout()).rejects.toThrow('REDIRECT:/login');
    expect(h.cookieDeletes).toEqual([SESSION_COOKIE]);
  });
});

describe('proxy', () => {
  async function run(path: string, claims?: Parameters<typeof signSession>[0], secret = SECRET) {
    vi.stubEnv('SESSION_SECRET', secret);
    const { proxy } = await import('@/proxy');
    const headers: Record<string, string> = claims ? { cookie: `${SESSION_COOKIE}=${cookieFor(claims)}` } : {};
    return proxy(new NextRequest(`http://localhost${path}`, { headers }));
  }
  const location = (res: Response) => (res.headers.get('location') ? new URL(res.headers.get('location') as string).pathname + new URL(res.headers.get('location') as string).search : null);

  it('sends signed-out visitors to the login page and remembers where they were going', async () => {
    const res = await run('/payments?x=1');
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/login?next=%2Fpayments%3Fx%3D1');
  });

  it('lets a signed-in customer into the customer area and keeps them out of staff', async () => {
    const claims = { uid: 'u', role: 'customer', cid: 'CUS-1001' } as const;
    expect((await run('/dashboard', claims)).headers.get('location')).toBeNull();
    expect(location(await run('/staff/conversations', claims))).toBe('/dashboard');
  });

  it('keeps staff out of the customer area and sends them home from login', async () => {
    const claims = { uid: 's', role: 'support_agent' } as const;
    expect(location(await run('/dashboard', claims))).toBe('/staff');
    expect((await run('/staff', claims)).headers.get('location')).toBeNull();
    expect(location(await run('/login', claims))).toBe('/staff');
  });

  it('treats a forged cookie, an expired cookie and a missing secret as signed out', async () => {
    const claims = { uid: 'u', role: 'customer', cid: 'CUS-1001' } as const;
    expect(location(await run('/dashboard', claims, 'x'.repeat(40)))).toContain('/login');
    expect(location(await run('/dashboard', claims, ''))).toContain('/login');
    const { proxy } = await import('@/proxy');
    vi.stubEnv('SESSION_SECRET', SECRET);
    const expired = signSession(claims, SECRET, { now: Date.now() - 9 * 3600 * 1000 });
    const res = proxy(new NextRequest('http://localhost/dashboard', { headers: { cookie: `${SESSION_COOKIE}=${expired}` } }));
    expect(location(res)).toContain('/login');
  });

  it('does not bounce someone the real check refused: a valid-looking cookie may still see the form', async () => {
    const claims = { uid: 'u', role: 'customer', cid: 'CUS-1001' } as const;
    expect((await run('/login?signedout=1', claims)).headers.get('location')).toBeNull();
    expect((await run('/login?next=%2Fdashboard', claims)).headers.get('location')).toBeNull();
    // ...while a plain visit to /login with a good cookie still goes to the right area.
    expect(location(await run('/login', claims))).toBe('/dashboard');
  });

  it('lets the login page through for visitors and declares a static matcher', async () => {
    expect((await run('/login')).headers.get('location')).toBeNull();
    const { config } = await import('@/proxy');
    expect(config.matcher).toEqual(['/', '/login', '/dashboard', '/payments', '/payouts', '/invoices', '/support/:path*', '/settings', '/staff/:path*']);
  });

  it('sends the root to sign-in, or to the right area when signed in', async () => {
    expect(location(await run('/'))).toBe('/login');
    expect(location(await run('/', { uid: 'u', role: 'customer', cid: 'CUS-1001' }))).toBe('/dashboard');
    expect(location(await run('/', { uid: 's', role: 'support_agent' }))).toBe('/staff');
    expect(location(await run('/', { uid: 'a', role: 'support_admin' }))).toBe('/staff');
    expect(location(await run('/', { uid: 'u', role: 'customer', cid: 'CUS-1001' }, 'x'.repeat(40)))).toBe('/login');
  });

  it('does not cover the APIs or the developer pages', async () => {
    const { config } = await import('@/proxy');
    for (const open of ['/api/conversations/x/state', '/dev/states']) {
      expect(config.matcher.some((m) => m === open)).toBe(false);
    }
  });
});
