import { canAccessConversation } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation } from '@/lib/dashboard/data.server';
import { parseFeedback, stageReady } from '@/lib/feedback';
import { json, logFailure, readJson } from '@/lib/http';
import { restInsert, restSelect } from '@/lib/supabase.server';

interface StoredFeedback {
  stage: string;
  rating: number;
  comment: string | null;
}

/**
 * An optional star rating from the customer. Satisfaction only: this writes `conversation_feedback` and nothing else, so
 * a rating can never change a conversation's outcome, an end reason or a ticket's status (the Session Controller and
 * staff own those). Idempotent: rating the same stage again keeps the first answer and returns it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer' || !user.customerId) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);

  const parsed = parseFeedback(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { stage, rating, comment } = parsed.value;

  const limit = await rateLimit(`feedback:${user.id}`, CHAT_LIMITS.settings);
  if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });

  try {
    const row = await getConversation(id);
    // Someone else's conversation looks like one that does not exist.
    if (!row || row.customer_id !== user.customerId || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (!stageReady(stage, row)) return json({ error: 'not-ready' }, 409);

    await restInsert(
      'conversation_feedback',
      { conversation_id: id, stage, rating, comment, user_id: user.id },
      { onConflict: 'conversation_id,stage' },
    );
    const [stored] = await restSelect<StoredFeedback>(
      'conversation_feedback',
      `select=stage,rating,comment&conversation_id=eq.${encodeURIComponent(id)}&stage=eq.${stage}&limit=1`,
    );
    return json({ stage, rating: stored?.rating ?? rating, comment: stored?.comment ?? comment, saved: true });
  } catch (error) {
    logFailure('feedback failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
