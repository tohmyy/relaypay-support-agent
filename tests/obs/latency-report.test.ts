import { describe, expect, it } from 'vitest';
import { callEndedMetadata, vapiLatencyMs } from '../../services/agent/src/observability';
import { buildReport, formatReport, type ReportInput } from '../../scripts/obs/aggregate';
import { describeTimings, readTimings } from '../../scripts/obs/segments';
import { buildTimeline, formatTimeline } from '../../scripts/obs/timeline';

describe('Vapi-side latency', () => {
  const report = (performanceMetrics: unknown) => ({ type: 'end-of-call-report', artifact: { performanceMetrics } });

  it('keeps the known averages as whole milliseconds', () => {
    expect(
      vapiLatencyMs(
        report({
          transcriberLatencyAverage: 212.4,
          endpointingLatencyAverage: 305,
          modelLatencyAverage: 2900.7,
          voiceLatencyAverage: 410,
          turnLatencyAverage: 3900,
        }),
      ),
    ).toEqual({ transcriber: 212, endpointing: 305, model: 2901, voice: 410, turn: 3900 });
  });

  it('keeps only numbers: nothing else from the report can slip into the event', () => {
    const out = vapiLatencyMs(
      report({
        modelLatencyAverage: '2900',
        voiceLatencyAverage: -5,
        turnLatencyAverage: Number.NaN,
        transcriberLatencyAverage: 100,
        turnLatencies: [{ transcript: 'my email is a@b.co' }],
        secret: 'x',
      }),
    );
    expect(out).toEqual({ transcriber: 100 });
    expect(JSON.stringify(out)).not.toMatch(/a@b|secret/);
  });

  it('gives nothing when the report has no metrics, or has them in an unexpected shape', () => {
    for (const m of [undefined, null, 'fast', 42, {}, { somethingElse: 1 }]) {
      expect(vapiLatencyMs(report(m))).toBeUndefined();
    }
    expect(vapiLatencyMs({ type: 'end-of-call-report' })).toBeUndefined();
    expect(vapiLatencyMs({ artifact: null })).toBeUndefined();
  });

  it('adds them to the call-ended details next to the existing whitelist', () => {
    const meta = callEndedMetadata({
      endedReason: 'customer-ended-call',
      durationSeconds: 61.2345,
      transcript: 'private',
      ...report({ turnLatencyAverage: 3500 }),
    });
    expect(meta).toEqual({ endedReason: 'customer-ended-call', durationSeconds: 61.235, vapi_latency_ms: { turn: 3500 } });
    expect(JSON.stringify(meta)).not.toContain('private');
  });

  it('leaves the details unchanged when Vapi sent no metrics', () => {
    expect(callEndedMetadata({ endedReason: 'x' })).toEqual({ endedReason: 'x' });
  });
});

describe('reading stored timings', () => {
  it('copes with anything the column might hold', () => {
    expect(readTimings(null)).toEqual({});
    expect(readTimings(undefined)).toEqual({});
    expect(readTimings('nope')).toEqual({});
    expect(readTimings([1, 2])).toEqual({});
    expect(readTimings(42)).toEqual({});
    expect(readTimings('{"model_ms": 5}')).toEqual({ model_ms: 5 });
    expect(readTimings({ model_ms: 5 })).toEqual({ model_ms: 5 });
  });

  it('describes a turn in the order it happened', () => {
    const text = describeTimings({
      queue_ms: 0,
      history_ms: 90,
      retrieval_ms: 40,
      sdk_start_ms: 1200,
      model_ms: 2900,
      mcp_ms: 310,
      save_ms: 60,
      first_write_ms: 2500,
      prewarmed: true,
      ack_category: 'transaction_lookup',
    });
    expect(text).toBe(
      'history 90ms, retrieval 40ms, agent start 1.2s, model 2.9s, tools 310ms, save 60ms, first reply byte 2.5s, pre-warmed, ack: transaction_lookup',
    );
  });

  it('shows a pre-warmed agent start of zero, but leaves out other empty pieces', () => {
    expect(describeTimings({ queue_ms: 0, sdk_start_ms: 0, model_ms: 1000 })).toBe('agent start 0ms, model 1.0s');
    expect(describeTimings({})).toBe('');
    expect(describeTimings(null)).toBe('');
  });
});

