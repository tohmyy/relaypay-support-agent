import type { SupabaseClient } from '@supabase/supabase-js';
import type { HistoryTurn } from './prompt';
import type { AnswerType } from './schema';

export const HISTORY_LIMIT = 8;

export interface LoadedHistory {
  turns: HistoryTurn[];
  escalationRaised: boolean;
  nextTurnNumber: number;
}

function fail(action: string, error: { message: string } | null) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export async function ensureConversation(db: SupabaseClient, conversationId: string) {
  const { error } = await db
    .from('conversations')
    .upsert(
      { conversation_id: conversationId, channel: 'voice' },
      { onConflict: 'conversation_id', ignoreDuplicates: true },
    );
  fail('ensure conversation', error);
}

/** Reads the last turns of a call, oldest first, and whether a handoff already happened. */
export async function loadHistory(
  db: SupabaseClient,
  conversationId: string,
): Promise<LoadedHistory> {
  const { data, error } = await db
    .from('conversation_turns')
    .select('turn_number, user_transcript, assistant_response')
    .eq('conversation_id', conversationId)
    .order('turn_number', { ascending: false });
  fail('load history', error);
  const rows = data ?? [];
  // "Raised" means a handoff record was actually created, not just that escalation was the right path.
  const conv = await db
    .from('conversations')
    .select('final_status')
    .eq('conversation_id', conversationId);
  fail('load conversation', conv.error);
  return {
    turns: rows
      .slice(0, HISTORY_LIMIT)
      .reverse()
      .map((r) => ({ user: r.user_transcript ?? '', assistant: r.assistant_response ?? '' })),
    escalationRaised: (conv.data ?? []).some((c) => c.final_status === 'escalated'),
    nextTurnNumber: (rows[0]?.turn_number ?? 0) + 1,
  };
}

export async function saveTurn(
  db: SupabaseClient,
  t: {
    conversationId: string;
    turnNumber: number;
    userMessage: string;
    response: string;
    answerType: AnswerType;
    confidenceNote?: string;
    /** True only when create_escalation actually succeeded this turn. */
    escalationCreated?: boolean;
    /** Wall-clock time to produce the reply, and the SDK's cost estimate for it. */
    latencyMs?: number;
    costUsd?: number;
  },
) {
  const { error } = await db.from('conversation_turns').insert({
    conversation_id: t.conversationId,
    turn_number: t.turnNumber,
    user_transcript: t.userMessage,
    assistant_response: t.response,
    answer_type: t.answerType,
    confidence_note: t.confidenceNote ?? null,
    latency_ms: t.latencyMs ?? null,
    cost_usd: t.costUsd ?? null,
  });
  fail('save turn', error);
  const activity = new Date().toISOString();
  if (t.escalationCreated) {
    const res = await db
      .from('conversations')
      .update({ final_status: 'escalated', last_activity_at: activity })
      .eq('conversation_id', t.conversationId);
    fail('mark conversation escalated', res.error);
  } else {
    // Best effort and off the reply path: a failed activity stamp must not fail the turn.
    void Promise.resolve(
      db
        .from('conversations')
        .update({ last_activity_at: activity })
        .eq('conversation_id', t.conversationId),
    ).catch(() => undefined);
  }
}
