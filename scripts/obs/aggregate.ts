import { readTimings, SEGMENTS, TOTALS } from './segments';

export interface ReportInput {
  conversations: { final_status: string | null; ended_at: string | null }[];
  turns: {
    answer_type: string | null;
    latency_ms: number | null;
    cost_usd: number | string | null;
    /** Segment timings (conversation_turns.timings); absent on turns from before they were recorded. */
    timings?: unknown;
  }[];
  toolCalls: { tool_name: string | null; status: string | null; duration_ms: number | null }[];
  events: { event_type: string; metadata?: unknown }[];
  tickets: number;
  escalations: number;
}

export interface Report {
  conversations: { total: number; byStatus: Record<string, number>; stillOpen: number };
  turns: { total: number; byAnswerType: Record<string, number> };
  latencyMs: { count: number; p50: number | null; p95: number | null; max: number | null };
  costUsd: { total: number };
  tools: Record<
    string,
    { calls: number; success: number; not_found: number; failed: number; avgMs: number | null }
  >;
  events: Record<string, number>;
  tickets: number;
  escalations: number;
  latency: LatencyReport;
  /** Averages per conversation (Build Plan V2 section 86). */
  perConversation: { turns: number | null; toolCalls: number | null };
}

export interface SegmentStats {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  /** This piece's share of all turn time, across turns that recorded both. */
  sharePct: number | null;
}

