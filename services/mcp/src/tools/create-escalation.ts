import { z } from 'zod';
import { pick } from '../utils/logging';
import { ToolError } from '../utils/errors';
import { validateCallbackTime } from '../validation/callback-window';
import {
  CONTACT_PREFERENCES,
  createEscalationSchema,
  ESCALATION_CATEGORIES,
  TICKET_CATEGORIES,
} from '../validation/schemas';
import type { ToolDef } from './types';

/** Ticket category for an escalation raised without a ticket (the escalation categories are a different list). */
const TICKET_CATEGORY_FOR = {
  compliance: 'compliance',
  account: 'account',
  dispute: 'other',
  payment: 'payment',
  other: 'other',
} as const satisfies Record<(typeof ESCALATION_CATEGORIES)[number], (typeof TICKET_CATEGORIES)[number]>;

export const createEscalation: ToolDef<z.infer<typeof createEscalationSchema>> = {
  name: 'create_escalation',
  purpose: 'Hand the customer to human support',
  summarize: (r) => `escalation ${pick(r.escalation_id)} created`,
  description:
    'Hand the customer to human support. Requires category and reason. The customer, their name and email, and the ' +
    'support ticket all come from the signed-in conversation automatically: do not ask for them and do not pass them. ' +
    'A ticket is created together with the escalation (or the one already logged for this conversation is used), and ' +
    'asking again returns the same ones. contact_preference is text_chat (the customer chose a live text chat ' +
    'with a specialist) or callback (the default). For callback, preferred_at is REQUIRED: a specific date and time the customer ' +
    'agreed to, as ISO 8601 (for example 2026-10-08T14:00:00), plus preferred_timezone (IANA name such as ' +
    'Africa/Lagos) unless preferred_at carries a UTC offset. The time must be in the future and within one month; ' +
    'if the tool rejects it, ask the customer for another time. Returns the ticket_id and escalation_id.',
  shape: {
    category: z
      .string()
      .optional()
      .describe(`one of: ${ESCALATION_CATEGORIES.join(', ')}`),
    reason: z.string().optional(),
    preferred_time: z.string().optional().describe('how the customer said it, for display only'),
    preferred_at: z.string().optional().describe('callback instant, ISO 8601; required for callback'),
    preferred_timezone: z.string().optional().describe('IANA timezone, for example Africa/Lagos'),
    contact_preference: z
      .string()
      .optional()
      .describe(`one of: ${CONTACT_PREFERENCES.join(', ')}`),
  },
  schema: createEscalationSchema,
  accountScoped: true,
  mutates: true,
  async run(input, store, ctx) {
    // The customer and the contact details are the signed-in account's, nothing the model supplied. executeTool has
    // already refused an unlinked conversation or an account without a name or email; this is the same check for a
    // caller that bypasses it.
    const identity = ctx.identity;
    if (!identity?.name || !identity.email || !ctx.conversationId) {
      throw new ToolError(
        'not_authorized',
        'This conversation is not linked to a signed-in customer account with a name and email, so no escalation was created.',
      );
    }

    // Anything that is not a live text chat is a callback, and a callback needs a real, specific, in-window time (no
    // "later", no "no preference"): the model proposes it and this decides.
    let callback: { at: string; timezone?: string; display: string } | undefined;
    if (input.contact_preference !== 'text_chat') {
      const check = validateCallbackTime({
        preferred_at: input.preferred_at,
        preferred_timezone: input.preferred_timezone,
      });
      if (!check.ok) throw new ToolError('invalid_input', check.message);
      callback = {
        at: check.at.toISOString(),
        timezone: check.timezone ?? undefined,
        display: check.display,
      };
    }

    // Ticket and escalation are created together, or the pair already open for this conversation comes back. The
    // conversation row is created first when missing (conversation_id is a foreign key).
    await store.ensureConversation(ctx.conversationId);
    const created = await store.createTicketAndEscalation({
      conversation_id: ctx.conversationId,
      customer_id: identity.customerId,
      ticket_category: TICKET_CATEGORY_FOR[input.category],
      ticket_priority: 'normal',
      ticket_summary: input.reason,
      category: input.category,
      reason: input.reason,
      user_name: identity.name,
      user_email: identity.email,
      preferred_time: callback?.display ?? input.preferred_time,
      preferred_at: callback?.at,
      preferred_timezone: callback?.timezone,
      contact_preference: input.contact_preference,
    });
    return {
      ticket_id: created.ticket_id,
      escalation_id: created.escalation_id,
      status: 'open',
      ...(callback ? { callback_at: callback.display } : {}),
      follow_up_summary:
        input.contact_preference === 'text_chat'
          ? `Your ${input.category} request has been passed to the RelayPay support team. ` +
            'A support specialist will continue with you by text chat.'
          : callback
            ? `Your ${input.category} request has been passed to the RelayPay support team. ` +
              `They will call you on ${callback.display}, using the contact details on your account.`
            : `Your ${input.category} request has been passed to the RelayPay support team. ` +
              'They will follow up using the contact details on your account.',
    };
  },
};
