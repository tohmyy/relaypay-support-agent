import QueueTable from '@/components/shell/QueueTable';
import { PageTitle } from '@/components/shell/ui';
import { canAccessConversation } from '@/lib/auth/access';
import { requireStaff } from '@/lib/auth/dal';
import { getStaffQueueRows } from '@/lib/dashboard/data.server';
import { buildStaffQueue } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function StaffConversationsPage() {
  const user = await requireStaff('/staff/conversations');
  const rows = await getStaffQueueRows();
  // Show only what this person may open, so every row's link works.
  const visible = rows.conversations.filter((c) => canAccessConversation(user, c));
  const queue = buildStaffQueue({ ...rows, conversations: visible });
  return (
    <>
      <PageTitle>{STAFF_COPY.conversations.title}</PageTitle>
      <QueueTable items={queue.items} caption={STAFF_COPY.conversations.title} />
    </>
  );
}
