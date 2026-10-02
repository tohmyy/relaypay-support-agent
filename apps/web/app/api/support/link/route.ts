import { getCurrentUser } from '@/lib/auth/dal';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { restInsert, restPatch, restSelect } from '@/lib/supabase.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Browsers send Origin on cross-site POSTs; a request from another site is refused. No Origin means a same-site tool. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * Ties a call to the signed-in customer, once the browser has the call's id. This is for web authorisation only:
 * it decides who may read the call's transcript and state afterwards. The voice agent is not told who is calling.
 *
 * Safe to repeat for the same customer; a call already tied to someone else is refused (409). Only customers can
 * link, and the customer id always comes from the server-side session, never from the request.
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
    if (won.length > 0) return reply({ linked: true }, 200);
    const [existing] = await restSelect<{ customer_id: string | null }>('conversations', `select=customer_id&${c}&limit=1`);
    if (existing?.customer_id === user.customerId) return reply({ linked: true }, 200);
    return reply({ error: 'conflict' }, 409);
  } catch (error) {
    console.error(`[web] link failed: ${error instanceof Error ? error.message : String(error)}`);
    return reply({ error: 'unavailable' }, 503);
  }
}
