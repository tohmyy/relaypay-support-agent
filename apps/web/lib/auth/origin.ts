/**
 * Browsers send an Origin header on cross-site POSTs. A request from another site is refused; no Origin at all means
 * a same-site tool or a server-to-server call, which the session cookie still has to authorise.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
