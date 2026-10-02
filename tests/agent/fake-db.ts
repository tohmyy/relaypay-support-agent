import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;

/**
 * In-memory stand-in for the parts of supabase-js the session code uses: select (with head/count), insert, upsert,
 * update, and the eq / neq / is / gte filters. Enough for the handoff and limit tests; not a general fake.
 */
export function fakeDb(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    conversations: [],
    conversation_turns: [],
    conversation_events: [],
    tool_calls: [],
    retrieval_logs: [],
    ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v ?? []])),
  };
  const queries: string[] = [];
  let failNext: string | undefined;

  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    let countOnly = false;
    let wantCount = false;
    let desc = false;
    queries.push(table);
    const matching = () => rows.filter((r) => filters.every((f) => f(r)));
    const b: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantCount = true;
        if (opts?.head) countOnly = true;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      limit: () => b,
      gte: (c: string, v: unknown) => (filters.push((r) => String(r[c] ?? '') >= String(v)), b),
      order: (_c: string, o?: { ascending?: boolean }) => ((desc = o?.ascending === false), b),
      update: (p: Row) => ((mode = 'update'), (patch = p), b),
      insert: (row: Row | Row[]) => {
        for (const r of Array.isArray(row) ? row : [row]) rows.push({ id: `${table}-${rows.length + 1}`, ...r });
        return Promise.resolve({ data: null, error: null });
      },
      upsert: (row: Row) => {
        if (!rows.some((r) => r.conversation_id === row.conversation_id)) {
          rows.push({
            started_at: new Date().toISOString(),
            ended_at: null,
            end_reason: null,
            final_status: null,
            support_mode: 'ai',
            customer_id: null,
            ...row,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        if (failNext === table) {
          failNext = undefined;
          return resolve({ data: null, count: null, error: { message: `${table} failed` } });
        }
        if (mode === 'update') {
          matching().forEach((r) => Object.assign(r, patch));
          return resolve({ data: null, error: null });
        }
        const data = matching().slice();
        if (desc) data.reverse();
        return resolve({
          data: countOnly ? null : data,
          count: wantCount ? data.length : null,
          error: null,
        });
      },
    };
    return b;
  };
  return {
    db: { from } as unknown as SupabaseClient,
    tables,
    queries,
    /** Make the next read of this table fail once. */
    failNext: (table: string) => {
      failNext = table;
    },
  };
}
