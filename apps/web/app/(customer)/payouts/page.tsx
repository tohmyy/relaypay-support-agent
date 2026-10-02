import { DataTable, EmptyState, PageTitle, StatusBadge } from '@/components/shell/ui';
import { requireCustomer } from '@/lib/auth/dal';
import { payoutLine } from '@/lib/dashboard/customer';
import { getCustomerPayouts } from '@/lib/dashboard/data.server';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  const user = await requireCustomer('/payouts');
  const rows = (await getCustomerPayouts(user.customerId as string)).map(payoutLine);
  const copy = SHELL_COPY.lists;
  return (
    <>
      <PageTitle>{copy.payouts.title}</PageTitle>
      {rows.length === 0 ? (
        <EmptyState>{copy.payouts.empty}</EmptyState>
      ) : (
        <DataTable
          caption={copy.payouts.title}
          rows={rows}
          rowKey={(r) => r.reference}
          columns={[
            { header: copy.columns.reference, cell: (r) => r.reference },
            { header: copy.columns.recipient, cell: (r) => r.title },
            { header: copy.columns.date, cell: (r) => r.date },
            { header: copy.columns.amount, cell: (r) => r.amount, className: 'whitespace-nowrap' },
            { header: copy.columns.status, cell: (r) => <StatusBadge tone={r.tone}>{r.status}</StatusBadge> },
          ]}
        />
      )}
    </>
  );
}
