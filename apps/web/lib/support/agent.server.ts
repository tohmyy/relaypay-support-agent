import 'server-only';
import { failFor, withRetry, type RetryEvent } from '@/lib/retry';

// The web app's server-side view of the voice agent: how to reach it and whether it is ready. Customers never see
// any of this; the routes that use it answer with a plain available / unavailable (docs/BUILD-PLAN-V3.md V3.1).

export function agentBaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENT_INTERNAL_URL) return env.AGENT_INTERNAL_URL.replace(/\/+$/, '');
  const host = env.AGENT_HOST || '127.0.0.1';
  const port = env.AGENT_PORT || '4100';
  return `http://${host}:${port}`;
}

export const READY_FETCH_TIMEOUT_MS = 4000;
/** A typed turn runs the assistant, which can take a while. */
export const TEXT_TURN_TIMEOUT_MS = 90_000;
export const AGENT_CONTROL_TIMEOUT_MS = 5_000;

function logRetry(event: RetryEvent) {
  if (event.outcome === 'ok' && event.attempt === 1) return;
  console.info(
    `[web] retry operation=${event.operation} attempt=${event.attempt} outcome=${event.outcome} class=${event.errorClass ?? '-'} ms=${event.durationMs}`,
  );
}

/** Sends a single authenticated control signal. These are leases/idempotent commands and are never auto-retried. */
export async function sendAgentControl(
  path: '/activity' | '/end-session',
  body: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  const token = env.AGENT_API_TOKEN;
  if (!token) return false;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${agentBaseUrl(env)}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(AGENT_CONTROL_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when the agent reports that it, the tool server and the database are all answering. One automatic retry. */
export async function agentIsReady(
  opts: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  const token = env.AGENT_API_TOKEN;
  if (!token) return false;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    await withRetry(
      async () => {
        const res = await doFetch(`${agentBaseUrl(env)}/ready`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(READY_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) failFor(res.status);
      },
      { operation: 'agent-ready', sleep: opts.sleep, onEvent: logRetry },
    );
    return true;
  } catch {
    return false;
  }
}
