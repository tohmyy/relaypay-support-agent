import Link from 'next/link';
import { formatWait } from '@/lib/human/notify';
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

/** Conversations as a table; the customer cell links to the conversation page. Unread chats say so in words. */
export default function QueueTable({ items, caption, now }: { items: QueueItem[]; caption: string; now?: number }) {
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
              {i.unread && <span className="ml-2 rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">{STAFF_COPY.queue.unread}</span>}
            </Link>
          ),
        },
        { header: copy.issue, cell: (i) => i.issue },
        {
          header: copy.status,
          cell: (i) => (
            <StatusBadge tone={TONES[i.state]}>
              {i.statusLabel}
              {i.assignedToMe ? ` · ${STAFF_COPY.queue.mine}` : ''}
            </StatusBadge>
          ),
        },
        { header: copy.waiting, cell: (i) => (i.waitingSince ? formatWait(i.waitingSince, now) : '—'), className: 'whitespace-nowrap' },
        { header: copy.ticket, cell: (i) => i.ticket ?? '—' },
        { header: copy.started, cell: (i) => i.started, className: 'whitespace-nowrap' },
      ]}
    />
  );
}
