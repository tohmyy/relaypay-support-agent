import Link from 'next/link';
import { Card, EmptyState, PageTitle, StatusBadge } from '@/components/shell/ui';
import { requireCustomer } from '@/lib/auth/dal';
import { getCustomerConversations } from '@/lib/dashboard/data.server';
import { buildHistoryPage, HISTORY_PAGE_SIZE, parsePage } from '@/lib/dashboard/history';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

/**
 * All of a signed-in customer's past support conversations, newest first, ten to a page (docs/BUILD-PLAN-V3.md V3.5).
 * The customer comes from the session, never from the URL; each row opens the saved transcript, which does its own
 * ownership check.
 */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const user = await requireCustomer('/support/history');
  const page = parsePage((await searchParams).page);
  const rows = await getCustomerConversations(user.customerId as string, HISTORY_PAGE_SIZE + 1, (page - 1) * HISTORY_PAGE_SIZE);
  const view = buildHistoryPage(rows, page);
  const copy = SHELL_COPY.history;
  return (
    <>
      <PageTitle sub={copy.intro}>{copy.title}</PageTitle>
      <Card>
        {view.lines.length === 0 ? (
          <EmptyState>{copy.empty}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {view.lines.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/support/${encodeURIComponent(c.id)}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-primary"
                >
                  <span>{c.started}</span>
                  <StatusBadge badge={c.badge} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(view.hasNewer || view.hasOlder) && (
          <nav aria-label={copy.title} className="mt-4 flex items-center justify-between gap-3 text-sm">
            {view.hasNewer ? (
              <Link
                href={view.page - 1 === 1 ? '/support/history' : `/support/history?page=${view.page - 1}`}
                className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
              >
                {copy.newer}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">{copy.page.replace('{page}', String(view.page))}</span>
            {view.hasOlder ? (
              <Link href={`/support/history?page=${view.page + 1}`} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
                {copy.older}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
      <Link href="/dashboard" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        {copy.back}
      </Link>
    </>
  );
}
