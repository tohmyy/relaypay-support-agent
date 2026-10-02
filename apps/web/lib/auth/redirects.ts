/**
 * Where to send someone after signing in, taken from the `next` query parameter. Only a plain path on this site is
 * accepted: anything that could leave the site (`//evil.example`, `https://...`, `/\evil`, control characters) falls
 * back to the default, so the login page cannot be used as an open redirect.
 */
export function safeNext(next: unknown, fallback: string): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, 'http://site.invalid');
    if (url.origin !== 'http://site.invalid') return fallback;
  } catch {
    return fallback;
  }
  // Never bounce back to the login page itself.
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return fallback;
  return next;
}
