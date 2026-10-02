import { canAccessConversation } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { CONVERSATION_ID_PATTERN, NEUTRAL_STATE, toPublicState, type ConversationRows } from '@/lib/conversation-state';
import { sessionLimitsFromEnv } from '@/lib/session/limits';
import { restSelect } from '@/lib/supabase.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Customer-safe snapshot of a call: latest answer type, ticket reference, escalation marker, ended flag,
 * end reason and the session timing the UI counts down against.
 * Unknown ids return the same neutral state as a call with nothing recorded, so ids cannot be probed. A call that
 * has been tied to a customer account (see /api/support/link) is readable only by that customer and by staff; anyone
 * else gets the same neutral state. A call tied to nobody is public by id, exactly as before.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_PATTERN.test(id)) {
    return Response.json({ error: 'invalid conversation id' }, { status: 400, headers: NO_STORE });
  }
  const c = `conversation_id=eq.${encodeURIComponent(id)}`;
  try {
    const [turns, tickets, escalations, conversation] = await Promise.all([
      restSelect<ConversationRows['turns'][number]>('conversation_turns', `select=turn_number,answer_type&${c}&order=turn_number.desc&limit=1`),
      restSelect<ConversationRows['tickets'][number]>('support_tickets', `select=ticket_id,created_at&${c}&order=created_at.desc&limit=1`),
      restSelect<ConversationRows['escalations'][number]>('escalations', `select=preferred_time&${c}&order=created_at.desc&limit=1`),
      restSelect<ConversationRows['conversation'][number]>('conversations', `select=ended_at,end_reason,started_at,final_status,customer_id&${c}&limit=1`),
    ]);
    const linked = conversation[0]?.customer_id ?? null;
    if (linked) {
      const user = await getCurrentUser();
      const allowed =
        user !== null &&
        canAccessConversation(user, {
          customer_id: linked,
          ended_at: conversation[0].ended_at,
          final_status: conversation[0].final_status ?? null,
        });
      if (!allowed) return Response.json(NEUTRAL_STATE, { headers: NO_STORE });
    }
    return Response.json(
      toPublicState({ turns, tickets, escalations, conversation }, { limits: sessionLimitsFromEnv() }),
      { headers: NO_STORE },
    );
  } catch (error) {
    // Technical detail stays in the server log; the browser just keeps its last known state.
    console.error(`[web] conversation state failed: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: 'unavailable', ...NEUTRAL_STATE }, { status: 503, headers: NO_STORE });
  }
}
