import type { Role } from './token';

/**
 * Who may see what. Pure, so every rule is a table-driven test and the same rules serve pages, route handlers and
 * server actions. The proxy only does a rough cookie check; these rules are what actually decide.
 */
export type Area = 'customer' | 'staff';

export interface AccessUser {
  /** app_users.id; needed for the staff rules about who a conversation is assigned to. */
  id?: string;
  role: Role;
  /** customers.customer_id, for customers only */
  customerId?: string | null;
}

export function isStaff(role: Role): boolean {
  return role === 'support_agent' || role === 'support_admin';
}

export function areaFor(role: Role): Area {
  return isStaff(role) ? 'staff' : 'customer';
}

/** Where a signed-in user lands, and where they are sent when they open an area that is not theirs. */
export function homeFor(role: Role): string {
  return isStaff(role) ? '/staff' : '/dashboard';
}

export function canEnterArea(role: Role, area: Area): boolean {
  return areaFor(role) === area;
}

export interface ConversationAccessRow {
  customer_id: string | null;
  ended_at: string | null;
  final_status: string | null;
  /** `ai`, `human` or `ended`; rows from before the handoff work have none and count as `ai`. */
  support_mode?: string | null;
  assigned_staff_id?: string | null;
}

/**
 * Customers: only their own conversations. Support agents: conversations that are still open, were escalated, or are
 * with a specialist (their working queue). Admins: all. A conversation not linked to any customer is never a customer's, so only staff
 * can open it.
 */
export function canAccessConversation(user: AccessUser, conversation: ConversationAccessRow): boolean {
  if (user.role === 'support_admin') return true;
  if (user.role === 'support_agent') {
    return (
      conversation.ended_at === null ||
      conversation.final_status === 'escalated' ||
      conversation.support_mode === 'human'
    );
  }
  return Boolean(user.customerId) && conversation.customer_id === user.customerId;
}

/** A conversation with a specialist that nobody has closed. */
export function isOpenHuman(conversation: Pick<ConversationAccessRow, 'support_mode' | 'ended_at'>): boolean {
  return conversation.support_mode === 'human' && !conversation.ended_at;
}

/** The customer may write only in their own conversation while it is with a specialist. */
export function canCustomerSend(user: AccessUser, conversation: ConversationAccessRow): boolean {
  return (
    user.role === 'customer' &&
    Boolean(user.customerId) &&
    conversation.customer_id === user.customerId &&
    isOpenHuman(conversation)
  );
}

/**
 * Staff may write while the conversation is with a specialist. If someone else has taken it, only that person or an
 * admin may; an unassigned conversation can be taken by writing to it.
 */
export function canStaffReply(user: AccessUser, conversation: ConversationAccessRow): boolean {
  if (!isStaff(user.role) || !isOpenHuman(conversation)) return false;
  const assignee = conversation.assigned_staff_id ?? null;
  return user.role === 'support_admin' || assignee === null || assignee === (user.id ?? null);
}
