import { canAccessConversation, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { claimConversation } from '@/lib/human/server';

/** Take an unassigned conversation. Two people clicking at once: one gets it, the other is told it is taken. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    const outcome = await claimConversation(user, id, row);
    if (outcome === 'claimed' || outcome === 'already-mine') return json({ assigned: true });
    return json({ error: outcome }, 409);
  } catch (error) {
    logFailure('claim failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
