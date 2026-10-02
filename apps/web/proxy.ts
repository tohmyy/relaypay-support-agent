import { NextResponse, type NextRequest } from 'next/server';
import { canEnterArea, homeFor } from '@/lib/auth/access';
import { getSessionSecret } from '@/lib/auth/secret';
import { verifySession, type SessionClaims } from '@/lib/auth/token';

/** Must match `SESSION_COOKIE` in lib/auth/session.ts (that module is server-only and cannot be imported here). */
const COOKIE = 'rp_session';

function claimsFrom(request: NextRequest): SessionClaims | null {
  try {
    return verifySession(request.cookies.get(COOKIE)?.value, getSessionSecret());
  } catch {
    return null; // no usable secret configured: nobody is signed in
  }
}

/**
 * A quick, cookie-only check that sends visitors to the right place before a page renders. It never reads the
 * database, so it is not the security boundary: every page, route handler and server action re-checks the user through
 * `lib/auth/dal.ts`, which also notices disabled accounts and changed roles.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const claims = claimsFrom(request);

  if (pathname === '/login') {
    return claims ? NextResponse.redirect(new URL(homeFor(claims.role), request.url)) : NextResponse.next();
  }

  if (!claims) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const area = pathname === '/staff' || pathname.startsWith('/staff/') ? 'staff' : 'customer';
  if (!canEnterArea(claims.role, area)) {
    return NextResponse.redirect(new URL(homeFor(claims.role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/dashboard', '/payments', '/payouts', '/invoices', '/support/:path*', '/settings', '/staff/:path*'],
};
