import type { Role } from './token';

/**
 * Who may see what. Pure, so every rule is a table-driven test and the same rules serve pages, route handlers and
 * server actions. The proxy only does a rough cookie check; these rules are what actually decide.
 */
export type Area = 'customer' | 'staff';

export interface AccessUser {
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
}

/**
 * Customers: only their own conversations. Support agents: conversations that are still open or were escalated
 * (their working queue). Admins: all. A conversation not linked to any customer is never a customer's, so only staff
 * can open it.
 */
export function canAccessConversation(user: AccessUser, conversation: ConversationAccessRow): boolean {
  if (user.role === 'support_admin') return true;
  if (user.role === 'support_agent') {
    return conversation.ended_at === null || conversation.final_status === 'escalated';
  }
  return Boolean(user.customerId) && conversation.customer_id === user.customerId;
}
