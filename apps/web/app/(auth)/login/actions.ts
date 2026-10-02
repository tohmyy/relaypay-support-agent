'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { homeFor } from '@/lib/auth/access';
import { MAX_PASSWORD_CHARS, verifyAgainstDecoy, verifyPassword } from '@/lib/auth/password';
import { safeNext } from '@/lib/auth/redirects';
import { rateLimit, rateLimitReset } from '@/lib/auth/rate-limit';
import { clearSession, createSession } from '@/lib/auth/session';
import { LoginThrottle, loginThrottle } from '@/lib/auth/throttle';
import { ROLES, type Role } from '@/lib/auth/token';
import { SHELL_COPY } from '@/lib/shell-copy';
import { restPatch, restSelect } from '@/lib/supabase.server';

export interface LoginState {
  error: string | null;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(MAX_PASSWORD_CHARS),
});

/** Attempts per window for one email and address; a successful sign-in clears the count. */
const LOGIN_ATTEMPTS = { windowSeconds: 15 * 60, max: 5 } as const;

interface LoginRow {
  id: string;
  password_hash: string;
  role: string;
  customer_id: string | null;
  disabled: boolean;
}

async function clientAddress(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}

/**
 * Signs in with email and password. Unknown email, wrong password and a disabled account all give the same message
 * and take about the same time, so the form does not reveal which emails have accounts. `redirect()` throws by
 * design, so it is only ever called outside of try/catch.
 */
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) return { error: SHELL_COPY.signIn.invalid };
  const { email, password } = parsed.data;

  const key = LoginThrottle.key(email, await clientAddress());
  // The shared limiter (Postgres) holds across instances and restarts; the in-memory one is the fallback when the
  // shared store cannot be reached, and a second guard otherwise.
  const shared = await rateLimit(`login:${key}`, LOGIN_ATTEMPTS);
  if (!shared.allowed) return { error: SHELL_COPY.signIn.tooMany };
  if (!shared.shared && loginThrottle.retryAfterMs(key) > 0) return { error: SHELL_COPY.signIn.tooMany };

  let user: LoginRow | undefined;
  try {
    [user] = await restSelect<LoginRow>(
      'app_users',
      `select=id,password_hash,role,customer_id,disabled&email=eq.${encodeURIComponent(email)}&limit=1`,
    );
  } catch (error) {
    console.error(`[web] sign-in lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return { error: SHELL_COPY.signIn.unavailable };
  }

  const passwordOk = user && !user.disabled ? await verifyPassword(password, user.password_hash) : await verifyAgainstDecoy(password);
  if (!user || user.disabled || !passwordOk || !ROLES.includes(user.role as Role)) {
    loginThrottle.recordFailure(key);
    return { error: SHELL_COPY.signIn.invalid };
  }

  loginThrottle.recordSuccess(key);
  void rateLimitReset(`login:${key}`);
  try {
    await createSession({ uid: user.id, role: user.role as Role, ...(user.customer_id ? { cid: user.customer_id } : {}) });
  } catch (error) {
    console.error(`[web] creating the session failed: ${error instanceof Error ? error.message : String(error)}`);
    return { error: SHELL_COPY.signIn.unavailable };
  }
  // Best effort: a failed timestamp must not stop someone signing in.
  void restPatch('app_users', `id=eq.${encodeURIComponent(user.id)}`, { last_login_at: new Date().toISOString() }).catch(() => {});

  redirect(safeNext(formData.get('next'), homeFor(user.role as Role)));
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect('/login');
}
