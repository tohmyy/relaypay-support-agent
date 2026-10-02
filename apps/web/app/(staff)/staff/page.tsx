import LiveQueue from '@/components/shell/LiveQueue';
import { PageTitle } from '@/components/shell/ui';
import { requireStaff } from '@/lib/auth/dal';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function StaffQueuePage() {
  const user = await requireStaff('/staff');
  return (
    <>
      <PageTitle>{STAFF_COPY.queue.title}</PageTitle>
      <LiveQueue variant="queue" role={user.role} />
    </>
  );
}
