/**
 * Which ways of reaching a person the assistant may offer, as an administrator sets them. Pure: no database, no React.
 * The voice agent reads the same stored value with the same rules (services/agent/src/chat-offer.ts).
 */
export interface ContactMethods {
  textChat: boolean;
  callback: boolean;
}

export const DEFAULT_METHODS: ContactMethods = { textChat: true, callback: true };
export const SETTING_KEY = 'contact_methods';

/** How the setting is stored. */
export interface StoredContactMethods {
  text_chat: boolean;
  callback: boolean;
}

export function toStored(m: ContactMethods): StoredContactMethods {
  return { text_chat: m.textChat, callback: m.callback };
}

/**
 * Reads a stored value. Anything missing or not exactly `false` counts as on, and a value with both off (which the page
 * never saves) is read as both on, because it would leave a customer with no way to reach anyone.
 */
export function parseContactMethods(value: unknown): ContactMethods {
  const v = (value && typeof value === 'object' ? value : {}) as { text_chat?: unknown; callback?: unknown };
  const methods = { textChat: v.text_chat !== false, callback: v.callback !== false };
  return methods.textChat || methods.callback ? methods : { ...DEFAULT_METHODS };
}

export type ValidateResult =
  | { ok: true; methods: ContactMethods }
  | { ok: false; error: 'invalid' | 'none-enabled' };

/** Checks what an administrator submitted: both fields must be true or false, and at least one must be on. */
export function validateContactMethods(input: unknown): ValidateResult {
  const v = (input && typeof input === 'object' ? input : null) as { textChat?: unknown; callback?: unknown } | null;
  if (!v || typeof v.textChat !== 'boolean' || typeof v.callback !== 'boolean') return { ok: false, error: 'invalid' };
  if (!v.textChat && !v.callback) return { ok: false, error: 'none-enabled' };
  return { ok: true, methods: { textChat: v.textChat, callback: v.callback } };
}
