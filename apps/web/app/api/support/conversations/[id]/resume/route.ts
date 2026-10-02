import { canAccessConversation } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure } from '@/lib/http';
import { agentBaseUrl } from '@/lib/support/agent.server';

/**
 * Reopens the customer's conversation that ended within the last 30 seconds, so a new call can continue it with the
 * transcript kept (docs/BUILD-PLAN-V3.md V3.14). The rule itself (the owner, the window, which endings can be resumed)
 * lives in the voice agent service, which also resets its in-memory session; this checks who is asking and passes it on.
 * Not retried automatically.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer' || !user.customerId) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);

  const limit = await rateLimit(`resume:${user.id}`, CHAT_LIMITS.settings);
  if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });

  const token = process.env.AGENT_API_TOKEN;
  if (!token) return json({ error: 'unavailable' }, 503);

  try {
    const row = await getConversation(id);
    // Someone else's conversation looks like one that does not exist.
    if (!row || row.customer_id !== user.customerId || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);

    const res = await fetch(`${agentBaseUrl()}/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // The owner is the customer in the session, never one named in the request.
      body: JSON.stringify({ conversationId: id, customerId: user.customerId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`agent resume failed (${res.status})`);
    const result = (await res.json()) as { reopened?: boolean; reason?: string };
    if (result.reopened) return json({ resumed: true });
    // Already open (for example the button was pressed twice): carrying on with the call is fine.
    if (result.reason === 'not-ended') return json({ resumed: true });
    if (result.reason === 'expired' || result.reason === 'not-resumable' || result.reason === 'human' || result.reason === 'raced') {
      return json({ resumed: false, error: 'expired' }, 409);
    }
    return json({ resumed: false, error: 'not found' }, 404);
  } catch (error) {
    logFailure('resume failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
