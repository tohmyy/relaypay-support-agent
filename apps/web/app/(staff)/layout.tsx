import type { ReactNode } from 'react';
import { logout } from '@/app/(auth)/login/actions';
import AppShell from '@/components/shell/AppShell';
import type { NavItem } from '@/components/shell/NavLinks';
import PresenceControl from '@/components/shell/PresenceControl';
import { StaffInboxProvider } from '@/components/shell/StaffInbox';
import { requireStaff } from '@/lib/auth/dal';
import { getStaffQueueRows } from '@/lib/dashboard/data.server';
import { buildStaffQueueFor } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { href: '/staff', label: STAFF_COPY.nav.queue, icon: 'queue', badge: 'inbox' },
  { href: '/staff/escalations', label: STAFF_COPY.nav.escalations, icon: 'escalations', prefix: true },
  { href: '/staff/conversations', label: STAFF_COPY.nav.conversations, icon: 'conversations', prefix: true },
];
/** Settings are for administrators only. */
const ADMIN_NAV: NavItem[] = [{ href: '/staff/settings', label: STAFF_COPY.nav.settings, icon: 'settings' }];

/**
 * As for the customer layout: this shows the shell; every staff page and action does its own check. The queue shown
 * on every staff page comes from one live inbox that starts from what the server just read and keeps itself current.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff();
  const initial = await getStaffQueueRows()
    .then((rows) => buildStaffQueueFor(user, rows))
    .catch(() => null);
  return (
    <StaffInboxProvider initial={initial}>
      <AppShell
        brand={STAFF_COPY.brand}
        homeHref="/staff"
        nav={user.role === 'support_admin' ? [...NAV, ...ADMIN_NAV] : NAV}
        navLabel={STAFF_COPY.nav.label}
        skipLabel={STAFF_COPY.nav.skip}
        signOutLabel={STAFF_COPY.nav.signOut}
        signOut={logout}
        user={{ displayName: user.displayName, subtitle: user.title }}
        headerExtra={<PresenceControl initialAvailable={user.available} />}
      >
        {children}
      </AppShell>
    </StaffInboxProvider>
  );
}
