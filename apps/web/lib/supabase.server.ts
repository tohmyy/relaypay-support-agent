import 'server-only';
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

function credentials() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
  }
  return parsed.data;
}

function headers(key: string, extra: Record<string, string> = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/**
 * Minimal PostgREST reader using the service-role key (server side only). Validates just the two
 * variables it needs; names only are reported when they are missing.
 */
export async function restSelect<T>(table: string, query: string): Promise<T[]> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = credentials();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: headers(SUPABASE_SERVICE_ROLE_KEY),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${table} query failed (${res.status})`);
  return (await res.json()) as T[];
}

/**
 * Inserts one row with the service-role key (server side only). With `onConflict` set, a row that already exists
 * for that unique column is left as it is, so repeating the call is harmless. Errors name the table and status
 * only, never the row, so submitted text cannot reach logs.
 */
export async function restInsert(
  table: string,
  row: Record<string, unknown>,
  opts: { onConflict?: string } = {},
): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = credentials();
  const query = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : '';
  const prefer = opts.onConflict ? 'return=minimal,resolution=ignore-duplicates' : 'return=minimal';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: 'POST',
    headers: headers(SUPABASE_SERVICE_ROLE_KEY, { 'Content-Type': 'application/json', Prefer: prefer }),
    body: JSON.stringify(row),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${table} insert failed (${res.status})`);
}

/**
 * Updates the rows matching `query` (a PostgREST filter such as `conversation_id=eq.x&customer_id=is.null`) and
 * returns the rows it changed, so a caller can tell whether a conditional update actually won. Errors name the table
 * and status only.
 */
export async function restPatch<T = Record<string, unknown>>(
  table: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<T[]> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = credentials();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: headers(SUPABASE_SERVICE_ROLE_KEY, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${table} update failed (${res.status})`);
  return (await res.json()) as T[];
}

/**
 * Calls a Postgres function through PostgREST (service role, server side only). Errors name the function and status
 * only, never the arguments.
 */
export async function restRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = credentials();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(SUPABASE_SERVICE_ROLE_KEY, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${fn} call failed (${res.status})`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
