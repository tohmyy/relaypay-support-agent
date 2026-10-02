import { canAccessConversation, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { addSystemMessage } from '@/lib/human/server';
import { restPatch } from '@/lib/supabase.server';

/**
 * Give a conversation back to the queue (for a break, or because someone else is better placed). The person who has it
 * or an admin may; conditional on it still being open and held by that person, so it happens once.
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
    if (!row.assigned_staff_id) return json({ error: 'not-assigned' }, 409);
    if (row.assigned_staff_id !== user.id && user.role !== 'support_admin') return json({ error: 'taken' }, 409);

    const released = await restPatch(
      'conversations',
      `conversation_id=eq.${encodeURIComponent(id)}&support_mode=eq.human&ended_at=is.null&assigned_staff_id=eq.${encodeURIComponent(row.assigned_staff_id)}`,
      { assigned_staff_id: null, staff_typing_at: null, last_activity_at: new Date().toISOString() },
    );
    if (released.length === 0) return json({ error: 'not-open' }, 409);
    await addSystemMessage(id, 'Your specialist has returned this conversation to the queue. Another specialist will join you shortly.');
    return json({ released: true });
  } catch (error) {
    logFailure('release failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
