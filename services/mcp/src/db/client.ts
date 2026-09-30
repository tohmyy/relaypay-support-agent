import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

// Service-role client (server side only). Node 20 has no native WebSocket, which realtime needs.
export function createSupabase(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    realtime: { transport: ws as never },
  });
}
