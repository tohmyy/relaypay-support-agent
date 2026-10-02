import type { ReactNode } from 'react';
import { logout } from '@/app/(auth)/login/actions';
import AppShell from '@/components/shell/AppShell';
import type { NavItem } from '@/components/shell/NavLinks';
import { requireCustomer } from '@/lib/auth/dal';
import { getCustomerProfile } from '@/lib/dashboard/data.server';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { href: '/dashboard', label: SHELL_COPY.nav.dashboard, icon: 'overview' },
  { href: '/payments', label: SHELL_COPY.nav.payments, icon: 'payments' },
  { href: '/payouts', label: SHELL_COPY.nav.payouts, icon: 'payouts' },
  { href: '/invoices', label: SHELL_COPY.nav.invoices, icon: 'invoices' },
  { href: '/support', label: SHELL_COPY.nav.support, icon: 'support', prefix: true },
  { href: '/settings', label: SHELL_COPY.nav.settings, icon: 'settings' },
];

/**
 * The layout shows the shell, but a layout does not run again on every navigation, so it is not what protects the
 * pages: each page and action checks the user itself.
 */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const user = await requireCustomer();
  const profile = user.customerId ? await getCustomerProfile(user.customerId).catch(() => null) : null;
  return (
    <AppShell
      brand={SHELL_COPY.brand}
      homeHref="/dashboard"
      nav={NAV}
      navLabel={SHELL_COPY.nav.label}
      skipLabel={SHELL_COPY.nav.skip}
      signOutLabel={SHELL_COPY.nav.signOut}
      signOut={logout}
      user={{ displayName: user.displayName, subtitle: profile?.company_name ?? null }}
    >
      {children}
    </AppShell>
  );
}
