import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  TYPING_WINDOW_MS,
  cleanMessage,
  cursorOf,
  mergeMessages,
  parseCursor,
  toMessages,
  typingActive,
  type HumanMessage,
} from '@/lib/human/messages';
import { abuseLimitsFromEnv, activeEarlierIds } from '@/lib/session/abuse';
import {
  canAccessConversation,
  canCustomerSend,
  canStaffReply,
  isOpenHuman,
  type ConversationAccessRow,
} from '@/lib/auth/access';

describe('cleanMessage', () => {
  it('trims and accepts normal text, including new lines', () => {
    expect(cleanMessage('  hello\nthere  ')).toEqual({ ok: true, body: 'hello\nthere' });
  });

  it('rejects empty, whitespace-only, non-string and over-long input', () => {
    expect(cleanMessage('')).toEqual({ ok: false, error: 'empty' });
    expect(cleanMessage('   \n ')).toEqual({ ok: false, error: 'empty' });
    expect(cleanMessage(42)).toEqual({ ok: false, error: 'invalid' });
    expect(cleanMessage(undefined)).toEqual({ ok: false, error: 'invalid' });
    expect(cleanMessage('x'.repeat(MAX_MESSAGE_CHARS))).toMatchObject({ ok: true });
    expect(cleanMessage('x'.repeat(MAX_MESSAGE_CHARS + 1))).toEqual({ ok: false, error: 'too-long' });
  });

  it('drops control characters but keeps tabs and new lines', () => {
    expect(cleanMessage('a\u0000b\u0007c\td\ne')).toEqual({ ok: true, body: 'abc\td\ne' });
  });
});

describe('typing and cursors', () => {
  const now = Date.parse('2026-10-03T12:00:10Z');

  it('counts someone as typing for a few seconds only', () => {
    expect(typingActive('2026-10-03T12:00:08Z', now)).toBe(true);
    expect(typingActive(new Date(now - TYPING_WINDOW_MS).toISOString(), now)).toBe(false);
    expect(typingActive(null, now)).toBe(false);
    expect(typingActive('nonsense', now)).toBe(false);
    expect(typingActive('2026-10-03T12:00:30Z', now)).toBe(false); // from the future
  });

  it('accepts only real times as a cursor', () => {
    expect(parseCursor('2026-10-03T12:00:00Z')).toBe('2026-10-03T12:00:00.000Z');
    expect(parseCursor('not a date')).toBeNull();
    expect(parseCursor('')).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });
});

describe('message lists', () => {
  const m = (id: string, at: string, over: Partial<HumanMessage> = {}): HumanMessage => ({
    id,
    sender: 'customer',
    body: id,
    at,
    author: null,
    ...over,
  });

  it('turns stored rows into messages, leaving out legacy pairs and empty rows', () => {
    const authors = new Map([['u-9', { name: 'Sarah', title: 'Support Specialist', avatarUrl: null }]]);
    const out = toMessages(
      [
        { id: '1', sender: 'system', body: 'You are being connected', staff_user_id: null, created_at: '2026-10-03T12:00:00Z' },
        { id: '2', sender: 'staff', body: 'Hi', staff_user_id: 'u-9', created_at: '2026-10-03T12:00:05Z' },
        { id: '3', sender: null, body: null, staff_user_id: null, created_at: '2026-10-03T11:00:00Z' },
        { id: '4', sender: 'customer', body: '', staff_user_id: null, created_at: '2026-10-03T12:00:06Z' },
        { id: '5', sender: 'robot', body: 'x', staff_user_id: null, created_at: '2026-10-03T12:00:07Z' },
      ],
      authors,
    );
    expect(out.map((x) => x.id)).toEqual(['1', '2']);
    expect(out[1].author).toEqual({ name: 'Sarah', title: 'Support Specialist', avatarUrl: null });
    expect(out[0].author).toBeNull();
    expect(JSON.stringify(out)).not.toContain('u-9');
  });

  it('merges by id, oldest first, and does not duplicate repeats', () => {
    const a = m('a', '2026-10-03T12:00:01.000Z');
    const b = m('b', '2026-10-03T12:00:02.000Z');
    const c = m('c', '2026-10-03T12:00:02.000Z');
    const merged = mergeMessages([a, b], [c, b]);
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(mergeMessages(merged, [])).toBe(merged);
    expect(cursorOf(merged)).toBe('2026-10-03T12:00:02.000Z');
    expect(cursorOf([])).toBeNull();
  });
});

