import { describe, expect, it } from 'vitest';
import { getSessionSecret } from '@/lib/auth/secret';
import { SESSION_TTL_SECONDS, signSession, verifySession } from '@/lib/auth/token';

const SECRET = 'a'.repeat(40);
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

describe('session token', () => {
  it('round-trips the claims', () => {
    const token = signSession({ uid: 'u1', role: 'customer', cid: 'CUS-1001' }, SECRET, { now: NOW });
    expect(verifySession(token, SECRET, NOW + 1000)).toEqual({
      uid: 'u1',
      role: 'customer',
      cid: 'CUS-1001',
      iat: NOW / 1000,
      exp: NOW / 1000 + SESSION_TTL_SECONDS,
    });
  });

  it('omits the customer id for staff', () => {
    const token = signSession({ uid: 's1', role: 'support_agent' }, SECRET, { now: NOW });
    expect(verifySession(token, SECRET, NOW)?.cid).toBeUndefined();
  });

  it('rejects a different secret', () => {
    const token = signSession({ uid: 'u1', role: 'customer', cid: 'CUS-1001' }, SECRET, { now: NOW });
    expect(verifySession(token, 'b'.repeat(40), NOW)).toBeNull();
  });

  it('rejects a tampered payload even with the old signature', () => {
    const token = signSession({ uid: 'u1', role: 'customer', cid: 'CUS-1001' }, SECRET, { now: NOW });
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ uid: 'u1', role: 'support_admin', iat: NOW / 1000, exp: NOW / 1000 + 99999 }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession({ uid: 'u1', role: 'customer', cid: 'c' }, SECRET, { now: NOW, ttlSeconds: 60 });
    expect(verifySession(token, SECRET, NOW + 59_000)).not.toBeNull();
    expect(verifySession(token, SECRET, NOW + 60_000)).toBeNull();
  });

  it('rejects junk without throwing', () => {
    for (const junk of [undefined, null, '', 'a', 'a.b', 'a.b.c', '.', 'x'.repeat(5000), '%%%.%%%', '{}.{}']) {
      expect(verifySession(junk as string | null | undefined, SECRET, NOW)).toBeNull();
    }
  });

  it('rejects a correctly signed token with an unknown role', () => {
    const bad = signSession({ uid: 'u1', role: 'root' as never }, SECRET, { now: NOW });
    expect(verifySession(bad, SECRET, NOW)).toBeNull();
  });
});

describe('session secret', () => {
  it('requires 32 or more characters and has no default', () => {
    expect(() => getSessionSecret({})).toThrow(/SESSION_SECRET/);
    expect(() => getSessionSecret({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(getSessionSecret({ SESSION_SECRET: SECRET })).toBe(SECRET);
  });

  it('never prints the value in its error', () => {
    let message = '';
    try {
      getSessionSecret({ SESSION_SECRET: 'too-short-secret' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain('SESSION_SECRET');
    expect(message).not.toContain('too-short-secret');
  });
});