describe('latency breakdown in the report', () => {
  const turn = (timings: unknown, latency = 4000) => ({ answer_type: 'direct_answer', latency_ms: latency, cost_usd: 0.01, timings });
  const base: ReportInput = { conversations: [], turns: [], toolCalls: [], events: [], tickets: 0, escalations: 0 };

  const input: ReportInput = {
    ...base,
    conversations: [
      { final_status: 'resolved', ended_at: 'x' },
      { final_status: 'resolved', ended_at: 'x' },
    ],
    turns: [
      turn({ total_turn_ms: 4000, history_ms: 100, retrieval_ms: 50, sdk_start_ms: 1500, model_ms: 2000, mcp_ms: 300, save_ms: 50, prewarmed: false, ack_category: 'knowledge_base', first_write_ms: 2500 }),
      turn({ total_turn_ms: 3000, history_ms: 100, retrieval_ms: 50, sdk_start_ms: 1500, model_ms: 1200, mcp_ms: 100, save_ms: 50, prewarmed: false }),
      turn({ total_turn_ms: 1800, history_ms: 100, retrieval_ms: 50, sdk_start_ms: 20, model_ms: 1500, save_ms: 50, prewarmed: true }),
      turn(null), // a turn from before timings were recorded
      turn({}),
    ],
    toolCalls: [
      { tool_name: 'lookup_payout', status: 'success', duration_ms: 100 },
      { tool_name: 'lookup_customer', status: 'success', duration_ms: 90 },
      { tool_name: 'lookup_transaction', status: 'success', duration_ms: 80 },
    ],
    events: [
      { event_type: 'call_ended', metadata: { vapi_latency_ms: { transcriber: 200, model: 3000, voice: 400, turn: 3900 } } },
      { event_type: 'call_ended', metadata: { vapi_latency_ms: { transcriber: 300, model: 4000 } } },
      { event_type: 'call_ended', metadata: {} },
      { event_type: 'error' },
    ],
  };
  const r = buildReport(input);

  it('counts only turns that carry timings', () => {
    expect(r.latency.timedTurns).toBe(3);
  });

  it('gives percentiles per piece and whole turn', () => {
    expect(r.latency.totals.total_turn_ms).toMatchObject({ count: 3, p50: 3000, max: 4000 });
    expect(r.latency.segments.retrieval_ms).toMatchObject({ count: 3, p50: 50, max: 50 });
    expect(r.latency.segments.sdk_start_ms).toMatchObject({ p50: 1500, max: 1500 });
    expect(r.latency.segments.mcp_ms).toMatchObject({ count: 2 });
  });

  it('says how much of the turn time each piece takes', () => {
    // sdk start: 1500 + 1500 + 20 of 8800 total turn time.
    expect(r.latency.segments.sdk_start_ms.sharePct).toBe(Math.round((3020 / 8800) * 100));
    expect(r.latency.segments.model_ms.sharePct).toBe(Math.round((4700 / 8800) * 100));
  });

  it('compares turns with and without the pre-started agent process', () => {
    expect(r.latency.prewarm).toEqual({ on: { turns: 1, p50: 1800 }, off: { turns: 2, p50: 3000 } });
  });

  it('counts the acknowledgements spoken, by kind', () => {
    expect(r.latency.acks).toEqual({ knowledge_base: 1 });
  });

  it('averages what Vapi measured over the calls that reported it', () => {
    expect(r.latency.vapi).toEqual({ calls: 2, stages: { transcriber: 250, model: 3500, voice: 400, turn: 3900 } });
  });

  it('averages turns and tool calls per conversation', () => {
    expect(r.perConversation).toEqual({ turns: 2.5, toolCalls: 1.5 });
    expect(buildReport(base).perConversation).toEqual({ turns: null, toolCalls: null });
  });

  it('prints it', () => {
    const text = formatReport(r, 'all time');
    expect(text).toContain('Latency breakdown (3 timed turns):');
    expect(text).toContain('whole turn: p50 3.0s, p95 4.0s, max 4.0s over 3');
    expect(text).toMatch(/agent start: p50 1\.5s, p95 1\.5s, max 1\.5s \(34% of turn time\) over 3/);
    expect(text).toContain('agent pre-start: on 1 turns (whole-turn p50 1.8s), off 2 turns (p50 3.0s)');
    expect(text).toContain('acknowledgements spoken: knowledge_base: 1');
    expect(text).toContain('Vapi-side averages over 2 calls: transcriber 250ms, model 3.5s, voice 400ms, turn 3.9s');
    expect(text).toContain('Per conversation: 2.5 turns, 1.5 tool calls on average');
  });

  it('says so plainly when no turn has timings yet', () => {
    const text = formatReport(buildReport({ ...base, turns: [turn(null)] }), 'all time');
    expect(text).toContain('Latency breakdown: no timed turns yet');
  });

  it('does not mention the comparison or Vapi when there is nothing to compare', () => {
    const text = formatReport(buildReport({ ...base, turns: [turn({ total_turn_ms: 1000, model_ms: 900 })] }), 'all time');
    expect(text).not.toContain('agent pre-start');
    expect(text).not.toContain('Vapi-side');
    expect(text).not.toContain('acknowledgements spoken');
  });
});

describe('trace', () => {
  it('adds the breakdown to the agent line of a turn, and leaves older turns alone', () => {
    const entries = buildTimeline({
      conversation: { conversation_id: 'vapi_a', started_at: '2026-10-02T09:00:00Z' },
      turns: [
        { turn_number: 1, user_transcript: 'hi', assistant_response: 'Hello', answer_type: 'direct_answer', latency_ms: 3000, cost_usd: 0.01, created_at: '2026-10-02T09:00:05Z', timings: { history_ms: 80, model_ms: 2500, sdk_start_ms: 300 } },
        { turn_number: 2, user_transcript: 'ok', assistant_response: 'Sure', answer_type: 'direct_answer', latency_ms: 2000, cost_usd: 0.01, created_at: '2026-10-02T09:00:10Z' },
      ],
      retrievals: [],
      toolCalls: [],
      events: [],
      tickets: [],
      escalations: [],
    });
    const text = formatTimeline(entries);
    expect(text).toContain('[history 80ms, agent start 300ms, model 2.5s]');
    const agentLines = entries.filter((e) => e.kind === 'agent');
    expect(agentLines[1].text).not.toContain('[');
  });
});
