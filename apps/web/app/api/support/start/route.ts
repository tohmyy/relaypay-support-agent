import { getCurrentUser } from '@/lib/auth/dal';
import { sameOrigin } from '@/lib/auth/origin';
import { startBlocked } from '@/lib/session/start-check';

const NO_STORE = { 'Cache-Control': 'no-store' };

function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Authorizes the browser to begin a voice call (docs/BUILD-PLAN-V3.md V3.7). Customers only, from this site only, and
 * only when they are within their conversation limits. The browser asks before it starts the call; the call is then
 * tied to the customer by /api/support/link, and the voice agent ends any call that is still unlinked after a short
 * grace period, so a call cannot be completed without a signed-in customer.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'forbidden' }, 403);
  const user = await getCurrentUser();
  if (!user) return reply({ error: 'unauthorized' }, 401);
  if (user.role !== 'customer' || !user.customerId) return reply({ error: 'forbidden' }, 403);

  try {
    const blocked = await startBlocked(user.customerId);
    if (blocked === 'active-session') return reply({ authorized: false, error: 'active-session' }, 409);
    if (blocked === 'rate-limited') return reply({ authorized: false, error: 'rate-limited' }, 429);
    return reply({ authorized: true }, 200);
  } catch (error) {
    console.error(`[web] start check failed: ${error instanceof Error ? error.message : String(error)}`);
    return reply({ error: 'unavailable' }, 503);
  }
}
