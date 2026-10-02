/**
 * Whether a member of staff counts as online. They must have switched "available for chats" on and been seen recently:
 * the staff pages send a heartbeat while open and visible, so a closed tab or a sleeping laptop drops out by itself.
 * The voice agent uses the same window (services/agent/src/chat-offer.ts) when it decides what to say.
 */
export const ONLINE_WINDOW_MS = 90_000;
export const HEARTBEAT_MS = 30_000;

export interface PresenceRow {
  available?: boolean | null;
  last_seen_at?: string | null;
  disabled?: boolean | null;
}

export function isOnline(row: PresenceRow, now: number = Date.now()): boolean {
  if (!row.available || row.disabled) return false;
  const seen = Date.parse(row.last_seen_at ?? '');
  return Number.isFinite(seen) && now - seen >= 0 && now - seen < ONLINE_WINDOW_MS;
}

/** The earliest `last_seen_at` that still counts as online, for a database filter. */
export function onlineCutoff(now: number = Date.now()): string {
  return new Date(now - ONLINE_WINDOW_MS).toISOString();
}
