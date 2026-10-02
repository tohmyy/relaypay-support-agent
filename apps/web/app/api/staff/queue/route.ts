import { isStaff } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { getStaffQueueRows } from '@/lib/dashboard/data.server';
import { buildStaffQueueFor } from '@/lib/dashboard/staff';
import { json, logFailure } from '@/lib/http';

/** The staff queue as the signed-in member of staff may see it, for the live view to poll. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return json({ error: 'unauthorized' }, 401);
  try {
    const queue = buildStaffQueueFor(user, await getStaffQueueRows());
    return json({ ...queue, at: new Date().toISOString() });
  } catch (error) {
    logFailure('staff queue failed', error);
    return json({ error: 'unavailable' }, 503);
  }
}
