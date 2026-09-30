import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time bearer token check. Hashing equalizes lengths so length is not leaked. */
export function isAuthorized(header: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match) return false;
  const a = createHash('sha256').update(match[1]).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}
