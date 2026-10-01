import { z } from 'zod';
import { pick } from '../utils/logging';
import { ToolError } from '../utils/errors';
import { createEscalationSchema, ESCALATION_CATEGORIES } from '../validation/schemas';
import type { ToolDef } from './types';

export const createEscalation: ToolDef<z.infer<typeof createEscalationSchema>> = {
  name: 'create_escalation',
  purpose: 'Hand the customer to human support',
  summarize: (r) => `escalation ${pick(r.escalation_id)} created`,
  description:
    'Hand the customer to human support. Requires user_name, user_email, category and reason. ' +
    'Optionally link ticket_id and customer_id. Returns the escalation_id.',
  shape: {
    ticket_id: z.string().optional(),
    customer_id: z.string().optional(),
    user_name: z.string().optional(),
    user_email: z.string().optional(),
    category: z
      .string()
      .optional()
      .describe(`one of: ${ESCALATION_CATEGORIES.join(', ')}`),
    reason: z.string().optional(),
    preferred_time: z.string().optional(),
  },
  schema: createEscalationSchema,
  async run(input, store, ctx) {
    if (input.customer_id && !(await store.customerExists(input.customer_id))) {
      throw new ToolError('reference_not_found', 'That customer_id does not exist.');
    }
    if (input.ticket_id && !(await store.ticketExists(input.ticket_id))) {
      throw new ToolError('reference_not_found', 'That ticket_id does not exist.');
    }
    // Tie the record to the call (the row must exist first: conversation_id is a foreign key).
    if (ctx.conversationId) await store.ensureConversation(ctx.conversationId);
    const escalationId = await store.insertEscalation({
      ...input,
      conversation_id: ctx.conversationId,
    });
    return {
      escalation_id: escalationId,
      status: 'open',
      follow_up_summary:
        `Your ${input.category} request has been passed to the RelayPay support team. ` +
        'They will follow up using the contact details you provided.',
    };
  },
};
