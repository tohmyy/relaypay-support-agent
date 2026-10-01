export interface ReportInput {
  conversations: { final_status: string | null; ended_at: string | null }[];
  turns: {
    answer_type: string | null;
    latency_ms: number | null;
    cost_usd: number | string | null;
  }[];
  toolCalls: { tool_name: string | null; status: string | null; duration_ms: number | null }[];
  events: { event_type: string }[];
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
  };
}

const kv = (o: Record<string, number>) =>
  Object.keys(o).length
    ? Object.entries(o)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : 'none';
const secs = (ms: number | null) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);

export function formatReport(r: Report, label: string): string {
  const lines = [
    `Support report (${label})`,
    `Conversations: ${r.conversations.total} (${kv(r.conversations.byStatus)}); still open: ${r.conversations.stillOpen}`,
    `Turns: ${r.turns.total} (${kv(r.turns.byAnswerType)})`,
    `Reply time: p50 ${secs(r.latencyMs.p50)}, p95 ${secs(r.latencyMs.p95)}, max ${secs(r.latencyMs.max)} over ${r.latencyMs.count} timed turns`,
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
