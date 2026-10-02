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
    'Log an issue for support follow-up. Requires category, priority, summary and conversation_id. The ticket belongs to ' +
    "the signed-in customer automatically: do not pass a customer id. Asking again with the same summary returns the " +
    'same ticket. Returns the ticket_id.',
  shape: {
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
  mutates: true,
  async run(input, store, ctx) {
    // The signed-in account is the customer, and the request's conversation (not one typed by the model) is the call.
    const identity = ctx.identity;
    const conversationId = ctx.conversationId ?? input.conversation_id;
    if (!identity || !conversationId) throw new ToolError('not_authorized', 'This conversation is not linked to a signed-in customer account.');
    await store.ensureConversation(conversationId);
    const ticket = await store.insertTicket({
      customer_id: identity.customerId,
      category: input.category,
      priority: input.priority,
      summary: input.summary,
      conversation_id: conversationId,
    });
    return { ticket_id: ticket.ticket_id, status: ticket.status };
  },
};
