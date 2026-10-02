import Image from 'next/image';
import { redirect } from 'next/navigation';
import LoginForm from '@/components/shell/LoginForm';
import { getCurrentUser } from '@/lib/auth/dal';
import { homeFor } from '@/lib/auth/access';
import { safeNext } from '@/lib/auth/redirects';
import { SHELL_COPY } from '@/lib/shell-copy';
import { login } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in · RelayPay' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next, '');
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-card sm:p-8">
        <Image src="/logo.png" alt="RelayPay" width={824} height={183} priority className="h-7 w-auto" />
        <h1 className="mt-6 text-xl font-semibold text-ink">{SHELL_COPY.signIn.title}</h1>
        <p className="mt-1 text-sm text-ink-secondary">{SHELL_COPY.signIn.intro}</p>
        <LoginForm action={login} next={target} />
      </div>
    </main>
  );
}
