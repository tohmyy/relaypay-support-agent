import { describe, expect, it } from 'vitest';
import { buildStaffQueueFor, workingQueue, type QueueItem } from '@/lib/dashboard/staff';
import { hasUnread, isUuid, lastSeenMessageId, type HumanMessage } from '@/lib/human/messages';
import {
  CALLBACK_NUDGE_MS,
  attentionCount,
  formatWait,
  newlyWaiting,
  titleWithCount,
  waitedLongEnough,
  waitingIds,
} from '@/lib/human/notify';
import { ONLINE_WINDOW_MS, isOnline, onlineCutoff } from '@/lib/human/presence';
import { MAX_POLL_DELAY_MS, nextDelay } from '@/lib/human/schedule';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('staff presence', () => {
  it('is online only when available and seen within the window', () => {
    expect(isOnline({ available: true, last_seen_at: ago(10_000) }, NOW)).toBe(true);
    expect(isOnline({ available: true, last_seen_at: ago(ONLINE_WINDOW_MS - 1) }, NOW)).toBe(true);
    expect(isOnline({ available: true, last_seen_at: ago(ONLINE_WINDOW_MS) }, NOW)).toBe(false);
    expect(isOnline({ available: false, last_seen_at: ago(1000) }, NOW)).toBe(false);
    expect(isOnline({ available: true, last_seen_at: ago(1000), disabled: true }, NOW)).toBe(false);
    expect(isOnline({ available: true, last_seen_at: null }, NOW)).toBe(false);
    expect(isOnline({ available: true, last_seen_at: 'garbage' }, NOW)).toBe(false);
    expect(isOnline({ available: true, last_seen_at: new Date(NOW + 60_000).toISOString() }, NOW)).toBe(false); // future
  });

  it('gives the matching cut-off for a database filter', () => {
    expect(onlineCutoff(NOW)).toBe(ago(ONLINE_WINDOW_MS));
  });
});

describe('poll schedule', () => {
  const base = { foregroundMs: 2000, hiddenMs: 10_000, failures: 0, random: 0.5 };

  it('is quick in front and slow when hidden', () => {
    expect(nextDelay({ ...base, visible: true })).toBe(2000);
    expect(nextDelay({ ...base, visible: false })).toBe(10_000);
  });

  it('backs off after failures, up to a ceiling, and resets with zero', () => {
    expect(nextDelay({ ...base, visible: true, failures: 1 })).toBe(4000);
    expect(nextDelay({ ...base, visible: true, failures: 3 })).toBe(16_000);
    expect(nextDelay({ ...base, visible: true, failures: 50 })).toBe(16_000);
    expect(nextDelay({ ...base, hiddenMs: 20_000, visible: false, failures: 3 })).toBe(MAX_POLL_DELAY_MS);
    expect(nextDelay({ ...base, visible: true, failures: -4 })).toBe(2000);
  });

  it('spreads polls by up to 15 percent either way, and never goes under a quarter second', () => {
    expect(nextDelay({ ...base, visible: true, random: 0 })).toBe(1700);
    expect(nextDelay({ ...base, visible: true, random: 1 })).toBe(2300);
    expect(nextDelay({ foregroundMs: 10, hiddenMs: 10, visible: true, failures: 0, random: 0 })).toBe(250);
  });
});

describe('inbox alerts', () => {
  const item = (over: Partial<QueueItem> = {}): QueueItem => ({
    conversationId: 'c1',
    state: 'waiting',
    statusLabel: 'Waiting for staff',
    customer: 'LagosLedger',
    issue: 'Payment question',
    ticket: null,
    started: '4 Oct 2026',
    waitingSince: ago(60_000),
    unread: false,
    assignedToMe: false,
    ...over,
  });

  it('announces only conversations that began waiting since the last look, and nothing on the first look', () => {
    const items = [item({ conversationId: 'a' }), item({ conversationId: 'b' }), item({ conversationId: 'c', state: 'open' })];
    expect(newlyWaiting(null, items)).toEqual([]);
    expect(newlyWaiting(new Set(['a']), items).map((i) => i.conversationId)).toEqual(['b']);
    expect(newlyWaiting(waitingIds(items), items)).toEqual([]);
  });

  it('counts what needs attention: chats nobody has taken, and my own with unread messages', () => {
    expect(
      attentionCount([
        item({ conversationId: 'a' }),
        item({ conversationId: 'b', state: 'in-progress', assignedToMe: true, unread: true }),
        item({ conversationId: 'c', state: 'in-progress', assignedToMe: true, unread: false }),
        item({ conversationId: 'd', state: 'in-progress', assignedToMe: false, unread: true }),
        item({ conversationId: 'e', state: 'open', unread: true }),
      ]),
    ).toBe(2);
  });

  it('says how long someone has waited, in words', () => {
    expect(formatWait(ago(10_000), NOW)).toBe('under a minute');
    expect(formatWait(ago(60_000), NOW)).toBe('1 minute');
    expect(formatWait(ago(5 * 60_000), NOW)).toBe('5 minutes');
    expect(formatWait(ago(2 * 3600_000), NOW)).toBe('2 hours');
    expect(formatWait(null, NOW)).toBe('');
    expect(formatWait('garbage', NOW)).toBe('');
  });

  it('nudges the customer towards a callback after three minutes', () => {
    expect(waitedLongEnough(ago(CALLBACK_NUDGE_MS - 1000), NOW)).toBe(false);
    expect(waitedLongEnough(ago(CALLBACK_NUDGE_MS), NOW)).toBe(true);
    expect(waitedLongEnough(null, NOW)).toBe(false);
  });

  it('puts a count in the title without stacking counts', () => {
    expect(titleWithCount('Support queue', 2)).toBe('(2) Support queue');
    expect(titleWithCount('(2) Support queue', 3)).toBe('(3) Support queue');
    expect(titleWithCount('(2) Support queue', 0)).toBe('Support queue');
    expect(titleWithCount('Support queue', 250)).toBe('(99+) Support queue');
  });
});

