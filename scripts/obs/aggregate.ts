import { readTimings, SEGMENTS, TOTALS } from './segments';

export interface ReportInput {
  conversations: {
    final_status: string | null;
    ended_at: string | null;
    /** Present when the report is asked for abuse figures (migration 20261002000010 and later). */
    conversation_id?: string;
    customer_id?: string | null;
    end_reason?: string | null;
    support_mode?: string | null;
  }[];
  turns: {
    conversation_id?: string;
    answer_type: string | null;
    latency_ms: number | null;
    cost_usd: number | string | null;
    /** Segment timings (conversation_turns.timings); absent on turns from before they were recorded. */
    timings?: unknown;
  }[];
  toolCalls: { conversation_id?: string; tool_name: string | null; status: string | null; duration_ms: number | null }[];
  events: { conversation_id?: string; event_type: string; metadata?: unknown }[];
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
  voice: VoiceReport;
  abuse: AbuseReport;
  /** Averages per conversation (Build Plan V2 section 86). */
  perConversation: { turns: number | null; toolCalls: number | null };
}

/** How customers interact by voice: talking over the assistant, going quiet, and replies that never arrived. */
export interface VoiceReport {
  /** Calls that wrote a voice_stats event. */
  calls: number;
  interruptions: number;
  /** Interruptions under half a second: likely noise or stray words rather than real interruptions. */
  shortInterruptions: number;
  silenceWarnings: number;
  /** Replies the customer's connection closed on before they arrived (they spoke over the assistant mid-turn). */
  undeliveredReplies: number;
  /** The same, counted from turn timings (turns that record whether the reply was delivered). */
  undeliveredTurns: number;
  deliveryTrackedTurns: number;
}

