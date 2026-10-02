import Link from 'next/link';
import { STAFF_COPY } from '@/lib/shell-copy';

/** "/staff/escalations?status=open&cursor=…": the list's own filters are kept, empty ones left out. */
export function pageHref(basePath: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/**
 * Paging for a newest-first list that moves by cursor: "Older" goes to the next page, "Newest" back to the first. There
 * is no page number, because a cursor page is defined by the row it starts after, not by a count.
 */
export default function PageNav({
  basePath,
  params,
  cursor,
  nextCursor,
}: {
  basePath: string;
  /** The filters to keep on every link. */
  params: Record<string, string | null | undefined>;
  /** The cursor of the page being shown (null on the first page). */
  cursor: string | null;
  nextCursor: string | null;
}) {
  if (!cursor && !nextCursor) return null;
  const copy = STAFF_COPY.pagination;
  const link = 'inline-flex min-h-11 items-center font-medium text-primary hover:underline';
  return (
    <nav aria-label={copy.label} className="mt-4 flex items-center justify-between gap-3 text-sm">
      {cursor ? (
        <Link href={pageHref(basePath, params)} className={link}>
          {copy.newest}
        </Link>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Link href={pageHref(basePath, { ...params, cursor: nextCursor })} className={link}>
          {copy.older}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
