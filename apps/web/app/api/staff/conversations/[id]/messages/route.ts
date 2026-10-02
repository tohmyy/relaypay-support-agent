import { canAccessConversation, canStaffReply, isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation, getHumanMessages, getStaffProfiles } from '@/lib/dashboard/data.server';
import { json, logFailure, readJson } from '@/lib/http';
import { cleanMessage, typingActive } from '@/lib/human/messages';
import { claimConversation, modeOf, touchOpenHuman } from '@/lib/human/server';
import { restInsert } from '@/lib/supabase.server';

/** Staff side of the chat: read the conversation (polled), and reply. Staff only; agents see the working queue. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);
  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    const after = new URL(request.url).searchParams.get('after');
    const [messages, profiles] = await Promise.all([
      getHumanMessages(id, after),
      row.assigned_staff_id ? getStaffProfiles([row.assigned_staff_id]) : Promise.resolve(new Map()),
    ]);
    return json({
      supportMode: modeOf(row.support_mode),
      ended: Boolean(row.ended_at),
      messages,
      assignedTo: row.assigned_staff_id ? (profiles.get(row.assigned_staff_id) ?? null) : null,
      assignedToMe: row.assigned_staff_id === user.id,
      canReply: canStaffReply(user, row),
      customerTyping: typingActive(row.customer_typing_at),
    });
  } catch (error) {
    logFailure('staff messages failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) return json({ error: 'invalid conversation id' }, 400);

  const payload = (await readJson(request)) as { body?: unknown } | undefined;
  const clean = cleanMessage(payload?.body);
  if (!clean.ok) return json({ error: clean.error }, clean.error === 'too-long' ? 413 : 400);

  try {
    const row = await getConversation(id);
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (row.support_mode !== 'human' || row.ended_at) return json({ error: 'not-open' }, 409);
    // Someone else has it: only the person it is assigned to, or an admin, may write.
    if (!canStaffReply(user, row)) return json({ error: 'taken' }, 409);

    const limit = await rateLimit(`chat:s:${user.id}`, CHAT_LIMITS.staffMessages);
    if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });

    // Writing to an unassigned conversation takes it. A lost race is reported, not overwritten.
    if (!row.assigned_staff_id) {
      const outcome = await claimConversation(user, id, row);
      if (outcome === 'taken' && user.role !== 'support_admin') return json({ error: 'taken' }, 409);
      if (outcome === 'not-open') return json({ error: 'not-open' }, 409);
    }
    const open = await touchOpenHuman(id, { staff_typing_at: null });
    if (!open) return json({ error: 'not-open' }, 409);
    await restInsert('conversation_turns', {
      conversation_id: id,
      sender: 'staff',
      body: clean.body,
      staff_user_id: user.id,
    });
    return json({ ok: true }, 201);
  } catch (error) {
    logFailure('staff message failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
