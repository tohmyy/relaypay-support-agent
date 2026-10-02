import Link from 'next/link';
import EscalationsTable from '@/components/shell/EscalationsTable';
import PageNav from '@/components/shell/PageNav';
import { PageTitle } from '@/components/shell/ui';
import { requireStaff } from '@/lib/auth/dal';
import { ESCALATION_STATUSES, normalizeTicketId, parseEscalationStatus } from '@/lib/dashboard/archive';
import { getEscalationsPage } from '@/lib/dashboard/data.server';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

type Query = { status?: string | string[]; ticket?: string | string[]; cursor?: string | string[] };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || null;

/**
 * The escalation inbox: every escalation, newest first, with a status filter and a ticket-number search. The query is
 * validated here (an unknown status is "all", a ticket number must look like TKT-000123) before it reaches the database.
 * Each ticket number opens the escalation's conversation.
 */
export default async function StaffEscalationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireStaff('/staff/escalations');
  const query = await searchParams;
  const copy = STAFF_COPY.escalations;
  const status = parseEscalationStatus(query.status);
  const typedTicket = first(query.ticket)?.trim() ?? '';
  const ticket = normalizeTicketId(typedTicket);
  const invalidTicket = typedTicket !== '' && !ticket;
  const cursor = first(query.cursor);
  const page = await getEscalationsPage({ status, ticket, cursor });
  const filtered = Boolean(status || ticket);
  const field = 'min-h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink';

  return (
    <>
      <PageTitle sub={copy.intro}>{copy.title}</PageTitle>
      <form method="get" action="/staff/escalations" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="escalation-ticket" className="text-sm font-medium text-ink-secondary">
            {copy.search.label}
          </label>
          <input
            id="escalation-ticket"
            name="ticket"
            defaultValue={typedTicket}
            placeholder={copy.search.placeholder}
            autoComplete="off"
            aria-invalid={invalidTicket || undefined}
            aria-describedby={invalidTicket ? 'escalation-ticket-error' : undefined}
            className={`${field} w-44`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="escalation-status" className="text-sm font-medium text-ink-secondary">
            {copy.status.label}
          </label>
          <select id="escalation-status" name="status" defaultValue={status ?? ''} className={field}>
            <option value="">{copy.status.all}</option>
            {ESCALATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {copy.status[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">
          {copy.apply}
        </button>
        {filtered || typedTicket ? (
          <Link href="/staff/escalations" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
            {copy.search.clear}
          </Link>
        ) : null}
      </form>
      {invalidTicket && (
        <p id="escalation-ticket-error" role="alert" className="mb-3 text-sm text-danger">
          {copy.search.invalid}
        </p>
      )}
      {page.restarted && (
        <p role="status" className="mb-3 text-sm text-ink-muted">
          {STAFF_COPY.pagination.restarted}
        </p>
      )}
      <EscalationsTable
        rows={page.rows}
        viewer={user}
        empty={ticket ? copy.search.notFound.replace('{ticket}', ticket) : filtered ? copy.emptyFiltered : copy.empty}
      />
      <PageNav
        basePath="/staff/escalations"
        params={{ status, ticket }}
        cursor={page.restarted ? null : cursor}
        nextCursor={page.nextCursor}
      />
    </>
  );
}
