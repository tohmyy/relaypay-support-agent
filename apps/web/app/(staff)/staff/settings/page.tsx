import ContactMethodsSettings from '@/components/shell/ContactMethodsSettings';
import { PageTitle } from '@/components/shell/ui';
import { requireRole } from '@/lib/auth/dal';
import { isAnyStaffOnline } from '@/lib/dashboard/data.server';
import { getContactMethodsDetail } from '@/lib/settings/contact-methods.server';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

function when(iso: string | null): string | null {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

/** Administrators only. Anyone else is sent to their own area before anything is read. */
export default async function StaffSettingsPage() {
  await requireRole(['support_admin'], '/staff/settings');
  const [detail, online] = await Promise.all([
    getContactMethodsDetail().catch(() => null),
    isAnyStaffOnline().catch(() => false),
  ]);
  return (
    <>
      <PageTitle>{STAFF_COPY.settings.title}</PageTitle>
      {detail ? (
        <ContactMethodsSettings
          initial={detail.methods}
          staffOnline={online}
          lastChanged={when(detail.updatedAt) ? { when: when(detail.updatedAt) as string, who: detail.updatedBy } : null}
        />
      ) : (
        <p role="alert" className="text-sm text-danger">
          {STAFF_COPY.settings.loadFailed}
        </p>
      )}
    </>
  );
}
