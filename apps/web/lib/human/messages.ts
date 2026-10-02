/**
 * Pure helpers for the text chat between a customer and a support specialist (after a handoff). No database and no
 * React, so every rule here is a plain test.
 */
export const MAX_MESSAGE_CHARS = 2000;
/** Someone counts as "typing" for this long after their last signal. */
export const TYPING_WINDOW_MS = 5000;
/** Typing signals are sent at most this often while someone keeps typing. */
export const TYPING_SIGNAL_INTERVAL_MS = 3000;

export type MessageSender = 'customer' | 'staff' | 'system';

export interface MessageAuthor {
  name: string;
  title: string | null;
  avatarUrl: string | null;
}

/** One message as the browser receives it. Never includes user ids or anything about other conversations. */
export interface HumanMessage {
  id: string;
  sender: MessageSender;
  body: string;
  /** ISO time the message was stored. */
  at: string;
  /** Who wrote a staff message. */
  author: MessageAuthor | null;
}

export interface MessageRow {
  id: string;
  sender: string | null;
  body: string | null;
  staff_user_id: string | null;
  created_at: string | null;
}

export type CleanResult = { ok: true; body: string } | { ok: false; error: 'empty' | 'too-long' | 'invalid' };

/** Trims and checks one outgoing message. Control characters other than newlines and tabs are dropped. */
export function cleanMessage(input: unknown): CleanResult {
  if (typeof input !== 'string') return { ok: false, error: 'invalid' };
  const body = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (body.length === 0) return { ok: false, error: 'empty' };
  if (body.length > MAX_MESSAGE_CHARS) return { ok: false, error: 'too-long' };
  return { ok: true, body };
}

export function typingActive(at: string | null | undefined, now: number = Date.now()): boolean {
  const t = Date.parse(at ?? '');
  return Number.isFinite(t) && now - t >= 0 && now - t < TYPING_WINDOW_MS;
}

const SENDERS: readonly string[] = ['customer', 'staff', 'system'];

/** Turns stored rows into messages. Legacy AI-era rows (no sender) and rows without text are left out. */
export function toMessages(rows: MessageRow[], authors: Map<string, MessageAuthor>): HumanMessage[] {
  return rows
    .filter((r) => r.sender && SENDERS.includes(r.sender) && r.body && r.created_at)
    .map((r) => ({
      id: r.id,
      sender: r.sender as MessageSender,
      body: r.body as string,
      at: new Date(r.created_at as string).toISOString(),
      author: r.sender === 'staff' && r.staff_user_id ? (authors.get(r.staff_user_id) ?? null) : null,
    }));
}

/** Adds new messages to what the browser already has: by id, oldest first. */
export function mergeMessages(existing: HumanMessage[], incoming: HumanMessage[]): HumanMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/**
 * The cursor for the next poll: the newest message time. The next request asks for messages at or after it, and
 * `mergeMessages` removes the repeats, so two messages stored in the same instant are never missed.
 */
export function cursorOf(messages: HumanMessage[]): string | null {
  return messages.length ? messages[messages.length - 1].at : null;
}

/** An `after` query value is only used if it is a real time. */
export function parseCursor(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
