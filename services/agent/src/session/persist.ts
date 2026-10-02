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
    .update({ support_mode: 'human', last_activity_at: now, handoff_at: now })
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

/** After a call ends the customer has this long to resume it (Build Plan V3, V3.14, concern 16). */
export const RESUME_GRACE_MS = 30_000;

/**
 * Ends from which a conversation may be resumed: the customer's own choice, the assistant's, silence, or a fault. Not a
 * session time limit (the six minutes are counted from the start, so nothing would be left), a budget, noise, a
 * specialist closing it, or a hand-over to staff.
 */
export const RESUMABLE_END_REASONS: readonly ConversationEndReason[] = ['user-ended', 'agent-ended', 'silence-timeout', 'error'];

export type ReopenResult =
  | { reopened: true }
  | { reopened: false; reason: 'not-found' | 'not-owner' | 'not-ended' | 'expired' | 'not-resumable' | 'human' | 'raced' };

/**
 * Reopens an ended conversation: only for the customer who owns it, only if it ended no more than `RESUME_GRACE_MS` ago
 * and for a resumable reason. Clears `ended_at` and `end_reason` (and the outcome, except that an escalation stays
 * escalated), conditional on it still being in the state that was read, so two reopens or a reopen racing a new end cannot
 * both win. The caller (the customer's page) then starts a new call that continues the same conversation.
 */
export async function reopenConversation(
  db: SupabaseClient,
  conversationId: string,
  opts: { customerId: string | null; now?: Date; graceMs?: number },
): Promise<ReopenResult> {
  const found = await db
    .from('conversations')
    .select('customer_id, ended_at, end_reason, final_status, support_mode')
    .eq('conversation_id', conversationId);
  fail('load conversation', found.error);
  const row = found.data?.[0] as
    | { customer_id?: string | null; ended_at?: string | null; end_reason?: string | null; final_status?: string | null; support_mode?: string | null }
    | undefined;
  if (!row) return { reopened: false, reason: 'not-found' };
  if (!opts.customerId || row.customer_id !== opts.customerId) return { reopened: false, reason: 'not-owner' };
  if ((row.support_mode ?? 'ai') !== 'ai') return { reopened: false, reason: 'human' };
  if (!row.ended_at) return { reopened: false, reason: 'not-ended' };
  if (!RESUMABLE_END_REASONS.includes(row.end_reason as ConversationEndReason)) return { reopened: false, reason: 'not-resumable' };

  const now = opts.now ?? new Date();
  const previousReason = row.end_reason;
  const age = now.getTime() - Date.parse(row.ended_at);
  if (!Number.isFinite(age) || age > (opts.graceMs ?? RESUME_GRACE_MS)) return { reopened: false, reason: 'expired' };

  const res = await db
    .from('conversations')
    .update({
      ended_at: null,
      end_reason: null,
      final_status: row.final_status === 'escalated' ? 'escalated' : null,
      last_activity_at: now.toISOString(),
    })
    .eq('conversation_id', conversationId)
    .eq('end_reason', row.end_reason as string)
    .eq('ended_at', row.ended_at);
  fail('reopen conversation', res.error);

  // The update is conditional; confirm it took before claiming it did.
  const check = await db.from('conversations').select('ended_at').eq('conversation_id', conversationId);
  fail('confirm reopen', check.error);
  if ((check.data?.[0] as { ended_at?: string | null } | undefined)?.ended_at) return { reopened: false, reason: 'raced' };

  const ev = await db.from('conversation_events').insert({
    conversation_id: conversationId,
    event_type: 'session_resumed',
    summary: 'conversation resumed within the grace period',
    metadata: { previous_end_reason: previousReason, seconds_after_end: Math.round(age / 1000) },
  });
  fail('record resume', ev.error);
  return { reopened: true };
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
