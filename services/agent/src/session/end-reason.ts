import type { ConversationEndReason } from './types';

/** Vapi `endedReason` -> why the session stopped. Unknown reasons are not guessed at. */
export function endReasonFromVapi(vapiReason: unknown): ConversationEndReason | undefined {
  if (typeof vapiReason !== 'string') return undefined;
  const r = vapiReason.toLowerCase();
  if (r === 'exceeded-max-duration') return 'session-timeout';
  if (r === 'silence-timed-out') return 'silence-timeout';
  if (r === 'customer-ended-call' || r === 'manually-canceled') return 'user-ended';
  if (r.startsWith('assistant-ended-call') || r === 'assistant-said-end-call-phrase') {
    return 'agent-ended';
  }
  if (/(error|failed|pipeline|transport|unreachable)/.test(r)) return 'error';
  return undefined;
}

/** Coarse outcome for an ended session (Build Plan V2 section 8). A handed-off conversation stays escalated. */
export function finalStatusFor(
  endReason: ConversationEndReason,
  ctx: { existing?: string | null; turnCount: number },
): 'resolved' | 'escalated' | 'abandoned' | 'error' {
  if (ctx.existing === 'escalated') return 'escalated';
  switch (endReason) {
    case 'silence-timeout':
    case 'session-timeout':
    case 'low-confidence':
    case 'limit-reached':
      return 'abandoned';
    case 'error':
      return 'error';
    case 'human-closed':
      return 'resolved';
    default:
      return ctx.turnCount > 0 ? 'resolved' : 'abandoned';
  }
}
