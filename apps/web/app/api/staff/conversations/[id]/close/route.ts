import { canAccessConversation, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { addSystemMessage } from '@/lib/human/server';
import { restInsert, restPatch } from '@/lib/supabase.server';

/**
 * Close a conversation that is with a specialist. The assigned person or an admin may close it; so may anyone on an
 * unassigned one. Conditional on it still being open, so closing twice (or racing a reply) changes nothing the second
 * time. `final_status` stays `escalated`: it was a handoff; `end_reason` says staff closed it.
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
    if (row.support_mode !== 'human' || row.ended_at) return json({ error: 'not-open' }, 409);
    if (row.assigned_staff_id && row.assigned_staff_id !== user.id && user.role !== 'support_admin') {
      return json({ error: 'taken' }, 409);
    }
    const now = new Date().toISOString();
    const closed = await restPatch('conversations', `conversation_id=eq.${encodeURIComponent(id)}&support_mode=eq.human&ended_at=is.null`, {
      support_mode: 'ended',
      ended_at: now,
      end_reason: 'human-closed',
      last_activity_at: now,
      staff_typing_at: null,
      customer_typing_at: null,
    });
    if (closed.length === 0) return json({ error: 'not-open' }, 409);
    await addSystemMessage(id, `${user.displayName} has closed this conversation.`);
    await restInsert('conversation_events', {
      conversation_id: id,
      event_type: 'human_closed',
      summary: 'conversation closed by staff',
      metadata: { closed_by: user.id },
    });
    return json({ closed: true });
  } catch (error) {
    logFailure('close failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
