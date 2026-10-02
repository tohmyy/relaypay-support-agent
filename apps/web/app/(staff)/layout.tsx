import type { ReactNode } from 'react';
import { logout } from '@/app/(auth)/login/actions';
import AppShell from '@/components/shell/AppShell';
import type { NavItem } from '@/components/shell/NavLinks';
import { requireStaff } from '@/lib/auth/dal';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { href: '/staff', label: STAFF_COPY.nav.queue, icon: 'queue' },
  { href: '/staff/conversations', label: STAFF_COPY.nav.conversations, icon: 'conversations', prefix: true },
];

/** As for the customer layout: this shows the shell; every staff page and action does its own check. */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff();
  return (
    <AppShell
      brand={STAFF_COPY.brand}
      homeHref="/staff"
      nav={NAV}
      navLabel={STAFF_COPY.nav.label}
      skipLabel={STAFF_COPY.nav.skip}
      signOutLabel={STAFF_COPY.nav.signOut}
      signOut={logout}
      user={{ displayName: user.displayName, subtitle: user.title }}
    >
      {children}
    </AppShell>
  );
}
