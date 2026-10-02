import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { abuseLimitsFromEnv, activeEarlierIds, type OpenSessionRow } from '@/lib/session/abuse';
import { restInsert, restPatch, restSelect } from '@/lib/supabase.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Whether this call breaks a limit once it is tied to the customer. The voice agent enforces the same limits on its
 * side and hangs up; this lets the page tell the customer straight away. A check that cannot be made is reported as
 * 'unavailable' (the link route then answers 503), never passed silently: the page retries, and the agent's link grace
 * is the backstop.
 */
async function limitBroken(
  customerId: string,
  conversationId: string,
): Promise<'active-session' | 'rate-limited' | 'unavailable' | null> {
  const limits = abuseLimitsFromEnv();
  try {
    if (limits.maxConcurrentSessions > 0) {
      const [me] = (await restSelect<{ started_at: string | null }>(
        'conversations',
        `select=started_at&conversation_id=eq.${encodeURIComponent(conversationId)}&limit=1`,
      )) ?? [];
      const others =
        (await restSelect<OpenSessionRow>(
          'conversations',
          `select=conversation_id,started_at,last_activity_at&customer_id=eq.${encodeURIComponent(customerId)}` +
            `&support_mode=eq.ai&ended_at=is.null&conversation_id=neq.${encodeURIComponent(conversationId)}&limit=20`,
        )) ?? [];
      const earlier = activeEarlierIds(others, Date.parse(me?.started_at ?? ''), { maxSeconds: limits.sessionMaxSeconds });
      if (earlier.length >= limits.maxConcurrentSessions) return 'active-session';
    }
    if (limits.sessionRateMax > 0) {
      const since = new Date(Date.now() - limits.sessionRateWindowSeconds * 1000).toISOString();
      const started =
        (await restSelect<{ conversation_id: string }>(
          'conversations',
          `select=conversation_id&customer_id=eq.${encodeURIComponent(customerId)}&started_at=gte.${encodeURIComponent(since)}&limit=${limits.sessionRateMax + 2}`,
        )) ?? [];
      if (started.length > limits.sessionRateMax) return 'rate-limited';
    }
  } catch (error) {
    console.error(`[web] session limit check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'unavailable';
  }
  return null;
}

/**
 * Ties a call to the signed-in customer, once the browser has the call's id. This decides who may read the call's
 * transcript afterwards, lets the voice agent know who is calling (for the limits and the handoff to a specialist),
 * and tells the page at once if the customer already has another active conversation or has started too many.
 *
 * Safe to repeat for the same customer; a call already tied to someone else is refused (409 conflict). Only customers
 * can link, and the customer id always comes from the server-side session, never from the request. Both ids are written
 * in one update, so a conversation is owned completely or not at all.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user) return reply({ error: 'unauthorized' }, 401);
  if (user.role !== 'customer' || !user.customerId) return reply({ error: 'forbidden' }, 403);

  let id: unknown;
  try {
    id = ((await request.json()) as { conversationId?: unknown } | null)?.conversationId;
  } catch {
    return reply({ error: 'invalid request' }, 400);
  }
  if (typeof id !== 'string' || !CONVERSATION_ID_PATTERN.test(id)) return reply({ error: 'invalid conversation id' }, 400);

  const c = `conversation_id=eq.${encodeURIComponent(id)}`;
  try {
    // The agent creates the conversation on its first turn; creating it here first is harmless because it
    // inserts with ignore-duplicates.
    await restInsert('conversations', { conversation_id: id, channel: 'voice' }, { onConflict: 'conversation_id' });
    const won = await restPatch('conversations', `${c}&customer_id=is.null`, {
      customer_id: user.customerId,
      user_id: user.id,
    });
    if (won.length === 0) {
      const [existing] = await restSelect<{ customer_id: string | null }>('conversations', `select=customer_id&${c}&limit=1`);
      if (existing?.customer_id !== user.customerId) return reply({ error: 'conflict' }, 409);
    }
    // Linked (now or before). Say so even if a limit is broken: the agent needs the link to enforce it too.
    const broken = await limitBroken(user.customerId, id);
    if (broken === 'unavailable') return reply({ error: 'unavailable' }, 503);
    if (broken === 'active-session') return reply({ linked: true, error: 'active-session' }, 409);
    if (broken === 'rate-limited') return reply({ linked: true, error: 'rate-limited' }, 429);
    return reply({ linked: true }, 200);
  } catch (error) {
    // Only one active AI conversation per customer can exist (a unique index): losing that race is not an outage.
    if (error instanceof Error && /(409)/.test(error.message)) return reply({ error: 'active-session' }, 409);
    console.error(`[web] link failed: ${error instanceof Error ? error.message : String(error)}`);
    return reply({ error: 'unavailable' }, 503);
  }
}
