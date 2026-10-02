import { conversationOutcomeBadge, type Badge } from './badges';
import { formatDate, formatMoney, statusLabel, statusTone, typeLabel, type StatusTone } from './format';

/**
 * What the customer pages are allowed to show. The columns below are the whole list: `support_notes`, `kyc_status`,
 * `support_summary` and `failure_reason` are internal and are deliberately not selected, mapped or typed anywhere here.
 */
export const TRANSACTION_COLUMNS = 'transaction_id,transaction_type,amount,currency,status,created_at,estimated_arrival,destination_country';
export const PAYOUT_COLUMNS = 'payout_id,recipient_name,amount,currency,status,scheduled_for';
export const CONVERSATION_COLUMNS = 'conversation_id,started_at,ended_at,final_status,end_reason';

export interface TransactionRow {
  transaction_id: string;
  transaction_type: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  created_at: string | null;
  estimated_arrival: string | null;
  destination_country: string | null;
}

export interface PayoutRow {
  payout_id: string;
  recipient_name: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  scheduled_for: string | null;
}

export interface ConversationRow {
  conversation_id: string;
  started_at: string | null;
  ended_at: string | null;
  final_status: string | null;
  end_reason: string | null;
}

export interface MoneyLine {
  reference: string;
  title: string;
  amount: string;
  status: string;
  tone: StatusTone;
  date: string;
}

export interface OverviewCard {
  count: number;
  /** One line about the most recent item, or null when there is none. */
  latest: string | null;
}

export interface ConversationSummary {
  id: string;
  started: string;
  outcome: string;
  /** The same outcome as a badge (label and tone), so every list shows it the same way. */
  badge: Badge;
}

export interface CustomerOverview {
  payments: OverviewCard;
  payouts: OverviewCard;
  invoices: OverviewCard;
  recent: MoneyLine[];
  conversations: ConversationSummary[];
}

const byDateDesc = <T,>(date: (row: T) => string | null) => (a: T, b: T) =>
  (Date.parse(date(b) ?? '') || 0) - (Date.parse(date(a) ?? '') || 0);

export const isInvoice = (t: TransactionRow) => (t.transaction_type ?? '').trim().toLowerCase() === 'invoice payment';

export function paymentLine(t: TransactionRow): MoneyLine {
  return {
    reference: t.transaction_id,
    title: typeLabel(t.transaction_type),
    amount: formatMoney(t.amount, t.currency),
    status: statusLabel(t.status),
    tone: statusTone(t.status),
    date: formatDate(t.created_at),
  };
}

export function payoutLine(p: PayoutRow): MoneyLine {
  return {
    reference: p.payout_id,
    title: p.recipient_name ? `To ${p.recipient_name}` : 'Payout',
    amount: formatMoney(p.amount, p.currency),
    status: statusLabel(p.status),
    tone: statusTone(p.status),
    date: formatDate(p.scheduled_for),
  };
}

export function conversationOutcome(c: Pick<ConversationRow, 'ended_at' | 'final_status'>): string {
  return conversationOutcomeBadge(c, 'customer').label;
}

function card<T>(rows: T[], describe: (row: T) => string): OverviewCard {
  return { count: rows.length, latest: rows.length ? describe(rows[0]) : null };
}

/** Counts and the latest item per area, plus a short merged activity list, from the customer's own rows. */
export function buildCustomerOverview(input: {
  transactions: TransactionRow[];
  payouts: PayoutRow[];
  conversations: ConversationRow[];
}): CustomerOverview {
  const transactions = [...input.transactions].sort(byDateDesc((t) => t.created_at));
  const payouts = [...input.payouts].sort(byDateDesc((p) => p.scheduled_for));
  const invoices = transactions.filter(isInvoice);
  const describe = (l: MoneyLine) => `${l.title} · ${l.amount} · ${l.status}`;

  const recent = [
    ...transactions.map((t) => ({ at: t.created_at, line: paymentLine(t) })),
    ...payouts.map((p) => ({ at: p.scheduled_for, line: payoutLine(p) })),
  ]
    .sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0))
    .slice(0, 5)
    .map((r) => r.line);

  return {
    payments: card(transactions, (t) => describe(paymentLine(t))),
    payouts: card(payouts, (p) => describe(payoutLine(p))),
    invoices: card(invoices, (t) => describe(paymentLine(t))),
    recent,
    conversations: [...input.conversations]
      .sort(byDateDesc((c) => c.started_at))
      .slice(0, 5)
      .map((c) => ({
        id: c.conversation_id,
        started: formatDate(c.started_at),
        outcome: conversationOutcome(c),
        badge: conversationOutcomeBadge(c, 'customer'),
      })),
  };
}