/** Limits that stopped a session, hand-overs to staff, and the heaviest users of the system (Build Plan V2 section 70). */
export interface AbuseReport {
  /** `limit_reached` events by kind (agent_calls, tool_calls, retrievals, concurrent_sessions, session_rate, ...). */
  limitEvents: Record<string, number>;
  /** Conversations that ended with the limit-reached reason. */
  limitEnded: number;
  /** Moves to a support specialist, by reason (escalation, limit-reached). */
  handoffs: { total: number; byReason: Record<string, number> };
  humanClosed: number;
  /** Signed-in customers with two or more sessions in the period, most first. */
  topCustomers: { customerId: string; sessions: number }[];
  /** The conversations that used the most model turns and tool calls. */
  heaviest: { conversationId: string; turns: number; toolCalls: number }[];
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

function buildVoice(input: ReportInput): VoiceReport {
  const out: VoiceReport = {
    calls: 0,
    interruptions: 0,
    shortInterruptions: 0,
    silenceWarnings: 0,
    undeliveredReplies: 0,
    undeliveredTurns: 0,
    deliveryTrackedTurns: 0,
  };
  const count = (meta: Record<string, unknown>, key: string) => (finite(meta[key]) && meta[key] >= 0 ? (meta[key] as number) : 0);
  for (const e of input.events) {
    if (e.event_type !== 'voice_stats') continue;
    const meta = (e.metadata && typeof e.metadata === 'object' ? e.metadata : {}) as Record<string, unknown>;
    out.calls++;
    out.interruptions += count(meta, 'interruptions');
    out.shortInterruptions += count(meta, 'short_interruptions');
    out.silenceWarnings += count(meta, 'silence_warnings');
    out.undeliveredReplies += count(meta, 'undelivered_replies');
  }
  for (const turn of input.turns) {
    const t = readTimings(turn.timings);
    if (typeof t.delivered !== 'boolean') continue;
    out.deliveryTrackedTurns++;
    if (t.delivered === false) out.undeliveredTurns++;
  }
  return out;
}

const meta = (e: { metadata?: unknown }) =>
  (e.metadata && typeof e.metadata === 'object' ? e.metadata : {}) as Record<string, unknown>;

function buildAbuse(input: ReportInput): AbuseReport {
  const limitEvents = tally(
    input.events.filter((e) => e.event_type === 'limit_reached'),
    (e) => (typeof meta(e).kind === 'string' ? (meta(e).kind as string) : 'unknown'),
  );
  const handoffEvents = input.events.filter((e) => e.event_type === 'human_handoff');
  const bySession = new Map<string, number>();
  for (const c of input.conversations) {
    if (c.customer_id) bySession.set(c.customer_id, (bySession.get(c.customer_id) ?? 0) + 1);
  }
  const usage = new Map<string, { turns: number; toolCalls: number }>();
  const bump = (id: string | undefined, key: 'turns' | 'toolCalls') => {
    if (!id) return;
    const row = usage.get(id) ?? { turns: 0, toolCalls: 0 };
    row[key]++;
    usage.set(id, row);
  };
  for (const t of input.turns) bump(t.conversation_id, 'turns');
  for (const c of input.toolCalls) bump(c.conversation_id, 'toolCalls');
  return {
    limitEvents,
    limitEnded: input.conversations.filter((c) => c.end_reason === 'limit-reached').length,
    handoffs: {
      total: handoffEvents.length,
      byReason: tally(handoffEvents, (e) => (typeof meta(e).reason === 'string' ? (meta(e).reason as string) : 'unknown')),
    },
    humanClosed: input.conversations.filter((c) => c.end_reason === 'human-closed').length,
    topCustomers: [...bySession.entries()]
      .filter(([, sessions]) => sessions >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([customerId, sessions]) => ({ customerId, sessions })),
    heaviest: [...usage.entries()]
      .sort((a, b) => b[1].turns + b[1].toolCalls - (a[1].turns + a[1].toolCalls) || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([conversationId, u]) => ({ conversationId, ...u })),
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
    voice: buildVoice(input),
    abuse: buildAbuse(input),
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

function formatVoice(v: VoiceReport): string[] {
  if (v.calls === 0 && v.deliveryTrackedTurns === 0) return ['Voice: no voice statistics yet'];
  const per = (n: number) => (v.calls ? ` (${Math.round((n / v.calls) * 10) / 10} per call)` : '');
  const lines = [`Voice (${v.calls} calls with statistics):`];
  const short = v.interruptions ? `, ${v.shortInterruptions} under half a second (${Math.round((v.shortInterruptions / v.interruptions) * 100)}%)` : '';
  lines.push(`  customer talked over the assistant: ${v.interruptions}${per(v.interruptions)}${short}`);
  lines.push(`  silence countdowns: ${v.silenceWarnings}${per(v.silenceWarnings)}`);
  lines.push(
    `  replies that never arrived: ${v.undeliveredReplies} (${v.undeliveredTurns} of ${v.deliveryTrackedTurns} timed turns)`,
  );
  return lines;
}

function formatAbuse(a: AbuseReport): string[] {
  const quiet =
    Object.keys(a.limitEvents).length === 0 && a.handoffs.total === 0 && a.limitEnded === 0 && a.topCustomers.length === 0;
  if (quiet && a.heaviest.length === 0) return ['Limits and handoffs: nothing recorded yet'];
  const lines = ['Limits and handoffs:'];
  lines.push(`  limits reached: ${kv(a.limitEvents)}; sessions ended by a limit: ${a.limitEnded}`);
  lines.push(`  moved to a specialist: ${a.handoffs.total} (${kv(a.handoffs.byReason)}); closed by staff: ${a.humanClosed}`);
  if (a.topCustomers.length) {
    lines.push(`  most sessions: ${a.topCustomers.map((c) => `${c.customerId} ${c.sessions}`).join(', ')}`);
  }
  if (a.heaviest.length) {
    lines.push(
      `  heaviest conversations: ${a.heaviest.map((h) => `${h.conversationId} (${h.turns} turns, ${h.toolCalls} tool calls)`).join(', ')}`,
    );
  }
  return lines;
}

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
    ...formatVoice(r.voice),
    ...formatAbuse(r.abuse),
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
