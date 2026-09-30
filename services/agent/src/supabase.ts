import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

let client: SupabaseClient | undefined;

// Service-role client (server side only). Validates just the variables it needs.
// Node 20 has no native WebSocket, which the realtime client requires.
export function getSupabase(): SupabaseClient {
  if (!client) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
      throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
    }
    client = createClient(result.data.SUPABASE_URL, result.data.SUPABASE_SERVICE_ROLE_KEY, {
      realtime: { transport: ws as never },
    });
  }
  return client;
}
