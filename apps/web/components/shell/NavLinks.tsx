'use client';

import { CreditCard, FileText, Headphones, LayoutDashboard, Landmark, ListChecks, MessagesSquare, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS = {
  overview: LayoutDashboard,
  payments: CreditCard,
  payouts: Landmark,
  invoices: FileText,
  support: Headphones,
  settings: Settings,
  queue: ListChecks,
  conversations: MessagesSquare,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Pages under this path also count as "here" (for example a conversation under Conversations). */
  prefix?: boolean;
}

export function isCurrent(pathname: string, item: Pick<NavItem, 'href' | 'prefix'>): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.prefix) && pathname.startsWith(`${item.href}/`);
}

/** The signed-in area's navigation. The current page is marked with aria-current for assistive technology. */
export default function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const current = isCurrent(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  current ? 'bg-accent-soft text-primary' : 'text-ink-secondary hover:bg-surface-subtle hover:text-ink'
                }`}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
