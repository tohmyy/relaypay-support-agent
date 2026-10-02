import { getCurrentUser } from '@/lib/auth/dal';
import { agentIsReady } from '@/lib/support/agent.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Whether voice support can be started right now. Customers only (the same rule as the support page). The answer is
 * just `available` or `unavailable`: no host names, no mention of which part is down.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (user.role !== 'customer' || !user.customerId) {
    return Response.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }
  const ready = await agentIsReady();
  return Response.json(
    { status: ready ? 'available' : 'unavailable' },
    { status: ready ? 200 : 503, headers: NO_STORE },
  );
}