describe('human chat access rules', () => {
  const row = (over: Partial<ConversationAccessRow> = {}): ConversationAccessRow => ({
    customer_id: 'CUS-1001',
    ended_at: null,
    final_status: 'escalated',
    support_mode: 'human',
    assigned_staff_id: null,
    ...over,
  });
  const customer = { id: 'u-1', role: 'customer' as const, customerId: 'CUS-1001' };
  const agent = { id: 'u-9', role: 'support_agent' as const };
  const other = { id: 'u-8', role: 'support_agent' as const };
  const admin = { id: 'u-7', role: 'support_admin' as const };

  it('knows an open human conversation', () => {
    expect(isOpenHuman(row())).toBe(true);
    expect(isOpenHuman(row({ ended_at: '2026-10-03T12:00:00Z', support_mode: 'ended' }))).toBe(false);
    expect(isOpenHuman(row({ support_mode: 'ai' }))).toBe(false);
    expect(isOpenHuman({ support_mode: undefined, ended_at: null })).toBe(false);
  });

  it('lets only the owner write, and only while it is open', () => {
    expect(canCustomerSend(customer, row())).toBe(true);
    expect(canCustomerSend({ ...customer, customerId: 'CUS-1002' }, row())).toBe(false);
    expect(canCustomerSend(customer, row({ ended_at: '2026-10-03T12:00:00Z', support_mode: 'ended' }))).toBe(false);
    expect(canCustomerSend(customer, row({ support_mode: 'ai' }))).toBe(false);
    expect(canCustomerSend(agent, row())).toBe(false);
  });

  it('lets staff reply to an unassigned or own conversation; others only if admin', () => {
    expect(canStaffReply(agent, row())).toBe(true);
    expect(canStaffReply(agent, row({ assigned_staff_id: 'u-9' }))).toBe(true);
    expect(canStaffReply(other, row({ assigned_staff_id: 'u-9' }))).toBe(false);
    expect(canStaffReply(admin, row({ assigned_staff_id: 'u-9' }))).toBe(true);
    expect(canStaffReply(customer, row())).toBe(false);
    expect(canStaffReply(agent, row({ support_mode: 'ended', ended_at: '2026-10-03T12:00:00Z' }))).toBe(false);
  });

  it('gives agents every human conversation, even a closed-looking one in human mode', () => {
    expect(canAccessConversation(agent, row({ final_status: 'resolved', ended_at: null }))).toBe(true);
    expect(canAccessConversation(agent, row({ final_status: 'resolved', ended_at: 'x', support_mode: 'human' }))).toBe(true);
    expect(canAccessConversation(agent, row({ final_status: 'resolved', ended_at: 'x', support_mode: 'ended' }))).toBe(false);
  });
});

describe('web abuse limits', () => {
  it('reads the same variables as the agent, with the same defaults and 0 = off', () => {
    expect(abuseLimitsFromEnv({})).toEqual({
      maxConcurrentSessions: 1,
      sessionRateMax: 8,
      sessionRateWindowSeconds: 3600,
      sessionMaxSeconds: 360,
    });
    expect(abuseLimitsFromEnv({ MAX_CONCURRENT_SESSIONS: '0', SESSION_RATE_MAX: '3', SESSION_RATE_WINDOW_SECONDS: '' })).toMatchObject({
      maxConcurrentSessions: 0,
      sessionRateMax: 3,
      sessionRateWindowSeconds: 3600,
    });
    expect(abuseLimitsFromEnv({ SESSION_RATE_MAX: 'lots', MAX_CONCURRENT_SESSIONS: '-1' })).toMatchObject({
      sessionRateMax: 8,
      maxConcurrentSessions: 1,
    });
  });

  it('only counts earlier sessions that are still live', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    const iso = (ms: number) => new Date(now - ms).toISOString();
    const rows = [
      { conversation_id: 'live', started_at: iso(60_000), last_activity_at: iso(2_000) },
      { conversation_id: 'stale', started_at: iso(30 * 60_000), last_activity_at: iso(20 * 60_000) },
      { conversation_id: 'newer', started_at: iso(1_000), last_activity_at: iso(500) },
    ];
    expect(activeEarlierIds(rows, now - 10_000, { maxSeconds: 360, now })).toEqual(['live']);
    expect(activeEarlierIds(rows, NaN, { maxSeconds: 360, now })).toEqual([]);
  });
});
