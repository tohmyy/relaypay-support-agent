import { formatDate } from './format';

/** What the staff queue reads. Customer fields are limited to company and contact; notes and KYC are never selected. */
export const QUEUE_CONVERSATION_COLUMNS = 'conversation_id,customer_id,started_at,ended_at,final_status,end_reason';

export interface QueueConversationRow {
  conversation_id: string;
  customer_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  final_status: string | null;
  end_reason: string | null;
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

export type QueueState = 'open' | 'waiting' | 'escalated' | 'resolved';

export interface QueueItem {
  conversationId: string;
  state: QueueState;
  statusLabel: string;
  customer: string;
  issue: string;
  ticket: string | null;
  started: string;
}

export interface StaffQueue {
  counts: { open: number; waiting: number; escalated: number; resolvedToday: number };
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
  escalated: 'Escalated',
  resolved: 'Resolved',
};

/**
 * Open = still in progress. Escalated = handed to staff (the call may have ended) and not yet resolved. Waiting for
 * staff = escalated and the call has ended, so a person needs to pick it up. Assignment and closing arrive with the
 * staff messaging work, so for now "waiting" is the ended-and-escalated case.
 */
export function queueState(c: Pick<QueueConversationRow, 'ended_at' | 'final_status'>): QueueState {
  if (c.final_status === 'escalated') return c.ended_at ? 'waiting' : 'escalated';
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
      };
    })
    .sort((a, b) => rank(a.state) - rank(b.state));

  const counts = { open: 0, waiting: 0, escalated: 0, resolvedToday: 0 };
  for (const c of input.conversations) {
    const state = queueState(c);
    if (state === 'open') counts.open++;
    else if (state === 'waiting') counts.waiting++;
    else if (state === 'escalated') counts.escalated++;
    else if (sameUtcDay(c.ended_at, now)) counts.resolvedToday++;
  }
  return { counts, items };
}

const rank = (s: QueueState) => ({ escalated: 0, waiting: 1, open: 2, resolved: 3 })[s];
