import ArchiveTable from '@/components/shell/ArchiveTable';
import PageNav from '@/components/shell/PageNav';
import { PageTitle } from '@/components/shell/ui';
import { requireStaff } from '@/lib/auth/dal';
import { getStaffConversationsPage } from '@/lib/dashboard/data.server';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

/**
 * Every conversation this person may open, newest first, one page at a time. The page moves by an opaque cursor over
 * (started_at, conversation_id), so rows that share a start time are never repeated or skipped between pages. The working
 * queue stays on /staff.
 */
export default async function StaffConversationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string | string[] }> }) {
  const user = await requireStaff('/staff/conversations');
  const raw = (await searchParams).cursor;
  const cursor = (Array.isArray(raw) ? raw[0] : raw) || null;
  const page = await getStaffConversationsPage({ cursor, role: user.role });
  return (
    <>
      <PageTitle sub={STAFF_COPY.conversations.intro}>{STAFF_COPY.conversations.title}</PageTitle>
      {page.restarted && (
        <p role="status" className="mb-3 text-sm text-ink-muted">
          {STAFF_COPY.pagination.restarted}
        </p>
      )}
      <ArchiveTable rows={page.rows} />
      <PageNav basePath="/staff/conversations" params={{}} cursor={page.restarted ? null : cursor} nextCursor={page.nextCursor} />
    </>
  );
}
