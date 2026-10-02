import { canAccessConversation, type AccessUser } from '@/lib/auth/access';
import { hasUnread } from '@/lib/human/messages';
import { formatDate } from './format';

/** What the staff queue reads. Customer fields are limited to company and contact; notes and KYC are never selected. */
export const QUEUE_CONVERSATION_COLUMNS =
  'conversation_id,customer_id,started_at,ended_at,final_status,end_reason,support_mode,assigned_staff_id,' +
  'handoff_at,staff_last_read_at,last_customer_message_at';

export interface QueueConversationRow {
  conversation_id: string;
  customer_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  final_status: string | null;
  end_reason: string | null;
  support_mode?: string | null;
  assigned_staff_id?: string | null;
  handoff_at?: string | null;
  staff_last_read_at?: string | null;
  last_customer_message_at?: string | null;
}

export interface QueueTicketRow {
  ticket_id: string | null;
  conversation_id: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
}

export interface QueueCustomerRow {
  customer_id: string;
  company_name: string | null;
  contact_name: string | null;
}

export type QueueState = 'open' | 'waiting' | 'in-progress' | 'escalated' | 'resolved';

export interface QueueItem {
  conversationId: string;
  state: QueueState;
  statusLabel: string;
  customer: string;
  issue: string;
  ticket: string | null;
  started: string;
  /** When a conversation with a specialist began waiting for someone (ISO); null otherwise. */
  waitingSince: string | null;
  /** The customer has written something this member of staff has not seen yet. */
  unread: boolean;
  assignedToMe: boolean;
}

export interface StaffQueue {
  counts: { open: number; waiting: number; inProgress: number; escalated: number; resolvedToday: number };
  items: QueueItem[];
}

const ISSUE_LABELS: Record<string, string> = {
  payment: 'Payment question',
  payout: 'Payout question',
  invoice: 'Invoice question',
  account: 'Account question',
  compliance: 'Compliance review',
  technical: 'Technical problem',
  other: 'General question',
};

export const issueLabel = (category: string | null | undefined) => ISSUE_LABELS[category ?? ''] ?? 'General question';

const STATE_LABELS: Record<QueueState, string> = {
  open: 'Open',
  waiting: 'Waiting for staff',
  'in-progress': 'In progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

/**
 * With a specialist (`support_mode = human`): waiting until someone takes it, then in progress. Otherwise the call is
 * still going (open), or it was escalated for a callback without moving to a specialist (escalated: Mode A, which
 * stays in the queue after the call ends), or it is over (resolved).
 */
export function queueState(
  c: Pick<QueueConversationRow, 'ended_at' | 'final_status' | 'support_mode' | 'assigned_staff_id'>,
): QueueState {
  if (c.support_mode === 'human' && !c.ended_at) return c.assigned_staff_id ? 'in-progress' : 'waiting';
  if (c.final_status === 'escalated' && c.support_mode !== 'human' && c.support_mode !== 'ended') return 'escalated';
  if (!c.ended_at) return 'open';
  return 'resolved';
}

const sameUtcDay = (value: string | null, now: Date) => {
  const t = Date.parse(value ?? '');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
};

export function buildStaffQueue(
  input: { conversations: QueueConversationRow[]; tickets: QueueTicketRow[]; customers: QueueCustomerRow[] },
  now: Date = new Date(),
  viewerId?: string,
): StaffQueue {
  const customers = new Map(input.customers.map((c) => [c.customer_id, c]));
  const tickets = new Map<string, QueueTicketRow>();
  for (const t of input.tickets) if (t.conversation_id && !tickets.has(t.conversation_id)) tickets.set(t.conversation_id, t);

  const items = input.conversations
    .map((c): QueueItem => {
      const state = queueState(c);
      const customer = c.customer_id ? customers.get(c.customer_id) : undefined;
      const ticket = tickets.get(c.conversation_id);
      return {
        conversationId: c.conversation_id,
        state,
        statusLabel: STATE_LABELS[state],
        customer: customer?.company_name ?? (c.customer_id ? c.customer_id : 'Unknown caller'),
        issue: issueLabel(ticket?.category),
        ticket: ticket?.ticket_id ?? null,
        started: formatDate(c.started_at),
        waitingSince: state === 'waiting' ? (c.handoff_at ?? c.started_at ?? null) : null,
        unread:
          (state === 'waiting' || state === 'in-progress') && hasUnread(c.last_customer_message_at, c.staff_last_read_at),
        assignedToMe: Boolean(viewerId) && c.assigned_staff_id === viewerId,
      };
    })
    .sort((a, b) => rank(a.state) - rank(b.state));

  const counts = { open: 0, waiting: 0, inProgress: 0, escalated: 0, resolvedToday: 0 };
  for (const c of input.conversations) {
    const state = queueState(c);
    if (state === 'open') counts.open++;
    else if (state === 'waiting') counts.waiting++;
    else if (state === 'in-progress') counts.inProgress++;
    else if (state === 'escalated') counts.escalated++;
    else if (sameUtcDay(c.ended_at, now)) counts.resolvedToday++;
  }
  return { counts, items };
}

const rank = (s: QueueState) => ({ waiting: 0, escalated: 1, 'in-progress': 2, open: 3, resolved: 4 })[s];

/**
 * The queue as one signed-in member of staff may see it: the counts cover every conversation, the list only the ones
 * they may open (so every row's link works). One place for the rule, used by the live queue route and the pages.
 */
export function buildStaffQueueFor(
  user: AccessUser,
  input: { conversations: QueueConversationRow[]; tickets: QueueTicketRow[]; customers: QueueCustomerRow[] },
  now: Date = new Date(),
): StaffQueue & { waitingCount: number; unreadCount: number } {
  const all = buildStaffQueue(input, now, user.id);
  const visible = new Set(
    input.conversations
      .filter((c) =>
        canAccessConversation(user, {
          customer_id: c.customer_id,
          ended_at: c.ended_at,
          final_status: c.final_status,
          support_mode: c.support_mode ?? null,
          assigned_staff_id: c.assigned_staff_id ?? null,
        }),
      )
      .map((c) => c.conversation_id),
  );
  const items = all.items.filter((i) => visible.has(i.conversationId));
  return {
    counts: all.counts,
    items,
    waitingCount: all.counts.waiting,
    unreadCount: items.filter((i) => i.unread).length,
  };
}

/** The working queue: an agent does not see finished conversations there, an admin does. */
export function workingQueue(items: QueueItem[], role: AccessUser['role']): QueueItem[] {
  return role === 'support_admin' ? items : items.filter((i) => i.state !== 'resolved');
}
