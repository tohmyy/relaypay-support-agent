import { canAccessConversation } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation, getTranscriptAfter } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer') return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const conversation = await getConversation(id);
    if (!conversation || !canAccessConversation(user, conversation)) return json({ error: 'not found' }, 404);
    const cursor = new URL(request.url).searchParams.get('after');
    return json(await getTranscriptAfter(id, cursor));
  } catch (error) {
    logFailure('customer transcript failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
