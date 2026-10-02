import { canAccessConversation, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { closeConversation, lifecycleRefusal } from '@/lib/human/server';

/**
 * Close a conversation that is with a specialist, or the escalation of one whose call already ended (a callback). The
 * assigned person or an admin may close a chat; so may anyone on an unassigned one. Conversation, ticket and escalation
 * close together, once: closing twice gets 409 with the current state, and a reply that races the close is refused.
 * `final_status` stays `escalated`: it was a handoff; `end_reason` says staff closed it.
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
    const result = await closeConversation(user.id, id);
    if (result.outcome === 'closed') return json({ closed: true });
    return lifecycleRefusal(result);
  } catch (error) {
    logFailure('close failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
