import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { readJson } from '@/lib/http';
import { startBlocked } from '@/lib/session/start-check';
import { sendAgentControl } from '@/lib/support/agent.server';
import { restRpc, restSelect } from '@/lib/supabase.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Authorizes the browser to begin a voice call (docs/BUILD-PLAN-V3.md V3.7). Customers only, from this site only, and
 * only when they are within their conversation limits. `{ replace: true, conversationId }` ends the owner's active AI
 * conversation first, then authorizes one fresh start.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user) return reply({ error: 'unauthorized' }, 401);
  if (user.role !== 'customer' || !user.customerId) return reply({ error: 'forbidden' }, 403);

  const payload = ((await readJson(request)) ?? {}) as { replace?: unknown; conversationId?: unknown };
  const replace = payload.replace === true;
  const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : '';

  try {
    if (replace) {
      if (!CONVERSATION_ID_PATTERN.test(conversationId)) return reply({ error: 'invalid conversation id' }, 400);
      const rows =
        (await restSelect<{ customer_id: string | null }>(
          'conversations',
          `select=customer_id&conversation_id=eq.${encodeURIComponent(conversationId)}&limit=1`,
        )) ?? [];
      if (!rows[0] || rows[0].customer_id !== user.customerId) return reply({ error: 'not found' }, 404);
      await sendAgentControl('/end-session', { conversationId });
      const result = await restRpc<{ outcome?: string }>('replace_active_conversation', {
        p_customer_id: user.customerId,
        p_old_id: conversationId,
      });
      if (result?.outcome === 'not-found') return reply({ error: 'not found' }, 404);
      if (result?.outcome === 'human') return reply({ authorized: false, error: 'human' }, 409);
      return reply({ authorized: true }, 200);
    }

    const blocked = await startBlocked(user.customerId);
    if (!blocked.ok && blocked.blocked === 'active-session') {
      return reply(
        { authorized: false, error: 'active-session', activeConversationId: blocked.activeConversationId },
        409,
      );
    }
    if (!blocked.ok && blocked.blocked === 'rate-limited') return reply({ authorized: false, error: 'rate-limited' }, 429);
    return reply({ authorized: true }, 200);
  } catch (error) {
    console.error(`[web] start check failed: ${error instanceof Error ? error.message : String(error)}`);
    return reply({ error: 'unavailable' }, 503);
  }
}
