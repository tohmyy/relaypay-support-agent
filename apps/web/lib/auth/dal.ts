import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { restSelect } from '@/lib/supabase.server';
import { homeFor } from './access';
import { readSession } from './session';
import { ROLES, type Role } from './token';

/** The signed-in person, as the pages need them. Never includes the password hash. */
export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
  displayName: string;
  title: string | null;
  avatarUrl: string | null;
  /** Staff only: switched on "available for chats". */
  available: boolean;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  customer_id: string | null;
  display_name: string;
  title: string | null;
  avatar_url: string | null;
  disabled: boolean;
  available?: boolean | null;
}

const USER_COLUMNS = 'id,email,role,customer_id,display_name,title,avatar_url,disabled,available';

/**
 * The current user, or null. The cookie only proves who signed in earlier; this re-reads the user so that disabling
 * an account or changing its role takes effect on the next request rather than when the cookie expires. Cached for the
 * duration of one request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const claims = await readSession();
  if (!claims) return null;
  let rows: UserRow[];
  try {
    rows = await restSelect<UserRow>('app_users', `select=${USER_COLUMNS}&id=eq.${encodeURIComponent(claims.uid)}&limit=1`);
  } catch {
    return null; // fail closed: if the user cannot be confirmed, they are signed out
  }
  const row = rows[0];
  if (!row || row.disabled || !ROLES.includes(row.role as Role)) return null;
  // A cookie issued for a different role or customer than the account has now is no longer trusted.
  if (row.role !== claims.role || (row.customer_id ?? undefined) !== claims.cid) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    customerId: row.customer_id,
    displayName: row.display_name,
    title: row.title,
    avatarUrl: row.avatar_url,
    available: Boolean(row.available),
  };
});

/** For pages, route handlers and actions that need a signed-in user: sends everyone else to the login page. */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // Always say why: the proxy sends a signed-in cookie holder away from /login, except when the real check just refused
  // them (a disabled account, a changed role). Without this marker that would bounce between the two for ever.
  if (!user) redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login?signedout=1');
  return user;
}

/** Like `requireUser`, but also limits the page to certain roles; anyone else is sent to their own home. */
export async function requireRole(roles: readonly Role[], returnTo?: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

export const requireCustomer = (returnTo?: string) => requireRole(['customer'], returnTo);
export const requireStaff = (returnTo?: string) => requireRole(['support_agent', 'support_admin'], returnTo);

export { homeFor };
