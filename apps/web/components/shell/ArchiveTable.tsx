import Link from 'next/link';
import type { ArchiveRow } from '@/lib/dashboard/archive';
import { formatDateTime } from '@/lib/dashboard/format';
import { formatUsd } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';
import { DataTable, EmptyState, StatusBadge } from './ui';

/** The staff conversation archive: one row per conversation with the facts staff look for, and the customer links to it. */
export default function ArchiveTable({ rows }: { rows: ArchiveRow[] }) {
  const copy = STAFF_COPY.conversations.columns;
  if (rows.length === 0) return <EmptyState>{STAFF_COPY.conversations.empty}</EmptyState>;
  return (
    <DataTable
      caption={STAFF_COPY.conversations.title}
      rows={rows}
      rowKey={(r) => r.conversationId}
      columns={[
        { header: copy.started, cell: (r) => formatDateTime(r.startedAt), className: 'whitespace-nowrap' },
        {
          header: copy.ended,
          cell: (r) => (r.endedAt ? formatDateTime(r.endedAt) : STAFF_COPY.conversations.stillOpen),
          className: 'whitespace-nowrap',
        },
        { header: copy.channel, cell: (r) => <StatusBadge badge={r.channel} /> },
        {
          header: copy.customer,
          cell: (r) => (
            <Link href={`/staff/conversations/${encodeURIComponent(r.conversationId)}`} className="font-medium text-primary hover:underline">
              {r.customer}
            </Link>
          ),
        },
        { header: copy.outcome, cell: (r) => <StatusBadge badge={r.outcome} /> },
        { header: copy.escalation, cell: (r) => (r.escalation ? <StatusBadge badge={r.escalation} /> : '—') },
        { header: copy.ticket, cell: (r) => r.ticket ?? '—', className: 'whitespace-nowrap' },
        { header: copy.assignee, cell: (r) => r.assignee ?? '—' },
        { header: copy.cost, cell: (r) => (r.costUsd === null ? STAFF_COPY.queue.costUnknown : formatUsd(r.costUsd)), className: 'whitespace-nowrap' },
      ]}
    />
  );
}
