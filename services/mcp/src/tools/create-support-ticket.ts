import { z } from 'zod';
import { pick } from '../utils/logging';
import { ToolError } from '../utils/errors';
import {
  createSupportTicketSchema,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
} from '../validation/schemas';
import type { ToolDef } from './types';

export const createSupportTicket: ToolDef<z.infer<typeof createSupportTicketSchema>> = {
  name: 'create_support_ticket',
  purpose: 'Log an issue for support follow-up',
  summarize: (r) => `ticket ${pick(r.ticket_id)} created`,
  description:
    'Log an issue for support follow-up. Requires category, priority, summary and conversation_id; ' +
    'customer_id is optional. Returns the ticket_id.',
  shape: {
    customer_id: z.string().optional(),
    category: z
      .string()
      .optional()
      .describe(`one of: ${TICKET_CATEGORIES.join(', ')}`),
    priority: z
      .string()
      .optional()
      .describe(`one of: ${TICKET_PRIORITIES.join(', ')}`),
    summary: z.string().optional().describe('short factual summary; no secrets'),
    conversation_id: z.string().optional(),
  },
  schema: createSupportTicketSchema,
  conversationId: (i) => i.conversation_id,
  accountScoped: true,
  async run(rawInput, store, ctx) {
    // A linked conversation's tickets belong to the signed-in customer; a different customer_id is refused.
    if (ctx.identity && rawInput.customer_id && rawInput.customer_id !== ctx.identity.customerId) {
      throw new ToolError('not_authorized', 'That customer_id is not the customer in this conversation.');
    }
    const input = ctx.identity ? { ...rawInput, customer_id: ctx.identity.customerId } : rawInput;
    if (input.customer_id && !(await store.customerExists(input.customer_id))) {
      throw new ToolError('reference_not_found', 'That customer_id does not exist.');
    }
    await store.ensureConversation(input.conversation_id);
    const ticketId = await store.insertTicket(input);
    return { ticket_id: ticketId, status: 'open' };
  },
};
