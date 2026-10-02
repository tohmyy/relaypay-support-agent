import Link from 'next/link';
import { Card, EmptyState, PageTitle, Stat, StatusBadge } from '@/components/shell/ui';
import { requireCustomer } from '@/lib/auth/dal';
import { buildCustomerOverview } from '@/lib/dashboard/customer';
import {
  getCustomerConversations,
  getCustomerPayouts,
  getCustomerTransactions,
  getOpenHumanConversation,
} from '@/lib/dashboard/data.server';
import { greeting } from '@/lib/dashboard/format';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireCustomer('/dashboard');
  const customerId = user.customerId as string;
  const [transactions, payouts, conversations, openHuman] = await Promise.all([
    getCustomerTransactions(customerId),
    getCustomerPayouts(customerId),
    getCustomerConversations(customerId, 5),
    getOpenHumanConversation(customerId).catch(() => null),
  ]);
  const overview = buildCustomerOverview({ transactions, payouts, conversations });
  const copy = SHELL_COPY.overview;
  return (
    <>
      <PageTitle>{greeting(new Date(), user.displayName)}</PageTitle>
      {openHuman && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft p-4">
          <p className="text-sm text-ink">{SHELL_COPY.human.banner}</p>
          <Link
            href="/support"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {SHELL_COPY.human.bannerAction}
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/payments" className="block">
          <Stat label={copy.paymentsCard} value={overview.payments.count} note={overview.payments.latest} />
        </Link>
        <Link href="/payouts" className="block">
          <Stat label={copy.payoutsCard} value={overview.payouts.count} note={overview.payouts.latest} />
        </Link>
        <Link href="/invoices" className="block">
          <Stat label={copy.invoicesCard} value={overview.invoices.count} note={overview.invoices.latest} />
        </Link>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={copy.recent}>
          {overview.recent.length === 0 ? (
            <EmptyState>{copy.recentEmpty}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {overview.recent.map((line) => (
                <li key={line.reference} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{line.title}</p>
                    <p className="text-xs text-ink-muted">
                      {line.reference} · {line.date}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm text-ink">{line.amount}</p>
                    <StatusBadge tone={line.tone}>{line.status}</StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title={copy.support}>
            <p className="text-sm text-ink-secondary">{copy.supportBody}</p>
            <Link
              href="/support"
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-5 py-2.5 text-base font-semibold text-white hover:bg-primary-hover"
            >
              {copy.supportAction}
            </Link>
          </Card>
          <Card title={copy.conversations}>
            {overview.conversations.length === 0 ? (
              <EmptyState>{copy.conversationsEmpty}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {overview.conversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/support/${encodeURIComponent(c.id)}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-primary"
                    >
                      <span>{c.started}</span>
                      <span className="text-ink-secondary">{c.outcome}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {overview.conversations.length > 0 && (
              <Link href="/support/history" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
                {copy.viewAll}
              </Link>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
