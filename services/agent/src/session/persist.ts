import type { SupabaseClient } from '@supabase/supabase-js';
import { finalStatusFor } from './end-reason';
import type { ConversationEndReason } from './types';

export interface HandoffResult {
  /** False when the conversation was already handed over, had ended, or does not exist: the first handoff wins. */
  applied: boolean;
}

/**
 * Moves a conversation from the AI to staff: `support_mode` becomes `human`, a system message records it for both
 * sides, and an event is logged. Nothing is ended: the conversation stays open until staff close it. First-wins and
 * conditional on the mode still being `ai`, so a repeat (or a racing end) changes nothing.
 */
export async function startHandoff(
  db: SupabaseClient,
  conversationId: string,
  opts: { reason: string; notice: string; now?: Date },
): Promise<HandoffResult> {
  const found = await db
    .from('conversations')
    .select('support_mode, ended_at')
    .eq('conversation_id', conversationId);
  fail('load conversation', found.error);
  const row = found.data?.[0] as { support_mode?: string | null; ended_at?: string | null } | undefined;
  if (!row || row.ended_at || (row.support_mode ?? 'ai') !== 'ai') return { applied: false };

  const now = (opts.now ?? new Date()).toISOString();
  const moved = await db
    .from('conversations')
    .update({ support_mode: 'human', last_activity_at: now })
    .eq('conversation_id', conversationId)
    .eq('support_mode', 'ai');
  fail('start handoff', moved.error);

  const note = await db.from('conversation_turns').insert({
    conversation_id: conversationId,
    sender: 'system',
    body: opts.notice,
  });
  fail('record handoff notice', note.error);
  const ev = await db.from('conversation_events').insert({
    conversation_id: conversationId,
    event_type: 'human_handoff',
    summary: `moved to a support specialist (${opts.reason})`,
    metadata: { reason: opts.reason },
  });
  fail('record handoff', ev.error);
  return { applied: true };
}

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
      .select('final_status, end_reason, ended_at, started_at, support_mode')
      .eq('conversation_id', conversationId),
    db.from('conversation_turns').select('turn_number').eq('conversation_id', conversationId),
  ]);
  fail('load conversation', conv.error);
  fail('load turns', turns.error);
  const row = conv.data?.[0] as
    | {
        final_status?: string | null;
        end_reason?: string | null;
        ended_at?: string | null;
        started_at?: string | null;
        support_mode?: string | null;
      }
    | undefined;

  // A conversation handed to staff stays open after the voice call is hung up: the end-of-call report that follows
  // must not close it. Only staff closing it (the web app) ends a human conversation.
  if (row?.support_mode === 'human') {
    return { applied: false, finalStatus: row.final_status ?? undefined, endReason: null };
  }

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
