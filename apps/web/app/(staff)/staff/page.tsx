import QueueTable from '@/components/shell/QueueTable';
import { PageTitle, Stat } from '@/components/shell/ui';
import { requireStaff } from '@/lib/auth/dal';
import { getStaffQueueRows } from '@/lib/dashboard/data.server';
import { buildStaffQueue } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function StaffQueuePage() {
  const user = await requireStaff('/staff');
  const queue = buildStaffQueue(await getStaffQueueRows());
  // A support agent works the live queue; the admin also sees what has been resolved.
  const items = user.role === 'support_admin' ? queue.items : queue.items.filter((i) => i.state !== 'resolved');
  const copy = STAFF_COPY.queue;
  return (
    <>
      <PageTitle>{copy.title}</PageTitle>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={copy.open} value={queue.counts.open} />
        <Stat label={copy.waiting} value={queue.counts.waiting} />
        <Stat label={copy.escalated} value={queue.counts.escalated} />
        <Stat label={copy.resolvedToday} value={queue.counts.resolvedToday} />
      </div>
      <QueueTable items={items} caption={copy.title} />
    </>
  );
}
