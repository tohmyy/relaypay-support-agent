/**
 * The pieces a turn's time is split into (conversation_turns.timings), in the order they happen. Shared by the trace
 * (one line per turn) and the report (percentiles per piece) so both name things the same way.
 */
export const SEGMENTS = [
  ['queue_ms', 'queue'],
  ['controller_ms', 'controller'],
  ['history_ms', 'history'],
  ['retrieval_ms', 'retrieval'],
  ['sdk_start_ms', 'agent start'],
  ['model_ms', 'model'],
  ['mcp_ms', 'tools'],
  ['save_ms', 'save'],
] as const;

export type SegmentKey = (typeof SEGMENTS)[number][0];

/** The whole-turn figures, reported next to the pieces. */
export const TOTALS = [
  ['total_turn_ms', 'whole turn'],
  ['first_write_ms', 'first reply byte'],
  ['speech_to_agent_ms', 'speech end to request'],
] as const;

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads a stored timings value defensively: rows from before timings existed, or odd JSON, give an empty object. */
export function readTimings(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return readTimings(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/** "history 90ms, retrieval 40ms, agent start 1.2s, model 2.9s, tools 310ms, save 60ms (pre-warmed)" */
export function describeTimings(value: unknown): string {
  const t = readTimings(value);
  const parts: string[] = [];
  for (const [key, label] of SEGMENTS) {
    const v = num(t[key]);
    if (v !== undefined && (v > 0 || key === 'sdk_start_ms')) parts.push(`${label} ${fmt(v)}`);
  }
  const first = num(t.first_write_ms);
  if (first !== undefined) parts.push(`first reply byte ${fmt(first)}`);
  if (t.delivered === false) {
    const left = num(t.client_closed_ms);
    parts.push(left === undefined ? 'reply not delivered' : `reply not delivered (customer left at ${fmt(left)})`);
  }
  if (t.prewarmed === true) parts.push('pre-warmed');
  if (typeof t.ack_category === 'string') parts.push(`ack: ${t.ack_category}`);
  return parts.join(', ');
}
