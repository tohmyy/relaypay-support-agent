'use client';

import { CreditCard, FileText, Headphones, History, LayoutDashboard, Landmark, ListChecks, MessagesSquare, Settings, Ticket } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOptionalInbox } from './StaffInbox';

const ICONS = {
  overview: LayoutDashboard,
  payments: CreditCard,
  payouts: Landmark,
  invoices: FileText,
  support: Headphones,
  history: History,
  settings: Settings,
  queue: ListChecks,
  escalations: Ticket,
  conversations: MessagesSquare,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Shows the staff inbox's attention count beside the label. */
  badge?: 'inbox';
  /** Pages under this path also count as "here" (for example a conversation under Conversations). */
  prefix?: boolean;
  /** Paths under `prefix` that belong to another item (so only one item is ever marked current). */
  exclude?: string[];
}

export function isCurrent(pathname: string, item: Pick<NavItem, 'href' | 'prefix' | 'exclude'>): boolean {
  if (pathname === item.href) return true;
  if (item.exclude?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return Boolean(item.prefix) && pathname.startsWith(`${item.href}/`);
}

/** The signed-in area's navigation. The current page is marked with aria-current for assistive technology. */
export default function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  const inbox = useOptionalInbox();
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const current = isCurrent(pathname, item);
          const count = item.badge === 'inbox' ? (inbox?.attention ?? 0) : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                aria-label={count > 0 ? `${item.label}, ${count} need attention` : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  current ? 'bg-accent-soft text-primary' : 'text-ink-secondary hover:bg-surface-subtle hover:text-ink'
                }`}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                {item.label}
                {count > 0 && (
                  <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white" aria-hidden>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
