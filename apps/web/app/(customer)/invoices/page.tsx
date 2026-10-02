import { DataTable, EmptyState, PageTitle, StatusBadge } from '@/components/shell/ui';
import { requireCustomer } from '@/lib/auth/dal';
import { isInvoice, paymentLine } from '@/lib/dashboard/customer';
import { getCustomerTransactions } from '@/lib/dashboard/data.server';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const user = await requireCustomer('/invoices');
  const rows = (await getCustomerTransactions(user.customerId as string)).filter(isInvoice).map(paymentLine);
  const copy = SHELL_COPY.lists;
  return (
    <>
      <PageTitle>{copy.invoices.title}</PageTitle>
      {rows.length === 0 ? (
        <EmptyState>{copy.invoices.empty}</EmptyState>
      ) : (
        <DataTable
          caption={copy.invoices.title}
          rows={rows}
          rowKey={(r) => r.reference}
          columns={[
            { header: copy.columns.reference, cell: (r) => r.reference },
            { header: copy.columns.date, cell: (r) => r.date },
            { header: copy.columns.amount, cell: (r) => r.amount, className: 'whitespace-nowrap' },
            { header: copy.columns.status, cell: (r) => <StatusBadge tone={r.tone}>{r.status}</StatusBadge> },
          ]}
        />
      )}
    </>
  );
}
