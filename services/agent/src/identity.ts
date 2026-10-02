import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage, logEvent } from './logger';

/**
 * The signed-in customer a conversation belongs to, as the server knows it (docs/BUILD-PLAN-V3.md V3.3). It comes from
 * the link the web app wrote onto the conversation and the account row, never from anything the caller said. It goes
 * into the model's prompt so the assistant helps THIS customer and does not ask who they are; the contact details are
 * also what the tool server puts on an escalation. Server side only: it is never part of the public state API.
 */
export interface AuthenticatedCustomer {
  customerId: string;
  displayName: string | null;
  email: string | null;
  companyName: string | null;
}

const CACHE_MS = 5 * 60_000;

interface Cached {
  value: AuthenticatedCustomer;
  expires: number;
}

/** Looks the account up once and remembers it for a few minutes. A missing link is never cached, so it is found the moment it lands. */
export class IdentitySource {
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly db: SupabaseClient,
    private readonly now: () => number = Date.now,
  ) {}

  async get(customerId: string | null, userId: string | null): Promise<AuthenticatedCustomer | null> {
    if (!customerId) return null;
    const key = `${customerId}|${userId ?? ''}`;
    const t = this.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > t) return hit.value;

    let displayName: string | null = null;
    let email: string | null = null;
    let companyName: string | null = null;
    try {
      const [user, customer] = await Promise.all([
        userId
          ? this.db.from('app_users').select('display_name, email').eq('id', userId)
          : Promise.resolve({ data: null, error: null }),
        this.db.from('customers').select('company_name').eq('customer_id', customerId),
      ]);
      if (user.error) throw new Error(user.error.message);
      if (customer.error) throw new Error(customer.error.message);
      const u = (user.data as { display_name?: string | null; email?: string | null }[] | null)?.[0];
      const c = (customer.data as { company_name?: string | null }[] | null)?.[0];
      displayName = u?.display_name ?? null;
      email = u?.email ?? null;
      companyName = c?.company_name ?? null;
    } catch (error) {
      // The customer id alone is still worth telling the model; the details are retried next turn.
      logEvent('warn', 'identity lookup failed', { message: errorMessage(error) });
      return { customerId, displayName: null, email: null, companyName: null };
    }

    const value: AuthenticatedCustomer = { customerId, displayName, email, companyName };
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { value, expires: t + CACHE_MS });
    return value;
  }
}

const sources = new WeakMap<SupabaseClient, IdentitySource>();

/** One source (and so one cache) per database client. */
export function identitySourceFor(db: SupabaseClient): IdentitySource {
  let source = sources.get(db);
  if (!source) {
    source = new IdentitySource(db);
    sources.set(db, source);
  }
  return source;
}
