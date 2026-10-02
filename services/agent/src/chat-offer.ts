import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage, logEvent } from './logger';

/**
 * Which ways of reaching a person the assistant may offer, as an administrator has set them
 * (`app_settings`, key `contact_methods`, edited on the staff settings page). Both are on unless an administrator turned
 * one off. A saved value with both off is a dead end for the customer, so it is read as "both on".
 */
export interface ContactMethods {
  textChat: boolean;
  callback: boolean;
}

export const DEFAULT_METHODS: ContactMethods = { textChat: true, callback: true };

export function parseContactMethods(value: unknown): ContactMethods {
  const v = (value && typeof value === 'object' ? value : {}) as { text_chat?: unknown; callback?: unknown };
  const methods = { textChat: v.text_chat !== false, callback: v.callback !== false };
  return methods.textChat || methods.callback ? methods : { ...DEFAULT_METHODS };
}

/**
 * What the assistant needs to word an escalation: which methods are on for THIS caller, whether anyone is online, and (for
 * a text chat) the customer's own account contact details, so it does not have to ask for them. Everything comes from the
 * database, never from what the caller says.
 */
export interface ContactContext {
  /** A live text chat can be offered: handoff is on, an administrator allows it, and the caller is a linked customer. */
  textChat: boolean;
  /** A callback can be offered (an administrator allows it). */
  callback: boolean;
  staffOnline: boolean;
  customer: { name: string; email: string } | null;
}

/** A staff member counts as online while "available" is on and the staff pages sent a heartbeat this recently. */
export const STAFF_ONLINE_WINDOW_MS = 90_000;
const STAFF_CACHE_MS = 15_000;
const METHODS_CACHE_MS = 15_000;
const CUSTOMER_CACHE_MS = 5 * 60_000;

interface Cached<T> {
  value: T;
  expires: number;
}

/** Looks up the contact context with short-lived caches, so the usual turn costs no extra query. */
export class ChatOfferSource {
  private staff?: Cached<boolean>;
  private settings?: Cached<ContactMethods>;
  private readonly customers = new Map<string, Cached<{ name: string; email: string } | null>>();

  constructor(
    private readonly db: SupabaseClient,
    private readonly now: () => number = Date.now,
  ) {}

  /** The administrator's choice. If it cannot be read the defaults apply (both on), so a hiccup never hides a method. */
  async methods(): Promise<ContactMethods> {
    const t = this.now();
    if (this.settings && this.settings.expires > t) return this.settings.value;
    let value: ContactMethods = { ...DEFAULT_METHODS };
    try {
      const { data, error } = await this.db.from('app_settings').select('value').eq('key', 'contact_methods');
      if (error) throw new Error(error.message);
      value = parseContactMethods((data?.[0] as { value?: unknown } | undefined)?.value);
    } catch (error) {
      logEvent('warn', 'contact methods setting not read', { message: errorMessage(error) });
    }
    this.settings = { value, expires: t + METHODS_CACHE_MS };
    return value;
  }

  async staffOnline(): Promise<boolean> {
    const t = this.now();
    if (this.staff && this.staff.expires > t) return this.staff.value;
    const cutoff = new Date(t - STAFF_ONLINE_WINDOW_MS).toISOString();
    const { data, error } = await this.db
      .from('app_users')
      .select('id')
      .in('role', ['support_agent', 'support_admin'])
      .eq('available', true)
      .eq('disabled', false)
      .gte('last_seen_at', cutoff)
      .limit(1);
    if (error) throw new Error(`staff presence: ${error.message}`);
    const value = (data ?? []).length > 0;
    this.staff = { value, expires: t + STAFF_CACHE_MS };
    return value;
  }

  async customer(customerId: string): Promise<{ name: string; email: string } | null> {
    const t = this.now();
    const hit = this.customers.get(customerId);
    if (hit && hit.expires > t) return hit.value;
    const { data, error } = await this.db
      .from('customers')
      .select('contact_name, contact_email')
      .eq('customer_id', customerId);
    if (error) throw new Error(`customer details: ${error.message}`);
    const row = data?.[0] as { contact_name?: string | null; contact_email?: string | null } | undefined;
    const value = row?.contact_name && row.contact_email ? { name: row.contact_name, email: row.contact_email } : null;
    if (this.customers.size > 500) this.customers.clear();
    this.customers.set(customerId, { value, expires: t + CUSTOMER_CACHE_MS });
    return value;
  }

  /**
   * What to tell the assistant about contact methods for this caller, or undefined when there is nothing to add (the normal
   * callback procedure applies: handoff is off and the callback is on). A text chat is offered only when handoff is switched
   * on, an administrator allows it, the caller is a linked customer, and their account has contact details.
   */
  async contactFor(customerId: string | null, handoffEnabled: boolean): Promise<ContactContext | undefined> {
    try {
      const methods = await this.methods();
      if (!handoffEnabled && methods.callback) return undefined;
      let customer: { name: string; email: string } | null = null;
      let staffOnline = false;
      if (handoffEnabled && methods.textChat && customerId) {
        try {
          customer = await this.customer(customerId);
          if (customer) staffOnline = await this.staffOnline();
        } catch (error) {
          customer = null;
          logEvent('warn', 'chat offer lookup failed', { message: errorMessage(error) });
        }
      }
      return { textChat: customer !== null, callback: methods.callback, staffOnline, customer };
    } catch (error) {
      logEvent('warn', 'contact context lookup failed', { message: errorMessage(error) });
      return undefined;
    }
  }
}

const sources = new WeakMap<SupabaseClient, ChatOfferSource>();

/** One source (and so one cache) per database client. */
export function chatOfferSourceFor(db: SupabaseClient): ChatOfferSource {
  let source = sources.get(db);
  if (!source) {
    source = new ChatOfferSource(db);
    sources.set(db, source);
  }
  return source;
}
