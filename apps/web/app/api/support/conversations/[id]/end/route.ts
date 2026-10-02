import { canAccessConversation, canCustomerSend } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { endConversationAsCustomer } from '@/lib/human/server';

/**
 * The customer ends their own chat. Only their own, only while it is open, and only once; the ticket and escalation close
 * with it, in the same step.
 */
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
    const result = await endConversationAsCustomer(user.customerId as string, id);
    if (result.outcome === 'ended') return json({ ended: true });
    // Not-found here means it stopped being theirs between the read and the call; a customer is only ever told "not open",
    // and never the staff-side details in the state.
    return json({ error: 'not-open' }, 409);
  } catch (error) {
    logFailure('customer end failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
