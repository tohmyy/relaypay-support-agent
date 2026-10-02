import { canAccessConversation, canStaffReply, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { touchOpenHuman } from '@/lib/human/server';

/** "Sarah is typing" for the customer. Only the person allowed to reply can send it. Best effort. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (!canStaffReply(user, row)) return json({ error: 'not-open' }, 409);
    const limit = await rateLimit(`typing:s:${user.id}`, CHAT_LIMITS.typing);
    if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
    await touchOpenHuman(id, { staff_typing_at: new Date().toISOString() });
    return json({ ok: true });
  } catch (error) {
    logFailure('staff typing failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
