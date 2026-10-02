import { describe, expect, it } from 'vitest';
import { buildReport, formatReport, type ReportInput } from '../../scripts/obs/aggregate';
import { describeTimings } from '../../scripts/obs/segments';

const base: ReportInput = { conversations: [], turns: [], toolCalls: [], events: [], tickets: 0, escalations: 0 };
const turn = (timings: unknown) => ({ answer_type: 'direct_answer', latency_ms: 3000, cost_usd: 0.01, timings });
const stats = (m: Record<string, unknown>) => ({ event_type: 'voice_stats', metadata: m });

describe('voice section of the report', () => {
  const input: ReportInput = {
    ...base,
    turns: [
      turn({ total_turn_ms: 3000, delivered: true }),
      turn({ total_turn_ms: 3000, delivered: false, client_closed_ms: 1200 }),
      turn({ total_turn_ms: 2000, delivered: false }),
      turn({ total_turn_ms: 2000 }), // from before delivery was tracked
      turn(null),
    ],
    events: [
      stats({ interruptions: 3, short_interruptions: 1, undelivered_replies: 2, silence_warnings: 1 }),
      stats({ interruptions: 1, short_interruptions: 1, undelivered_replies: 0, silence_warnings: 0 }),
      stats({ interruptions: 0, short_interruptions: 0, undelivered_replies: 0, silence_warnings: 2 }),
      { event_type: 'silence_warning', metadata: {} },
      { event_type: 'call_ended', metadata: {} },
    ],
  };
  const r = buildReport(input);

  it('adds up what the calls reported', () => {
    expect(r.voice).toMatchObject({
      calls: 3,
      interruptions: 4,
      shortInterruptions: 2,
      silenceWarnings: 3,
      undeliveredReplies: 2,
    });
  });

  it('counts undelivered turns only among turns that track delivery', () => {
    expect(r.voice.deliveryTrackedTurns).toBe(3);
    expect(r.voice.undeliveredTurns).toBe(2);
  });

  it('prints it', () => {
    const text = formatReport(r, 'all time');
    expect(text).toContain('Voice (3 calls with statistics):');
    expect(text).toContain('customer talked over the assistant: 4 (1.3 per call), 2 under half a second (50%)');
    expect(text).toContain('silence countdowns: 3 (1 per call)');
    expect(text).toContain('replies that never arrived: 2 (2 of 3 timed turns)');
  });

  it('says so when there is nothing yet, and does not divide by zero', () => {
    const none = buildReport(base);
    expect(none.voice.calls).toBe(0);
    expect(formatReport(none, 'all time')).toContain('Voice: no voice statistics yet');
  });

  it('copes with odd metadata', () => {
    const odd = buildReport({
      ...base,
      events: [stats({ interruptions: 'many', short_interruptions: -3 }), { event_type: 'voice_stats', metadata: null }],
    });
    expect(odd.voice).toMatchObject({ calls: 2, interruptions: 0, shortInterruptions: 0 });
  });

  it('shows interruptions without a percentage when there were none', () => {
    const text = formatReport(buildReport({ ...base, events: [stats({ interruptions: 0 })] }), 'all time');
    expect(text).toContain('customer talked over the assistant: 0 (0 per call)');
    expect(text).not.toContain('under half a second');
  });
});

describe('trace for a turn nobody heard', () => {
  it('says so, with when the customer left', () => {
    expect(describeTimings({ model_ms: 2000, delivered: false, client_closed_ms: 1250 })).toBe(
      'model 2.0s, reply not delivered (customer left at 1.3s)',
    );
    expect(describeTimings({ delivered: false })).toBe('reply not delivered');
  });

  it('says nothing for a delivered reply', () => {
    expect(describeTimings({ model_ms: 2000, delivered: true })).toBe('model 2.0s');
  });
});
