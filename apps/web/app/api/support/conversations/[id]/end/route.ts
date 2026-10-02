import { canAccessConversation, canCustomerSend } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { addSystemMessage, endOpenChat } from '@/lib/human/server';

/** The customer ends their own chat. Only their own, only while it is open, and only once. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer') return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (!canCustomerSend(user, row)) return json({ error: 'not-open' }, 409);
    if (!(await endOpenChat(id, 'user-ended'))) return json({ error: 'not-open' }, 409);
    await addSystemMessage(id, 'The customer ended the conversation.');
    return json({ ended: true });
  } catch (error) {
    logFailure('customer end failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
