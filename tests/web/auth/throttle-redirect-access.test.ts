import { describe, expect, it } from 'vitest';
import { canAccessConversation, canEnterArea, homeFor } from '@/lib/auth/access';
import { safeNext } from '@/lib/auth/redirects';
import { LoginThrottle } from '@/lib/auth/throttle';

describe('LoginThrottle', () => {
  function make(maxKeys?: number) {
    const clock = { t: 1_000_000 };
    return { clock, throttle: new LoginThrottle({ now: () => clock.t, maxKeys }) };
  }

  it('allows attempts until the limit, then blocks until the window passes', () => {
    const { clock, throttle } = make();
    const key = LoginThrottle.key('A@x.example ', '1.2.3.4');
    for (let i = 0; i < 4; i++) throttle.recordFailure(key);
    expect(throttle.retryAfterMs(key)).toBe(0);
    throttle.recordFailure(key);
    expect(throttle.retryAfterMs(key)).toBe(15 * 60_000);
    clock.t += 15 * 60_000 - 1;
    expect(throttle.retryAfterMs(key)).toBeGreaterThan(0);
    clock.t += 2;
    expect(throttle.retryAfterMs(key)).toBe(0);
  });

  it('is case-insensitive on email and separate per address', () => {
    expect(LoginThrottle.key('Amara@X.example', '1.1.1.1')).toBe(LoginThrottle.key(' amara@x.example', '1.1.1.1'));
    expect(LoginThrottle.key('a@x.example', '1.1.1.1')).not.toBe(LoginThrottle.key('a@x.example', '2.2.2.2'));
  });

  it('a success clears the count', () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.recordFailure('k');
    expect(throttle.retryAfterMs('k')).toBeGreaterThan(0);
    throttle.recordSuccess('k');
    expect(throttle.retryAfterMs('k')).toBe(0);
  });

  it('bounds memory when flooded with made-up emails', () => {
    const { throttle } = make(10);
    for (let i = 0; i < 100; i++) throttle.recordFailure(`k${i}`);
    expect(throttle.size).toBeLessThanOrEqual(10);
  });
});

describe('safeNext', () => {
  it('accepts plain same-site paths', () => {
    expect(safeNext('/support', '/dashboard')).toBe('/support');
    expect(safeNext('/support/vapi_abc?x=1', '/dashboard')).toBe('/support/vapi_abc?x=1');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'support',
    '',
    '/ok\nLocation: x',
    '/login',
    '/login?next=/x',
    '/' + 'a'.repeat(600),
  ])('rejects %j', (value) => {
    expect(safeNext(value, '/dashboard')).toBe('/dashboard');
  });

  it('rejects non-strings', () => {
    expect(safeNext(undefined, '/dashboard')).toBe('/dashboard');
    expect(safeNext(['/a'], '/dashboard')).toBe('/dashboard');
  });
});

describe('access rules', () => {
  it('sends each role home and keeps areas apart', () => {
    expect(homeFor('customer')).toBe('/dashboard');
    expect(homeFor('support_agent')).toBe('/staff');
    expect(homeFor('support_admin')).toBe('/staff');
    expect(canEnterArea('customer', 'staff')).toBe(false);
    expect(canEnterArea('support_agent', 'customer')).toBe(false);
    expect(canEnterArea('support_admin', 'staff')).toBe(true);
  });

  const own = { customer_id: 'CUS-1001', ended_at: null, final_status: null };
  const other = { customer_id: 'CUS-1002', ended_at: '2026-10-02T10:00:00Z', final_status: 'resolved' };
  const anon = { customer_id: null, ended_at: null, final_status: null };
  const closedEscalated = { customer_id: 'CUS-1002', ended_at: '2026-10-02T10:00:00Z', final_status: 'escalated' };

  it('customers see only their own conversations', () => {
    const user = { role: 'customer' as const, customerId: 'CUS-1001' };
    expect(canAccessConversation(user, own)).toBe(true);
    expect(canAccessConversation(user, other)).toBe(false);
    expect(canAccessConversation(user, anon)).toBe(false);
  });

  it('a customer without a customer id sees nothing, even unlinked conversations', () => {
    expect(canAccessConversation({ role: 'customer', customerId: null }, anon)).toBe(false);
  });

  it('support agents see open or escalated conversations, admins see everything', () => {
    const agent = { role: 'support_agent' as const };
    expect(canAccessConversation(agent, own)).toBe(true);
    expect(canAccessConversation(agent, closedEscalated)).toBe(true);
    expect(canAccessConversation(agent, other)).toBe(false);
    expect(canAccessConversation({ role: 'support_admin' }, other)).toBe(true);
  });
});
