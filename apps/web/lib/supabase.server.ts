import 'server-only';
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Minimal PostgREST reader using the service-role key (server side only). Validates just the two
 * variables it needs; names only are reported when they are missing.
 */
export async function restSelect<T>(table: string, query: string): Promise<T[]> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = parsed.data;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${table} query failed (${res.status})`);
  return (await res.json()) as T[];
}
