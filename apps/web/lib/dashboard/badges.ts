import type { StatusTone } from './format';

/**
 * One badge vocabulary for every surface that shows a conversation, an escalation or a ticket: the staff queue and
 * archive, the escalation inbox and detail, and the customer's dashboard and history. A status always has the same tone
 * wherever it appears. Staff and customers read different words for the same outcome (customers never see "escalated"),
 * so labels depend on the audience and tones do not, apart from the one noted below.
 */
export interface Badge {
  label: string;
  tone: StatusTone;
}

export type BadgeAudience = 'staff' | 'customer';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The state of a conversation as the staff queue groups it (see `queueState` in staff.ts). */
export type QueueStateName = 'open' | 'waiting' | 'in-progress' | 'escalated' | 'resolved';

export const QUEUE_STATE_BADGES: Record<QueueStateName, Badge> = {
  open: { label: 'Open', tone: 'neutral' },
  waiting: { label: 'Waiting for staff', tone: 'warning' },
  'in-progress': { label: 'In progress', tone: 'neutral' },
  escalated: { label: 'Escalated', tone: 'danger' },
  // The AI conversation's outcome (the customer confirmed they were done), not that any ticket was closed.
  resolved: { label: 'Conversation resolved', tone: 'success' },
};

export const queueStateBadge = (state: QueueStateName): Badge => QUEUE_STATE_BADGES[state];

/** What the conversation ended as (`conversations.final_status`). */
const OUTCOME_BADGES: Record<string, Badge> = {
  resolved: { label: 'Resolved', tone: 'success' },
  escalated: { label: 'Escalated', tone: 'danger' },
  clarification: { label: 'Needed more detail', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'neutral' },
  abandoned: { label: 'Abandoned', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};

/** What a customer reads for an outcome. Only the outcomes they can reach; anything else is a plain "Ended". */
const CUSTOMER_OUTCOME_BADGES: Record<string, Badge> = {
  resolved: { label: 'Resolved', tone: 'success' },
  // Passing a conversation to the team is not an alarm to the person who asked for it, so it is not red here.
  escalated: { label: 'Passed to our team', tone: 'neutral' },
};

export function conversationOutcomeBadge(
  c: { ended_at: string | null; final_status: string | null },
  audience: BadgeAudience = 'staff',
): Badge {
  if (!c.ended_at) return { label: 'In progress', tone: 'neutral' };
  const status = (c.final_status ?? '').trim().toLowerCase();
  if (audience === 'customer') return CUSTOMER_OUTCOME_BADGES[status] ?? { label: 'Ended', tone: 'neutral' };
  return OUTCOME_BADGES[status] ?? { label: 'Ended', tone: 'neutral' };
}

/** Escalation and ticket status share one vocabulary: they move together (claim, release, close). */
const WORK_STATUS_BADGES: Record<string, Badge> = {
  open: { label: 'Open', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'success' },
};

export function workStatusBadge(status: string | null | undefined): Badge {
  const key = (status ?? '').trim().toLowerCase();
  return WORK_STATUS_BADGES[key] ?? { label: key ? capitalize(key.replace(/_/g, ' ')) : 'Unknown', tone: 'neutral' };
}

const CHANNEL_BADGES: Record<string, Badge> = {
  voice: { label: 'Voice', tone: 'neutral' },
  text: { label: 'Text', tone: 'neutral' },
};

export function channelBadge(channel: string | null | undefined): Badge {
  const key = (channel ?? '').trim().toLowerCase();
  return CHANNEL_BADGES[key] ?? { label: key ? capitalize(key) : 'Unknown', tone: 'neutral' };
}
