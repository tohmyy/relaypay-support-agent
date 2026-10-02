import { canAccessConversation, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { markRead } from '@/lib/human/server';

/** "I have read the conversation up to now" from staff: clears the unread mark and shows the customer "Seen". */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    // Only the person who has the conversation counts as having read it. Someone just looking at an unassigned one, or at
    // one another team member has taken, must not show the customer "Seen".
    if (row.assigned_staff_id !== user.id) return json({ ok: true, recorded: false });
    const limit = await rateLimit(`read:s:${user.id}`, CHAT_LIMITS.read);
    if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
    await markRead(id, 'staff');
    return json({ ok: true, recorded: true });
  } catch (error) {
    logFailure('staff read failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
