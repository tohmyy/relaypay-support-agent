import { canAccessConversation } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, readJson } from '@/lib/http';
import { sendAgentControl } from '@/lib/support/agent.server';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer') return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  const body = (await readJson(request)) as { type?: unknown } | undefined;
  if (body?.type !== 'start' && body?.type !== 'heartbeat' && body?.type !== 'stop') {
    return json({ error: 'invalid activity type' }, 400);
  }
  const conversation = await getConversation(id);
  if (!conversation || !canAccessConversation(user, conversation)) return json({ error: 'not found' }, 404);
  if (conversation.ended_at || conversation.support_mode === 'ended') return json({ error: 'not active' }, 409);
  const limit = await rateLimit(`activity:${user.id}:${id}`, CHAT_LIMITS.typing);
  if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
  return (await sendAgentControl('/activity', { conversationId: id, type: body.type }))
    ? json({ ok: true })
    : json({ error: 'unavailable' }, 503);
}
