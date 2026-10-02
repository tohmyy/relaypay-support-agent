import { DataTable, EmptyState, PageTitle, StatusBadge } from '@/components/shell/ui';
import { requireCustomer } from '@/lib/auth/dal';
import { paymentLine } from '@/lib/dashboard/customer';
import { getCustomerTransactions } from '@/lib/dashboard/data.server';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const user = await requireCustomer('/payments');
  const rows = (await getCustomerTransactions(user.customerId as string)).map(paymentLine);
  const copy = SHELL_COPY.lists;
  return (
    <>
      <PageTitle>{copy.payments.title}</PageTitle>
      {rows.length === 0 ? (
        <EmptyState>{copy.payments.empty}</EmptyState>
      ) : (
        <DataTable
          caption={copy.payments.title}
          rows={rows}
          rowKey={(r) => r.reference}
          columns={[
            { header: copy.columns.reference, cell: (r) => r.reference },
            { header: copy.columns.type, cell: (r) => r.title },
            { header: copy.columns.date, cell: (r) => r.date },
            { header: copy.columns.amount, cell: (r) => r.amount, className: 'whitespace-nowrap' },
            { header: copy.columns.status, cell: (r) => <StatusBadge tone={r.tone}>{r.status}</StatusBadge> },
          ]}
        />
      )}
    </>
  );
}
