import { z } from 'zod';
import { pick } from '../utils/logging';
import { lookupTransactionSchema } from '../validation/schemas';
import type { ToolDef } from './types';

export const lookupTransaction: ToolDef<z.infer<typeof lookupTransactionSchema>> = {
  name: 'lookup_transaction',
  purpose: 'Look up a transaction to report its status',
  summarize: (r) =>
    r.found === true ? `found ${pick(r.transaction_id)}, status ${pick(r.status)}` : 'not found',
  description:
    'Look up a transaction by transaction_id (required; TXN- followed by digits). Returns status, amount, ' +
    'currency, estimated arrival and a support summary. Translate the result into customer-friendly language.',
  shape: { transaction_id: z.string().optional().describe('required; TXN- followed by digits') },
  schema: lookupTransactionSchema,
  accountScoped: true,
  async run(input, store, ctx) {
    // The customer predicate is part of the query, so someone else's transaction looks exactly like a missing one.
    const t = await store.getTransaction(input.transaction_id, ctx.identity?.customerId);
    if (!t) return { found: false };
    return {
      found: true,
      transaction_id: t.transaction_id,
      customer_id: t.customer_id,
      type: t.transaction_type,
      status: t.status,
      amount: t.amount === null ? null : Number(t.amount),
      currency: t.currency,
      estimated_arrival: t.estimated_arrival,
      support_summary: t.support_summary,
    };
  },
};
