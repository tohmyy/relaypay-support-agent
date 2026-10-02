import type { QueueItem } from '@/lib/dashboard/staff';

/** Pure rules for the staff inbox's alerts, so what counts as "new" and "needs attention" is a plain test. */

/** Conversations that are waiting now and were not waiting at the previous look. The first look announces nothing. */
export function newlyWaiting(previous: ReadonlySet<string> | null, items: QueueItem[]): QueueItem[] {
  if (previous === null) return [];
  return items.filter((i) => i.state === 'waiting' && !previous.has(i.conversationId));
}

export function waitingIds(items: QueueItem[]): Set<string> {
  return new Set(items.filter((i) => i.state === 'waiting').map((i) => i.conversationId));
}

/** What needs this person's attention: chats nobody has taken, and chats they have with unread messages. */
export function attentionCount(items: QueueItem[]): number {
  return items.filter((i) => i.state === 'waiting' || (i.state === 'in-progress' && i.assignedToMe && i.unread)).length;
}

/** "5 minutes", "1 minute", "under a minute": how long someone has waited, for a message people read. */
export function formatWait(sinceIso: string | null | undefined, now: number = Date.now()): string {
  const since = Date.parse(sinceIso ?? '');
  if (!Number.isFinite(since)) return '';
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/** After this long without anyone joining, the customer is nudged towards a callback. */
export const CALLBACK_NUDGE_MS = 3 * 60_000;

export function waitedLongEnough(sinceIso: string | null | undefined, now: number = Date.now()): boolean {
  const since = Date.parse(sinceIso ?? '');
  return Number.isFinite(since) && now - since >= CALLBACK_NUDGE_MS;
}

/** The page title with a count in front: "(2) Support queue". A count of 0 leaves the title alone. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(/^\(\d+\)\s*/, '');
  return count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}
