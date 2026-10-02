import { z } from 'zod';
import { pick } from '../utils/logging';
import { ToolError } from '../utils/errors';
import { validateCallbackTime } from '../validation/callback-window';
import { CONTACT_PREFERENCES, createEscalationSchema, ESCALATION_CATEGORIES } from '../validation/schemas';
import type { ToolDef } from './types';

export const createEscalation: ToolDef<z.infer<typeof createEscalationSchema>> = {
  name: 'create_escalation',
  purpose: 'Hand the customer to human support',
  summarize: (r) => `escalation ${pick(r.escalation_id)} created`,
  description:
    'Hand the customer to human support. Requires category and reason. The customer\'s name and email come from their ' +
    'signed-in account automatically: do not ask for them. ' +
    'Optionally link ticket_id. contact_preference is text_chat (the customer chose a live text chat ' +
    'with a specialist) or callback (the default). For callback, preferred_at is REQUIRED: a specific date and time the customer ' +
    'agreed to, as ISO 8601 (for example 2026-10-08T14:00:00), plus preferred_timezone (IANA name such as ' +
    'Africa/Lagos) unless preferred_at carries a UTC offset. The time must be in the future and within one month; ' +
    'if the tool rejects it, ask the customer for another time. Returns the escalation_id.',
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
  async run(input, store, ctx) {
    const identity = ctx.identity;
    // The signed-in account is the customer. A different customer_id from the model is refused, not trusted.
    if (identity && input.customer_id && input.customer_id !== identity.customerId) {
      throw new ToolError('not_authorized', 'That customer_id is not the customer in this conversation.');
    }
    const customerId = identity?.customerId ?? input.customer_id;

    // Contact details: the account's, whatever the model supplied. Only an unlinked conversation (development, or a
    // deployment that does not require sign-in) falls back to what was given.
    const userName = identity?.name ?? input.user_name;
    const userEmail = identity?.email ?? input.user_email;
    if (!userName || !userEmail) {
      throw new ToolError(
        'invalid_input',
        identity
          ? 'The signed-in account has no name or email on file, so a specialist cannot be given contact details.'
          : 'user_name and user_email are required when the customer is not signed in.',
      );
    }

    if (customerId && !(await store.customerExists(customerId))) {
      throw new ToolError('reference_not_found', 'That customer_id does not exist.');
    }
    if (input.ticket_id && !(await store.ticketExists(input.ticket_id))) {
      throw new ToolError('reference_not_found', 'That ticket_id does not exist.');
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

    // Tie the record to the call (the row must exist first: conversation_id is a foreign key).
    if (ctx.conversationId) await store.ensureConversation(ctx.conversationId);
    const escalationId = await store.insertEscalation({
      ticket_id: input.ticket_id,
      customer_id: customerId,
      user_name: userName,
      user_email: userEmail,
      category: input.category,
      reason: input.reason,
      preferred_time: callback?.display ?? input.preferred_time,
      preferred_at: callback?.at,
      preferred_timezone: callback?.timezone,
      contact_preference: input.contact_preference,
      conversation_id: ctx.conversationId,
    });
    return {
      escalation_id: escalationId,
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
