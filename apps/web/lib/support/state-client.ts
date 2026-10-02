import { NEUTRAL_STATE, type PublicConversationState } from '../conversation-state';

/** Reads the customer-safe call snapshot. Returns null on any failure so the UI keeps its last state. */
export async function fetchConversationState(conversationId: string): Promise<PublicConversationState | null> {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/state`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PublicConversationState;
    if (typeof data !== 'object' || data === null || typeof data.ended !== 'boolean') return null;
    // Fields added later (end reason, limits) default, so an older or partial response still parses.
    return { ...NEUTRAL_STATE, ...data };
  } catch {
    return null;
  }
}
