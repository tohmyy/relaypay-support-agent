import { canAccessConversation, canCustomerSend } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CHAT_LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { getConversation, getHumanMessages, getStaffProfiles, isAnyStaffOnline } from '@/lib/dashboard/data.server';
import { json, logFailure, readJson } from '@/lib/http';
import { getContactMethods } from '@/lib/settings/contact-methods.server';
import { cleanMessage, isUuid, typingActive } from '@/lib/human/messages';
import { modeOf, touchOpenHuman } from '@/lib/human/server';
import { restInsert } from '@/lib/supabase.server';

const NEUTRAL = {
  supportMode: 'ai',
  ended: false,
  messages: [],
  staff: null,
  staffTyping: false,
  staffReadAt: null,
  waitingSince: null,
  staffOnline: false,
  callbackAvailable: true,
};

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
    const waiting = row.support_mode === 'human' && !row.ended_at && !row.assigned_staff_id;
    const [messages, profiles, staffOnline, methods] = await Promise.all([
      getHumanMessages(id, after),
      row.assigned_staff_id ? getStaffProfiles([row.assigned_staff_id]) : Promise.resolve(new Map()),
      // Only worth asking while nobody has joined: it decides what the waiting message says.
      waiting ? isAnyStaffOnline().catch(() => false) : Promise.resolve(false),
      getContactMethods(),
    ]);
    return json({
      supportMode: modeOf(row.support_mode),
      ended: Boolean(row.ended_at),
      messages,
      staff: row.assigned_staff_id ? (profiles.get(row.assigned_staff_id) ?? null) : null,
      staffTyping: typingActive(row.staff_typing_at),
      staffReadAt: row.staff_last_read_at,
      waitingSince: waiting ? (row.handoff_at ?? row.started_at) : null,
      staffOnline,
      // An administrator can turn the callback off; the chat then does not offer it.
      callbackAvailable: methods.callback,
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

  const payload = (await readJson(request)) as { body?: unknown; clientId?: unknown } | undefined;
  const clean = cleanMessage(payload?.body);
  if (!clean.ok) return json({ error: clean.error }, clean.error === 'too-long' ? 413 : 400);
  if (payload?.clientId !== undefined && !isUuid(payload.clientId)) return json({ error: 'invalid client id' }, 400);
  const clientId = (payload?.clientId as string | undefined) ?? null;

  try {
    const row = await getConversation(id);
    // Someone else's conversation looks like one that does not exist.
    if (!row || !canAccessConversation(user, row)) return json({ error: 'not found' }, 404);
    if (!canCustomerSend(user, row)) return json({ error: 'not-open' }, 409);

    const limit = await rateLimit(`chat:c:${id}`, CHAT_LIMITS.customerMessages);
    if (!limit.allowed) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });

    // The write that gates the insert: if the conversation was closed a moment ago, nothing is stored.
    const now = new Date().toISOString();
    const open = await touchOpenHuman(id, { customer_typing_at: null, last_customer_message_at: now });
    if (!open) return json({ error: 'not-open' }, 409);
    // A retry with the same client id is recognised by the unique index and stored once.
    await restInsert(
      'conversation_turns',
      { conversation_id: id, sender: 'customer', body: clean.body, ...(clientId ? { client_msg_id: clientId } : {}) },
      clientId ? { onConflict: 'conversation_id,client_msg_id' } : {},
    );
    return json({ ok: true }, 201);
  } catch (error) {
    logFailure('customer message failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
