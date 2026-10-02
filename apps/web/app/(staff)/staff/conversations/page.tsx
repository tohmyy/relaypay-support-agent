import LiveQueue from '@/components/shell/LiveQueue';
import { PageTitle } from '@/components/shell/ui';
import { requireStaff } from '@/lib/auth/dal';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function StaffConversationsPage() {
  const user = await requireStaff('/staff/conversations');
  return (
    <>
      <PageTitle>{STAFF_COPY.conversations.title}</PageTitle>
      <LiveQueue variant="all" role={user.role} />
    </>
  );
}
