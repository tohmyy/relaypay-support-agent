import { canAccessConversation, canCustomerSend } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation, getHumanMessages, getStaffProfiles } from '@/lib/dashboard/data.server';
import { json, logFailure, readJson } from '@/lib/http';
import { cleanMessage, typingActive } from '@/lib/human/messages';
import { modeOf, touchOpenHuman } from '@/lib/human/server';
import { restInsert } from '@/lib/supabase.server';

const NEUTRAL = { supportMode: 'ai', ended: false, messages: [], staff: null, staffTyping: false };

/**
 * The customer's side of the text chat with a support specialist. Only the customer the conversation belongs to can
 * read or write it; anyone else, and any id that does not exist, gets the same empty answer, so ids cannot be probed.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer') return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json(NEUTRAL);
    const after = new URL(request.url).searchParams.get('after');
    const [messages, profiles] = await Promise.all([
      getHumanMessages(id, after),
      row.assigned_staff_id ? getStaffProfiles([row.assigned_staff_id]) : Promise.resolve(new Map()),
    ]);
    return json({
      supportMode: modeOf(row.support_mode),
      ended: Boolean(row.ended_at),
      messages,
      staff: row.assigned_staff_id ? (profiles.get(row.assigned_staff_id) ?? null) : null,
      staffTyping: typingActive(row.staff_typing_at),
    });
  } catch (error) {
    logFailure('customer messages failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'customer') return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);

  const payload = (await readJson(request)) as { body?: unknown } | undefined;
  const clean = cleanMessage(payload?.body);
  if (!clean.ok) return json({ error: clean.error }, clean.error === 'too-long' ? 413 : 400);

  try {
    const row = await getConversation(id);
    // Someone else's conversation looks like one that does not exist.
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (!canCustomerSend(user, row)) return json({ error: 'not-open' }, 409);

    const limit = await rateLimit(`chat:c:${id}`, CHAT_LIMITS.customerMessages);
    if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });

    // The write that gates the insert: if the conversation was closed a moment ago, nothing is stored.
    const open = await touchOpenHuman(id, { customer_typing_at: null });
    if (!open) return json({ error: 'not-open' }, 409);
    await restInsert('conversation_turns', { conversation_id: id, sender: 'customer', body: clean.body });
    return json({ ok: true }, 201);
  } catch (error) {
    logFailure('customer message failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
