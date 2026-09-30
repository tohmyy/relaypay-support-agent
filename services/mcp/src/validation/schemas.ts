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
export const ESCALATION_CATEGORIES = ['compliance', 'account', 'dispute', 'payment', 'other'] as const;

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

export const createSupportTicketSchema = z.strictObject({
  customer_id: id.optional(),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  summary: text(1000),
  conversation_id: id,
});

export const createEscalationSchema = z.strictObject({
  ticket_id: id.optional(),
  customer_id: id.optional(),
  user_name: text(120),
  user_email: z.email().max(254),
  category: z.enum(ESCALATION_CATEGORIES),
  reason: text(1000),
  preferred_time: text(100).optional(),
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