describe('read marks', () => {
  const m = (id: string, sender: HumanMessage['sender'], at: string): HumanMessage => ({
    id,
    sender,
    body: id,
    at,
    clientId: null,
    author: null,
  });
  const thread = [
    m('1', 'customer', '2026-10-04T12:00:00.000Z'),
    m('2', 'staff', '2026-10-04T12:00:10.000Z'),
    m('3', 'customer', '2026-10-04T12:00:20.000Z'),
    m('4', 'customer', '2026-10-04T12:00:40.000Z'),
  ];

  it('marks the newest own message the other side has read', () => {
    expect(lastSeenMessageId(thread, 'customer', '2026-10-04T12:00:25.000Z')).toBe('3');
    expect(lastSeenMessageId(thread, 'customer', '2026-10-04T12:01:00.000Z')).toBe('4');
    expect(lastSeenMessageId(thread, 'customer', '2026-10-04T11:00:00.000Z')).toBeNull();
    expect(lastSeenMessageId(thread, 'staff', '2026-10-04T12:00:25.000Z')).toBe('2');
    expect(lastSeenMessageId(thread, 'customer', null)).toBeNull();
    expect(lastSeenMessageId(thread, 'customer', 'garbage')).toBeNull();
  });

  it('knows when the other side has written something not yet read', () => {
    expect(hasUnread('2026-10-04T12:00:20Z', '2026-10-04T12:00:10Z')).toBe(true);
    expect(hasUnread('2026-10-04T12:00:20Z', '2026-10-04T12:00:20Z')).toBe(false);
    expect(hasUnread('2026-10-04T12:00:20Z', null)).toBe(true);
    expect(hasUnread(null, null)).toBe(false);
  });

  it('accepts only real uuids as client message ids', () => {
    expect(isUuid('3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b')).toBe(true);
    for (const bad of ['', 'abc', '3f2b8c1e5a4d4e6f9a0b1c2d3e4f5a6b', 42, null, undefined, "1'; drop table x;--"]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe('the staff queue as one person may see it', () => {
  const row = (id: string, over: Record<string, string | null> = {}) => ({
    conversation_id: id,
    customer_id: 'CUS-1001',
    started_at: ago(30 * 60_000),
    ended_at: null as string | null,
    final_status: 'escalated' as string | null,
    end_reason: null as string | null,
    support_mode: 'human' as string | null,
    assigned_staff_id: null as string | null,
    handoff_at: ago(4 * 60_000) as string | null,
    staff_last_read_at: null as string | null,
    last_customer_message_at: null as string | null,
    ...over,
  });
  const input = {
    conversations: [
      row('waiting'),
      row('mine-unread', { assigned_staff_id: 'u-9', last_customer_message_at: ago(30_000), staff_last_read_at: ago(120_000) }),
      row('mine-read', { assigned_staff_id: 'u-9', last_customer_message_at: ago(120_000), staff_last_read_at: ago(30_000) }),
      row('theirs', { assigned_staff_id: 'u-8', last_customer_message_at: ago(30_000) }),
      row('old', { final_status: 'resolved', support_mode: 'ended', ended_at: ago(3600_000) }),
    ],
    tickets: [],
    customers: [{ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara' }],
  };
  const sarah = { id: 'u-9', role: 'support_agent' as const };

  it('shows how long a chat has waited, and what is unread for this person only', () => {
    const q = buildStaffQueueFor(sarah, input, new Date(NOW));
    const byId = Object.fromEntries(q.items.map((i) => [i.conversationId, i]));
    expect(byId.waiting.waitingSince).toBe(ago(4 * 60_000));
    expect(byId['mine-unread']).toMatchObject({ state: 'in-progress', unread: true, assignedToMe: true, waitingSince: null });
    expect(byId['mine-read'].unread).toBe(false);
    expect(byId.theirs).toMatchObject({ assignedToMe: false });
    expect(q.waitingCount).toBe(1);
    expect(q.unreadCount).toBe(2); // mine-unread and the one another member has (unread is about the customer's writing)
  });

  it('lists only what an agent may open, but counts everything', () => {
    const q = buildStaffQueueFor(sarah, input, new Date(NOW));
    expect(q.items.map((i) => i.conversationId)).not.toContain('old');
    expect(q.counts).toMatchObject({ waiting: 1, inProgress: 3 });
    const admin = buildStaffQueueFor({ id: 'u-7', role: 'support_admin' }, input, new Date(NOW));
    expect(admin.items.map((i) => i.conversationId)).toContain('old');
  });

  it('hides finished conversations from an agent\'s working queue but not an admin\'s', () => {
    const admin = buildStaffQueueFor({ id: 'u-7', role: 'support_admin' }, input, new Date(NOW));
    expect(workingQueue(admin.items, 'support_agent').map((i) => i.state)).not.toContain('resolved');
    expect(workingQueue(admin.items, 'support_admin').map((i) => i.state)).toContain('resolved');
  });

  it('orders waiting conversations first', () => {
    expect(buildStaffQueueFor(sarah, input, new Date(NOW)).items[0].conversationId).toBe('waiting');
  });
});
