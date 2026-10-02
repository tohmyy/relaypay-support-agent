import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));

import Home from '@/app/page';

beforeEach(() => h.getCurrentUser.mockReset());

// AC-39.1: `/` never hosts a call: everyone is sent somewhere that needs a sign-in.
describe('the root page sends everyone to the right place', () => {
  it('signed out → sign in', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    await expect(Home()).rejects.toThrow('REDIRECT:/login?signedout=1');
  });

  it('a customer → their dashboard', async () => {
    h.getCurrentUser.mockResolvedValue({ role: 'customer', customerId: 'CUS-1001' });
    await expect(Home()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('staff → the staff area', async () => {
    h.getCurrentUser.mockResolvedValue({ role: 'support_agent', customerId: null });
    await expect(Home()).rejects.toThrow('REDIRECT:/staff');
    h.getCurrentUser.mockResolvedValue({ role: 'support_admin', customerId: null });
    await expect(Home()).rejects.toThrow('REDIRECT:/staff');
  });
});
