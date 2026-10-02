import Link from 'next/link';
import type { QueueItem, QueueState } from '@/lib/dashboard/staff';
import type { StatusTone } from '@/lib/dashboard/format';
import { STAFF_COPY } from '@/lib/shell-copy';
import { DataTable, EmptyState, StatusBadge } from './ui';

const TONES: Record<QueueState, StatusTone> = {
  escalated: 'danger',
  waiting: 'warning',
  'in-progress': 'neutral',
  open: 'neutral',
  resolved: 'success',
};

/** Conversations as a table; the customer cell links to the read-only conversation page. */
export default function QueueTable({ items, caption }: { items: QueueItem[]; caption: string }) {
  const copy = STAFF_COPY.queue.columns;
  if (items.length === 0) return <EmptyState>{STAFF_COPY.queue.empty}</EmptyState>;
  return (
    <DataTable
      caption={caption}
      rows={items}
      rowKey={(i) => i.conversationId}
      columns={[
        {
          header: copy.customer,
          cell: (i) => (
            <Link href={`/staff/conversations/${encodeURIComponent(i.conversationId)}`} className="font-medium text-primary hover:underline">
              {i.customer}
            </Link>
          ),
        },
        { header: copy.issue, cell: (i) => i.issue },
        { header: copy.status, cell: (i) => <StatusBadge tone={TONES[i.state]}>{i.statusLabel}</StatusBadge> },
        { header: copy.ticket, cell: (i) => i.ticket ?? '—' },
        { header: copy.started, cell: (i) => i.started, className: 'whitespace-nowrap' },
      ]}
    />
  );
}
