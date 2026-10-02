import 'server-only';
import { restInsert, restPatch, restSelect } from '@/lib/supabase.server';
import { DEFAULT_METHODS, SETTING_KEY, parseContactMethods, toStored, type ContactMethods } from './contact-methods';

const CACHE_MS = 10_000;
let cached: { value: ContactMethods; expires: number } | undefined;

interface SettingRow {
  value: unknown;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * The saved choice, remembered for a few seconds (the customer's chat asks on every poll). If it cannot be read both
 * methods count as on, so a database hiccup never takes a way of reaching a person away from a customer.
 */
export async function getContactMethods(now: number = Date.now()): Promise<ContactMethods> {
  if (cached && cached.expires > now) return cached.value;
  let value = { ...DEFAULT_METHODS };
  try {
    const [row] = await restSelect<SettingRow>('app_settings', `select=value&key=eq.${SETTING_KEY}&limit=1`);
    value = parseContactMethods(row?.value);
  } catch (error) {
    console.error(`[web] contact methods not read: ${error instanceof Error ? error.message : String(error)}`);
  }
  cached = { value, expires: now + CACHE_MS };
  return value;
}

/** The saved choice and who last changed it, for the settings page (never cached). */
export async function getContactMethodsDetail(): Promise<{ methods: ContactMethods; updatedAt: string | null; updatedBy: string | null }> {
  const [row] = await restSelect<SettingRow>('app_settings', `select=value,updated_at,updated_by&key=eq.${SETTING_KEY}&limit=1`);
  let updatedBy: string | null = null;
  if (row?.updated_by) {
    const [who] = await restSelect<{ display_name: string }>('app_users', `select=display_name&id=eq.${encodeURIComponent(row.updated_by)}&limit=1`);
    updatedBy = who?.display_name ?? null;
  }
  return { methods: parseContactMethods(row?.value), updatedAt: row?.updated_at ?? null, updatedBy };
}

/** Saves the choice (an update, or the first insert) and forgets the cached copy on this instance. */
export async function saveContactMethods(methods: ContactMethods, userId: string): Promise<void> {
  const patch = { value: toStored(methods), updated_at: new Date().toISOString(), updated_by: userId };
  const updated = await restPatch('app_settings', `key=eq.${SETTING_KEY}`, patch);
  if (updated.length === 0) {
    // First time: create it. If two administrators race, the loser's insert is ignored and its update below still lands.
    await restInsert('app_settings', { key: SETTING_KEY, ...patch }, { onConflict: 'key' });
    await restPatch('app_settings', `key=eq.${SETTING_KEY}`, patch);
  }
  cached = undefined;
}

/** For tests. */
export function resetContactMethodsCache(): void {
  cached = undefined;
}
