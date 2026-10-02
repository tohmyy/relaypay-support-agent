import { NEUTRAL_STATE, type PublicConversationState } from '../conversation-state';
import { failFor, withRetry } from '../retry';
import type { DurableTranscriptTurn } from '../transcript';

/**
 * Reads the customer-safe call snapshot. Returns null on any failure so the UI keeps its last state. A transient
 * failure (network error, 502/503/504) is tried once more automatically (docs/BUILD-PLAN-V3.md V3.2); the next poll
 * after that is a fresh attempt.
 */
export async function fetchConversationState(conversationId: string): Promise<PublicConversationState | null> {
  try {
    return await withRetry(
      async () => {
        const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/state`, {
          cache: 'no-store',
        });
        if (!res.ok) failFor(res.status);
        const data = (await res.json()) as PublicConversationState;
        if (typeof data !== 'object' || data === null || typeof data.ended !== 'boolean') return null;
        // Fields added later (end reason, limits) default, so an older or partial response still parses.
        return { ...NEUTRAL_STATE, ...data };
      },
      { operation: 'state-poll' },
    );
  } catch {
    return null;
  }
}

export interface TranscriptPage {
  turns: DurableTranscriptTurn[];
  cursor: string | null;
}

export async function fetchConversationTranscript(
  conversationId: string,
  cursor: string | null,
): Promise<TranscriptPage | null> {
  try {
    const query = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
    const res = await fetch(`/api/support/conversations/${encodeURIComponent(conversationId)}/transcript${query}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<TranscriptPage>;
    if (!Array.isArray(data.turns)) return null;
    return { turns: data.turns as DurableTranscriptTurn[], cursor: typeof data.cursor === 'string' ? data.cursor : null };
  } catch {
    return null;
  }
}
