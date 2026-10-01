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
  return meta;
}
