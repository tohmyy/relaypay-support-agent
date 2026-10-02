import type { SupabaseClient } from '@supabase/supabase-js';

// Dependency readiness for the agent (docs/BUILD-PLAN-V3.md V3.1). `/health` stays pure liveness; `/ready` answers
// "can this agent do useful work right now": the MCP server answers and the database responds. Internal only; the web
// app maps it to a customer-safe available / unavailable.

export interface ReadyCheck {
  ok: boolean;
  ms?: number;
  error?: string;
}

export interface ReadyResponse {
  ok: boolean;
  checks: { mcp: ReadyCheck; db: ReadyCheck };
}

export const READY_TIMEOUT_MS = 1500;

async function timed(
  run: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
): Promise<ReadyCheck> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await run(controller.signal);
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      ms: Date.now() - started,
      error: aborted ? 'timeout' : error instanceof Error ? error.message : 'failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The MCP URL points at `/mcp`; its liveness route is `/health` on the same origin. */
export function mcpHealthUrl(mcpUrl: string): string {
  return new URL('/health', mcpUrl).toString();
}

export function createReadyCheck(opts: {
  db: SupabaseClient;
  mcpUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): () => Promise<ReadyResponse> {
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  return async () => {
    const [mcp, db] = await Promise.all([
      timed(async (signal) => {
        const res = await doFetch(mcpHealthUrl(opts.mcpUrl), { signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
      }, timeoutMs),
      timed(async (signal) => {
        const { error } = await opts.db
          .from('conversations')
          .select('conversation_id', { head: true, count: 'exact' })
          .limit(1)
          .abortSignal(signal);
        if (error) throw new Error(error.message);
      }, timeoutMs),
    ]);
    return { ok: mcp.ok && db.ok, checks: { mcp, db } };
  };
}
