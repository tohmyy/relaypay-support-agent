import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/dashboard/format';

/** Small building blocks for the signed-in pages: flat cards, a status badge and a plain accessible table. */

const TONES: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success',
  neutral: 'bg-surface-subtle text-ink-secondary',
  warning: 'bg-surface-subtle text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-ink">{children}</h1>
      {sub && <p className="mt-1 text-sm text-ink-secondary">{sub}</p>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-4 shadow-card sm:p-6 ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
      {note && <p className="mt-2 text-sm text-ink-muted">{note}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-secondary">{children}</p>;
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** A real table (header cells scoped to columns) inside a horizontally scrollable region for small screens. */
export function DataTable<T>({ caption, columns, rows, rowKey }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle text-ink-secondary">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-4 py-3 font-medium ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.header} className={`px-4 py-3 text-ink ${c.className ?? ''}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
