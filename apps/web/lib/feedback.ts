/** Optional star ratings (docs/BUILD-PLAN-V3.md V3.9). Pure rules, shared by the route and the tests. */
export const FEEDBACK_STAGES = ['ai', 'human'] as const;
export type FeedbackStage = (typeof FEEDBACK_STAGES)[number];
export const MAX_FEEDBACK_COMMENT = 1000;

export interface FeedbackInput {
  stage: FeedbackStage;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
}

export type ParsedFeedback = { ok: true; value: FeedbackInput } | { ok: false; error: 'invalid-stage' | 'invalid-rating' | 'invalid-comment' };

export function parseFeedback(body: unknown): ParsedFeedback {
  const b = (body && typeof body === 'object' ? body : {}) as { stage?: unknown; rating?: unknown; comment?: unknown };
  if (!FEEDBACK_STAGES.includes(b.stage as FeedbackStage)) return { ok: false, error: 'invalid-stage' };
  if (typeof b.rating !== 'number' || !Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) {
    return { ok: false, error: 'invalid-rating' };
  }
  let comment: string | null = null;
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== 'string') return { ok: false, error: 'invalid-comment' };
    // Control characters other than newlines and tabs are dropped, like a chat message.
    const clean = b.comment.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (clean.length > MAX_FEEDBACK_COMMENT) return { ok: false, error: 'invalid-comment' };
    comment = clean || null;
  }
  return { ok: true, value: { stage: b.stage as FeedbackStage, rating: b.rating as FeedbackInput['rating'], comment } };
}

/**
 * When each stage may be rated. The AI stage once the voice (or typed) leg is over: the conversation ended, or it moved to
 * a specialist (the call is hung up then). The human stage only once the specialist chat has been closed.
 */
export function stageReady(stage: FeedbackStage, row: { ended_at: string | null; support_mode: string | null }): boolean {
  if (stage === 'human') return row.support_mode === 'ended';
  return Boolean(row.ended_at) || row.support_mode === 'human' || row.support_mode === 'ended';
}
