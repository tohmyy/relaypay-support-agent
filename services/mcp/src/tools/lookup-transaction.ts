import { z } from 'zod';
import { lookupTransactionSchema } from '../validation/schemas';
import type { ToolDef } from './types';

export const lookupTransaction: ToolDef<z.infer<typeof lookupTransactionSchema>> = {
  name: 'lookup_transaction',
  description:
    'Look up a transaction by transaction_id (required, e.g. TXN-9001). Returns status, amount, ' +
    'currency, estimated arrival and a support summary. Translate the result into customer-friendly language.',
  shape: { transaction_id: z.string().optional().describe('required, e.g. TXN-9001') },
  schema: lookupTransactionSchema,
  async run(input, store) {
    const t = await store.getTransaction(input.transaction_id);
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
