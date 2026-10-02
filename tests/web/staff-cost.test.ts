import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStaffQueue,
  buildStaffQueueFor,
  formatUsd,
  startOfUtcDay,
  sumCosts,
  type QueueConversationRow,
} from '@/lib/dashboard/staff';
import { buildHistoryPage, parsePage } from '@/lib/dashboard/history';

const h = vi.hoisted(() => ({ restSelect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase.server', () => ({ restSelect: (...a: unknown[]) => h.restSelect(...a) }));

import { getConversationCost, getCostRows, getStaffQueueRows, getTodayCostTotal } from '@/lib/dashboard/data.server';

const NOW = new Date('2026-10-05T15:30:00Z');
const conv = (id: string, startedAt: string, over: Partial<QueueConversationRow> = {}): QueueConversationRow => ({
  conversation_id: id,
  customer_id: 'CUS-1001',
  started_at: startedAt,
  ended_at: '2026-10-05T10:00:00Z',
  final_status: 'resolved',
  end_reason: 'user-ended',
  ...over,
});
const customers = [{ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara' }];

describe('estimated cost arithmetic (AC-12.1, AC-12.2)', () => {
  it('sums each conversation’s turn costs, counting missing and non-numeric costs as 0', () => {
    const sums = sumCosts([
      { conversation_id: 'a', cost_usd: 0.01 },
      { conversation_id: 'a', cost_usd: '0.0250' },
      { conversation_id: 'a', cost_usd: null },
      { conversation_id: 'b', cost_usd: 'oops' },
      { conversation_id: 'c', cost_usd: 1.5 },
    ]);
    expect(sums.get('a')).toBeCloseTo(0.035, 6);
    expect(sums.get('b')).toBe(0);
    expect(sums.get('c')).toBe(1.5);
  });

  it('draws the day at midnight UTC', () => {
    expect(startOfUtcDay(new Date('2026-10-05T23:59:59Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(startOfUtcDay(new Date('2026-10-05T00:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('formats dollars with two to four decimals, and a dash when unknown', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0421)).toBe('$0.0421');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
  });
});

describe('the staff queue carries the estimate', () => {
  const input = (extra: object = {}) => ({
    conversations: [
      conv('today-1', '2026-10-05T09:00:00Z'),
      conv('today-2', '2026-10-05T11:00:00Z'),
      conv('yesterday', '2026-10-04T22:00:00Z'),
    ],
    tickets: [],
    customers,
    ...extra,
  });
  const costs = [
    { conversation_id: 'today-1', cost_usd: 0.02 },
    { conversation_id: 'today-1', cost_usd: 0.03 },
    { conversation_id: 'today-2', cost_usd: 0.1 },
    { conversation_id: 'yesterday', cost_usd: 5 },
  ];

  it('gives every row its own estimate and totals only the UTC day’s conversations', () => {
    const q = buildStaffQueue(input({ costs }), NOW);
    const byId = Object.fromEntries(q.items.map((i) => [i.conversationId, i.estimatedCostUsd]));
    expect(byId['today-1']).toBeCloseTo(0.05, 6);
    expect(byId['today-2']).toBeCloseTo(0.1, 6);
    expect(byId.yesterday).toBe(5);
    expect(q.todayCostUsd).toBeCloseTo(0.15, 6);
  });

  it('shows 0 for a conversation with no billed turns', () => {
    const q = buildStaffQueue(input({ costs: [] }), NOW);
    expect(q.items.every((i) => i.estimatedCostUsd === 0)).toBe(true);
    expect(q.todayCostUsd).toBe(0);
  });

  it('says "unknown" (null) rather than zero when costs could not be read', () => {
    const q = buildStaffQueue(input(), NOW);
    expect(q.items.every((i) => i.estimatedCostUsd === null)).toBe(true);
    expect(q.todayCostUsd).toBeNull();
  });

  it('uses the separately computed day total when given, and passes it to the live queue', () => {
    const q = buildStaffQueueFor({ id: 'u-9', role: 'support_admin' }, input({ costs, todayCostUsd: 2.5 }), NOW);
    expect(q.todayCostUsd).toBe(2.5);
    expect(q.items).toHaveLength(3);
  });
});

describe('reading costs from the database', () => {
  beforeEach(() => h.restSelect.mockReset());

  it('reads costs a few conversations at a time, quoting ids, so no request meets the row limit', async () => {
    h.restSelect.mockResolvedValue([]);
    const ids = Array.from({ length: 60 }, (_, i) => `vapi_${i}`);
    await getCostRows(ids);
    expect(h.restSelect).toHaveBeenCalledTimes(3);
    const query = h.restSelect.mock.calls[0][1] as string;
    expect(query).toContain('cost_usd=not.is.null');
    expect(query).toContain(encodeURIComponent('"vapi_0"'));
    expect(query).toContain('limit=1000');
  });

  it('sums one conversation’s cost for the detail page', async () => {
    h.restSelect.mockResolvedValue([
      { conversation_id: 'vapi_abc', cost_usd: 0.02 },
      { conversation_id: 'vapi_abc', cost_usd: 0.0221 },
    ]);
    expect(await getConversationCost('vapi_abc')).toBeCloseTo(0.0421, 6);
    h.restSelect.mockResolvedValue([]);
    expect(await getConversationCost('vapi_none')).toBe(0);
  });

  it('totals the conversations started since midnight UTC', async () => {
    h.restSelect.mockImplementation(async (table: string, query: string) => {
      if (table === 'conversations') {
        expect(query).toContain(`started_at=gte.${encodeURIComponent('2026-10-05T00:00:00.000Z')}`);
        return [{ conversation_id: 'a' }, { conversation_id: 'b' }];
      }
      return [
        { conversation_id: 'a', cost_usd: 0.25 },
        { conversation_id: 'b', cost_usd: 0.5 },
      ];
    });
    expect(await getTodayCostTotal(NOW)).toBeCloseTo(0.75, 6);
  });

  it('still returns the queue when the costs cannot be read', async () => {
    h.restSelect.mockImplementation(async (table: string) => {
      if (table === 'conversation_turns') throw new Error('cost query failed (500)');
      if (table === 'conversations') return [{ conversation_id: 'a' }];
      return [];
    });
    const rows = await getStaffQueueRows();
    expect(rows.conversations).toEqual([{ conversation_id: 'a' }]);
    expect(rows.costs).toBeUndefined();
    expect(rows.todayCostUsd).toBeNull();
  });
});

describe('history pagination (AC-32.1)', () => {
  const row = (i: number) => ({ conversation_id: `vapi_${i}`, started_at: '2026-10-01T09:00:00Z', ended_at: 'x', final_status: 'resolved', end_reason: 'user-ended' });

  it('reads the page number safely', () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('3')).toBe(3);
    expect(parsePage(['2', '5'])).toBe(2);
    for (const bad of ['0', '-1', '1.5', 'x', '', '999999']) expect(parsePage(bad)).toBe(1);
  });

  it('shows ten, knows there is an older page from the extra row, and a newer one after page 1', () => {
    const first = buildHistoryPage(Array.from({ length: 11 }, (_, i) => row(i)), 1);
    expect(first.lines).toHaveLength(10);
    expect(first.hasOlder).toBe(true);
    expect(first.hasNewer).toBe(false);
    const last = buildHistoryPage([row(20), row(21)], 3);
    expect(last.lines).toHaveLength(2);
    expect(last.hasOlder).toBe(false);
    expect(last.hasNewer).toBe(true);
    expect(last.lines[0].outcome).toBe('Resolved');
  });
});
