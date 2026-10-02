import Link from 'next/link';
import { canAccessConversation, type AccessUser } from '@/lib/auth/access';
import type { EscalationRow } from '@/lib/dashboard/archive';
import { formatDateTime } from '@/lib/dashboard/format';
import { STAFF_COPY } from '@/lib/shell-copy';
import { DataTable, EmptyState, StatusBadge } from './ui';

/**
 * The escalation inbox rows. The ticket number opens the escalation (which opens its conversation); a row this person may
 * not open shows the number without a link, so no link leads to a "not found".
 */
export default function EscalationsTable({ rows, viewer, empty }: { rows: EscalationRow[]; viewer: AccessUser; empty: string }) {
  const copy = STAFF_COPY.escalations;
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <DataTable
      caption={copy.title}
      rows={rows}
      rowKey={(r) => r.escalationId}
      columns={[
        {
          header: copy.columns.ticket,
          className: 'whitespace-nowrap',
          cell: (r) =>
            r.conversation && canAccessConversation(viewer, r.conversation) ? (
              <Link href={`/staff/escalations/${encodeURIComponent(r.ticketId)}`} className="font-medium text-primary hover:underline">
                {r.ticketId}
              </Link>
            ) : (
              <span title={copy.notAvailable}>{r.ticketId}</span>
            ),
        },
        { header: copy.columns.customer, cell: (r) => r.customer },
        {
          header: copy.columns.topic,
          cell: (r) => (
            <>
              <span>{r.topic}</span>
              {r.reasonPreview && <span className="block max-w-xs truncate text-xs text-ink-muted">{r.reasonPreview}</span>}
            </>
          ),
        },
        {
          header: copy.columns.status,
          cell: (r) => (
            <span className="flex flex-wrap gap-1">
              <StatusBadge badge={r.status} />
              {r.ticketStatus && <StatusBadge badge={{ ...r.ticketStatus, label: copy.ticketStatus.replace('{status}', r.ticketStatus.label) }} />}
            </span>
          ),
        },
        { header: copy.columns.assignee, cell: (r) => r.assignee ?? '—' },
        { header: copy.columns.created, cell: (r) => formatDateTime(r.createdAt), className: 'whitespace-nowrap' },
        { header: copy.columns.updated, cell: (r) => formatDateTime(r.updatedAt), className: 'whitespace-nowrap' },
      ]}
    />
  );
}
