import { describe, expect, it } from 'vitest';
import { buildReport, formatReport, type ReportInput } from '../../scripts/obs/aggregate';

const base: ReportInput = { conversations: [], turns: [], toolCalls: [], events: [], tickets: 0, escalations: 0 };
const conv = (id: string, over: Record<string, unknown> = {}) => ({
  conversation_id: id,
  final_status: 'resolved',
  ended_at: '2026-10-03T12:00:00Z',
  customer_id: null as string | null,
  end_reason: null as string | null,
  ...over,
});
const turns = (id: string, n: number) =>
  Array.from({ length: n }, () => ({ conversation_id: id, answer_type: 'direct_answer', latency_ms: 1000, cost_usd: 0.01 }));
const tools = (id: string, n: number) =>
  Array.from({ length: n }, () => ({ conversation_id: id, tool_name: 'lookup_payout', status: 'success', duration_ms: 50 }));
const event = (event_type: string, metadata: unknown) => ({ event_type, metadata });

describe('limits and handoffs in the report', () => {
  const input: ReportInput = {
    ...base,
    conversations: [
      conv('a', { customer_id: 'CUS-1001', end_reason: 'limit-reached' }),
      conv('b', { customer_id: 'CUS-1001' }),
      conv('c', { customer_id: 'CUS-1001', end_reason: 'human-closed' }),
      conv('d', { customer_id: 'CUS-1002' }),
      conv('e'),
    ],
    turns: [...turns('a', 6), ...turns('b', 1), ...turns('c', 3)],
    toolCalls: [...tools('a', 5), ...tools('c', 1)],
    events: [
      event('limit_reached', { kind: 'agent_calls', limit: 30, value: 30 }),
      event('limit_reached', { kind: 'agent_calls', limit: 30, value: 30 }),
      event('limit_reached', { kind: 'concurrent_sessions' }),
      event('limit_reached', null),
      event('human_handoff', { reason: 'escalation' }),
      event('human_handoff', { reason: 'limit-reached' }),
      event('human_handoff', {}),
      event('voice_stats', {}),
    ],
  };
  const abuse = buildReport(input).abuse;

  it('counts limit events by kind and sessions ended by a limit', () => {
    expect(abuse.limitEvents).toEqual({ agent_calls: 2, concurrent_sessions: 1, unknown: 1 });
    expect(abuse.limitEnded).toBe(1);
  });

  it('counts hand-overs by reason, and conversations closed by staff', () => {
    expect(abuse.handoffs).toEqual({ total: 3, byReason: { escalation: 1, 'limit-reached': 1, unknown: 1 } });
    expect(abuse.humanClosed).toBe(1);
  });

  it('lists only customers with more than one session, most first', () => {
    expect(abuse.topCustomers).toEqual([{ customerId: 'CUS-1001', sessions: 3 }]);
  });

  it('ranks the heaviest conversations by turns plus tool calls', () => {
    expect(abuse.heaviest.map((h) => h.conversationId)).toEqual(['a', 'c', 'b']);
    expect(abuse.heaviest[0]).toEqual({ conversationId: 'a', turns: 6, toolCalls: 5 });
  });

  it('is part of the printed report', () => {
    const text = formatReport(buildReport(input), 'all time');
    expect(text).toContain('Limits and handoffs:');
    expect(text).toContain('agent_calls: 2');
    expect(text).toContain('moved to a specialist: 3');
    expect(text).toContain('CUS-1001 3');
    expect(text).toContain('a (6 turns, 5 tool calls)');
  });

  it('says so when nothing has been recorded, and tolerates input from before these fields existed', () => {
    const empty = buildReport(base);
    expect(empty.abuse).toEqual({
      limitEvents: {},
      limitEnded: 0,
      handoffs: { total: 0, byReason: {} },
      humanClosed: 0,
      topCustomers: [],
      heaviest: [],
    });
    expect(formatReport(empty, 'all time')).toContain('Limits and handoffs: nothing recorded yet');
    const legacy = buildReport({ ...base, conversations: [{ final_status: 'resolved', ended_at: null }] });
    expect(legacy.abuse.topCustomers).toEqual([]);
  });
});
