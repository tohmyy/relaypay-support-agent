import { canAccessConversation, type AccessUser } from '@/lib/auth/access';
import { hasUnread } from '@/lib/human/messages';
import { QUEUE_STATE_BADGES, type QueueStateName } from './badges';
import { formatDate } from './format';

/** What the staff queue reads. Customer fields are limited to company and contact; notes and KYC are never selected. */
export const QUEUE_CONVERSATION_COLUMNS =
  'conversation_id,customer_id,started_at,ended_at,final_status,end_reason,support_mode,assigned_staff_id,' +
  'handoff_at,staff_last_read_at,last_customer_message_at';

/** The staff archive adds the channel the conversation happened on. */
export const ARCHIVE_CONVERSATION_COLUMNS = `${QUEUE_CONVERSATION_COLUMNS},channel`;

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
  channel?: string | null;
}

export interface QueueTicketRow {
  ticket_id: string | null;
  conversation_id: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  /** Only read where a page shows it (the detail and accept card), not by the queue. */
  summary?: string | null;
  created_at?: string | null;
}

export interface QueueCustomerRow {
  customer_id: string;
  company_name: string | null;
  contact_name: string | null;
}

/** A turn's recorded model cost; null when the turn was not billed (fixed replies). */
export interface QueueCostRow {
  conversation_id: string;
  cost_usd: number | string | null;
}

/**
 * Estimated model cost per conversation: the sum of its turns' `cost_usd` (a turn without one counts as 0). Estimates of
 * model usage only, never provider call cost and never a bill.
 */
export function sumCosts(rows: QueueCostRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.cost_usd ?? 0);
    out.set(r.conversation_id, (out.get(r.conversation_id) ?? 0) + (Number.isFinite(n) ? n : 0));
  }
  return out;
}

/** Midnight UTC at the start of `now`'s UTC calendar day. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** "$0.0421": two to four decimals, because one conversation costs cents or fractions of one. */
export function formatUsd(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : USD.format(n);
}

export type QueueState = QueueStateName;

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
  /** Estimated model cost of this conversation (USD); null when costs could not be read. */
  estimatedCostUsd?: number | null;
}

export interface StaffQueue {
  counts: { open: number; waiting: number; inProgress: number; escalated: number; resolvedToday: number };
  items: QueueItem[];
  /** Estimated model cost of the conversations started today (UTC calendar day); null when it could not be read. */
  todayCostUsd?: number | null;
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

export interface QueueInput {
  conversations: QueueConversationRow[];
  tickets: QueueTicketRow[];
  customers: QueueCustomerRow[];
  /** Turn costs for these conversations; absent when they could not be read. */
  costs?: QueueCostRow[];
  /** Today's (UTC) total when it was computed over more than the listed conversations. */
  todayCostUsd?: number | null;
}

export function buildStaffQueue(
  input: QueueInput,
  now: Date = new Date(),
  viewerId?: string,
): StaffQueue {
  const customers = new Map(input.customers.map((c) => [c.customer_id, c]));
  const costs = input.costs ? sumCosts(input.costs) : null;
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
        statusLabel: QUEUE_STATE_BADGES[state].label,
        customer: customer?.company_name ?? (c.customer_id ? c.customer_id : 'Unknown caller'),
        issue: issueLabel(ticket?.category),
        ticket: ticket?.ticket_id ?? null,
        started: formatDate(c.started_at),
        waitingSince: state === 'waiting' ? (c.handoff_at ?? c.started_at ?? null) : null,
        unread:
          (state === 'waiting' || state === 'in-progress') && hasUnread(c.last_customer_message_at, c.staff_last_read_at),
        assignedToMe: Boolean(viewerId) && c.assigned_staff_id === viewerId,
        estimatedCostUsd: costs ? (costs.get(c.conversation_id) ?? 0) : null,
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
  const dayStart = startOfUtcDay(now).getTime();
  const today =
    input.todayCostUsd !== undefined
      ? input.todayCostUsd
      : costs
        ? input.conversations
            .filter((c) => Date.parse(c.started_at ?? '') >= dayStart)
            .reduce((sum, c) => sum + (costs.get(c.conversation_id) ?? 0), 0)
        : null;
  return { counts, items, todayCostUsd: today };
}

const rank = (s: QueueState) => ({ waiting: 0, escalated: 1, 'in-progress': 2, open: 3, resolved: 4 })[s];

/**
 * The queue as one signed-in member of staff may see it: the counts cover every conversation, the list only the ones
 * they may open (so every row's link works). One place for the rule, used by the live queue route and the pages.
 */
export function buildStaffQueueFor(
  user: AccessUser,
  input: QueueInput,
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
    todayCostUsd: all.todayCostUsd,
    waitingCount: all.counts.waiting,
    unreadCount: items.filter((i) => i.unread).length,
  };
}

/** The working queue: an agent does not see finished conversations there, an admin does. */
export function workingQueue(items: QueueItem[], role: AccessUser['role']): QueueItem[] {
  return role === 'support_admin' ? items : items.filter((i) => i.state !== 'resolved');
}
