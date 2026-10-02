import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import NavLinks, { type NavItem } from './NavLinks';

export interface ShellUser {
  displayName: string;
  subtitle: string | null;
}

/**
 * Frame for the signed-in areas: logo, navigation (a sidebar on large screens, a scrolling row on small ones), the
 * signed-in person with a sign-out button, and the page. The sign-out action is passed in so this stays presentational.
 */
export default function AppShell({
  brand,
  homeHref,
  nav,
  navLabel,
  skipLabel,
  signOutLabel,
  signOut,
  user,
  children,
}: {
  brand: string;
  homeHref: string;
  nav: NavItem[];
  navLabel: string;
  skipLabel: string;
  signOutLabel: string;
  signOut: () => Promise<void>;
  user: ShellUser;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        {skipLabel}
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href={homeHref} className="flex items-center gap-3" aria-label={brand}>
            <Image src="/logo.png" alt="" width={824} height={183} priority className="h-7 w-auto" />
            {brand !== 'RelayPay' && <span className="hidden text-sm font-medium text-ink-secondary sm:inline">{brand}</span>}
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink">{user.displayName}</p>
              {user.subtitle && <p className="text-xs text-ink-muted">{user.subtitle}</p>}
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-subtle"
              >
                {signOutLabel}
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:gap-8 lg:py-8">
        <div className="lg:w-52 lg:shrink-0">
          <NavLinks items={nav} label={navLabel} />
        </div>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
