import { randomBytes } from 'node:crypto';
import { canAccessConversation } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { json, logFailure, readJson } from '@/lib/http';
import { cleanMessage } from '@/lib/human/messages';
import { startBlocked } from '@/lib/session/start-check';
import { agentBaseUrl, TEXT_TURN_TIMEOUT_MS } from '@/lib/support/agent.server';
import { restInsert } from '@/lib/supabase.server';

// A typed turn runs the assistant, which can take a while.
export const maxDuration = 120;

/**
 * Type instead of talking (docs/BUILD-PLAN-V3.md V3.12). For a customer who cannot use a microphone: authenticated,
 * same-origin, rate limited. The first message creates a conversation tied to the signed-in customer (the customer comes
 * from the session, never from the request); later messages name it. The turn itself runs in the voice agent service,
 * through the same Session Controller, history, tools and limits as a spoken turn. Not retried automatically: a retried
 * turn would be answered, and billed, twice.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer' || !user.customerId) return json({ error: 'unauthorized' }, 401);

  const payload = (await readJson(request)) as { conversationId?: unknown; message?: unknown } | undefined;
  const clean = cleanMessage(payload?.message);
  if (!clean.ok) return json({ error: clean.error }, clean.error === 'too-long' ? 413 : 400);
  const supplied = payload?.conversationId;
  if (supplied !== undefined && (typeof supplied !== 'string' || !CONVERSATION_ID_PATTERN.test(supplied))) {
    return json({ error: 'invalid conversation id' }, 400);
  }

  const limit = await rateLimit(`text-turn:${user.id}`, CHAT_LIMITS.textTurns);
  if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });

  const token = process.env.AGENT_API_TOKEN;
  if (!token) return json({ error: 'unavailable' }, 503);

  try {
    let conversationId = supplied as string | undefined;
    if (conversationId) {
      const row = await getConversation(conversationId);
      // Someone else's conversation looks like one that does not exist.
      if (!row || row.customer_id !== user.customerId || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
      if (row.ended_at || row.support_mode !== 'ai') return json({ error: 'not-open' }, 409);
    } else {
      const blocked = await startBlocked(user.customerId);
      if (!blocked.ok && blocked.blocked === 'active-session') {
        return json({ error: 'active-session', activeConversationId: blocked.activeConversationId }, 409);
      }
      if (!blocked.ok && blocked.blocked === 'rate-limited') return json({ error: 'rate-limited' }, 429);
      conversationId = `text_${randomBytes(16).toString('hex')}`;
      await restInsert('conversations', {
        conversation_id: conversationId,
        channel: 'text',
        customer_id: user.customerId,
        user_id: user.id,
      });
    }

    const res = await fetch(`${agentBaseUrl()}/text-turn`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message: clean.body }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TEXT_TURN_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`agent text turn failed (${res.status})`);
    const answer = (await res.json()) as { response?: unknown; ended?: unknown };
    if (typeof answer.response !== 'string') throw new Error('agent text turn returned nothing');
    return json({ conversationId, response: answer.response, ended: answer.ended === true });
  } catch (error) {
    logFailure('text turn failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
