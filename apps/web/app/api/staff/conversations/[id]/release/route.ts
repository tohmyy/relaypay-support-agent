import { canAccessConversation, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { lifecycleRefusal, releaseConversation } from '@/lib/human/server';

/**
 * Give a conversation back to the queue (for a break, or because someone else is better placed). The person who has it
 * or an admin may. The conversation, ticket and escalation go back to open together, once: a repeat gets 409 with the
 * current state.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    const result = await releaseConversation(user.id, id);
    if (result.outcome === 'released') return json({ released: true });
    return lifecycleRefusal(result);
  } catch (error) {
    logFailure('release failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
