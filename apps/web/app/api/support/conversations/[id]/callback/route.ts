import { canAccessConversation, canCustomerSend } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure, readJson } from '@/lib/http';
import { addSystemMessage, endOpenChat } from '@/lib/human/server';
import { getContactMethods } from '@/lib/settings/contact-methods.server';
import { restInsert, restSelect } from '@/lib/supabase.server';

/**
 * The customer would rather have a callback than wait for the chat. Records a callback request from their own account
 * details (never from the request), then ends the chat so staff stop seeing it as waiting. The preferred time is the
 * only thing taken from the request, and it is optional.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer' || !user.customerId) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);

  const payload = (await readJson(request)) as { preferredTime?: unknown } | undefined;
  const raw = payload?.preferredTime;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return json({ error: 'invalid request' }, 400);
  const preferredTime = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';

  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (!canCustomerSend(user, row)) return json({ error: 'not-open' }, 409);
    // Enforced here too, not only by hiding the button: an administrator has switched callbacks off.
    if (!(await getContactMethods()).callback) return json({ error: 'method-disabled' }, 403);

    const [account] = await restSelect<{ contact_name: string | null; contact_email: string | null }>(
      'customers',
      `select=contact_name,contact_email&customer_id=eq.${encodeURIComponent(user.customerId)}&limit=1`,
    );
    await restInsert('escalations', {
      customer_id: user.customerId,
      conversation_id: id,
      user_name: account?.contact_name ?? user.displayName,
      user_email: account?.contact_email ?? user.email,
      category: 'other',
      reason: 'The customer asked for a callback instead of waiting for the live text chat.',
      preferred_time: preferredTime || null,
      contact_preference: 'callback',
      status: 'open',
    });
    if (!(await endOpenChat(id, 'user-ended'))) return json({ error: 'not-open' }, 409);
    await addSystemMessage(id, 'The customer asked for a callback instead.');
    return json({ requested: true });
  } catch (error) {
    logFailure('callback request failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
