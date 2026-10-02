import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_CHARS, hashPassword, verifyAgainstDecoy, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
  });

  it('uses a fresh salt each time and a self-describing format', async () => {
    const [a, b] = await Promise.all([hashPassword('same password 1'), hashPassword('same password 1')]);
    expect(a).not.toBe(b);
    expect(a.split('$')).toHaveLength(6);
    expect(a.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(a).not.toContain('same password');
  });

  it('refuses to hash passwords outside the length bounds', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
    await expect(hashPassword('x'.repeat(MAX_PASSWORD_CHARS + 1))).rejects.toThrow();
  });

  it('treats malformed stored hashes as a failed login, never an error', async () => {
    for (const stored of ['', 'plain', 'scrypt$1$2', 'bcrypt$16384$8$1$aaaaaaaaaaaa$bbbb', 'scrypt$x$8$1$aaaaaaaaaaaa$bbbb']) {
      expect(await verifyPassword('whatever12345', stored)).toBe(false);
    }
  });

  it('refuses cost parameters large enough to be a denial of service', async () => {
    const hash = await hashPassword('correct horse battery');
    const parts = hash.split('$');
    parts[1] = String(2 ** 30);
    expect(await verifyPassword('correct horse battery', parts.join('$'))).toBe(false);
  });

  it('rejects empty and over-long attempts without doing the work', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('x'.repeat(MAX_PASSWORD_CHARS + 1), hash)).toBe(false);
  });

  it('the decoy check spends real time and always fails', async () => {
    const start = Date.now();
    expect(await verifyAgainstDecoy('anything at all')).toBe(false);
    expect(await verifyAgainstDecoy('anything at all')).toBe(false);
    expect(Date.now() - start).toBeGreaterThan(5);
  });
});
