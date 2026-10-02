import 'server-only';
import { cookies } from 'next/headers';
import { getSessionSecret } from './secret';
import { SESSION_TTL_SECONDS, signSession, verifySession, type SessionClaims } from './token';

export const SESSION_COOKIE = 'rp_session';

export async function createSession(claims: Pick<SessionClaims, 'uid' | 'role' | 'cid'>): Promise<void> {
  const token = signSession(claims, getSessionSecret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The claims in the session cookie, or null. Signature and expiry only; see `getCurrentUser` for the live check.
 * A missing or too-short `SESSION_SECRET` means nobody is signed in rather than an error page.
 */
export async function readSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return verifySession(token, getSessionSecret());
  } catch {
    return null;
  }
}
