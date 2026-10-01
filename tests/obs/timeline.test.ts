import { describe, expect, it } from 'vitest';
import { buildReport, formatReport, parseSince, percentile, type ReportInput } from '../../scripts/obs/aggregate';
import { buildTimeline, formatTimeline, type TimelineInput } from '../../scripts/obs/timeline';

// Seconds after 10:00:00 UTC on a fixed day.
const T = (sec: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, 0) + sec * 1000).toISOString();

const call: TimelineInput = {
  conversation: { conversation_id: 'vapi_1', channel: 'voice', started_at: T(0), ended_at: T(60), final_status: 'escalated' },
  turns: [
    {
      turn_number: 1,
      user_transcript: 'Check TXN-9001 and email me at ada@example.com',
      assistant_response: 'It is processing.',
      answer_type: 'direct_answer',
      latency_ms: 6000,
      cost_usd: '0.0412',
      created_at: T(10),
    },
    {
      turn_number: 2,
      user_transcript: 'My account is restricted',
      assistant_response: 'A specialist will help.',
      answer_type: 'escalation',
      latency_ms: null,
      cost_usd: null,
      created_at: T(30),
    },
  ],
  retrievals: [{ query: 'Check TXN-9001 and email me at ada@example.com', source_titles: ['Why Is My Payment Delayed?'], created_at: T(4.5) }],
  toolCalls: [
    { tool_name: 'lookup_transaction', purpose: 'Look up a transaction to report its status', status: 'success', duration_ms: 412, result_summary: 'found TXN-9001, status processing', error: null, created_at: T(6) },
    { tool_name: 'lookup_customer', purpose: null, status: 'failed', duration_ms: null, result_summary: 'error: temporarily_unavailable', error: 'timeout', created_at: T(20) },
  ],
  events: [
    { event_type: 'error', summary: 'agent.runTurn failed', metadata: { source: 'agent.runTurn' }, created_at: T(21) },
    { event_type: 'call_ended', summary: 'call ended (escalated)', metadata: { endedReason: 'customer-ended-call', durationSeconds: 60 }, created_at: T(59) },
  ],
  tickets: [{ ticket_id: 'TKT-000012', category: 'account', priority: 'high', created_at: T(25) }],
  escalations: [{ escalation_id: 'ESC-000004', category: 'account', preferred_time: 'Tuesday 2 PM', created_at: T(28) }],
};

