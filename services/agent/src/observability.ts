import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureConversation } from './history';
import { errorMessage, logEvent } from './logger';
import { redactPii } from './redact';

const MAX_MESSAGE = 300;

/**
 * Persists a failure as a conversation event so a failed call leaves a trace in the database, not only in
 * the server log. The message is scrubbed and truncated. This never throws: if the write itself fails the
 * failure is logged to stderr instead.
 */
export async function recordError(
  db: SupabaseClient,
  conversationId: string,
  source: string,
  error: unknown,
): Promise<void> {
  const message = redactPii(errorMessage(error)).slice(0, MAX_MESSAGE);
  try {
    await ensureConversation(db, conversationId);
    const { error: writeError } = await db.from('conversation_events').insert({
      conversation_id: conversationId,
      event_type: 'error',
      summary: `${source} failed`,
      metadata: { source, message },
    });
    if (writeError) throw new Error(writeError.message);
  } catch (writeFailure) {
    logEvent('error', 'could not record error event', {
      conversation_id: conversationId,
      source,
      message,
      write_failure: errorMessage(writeFailure),
    });
  }
}

/** Safe, whitelisted details of how a call ended. Nothing from the transcript is kept. */
export function callEndedMetadata(message: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const reason = message.endedReason;
  if (typeof reason === 'string' && /^[A-Za-z0-9._ -]{1,80}$/.test(reason))
    meta.endedReason = reason;
  for (const key of ['durationSeconds', 'cost'] as const) {
    const v = message[key];
    if (typeof v === 'number' && Number.isFinite(v)) meta[key] = Math.round(v * 1000) / 1000;
  }
  const vapiLatency = vapiLatencyMs(message);
  if (vapiLatency) meta.vapi_latency_ms = vapiLatency;
  return meta;
}

/** Vapi's average per-turn timings (milliseconds) as reported in the end-of-call report, by stage. */
const VAPI_LATENCY_KEYS = {
  transcriber: 'transcriberLatencyAverage',
  endpointing: 'endpointingLatencyAverage',
  model: 'modelLatencyAverage',
  voice: 'voiceLatencyAverage',
  turn: 'turnLatencyAverage',
} as const;

/**
 * What Vapi measured itself: speech recognition, end-of-speech detection, its model call (our endpoint), speech
 * synthesis and the whole turn. These happen outside the agent, so they are the only view of that time. The
 * report's exact shape still needs a live check (docs/PERFORMANCE.md); only finite non-negative numbers under the
 * known names are kept, and anything else is ignored.
 */
export function vapiLatencyMs(message: Record<string, unknown>): Record<string, number> | undefined {
  const artifact = message.artifact as { performanceMetrics?: Record<string, unknown> } | null | undefined;
  const metrics = artifact?.performanceMetrics;
  if (!metrics || typeof metrics !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [stage, key] of Object.entries(VAPI_LATENCY_KEYS)) {
    const v = (metrics as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[stage] = Math.round(v);
  }
  return Object.keys(out).length ? out : undefined;
}
