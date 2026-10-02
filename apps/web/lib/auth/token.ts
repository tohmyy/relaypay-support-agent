import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The session token: `<payload>.<signature>`, both base64url, signed with HMAC-SHA256. The payload is only
 * who and until when (user id, role, customer id for customers); nothing personal. Kept free of `server-only` and of
 * any database access so `proxy.ts` can verify it cheaply on every request. Whether the user still exists and is
 * allowed in is re-checked by the data-access layer (`dal.ts`), not here.
 */
export type Role = 'customer' | 'support_agent' | 'support_admin';
export const ROLES: readonly Role[] = ['customer', 'support_agent', 'support_admin'];

export interface SessionClaims {
  /** app_users.id */
  uid: string;
  role: Role;
  /** customers.customer_id, for customers only */
  cid?: string;
  /** Issued at and expiry, in seconds since the epoch. */
  iat: number;
  exp: number;
}

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_TOKEN_CHARS = 1024;

function b64(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function signSession(
  claims: Pick<SessionClaims, 'uid' | 'role' | 'cid'>,
  secret: string,
  opts: { now?: number; ttlSeconds?: number } = {},
): string {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const body: SessionClaims = {
    uid: claims.uid,
    role: claims.role,
    ...(claims.cid ? { cid: claims.cid } : {}),
    iat,
    exp: iat + (opts.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const payload = b64(JSON.stringify(body));
  return `${payload}.${b64(sign(payload, secret))}`;
}

/** The claims if the token is genuine, well formed and not expired; otherwise null (never throws). */
export function verifySession(token: string | undefined | null, secret: string, now: number = Date.now()): SessionClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const given = Buffer.from(parts[1], 'base64url');
    const expected = sign(parts[0], secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Partial<SessionClaims>;
    if (
      typeof claims.uid !== 'string' ||
      !claims.uid ||
      !ROLES.includes(claims.role as Role) ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number' ||
      (claims.cid !== undefined && typeof claims.cid !== 'string')
    ) {
      return null;
    }
    if (Math.floor(now / 1000) >= claims.exp) return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}
