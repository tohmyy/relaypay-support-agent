import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';

// The site has no public page of its own: everyone starts at sign-in, and a signed-in person goes straight to their
// own area. `proxy.ts` already does this from the cookie; this repeats it from the real session, because the proxy is
// only a first check (docs/AUTH.md).
export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user.role) : '/login?signedout=1');
}
