import { isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { json, logFailure, readJson } from '@/lib/http';
import { restPatch } from '@/lib/supabase.server';

/** Whether the signed-in staff member is switched on for chats. Read when the staff pages open. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  return json({ available: user.available });
}

/**
 * The staff pages' heartbeat (every ~30 seconds while a page is open and visible) and the "available for chats"
 * switch. A heartbeat only refreshes "last seen"; the switch is changed only when `available` is sent. A closed tab
 * simply stops sending, and the person drops out of "online" on their own.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const payload = (await readJson(request)) as { available?: unknown } | undefined;
  if (payload?.available !== undefined && typeof payload.available !== 'boolean') return json({ error: 'invalid request' }, 400);

  const limit = await rateLimit(`presence:${user.id}`, CHAT_LIMITS.presence);
  if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
  try {
    await restPatch('app_users', `id=eq.${encodeURIComponent(user.id)}`, {
      last_seen_at: new Date().toISOString(),
      ...(typeof payload?.available === 'boolean' ? { available: payload.available } : {}),
    });
    return json({ ok: true, ...(typeof payload?.available === 'boolean' ? { available: payload.available } : {}) });
  } catch (error) {
    logFailure('presence failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