export interface LatencyReport {
  /** Turns that carry timings. */
  timedTurns: number;
  segments: Record<string, SegmentStats>;
  totals: Record<string, SegmentStats>;
  /** The pre-start comparison: whole-turn p50 with the agent process pre-started and without. */
  prewarm: { on: { turns: number; p50: number | null }; off: { turns: number; p50: number | null } };
  /** Acknowledgements spoken, by kind. */
  acks: Record<string, number>;
  /** What Vapi measured itself, averaged over the calls that reported it (milliseconds). */
  vapi: { calls: number; stages: Record<string, number> };
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function tally<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

function stats(values: number[], totalTurnMs?: number): SegmentStats {
  const sorted = [...values].sort((x, y) => x - y);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? null,
    sharePct:
      totalTurnMs && totalTurnMs > 0 && sorted.length
        ? Math.round((sorted.reduce((s, v) => s + v, 0) / totalTurnMs) * 100)
        : null,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function buildLatency(input: ReportInput): LatencyReport {
  const timings = input.turns.map((t) => readTimings(t.timings)).filter((t) => Object.keys(t).length > 0);
  const totals = timings.map((t) => t.total_turn_ms).filter(finite);
  const wholeMs = totals.reduce((s, v) => s + v, 0);
  const column = (key: string) => timings.map((t) => t[key]).filter(finite);

  const p50Of = (list: number[]) => percentile([...list].sort((x, y) => x - y), 50);
  const warm = timings.filter((t) => t.prewarmed === true).map((t) => t.total_turn_ms).filter(finite);
  const cold = timings.filter((t) => t.prewarmed === false).map((t) => t.total_turn_ms).filter(finite);

  const acks: Record<string, number> = {};
  for (const t of timings) {
    if (typeof t.ack_category === 'string') acks[t.ack_category] = (acks[t.ack_category] ?? 0) + 1;
  }

  const stages: Record<string, number[]> = {};
  let calls = 0;
  for (const e of input.events) {
    if (e.event_type !== 'call_ended') continue;
    const meta = (e.metadata && typeof e.metadata === 'object' ? e.metadata : {}) as Record<string, unknown>;
    const vapi = meta.vapi_latency_ms;
    if (!vapi || typeof vapi !== 'object') continue;
    calls++;
    for (const [stage, v] of Object.entries(vapi as Record<string, unknown>)) {
      if (finite(v)) (stages[stage] ??= []).push(v);
    }
  }

  return {
    timedTurns: timings.length,
    segments: Object.fromEntries(
      SEGMENTS.map(([key]) => [key, stats(column(key), wholeMs)]).filter(([, s]) => (s as SegmentStats).count > 0),
    ),
    totals: Object.fromEntries(
      TOTALS.map(([key]) => [key, stats(column(key))]).filter(([, s]) => (s as SegmentStats).count > 0),
    ),
    prewarm: {
      on: { turns: warm.length, p50: p50Of(warm) },
      off: { turns: cold.length, p50: p50Of(cold) },
    },
    acks,
    vapi: {
      calls,
      stages: Object.fromEntries(
        Object.entries(stages).map(([stage, list]) => [stage, Math.round(list.reduce((s, v) => s + v, 0) / list.length)]),
      ),
    },
  };
}

export function buildReport(input: ReportInput): Report {
  const latencies = input.turns
    .map((t) => t.latency_ms)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  const tools: Report['tools'] = {};
  const durations: Record<string, number[]> = {};
  for (const c of input.toolCalls) {
    const name = c.tool_name ?? 'unknown';
    const row = (tools[name] ??= { calls: 0, success: 0, not_found: 0, failed: 0, avgMs: null });
    row.calls++;
    if (c.status === 'success' || c.status === 'not_found' || c.status === 'failed')
      row[c.status]++;
    if (c.duration_ms != null) (durations[name] ??= []).push(c.duration_ms);
  }
  for (const [name, list] of Object.entries(durations)) {
    tools[name].avgMs = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }

  return {
    conversations: {
      total: input.conversations.length,
      byStatus: tally(input.conversations, (c) => c.final_status ?? 'no status yet'),
      stillOpen: input.conversations.filter((c) => !c.ended_at).length,
    },
    turns: {
      total: input.turns.length,
      byAnswerType: tally(input.turns, (t) => t.answer_type ?? 'unknown'),
    },
    latencyMs: {
      count: latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.at(-1) ?? null,
    },
    costUsd: {
      total: Math.round(input.turns.reduce((s, t) => s + Number(t.cost_usd ?? 0), 0) * 1e6) / 1e6,
    },
    tools,
    events: tally(input.events, (e) => e.event_type),
    tickets: input.tickets,
    escalations: input.escalations,
    latency: buildLatency(input),
    perConversation: {
      turns: input.conversations.length
        ? Math.round((input.turns.length / input.conversations.length) * 10) / 10
        : null,
      toolCalls: input.conversations.length
        ? Math.round((input.toolCalls.length / input.conversations.length) * 10) / 10
        : null,
    },
  };
}

const kv = (o: Record<string, number>) =>
  Object.keys(o).length
    ? Object.entries(o)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : 'none';
const secs = (ms: number | null) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
const ms = (v: number | null) => (v == null ? 'n/a' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

function formatLatency(l: LatencyReport): string[] {
  if (l.timedTurns === 0) return ['Latency breakdown: no timed turns yet (turns before segment timings were recorded have none)'];
  const label = (key: string) =>
    [...SEGMENTS, ...TOTALS].find(([k]) => k === key)?.[1] ?? key;
  const row = (key: string, s: SegmentStats) =>
    `  ${label(key)}: p50 ${ms(s.p50)}, p95 ${ms(s.p95)}, max ${ms(s.max)}${s.sharePct == null ? '' : ` (${s.sharePct}% of turn time)`} over ${s.count}`;
  const lines = [`Latency breakdown (${l.timedTurns} timed turns):`];
  for (const [key, s] of Object.entries(l.totals)) lines.push(row(key, s));
  for (const [key, s] of Object.entries(l.segments)) lines.push(row(key, s));
  if (l.prewarm.on.turns > 0 || l.prewarm.off.turns > 0) {
    lines.push(
      `  agent pre-start: on ${l.prewarm.on.turns} turns (whole-turn p50 ${ms(l.prewarm.on.p50)}), off ${l.prewarm.off.turns} turns (p50 ${ms(l.prewarm.off.p50)})`,
    );
  }
  if (Object.keys(l.acks).length) lines.push(`  acknowledgements spoken: ${kv(l.acks)}`);
  if (l.vapi.calls > 0) {
    lines.push(`  Vapi-side averages over ${l.vapi.calls} calls: ${Object.entries(l.vapi.stages).map(([k, v]) => `${k} ${ms(v)}`).join(', ')}`);
  }
  return lines;
}

export function formatReport(r: Report, label: string): string {
  const lines = [
    `Support report (${label})`,
    `Conversations: ${r.conversations.total} (${kv(r.conversations.byStatus)}); still open: ${r.conversations.stillOpen}`,
    `Turns: ${r.turns.total} (${kv(r.turns.byAnswerType)})`,
    `Reply time: p50 ${secs(r.latencyMs.p50)}, p95 ${secs(r.latencyMs.p95)}, max ${secs(r.latencyMs.max)} over ${r.latencyMs.count} timed turns`,
    ...formatLatency(r.latency),
    `Per conversation: ${r.perConversation.turns ?? 'n/a'} turns, ${r.perConversation.toolCalls ?? 'n/a'} tool calls on average`,
    `Model cost estimate: $${r.costUsd.total.toFixed(4)}`,
    `Tickets: ${r.tickets}, escalations: ${r.escalations}`,
    `Events: ${kv(r.events)}`,
    'Tools:',
  ];
  const names = Object.keys(r.tools).sort();
  if (names.length === 0) lines.push('  none');
  for (const n of names) {
    const t = r.tools[n];
    const avg = t.avgMs == null ? 'n/a' : `${t.avgMs}ms`;
    lines.push(
      `  ${n}: ${t.calls} calls (success ${t.success}, not found ${t.not_found}, failed ${t.failed}), avg ${avg}`,
    );
  }
  return lines.join('\n');
}

/** "30m", "24h", "7d" to milliseconds. */
export function parseSince(value: string): number {
  const m = /^(\d+)([mhd])$/.exec(value.trim());
  if (!m) throw new Error('--since must look like 30m, 24h or 7d');
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
}
