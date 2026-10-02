import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbuseLimits } from './types';

/** What a conversation has used so far. Rebuilt from the tables after a restart, then kept in memory. */
export interface Usage {
  agentCalls: number;
  toolCalls: number;
  retrievalCalls: number;
}

export type BudgetKind = 'agent_calls' | 'tool_calls' | 'retrievals';

/** The first budget a conversation has used up, if any. A limit of 0 is off. */
export function budgetExceeded(
  usage: Usage,
  limits: AbuseLimits,
): { kind: BudgetKind; limit: number; value: number } | undefined {
  const checks: [BudgetKind, number, number][] = [
    ['agent_calls', limits.maxAgentCalls, usage.agentCalls],
    ['tool_calls', limits.maxToolCalls, usage.toolCalls],
    ['retrievals', limits.maxRetrievals, usage.retrievalCalls],
  ];
  for (const [kind, limit, value] of checks) {
    if (limit > 0 && value >= limit) return { kind, limit, value };
  }
  return undefined;
}

export function limitsEnabled(limits: AbuseLimits): boolean {
  return (
    limits.maxAgentCalls > 0 ||
    limits.maxToolCalls > 0 ||
    limits.maxRetrievals > 0 ||
    limits.maxConcurrentSessions > 0 ||
    limits.sessionRateMax > 0 ||
    limits.globalSessionRateMax > 0
  );
}

function fail(action: string, error: { message: string } | null) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

async function countRows(db: SupabaseClient, table: string, conversationId: string): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  fail(`count ${table}`, error);
  return count ?? 0;
}

/**
 * Usage so far, from the tables. Only the AI-era pair rows of `conversation_turns` count as model calls (rows from
 * people and the system have a sender). Tool call rows can lag slightly when the MCP server writes them in the
 * background, which only ever makes a budget a little more generous after a restart.
 */
export async function loadUsage(db: SupabaseClient, conversationId: string): Promise<Usage> {
  const [turns, toolCalls, retrievals] = await Promise.all([
    db
      .from('conversation_turns')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .is('sender', null),
    countRows(db, 'tool_calls', conversationId),
    countRows(db, 'retrieval_logs', conversationId),
  ]);
  fail('count turns', turns.error);
  return { agentCalls: turns.count ?? 0, toolCalls, retrievalCalls: retrievals };
}

export interface Identity {
  customerId: string | null;
  supportMode: string;
  startedAt?: string | null;
}

/** Who the conversation belongs to (set by the web app's link step after the call starts) and who is talking. */
export async function lookupIdentity(db: SupabaseClient, conversationId: string): Promise<Identity | undefined> {
  const { data, error } = await db
    .from('conversations')
    .select('customer_id, support_mode, started_at')
    .eq('conversation_id', conversationId);
  fail('look up conversation', error);
  const row = data?.[0] as
    | { customer_id?: string | null; support_mode?: string | null; started_at?: string | null }
    | undefined;
  if (!row) return undefined;
  return { customerId: row.customer_id ?? null, supportMode: row.support_mode ?? 'ai', startedAt: row.started_at };
}

export async function countCustomerSessions(db: SupabaseClient, customerId: string, sinceIso: string): Promise<number> {
  const { count, error } = await db
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .gte('started_at', sinceIso);
  fail('count customer sessions', error);
  return count ?? 0;
}

export async function countAllSessions(db: SupabaseClient, sinceIso: string): Promise<number> {
  const { count, error } = await db
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .gte('started_at', sinceIso);
  fail('count sessions', error);
  return count ?? 0;
}

/**
 * Other AI voice sessions this customer has open that began before this one. "Open" means not ended and showing
 * recent activity: a row left behind by a crashed call must not block the customer for ever, so anything older than
 * the session limit plus a grace period is ignored.
 */
export async function activeEarlierSessions(
  db: SupabaseClient,
  customerId: string,
  conversationId: string,
  thisStartedAtMs: number,
  opts: { maxSeconds: number; now?: number },
): Promise<string[]> {
  const { data, error } = await db
    .from('conversations')
    .select('conversation_id, started_at, last_activity_at')
    .eq('customer_id', customerId)
    .eq('support_mode', 'ai')
    .is('ended_at', null)
    .neq('conversation_id', conversationId);
  fail('look up open sessions', error);
  const now = opts.now ?? Date.now();
  const staleAfterMs = (opts.maxSeconds + 120) * 1000;
  return ((data ?? []) as { conversation_id: string; started_at?: string | null; last_activity_at?: string | null }[])
    .filter((r) => {
      const started = Date.parse(r.started_at ?? '');
      const last = Date.parse(r.last_activity_at ?? '') || started;
      return Number.isFinite(started) && started < thisStartedAtMs && now - last < staleAfterMs;
    })
    .map((r) => r.conversation_id);
}
