import { logout } from '@/app/(auth)/login/actions';
import { Card, PageTitle } from '@/components/shell/ui';
import { requireCustomer } from '@/lib/auth/dal';
import { getCustomerProfile } from '@/lib/dashboard/data.server';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireCustomer('/settings');
  const profile = await getCustomerProfile(user.customerId as string).catch(() => null);
  const copy = SHELL_COPY.settings;
  const rows: [string, string][] = [
    [copy.name, user.displayName],
    [copy.email, user.email],
    [copy.company, profile?.company_name ?? '—'],
    [copy.plan, profile?.plan ?? '—'],
  ];
  return (
    <>
      <PageTitle>{copy.title}</PageTitle>
      <Card title={copy.profile}>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-medium text-ink-secondary">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="mt-4">
        <p className="text-sm text-ink-secondary">{copy.signOutHint}</p>
        <form action={logout} className="mt-3">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-subtle"
          >
            {SHELL_COPY.nav.signOut}
          </button>
        </form>
      </Card>
    </>
  );
}
