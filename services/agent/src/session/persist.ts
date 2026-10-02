import type { SupabaseClient } from '@supabase/supabase-js';
import { finalStatusFor } from './end-reason';
import type { ConversationEndReason } from './types';

export interface EndResult {
  /** False when the conversation already had an end reason; the first reason wins. */
  applied: boolean;
  finalStatus?: string;
  endReason?: ConversationEndReason | null;
}

function fail(action: string, error: { message: string } | null) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

/**
 * Durable end of a session: `ended_at`, coarse `final_status`, and `end_reason`. Idempotent and first-wins, so a
 * controller-initiated end (silence, time limit, "that's all") is never overwritten by the later Vapi report.
 */
export async function endConversation(
  db: SupabaseClient,
  conversationId: string,
  /** Null when the reason is unknown (e.g. an unmapped Vapi endedReason): outcome is still recorded. */
  endReason: ConversationEndReason | null,
  opts: { summary?: string; now?: Date } = {},
): Promise<EndResult> {
  const [conv, turns] = await Promise.all([
    db
      .from('conversations')
      .select('final_status, end_reason, ended_at, started_at')
      .eq('conversation_id', conversationId),
    db.from('conversation_turns').select('turn_number').eq('conversation_id', conversationId),
  ]);
  fail('load conversation', conv.error);
  fail('load turns', turns.error);
  const row = conv.data?.[0] as
    | { final_status?: string | null; end_reason?: string | null; ended_at?: string | null; started_at?: string | null }
    | undefined;

  if (row?.end_reason) {
    if (opts.summary) {
      const res = await db
        .from('conversations')
        .update({ summary: opts.summary })
        .eq('conversation_id', conversationId);
      fail('save summary', res.error);
    }
    return { applied: false, finalStatus: row.final_status ?? undefined, endReason: row.end_reason as ConversationEndReason };
  }

  const now = opts.now ?? new Date();
  const finalStatus = finalStatusFor(endReason ?? 'user-ended', {
    existing: row?.final_status,
    turnCount: (turns.data ?? []).length,
  });
  const { error } = await db
    .from('conversations')
    .update({
      ended_at: row?.ended_at ?? now.toISOString(),
      final_status: finalStatus,
      end_reason: endReason,
      last_activity_at: now.toISOString(),
      ...(opts.summary ? { summary: opts.summary } : {}),
    })
    .eq('conversation_id', conversationId);
  fail('end conversation', error);

  const startedAt = row?.started_at ? Date.parse(row.started_at) : NaN;
  const durationSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.round((now.getTime() - startedAt) / 1000))
    : undefined;
  const ev = await db.from('conversation_events').insert({
    conversation_id: conversationId,
    event_type: 'session_ended',
    summary: `session ended (${endReason})`,
    metadata: { end_reason: endReason, final_status: finalStatus, duration_seconds: durationSeconds ?? null },
  });
  fail('record session end', ev.error);
  return { applied: true, finalStatus, endReason };
}
