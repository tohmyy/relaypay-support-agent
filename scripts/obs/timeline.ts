import { redactPii } from '../../services/agent/src/redact';
import { describeTimings } from './segments';

export interface TimelineInput {
  conversation: {
    conversation_id: string;
    channel?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    final_status?: string | null;
  } | null;
  turns: {
    turn_number: number | null;
    user_transcript: string | null;
    assistant_response: string | null;
    answer_type: string | null;
    latency_ms: number | null;
    cost_usd: number | string | null;
    /** Where the turn's time went (segments); absent on turns from before they were recorded. */
    timings?: unknown;
    created_at: string;
  }[];
  retrievals: { query: string | null; source_titles: unknown; created_at: string }[];
  toolCalls: {
    tool_name: string | null;
    purpose: string | null;
    status: string | null;
    duration_ms: number | null;
    result_summary: string | null;
    error: string | null;
    created_at: string;
  }[];
  events: { event_type: string; summary: string; metadata: unknown; created_at: string }[];
  tickets: {
    ticket_id: string;
    category: string | null;
    priority: string | null;
    created_at: string;
  }[];
  escalations: {
    escalation_id: string;
    category: string | null;
    preferred_time: string | null;
    created_at: string;
  }[];
}

export type EntryKind =
  | 'start'
  | 'customer'
  | 'retrieval'
  | 'tool'
  | 'agent'
  | 'ticket'
  | 'escalation'
  | 'event'
  | 'error'
  | 'end';

export interface TimelineEntry {
  at: string;
  kind: EntryKind;
  text: string;
}

// When timestamps tie, the story reads in this order.
const ORDER: EntryKind[] = [
  'start',
  'customer',
  'retrieval',
  'tool',
  'ticket',
  'escalation',
  'event',
  'error',
  'agent',
  'end',
];

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function titles(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Merges every table that describes one call into a single, time-ordered list. */
export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const c = input.conversation;
  if (c?.started_at) {
    out.push({
      at: c.started_at,
      kind: 'start',
      text: `call started (${c.channel ?? 'unknown channel'})`,
    });
  }
  if (c?.ended_at) {
    out.push({
      at: c.ended_at,
      kind: 'end',
      text: `call ended (${c.final_status ?? 'no final status'})`,
    });
  }

  for (const t of input.turns) {
    const done = new Date(t.created_at).getTime();
    // The turn row is saved when the reply is ready, so the customer spoke latency_ms earlier.
    let spokeMs = t.latency_ms ? done - t.latency_ms : done;
    // The call row is created a moment after the turn begins; never show speech before the call started.
    if (c?.started_at) spokeMs = Math.max(spokeMs, new Date(c.started_at).getTime());
    const spoke = new Date(spokeMs).toISOString();
    if (t.user_transcript)
      out.push({ at: spoke, kind: 'customer', text: `"${clip(t.user_transcript, 240)}"` });
    const bits = [t.answer_type ?? 'unknown'];
    if (t.latency_ms != null) bits.push(`${(t.latency_ms / 1000).toFixed(1)}s`);
    if (t.cost_usd != null) bits.push(`$${Number(t.cost_usd).toFixed(3)}`);
    const breakdown = describeTimings(t.timings);
    out.push({
      at: t.created_at,
      kind: 'agent',
      text: `(${bits.join(', ')}) "${clip(t.assistant_response, 240)}"${breakdown ? ` [${breakdown}]` : ''}`,
    });
  }

  for (const r of input.retrievals) {
    const names = titles(r.source_titles);
    out.push({
      at: r.created_at,
      kind: 'retrieval',
      text: `searched "${clip(r.query, 100)}" -> ${names.length ? names.join('; ') : 'nothing relevant'} (${names.length})`,
    });
  }

  for (const k of input.toolCalls) {
    const timing = k.duration_ms != null ? ` ${k.duration_ms}ms` : '';
    const err = k.error ? ` error: ${clip(k.error, 160)}` : '';
    out.push({
      at: k.created_at,
      kind: 'tool',
      text: `${k.tool_name} ${k.status}${timing} - ${clip(k.result_summary, 120)}${k.purpose ? ` [${k.purpose}]` : ''}${err}`,
    });
  }

  for (const e of input.events) {
    const hasMeta =
      e.metadata && typeof e.metadata === 'object' && Object.keys(e.metadata).length > 0;
    out.push({
      at: e.created_at,
      kind: e.event_type === 'error' ? 'error' : 'event',
      text: `${e.event_type}: ${clip(e.summary, 160)}${hasMeta ? ` ${clip(JSON.stringify(e.metadata), 200)}` : ''}`,
    });
  }

  for (const t of input.tickets) {
    out.push({
      at: t.created_at,
      kind: 'ticket',
      text: `ticket ${t.ticket_id} created (${t.category ?? '?'}, ${t.priority ?? '?'})`,
    });
  }
  for (const e of input.escalations) {
    const when = e.preferred_time ? `, requested callback: ${clip(e.preferred_time, 60)}` : '';
    out.push({
      at: e.created_at,
      kind: 'escalation',
      text: `escalation ${e.escalation_id} created (${e.category ?? '?'}${when})`,
    });
  }

  return out.sort(
    (a, b) =>
      new Date(a.at).getTime() - new Date(b.at).getTime() ||
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
}

/** Printable timeline. Emails and long numbers are masked even though the stored text is kept as is. */
export function formatTimeline(entries: TimelineEntry[]): string {
  if (entries.length === 0) return 'No records found for that conversation.';
  const kindWidth = Math.max(...entries.map((e) => e.kind.length));
  return entries
    .map((e) => `${e.at.slice(11, 23)}  ${e.kind.padEnd(kindWidth)}  ${redactPii(e.text)}`)
    .join('\n');
}
