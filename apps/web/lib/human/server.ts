import 'server-only';
import { SUPPORT_MODES, type SupportMode } from '@/lib/conversation-state';
import { restInsert, restPatch, restSelect } from '@/lib/supabase.server';
import type { CurrentUser } from '@/lib/auth/dal';

/** Shared by the customer and staff routes. Each helper is one conditional write, so a race has exactly one winner. */
export const modeOf = (mode: string | null | undefined): SupportMode =>
  SUPPORT_MODES.find((m) => m === mode) ?? 'ai';

const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
/** Matches a conversation only while it is with a specialist and still open. */
const openHuman = (id: string) => `conversation_id=${eq(id)}&support_mode=eq.human&ended_at=is.null`;

export async function addSystemMessage(conversationId: string, body: string): Promise<void> {
  await restInsert('conversation_turns', { conversation_id: conversationId, sender: 'system', body });
}

/**
 * Bumps activity on an open human conversation and says whether it was still open. Used as the gate before storing
 * a message, so nothing is written to a conversation that was closed a moment ago.
 */
export async function touchOpenHuman(
  conversationId: string,
  extra: Record<string, unknown> = {},
  extraFilter = '',
): Promise<boolean> {
  const rows = await restPatch(
    'conversations',
    `${openHuman(conversationId)}${extraFilter}`,
    { last_activity_at: new Date().toISOString(), ...extra },
  );
  return rows.length > 0;
}

export type ClaimOutcome = 'claimed' | 'already-mine' | 'taken' | 'not-open';

/**
 * Takes an unassigned conversation. Conditional on nobody having it, so two staff members clicking at once give one
 * winner. The customer sees a short "joined" note.
 */
export async function claimConversation(
  user: Pick<CurrentUser, 'id' | 'displayName' | 'title'>,
  conversationId: string,
  current: { assigned_staff_id: string | null; support_mode: string | null; ended_at: string | null },
): Promise<ClaimOutcome> {
  if (current.support_mode !== 'human' || current.ended_at) return 'not-open';
  if (current.assigned_staff_id === user.id) return 'already-mine';
  const won = await restPatch('conversations', `${openHuman(conversationId)}&assigned_staff_id=is.null`, {
    assigned_staff_id: user.id,
    last_activity_at: new Date().toISOString(),
  });
  if (won.length === 0) {
    // Lost the race, or it was closed: look again to say which.
    const [now] = await restSelect<{ assigned_staff_id: string | null; support_mode: string | null; ended_at: string | null }>(
      'conversations',
      `select=assigned_staff_id,support_mode,ended_at&conversation_id=${eq(conversationId)}&limit=1`,
    );
    if (!now || now.support_mode !== 'human' || now.ended_at) return 'not-open';
    return now.assigned_staff_id === user.id ? 'already-mine' : 'taken';
  }
  await addSystemMessage(
    conversationId,
    `${user.displayName}${user.title ? `, ${user.title},` : ''} has joined the conversation.`,
  );
  return 'claimed';
}
