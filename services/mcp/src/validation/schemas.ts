import { z } from 'zod';

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);

export const TICKET_CATEGORIES = [
  'payment',
  'payout',
  'invoice',
  'account',
  'compliance',
  'technical',
  'other',
] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const ESCALATION_CATEGORIES = [
  'compliance',
  'account',
  'dispute',
  'payment',
  'other',
] as const;

export const lookupCustomerSchema = z
  .strictObject({
    customer_id: id.optional(),
    email: text(254).optional(),
    company_name: text(120).optional(),
  })
  .refine((v) => v.customer_id || v.email || v.company_name, {
    message: 'Provide at least one of customer_id, email or company_name',
  });

export const lookupTransactionSchema = z.strictObject({ transaction_id: id });

export const lookupPayoutSchema = z
  .strictObject({ payout_id: id.optional(), transaction_id: id.optional() })
  .refine((v) => v.payout_id || v.transaction_id, {
    message: 'Provide payout_id or transaction_id',
  });

/**
 * The customer, their contact details and any ticket come from the linked account and the conversation, never from the
 * model. A model that still sends `customer_id`, `user_name`, `user_email` or `ticket_id` is not refused: the fields
 * are dropped here (a plain object strips unknown keys) and nothing downstream can read them.
 */
export const createSupportTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  summary: text(1000),
  conversation_id: id.optional(),
});

export const CONTACT_PREFERENCES = ['text_chat', 'callback'] as const;

export const createEscalationSchema = z.object({
  category: z.enum(ESCALATION_CATEGORIES),
  reason: text(1000),
  /** Free-text display of the callback time; the validated instant is `preferred_at`. */
  preferred_time: text(100).optional(),
  /** Callback instant, ISO 8601. Validated against the 1 calendar month window (validation/callback-window.ts). */
  preferred_at: text(40).optional(),
  /** IANA timezone of the customer, such as Africa/Lagos. */
  preferred_timezone: text(64).optional(),
  /** How the customer chose to be helped: a live text chat with a specialist, or a callback. */
  contact_preference: z.enum(CONTACT_PREFERENCES).optional(),
});

export const logConversationEventSchema = z.strictObject({
  conversation_id: id,
  event_type: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/),
  summary: text(500),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
