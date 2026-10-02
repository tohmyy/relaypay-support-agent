/** JSON response that is never cached: these answers are about one person's conversation. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** The parsed JSON body, or undefined when it is missing or not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function logFailure(what: string, error: unknown): void {
  console.error(`[web] ${what}: ${error instanceof Error ? error.message : String(error)}`);
}
