import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { isAnyStaffOnline } from '@/lib/dashboard/data.server';
import { json, logFailure, readJson } from '@/lib/http';
import { validateContactMethods } from '@/lib/settings/contact-methods';
import { getContactMethodsDetail, saveContactMethods } from '@/lib/settings/contact-methods.server';

/** Administrators only: other staff, customers and signed-out visitors get the same refusal. */
async function admin() {
  const user = await getCurrentUser();
  return user && user.role === 'support_admin' ? user : null;
}

export async function GET() {
  if (!(await admin())) return json({ error: 'unauthorized' }, 401);
  try {
    const [detail, online] = await Promise.all([getContactMethodsDetail(), isAnyStaffOnline().catch(() => false)]);
    return json({ ...detail, staffOnline: online });
  } catch (error) {
    logFailure('contact methods read failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}

/**
 * Saves which ways of reaching a person are on. Both fields must be booleans and at least one must be on (otherwise a
 * customer who needs a person would have no way to reach one). The change is recorded with who made it and when.
 */
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await admin();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const checked = validateContactMethods(await readJson(request));
  if (!checked.ok) return json({ error: checked.error }, 400);

  const limit = await rateLimit(`settings:${user.id}`, CHAT_LIMITS.settings);
  if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
  try {
    await saveContactMethods(checked.methods, user.id);
    // A line in the log of who changed what; the setting itself keeps who and when.
    console.info(`[web] contact methods changed by ${user.id}: text_chat=${checked.methods.textChat} callback=${checked.methods.callback}`);
    return json({ methods: checked.methods });
  } catch (error) {
    logFailure('contact methods save failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