describe('buildTimeline', () => {
  const entries = buildTimeline(call);

  it('merges every source into one time-ordered list', () => {
    const times = entries.map((e) => new Date(e.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(entries.map((e) => e.kind))).toEqual(
      new Set(['start', 'customer', 'retrieval', 'tool', 'agent', 'ticket', 'escalation', 'event', 'error', 'end']),
    );
  });

  it('places the customer utterance before the work done for it, using the reply time', () => {
    const kinds = entries.map((e) => e.kind);
    const first = kinds.indexOf('customer');
    expect(first).toBeLessThan(kinds.indexOf('retrieval'));
    expect(kinds.indexOf('retrieval')).toBeLessThan(kinds.indexOf('tool'));
    expect(kinds.indexOf('tool')).toBeLessThan(kinds.indexOf('agent'));
    // The first turn took 6s and was saved at :10, so the customer spoke at :04.
    expect(entries[first].at).toBe(T(4));
  });

  it('never shows speech before the call started', () => {
    const early = buildTimeline({
      ...call,
      conversation: { ...call.conversation!, started_at: T(9.9), ended_at: null },
      turns: [call.turns[0]],
      retrievals: [],
      toolCalls: [],
      events: [],
      tickets: [],
      escalations: [],
    });
    expect(early.map((e) => e.kind)).toEqual(['start', 'customer', 'agent']);
    expect(early[1].at).toBe(T(9.9));
  });

  it('describes each entry with the useful details', () => {
    const text = entries.map((e) => e.text).join('\n');
    expect(text).toContain('(direct_answer, 6.0s, $0.041)');
    expect(text).toContain('lookup_transaction success 412ms - found TXN-9001, status processing [Look up a transaction to report its status]');
    expect(text).toContain('lookup_customer failed - error: temporarily_unavailable error: timeout');
    expect(text).toContain('ticket TKT-000012 created (account, high)');
    expect(text).toContain('escalation ESC-000004 created (account, requested callback: Tuesday 2 PM)');
    expect(text).toContain('call ended (escalated)');
    expect(entries.find((e) => e.kind === 'error')?.text).toContain('agent.runTurn failed');
  });

  it('copes with an unknown conversation and with turns that have no timing', () => {
    expect(buildTimeline({ ...call, conversation: null, turns: [], retrievals: [], toolCalls: [], events: [], tickets: [], escalations: [] })).toEqual([]);
    expect(formatTimeline([])).toBe('No records found for that conversation.');
    const single = buildTimeline({ ...call, turns: [call.turns[1]], retrievals: [], toolCalls: [], events: [], tickets: [], escalations: [], conversation: null });
    expect(single.map((e) => e.kind)).toEqual(['customer', 'agent']);
    expect(single[0].at).toBe(single[1].at);
  });

  it('formats readable lines and masks emails in what it prints', () => {
    const out = formatTimeline(entries);
    expect(out.split('\n')).toHaveLength(entries.length);
    expect(out).toContain('10:00:04.000');
    expect(out).not.toContain('ada@example.com');
    expect(out).toContain('[email]');
  });
});

describe('report aggregation', () => {
  const input: ReportInput = {
    conversations: [
      { final_status: 'escalated', ended_at: T(60) },
      { final_status: 'resolved', ended_at: T(120) },
      { final_status: null, ended_at: null },
    ],
    turns: [
      { answer_type: 'direct_answer', latency_ms: 2000, cost_usd: '0.01' },
      { answer_type: 'direct_answer', latency_ms: 4000, cost_usd: 0.02 },
      { answer_type: 'escalation', latency_ms: 10000, cost_usd: null },
      { answer_type: null, latency_ms: null, cost_usd: null },
    ],
    toolCalls: [
      { tool_name: 'lookup_transaction', status: 'success', duration_ms: 400 },
      { tool_name: 'lookup_transaction', status: 'not_found', duration_ms: 200 },
      { tool_name: 'lookup_customer', status: 'failed', duration_ms: null },
    ],
    events: [{ event_type: 'error' }, { event_type: 'call_ended' }, { event_type: 'error' }],
    tickets: 2,
    escalations: 1,
  };

  it('counts, percentiles and costs', () => {
    const r = buildReport(input);
    expect(r.conversations).toEqual({ total: 3, byStatus: { escalated: 1, resolved: 1, 'no status yet': 1 }, stillOpen: 1 });
    expect(r.turns.byAnswerType).toEqual({ direct_answer: 2, escalation: 1, unknown: 1 });
    expect(r.latencyMs).toEqual({ count: 3, p50: 4000, p95: 10000, max: 10000 });
    expect(r.costUsd.total).toBe(0.03);
    expect(r.tools.lookup_transaction).toEqual({ calls: 2, success: 1, not_found: 1, failed: 0, avgMs: 300 });
    expect(r.tools.lookup_customer).toMatchObject({ calls: 1, failed: 1, avgMs: null });
    expect(r.events).toEqual({ error: 2, call_ended: 1 });
    expect(r).toMatchObject({ tickets: 2, escalations: 1 });
  });

  it('handles an empty system', () => {
    const r = buildReport({ conversations: [], turns: [], toolCalls: [], events: [], tickets: 0, escalations: 0 });
    expect(r.latencyMs).toEqual({ count: 0, p50: null, p95: null, max: null });
    expect(formatReport(r, 'all time')).toContain('Reply time: p50 n/a, p95 n/a, max n/a over 0 timed turns');
    expect(formatReport(r, 'all time')).toContain('  none');
  });

  it('formats a readable report', () => {
    const text = formatReport(buildReport(input), 'last 24h');
    expect(text).toContain('Support report (last 24h)');
    expect(text).toContain('Conversations: 3 (escalated: 1, resolved: 1, no status yet: 1); still open: 1');
    expect(text).toContain('Reply time: p50 4.0s, p95 10.0s, max 10.0s over 3 timed turns');
    expect(text).toContain('lookup_transaction: 2 calls (success 1, not found 1, failed 0), avg 300ms');
  });

  it('uses nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });

  it('parses --since values', () => {
    expect(parseSince('30m')).toBe(1_800_000);
    expect(parseSince('24h')).toBe(86_400_000);
    expect(parseSince('7d')).toBe(604_800_000);
    expect(() => parseSince('soon')).toThrow(/30m, 24h or 7d/);
    expect(() => parseSince('')).toThrow();
  });
});
