import { z } from 'zod';
import { pick } from '../utils/logging';
import { lookupPayoutSchema } from '../validation/schemas';
import type { ToolDef } from './types';

export const lookupPayout: ToolDef<z.infer<typeof lookupPayoutSchema>> = {
  name: 'lookup_payout',
  purpose: 'Look up a payout to report its status',
  summarize: (r) =>
    r.found === true ? `found ${pick(r.payout_id)}, status ${pick(r.status)}` : 'not found',
  description:
    'Look up a payout by payout_id or transaction_id (at least one). Returns status, schedule, ' +
    'failure reason and a support summary. A compliance review status means escalation rules apply.',
  shape: {
    payout_id: z.string().optional().describe('e.g. PAY-7002'),
    transaction_id: z.string().optional().describe('e.g. TXN-9003'),
  },
  schema: lookupPayoutSchema,
  accountScoped: true,
  async run(input, store, ctx) {
    // The customer predicate is part of both queries, so someone else's payout looks exactly like a missing one.
    const customerId = ctx.identity?.customerId;
    const p = await store.findPayout(input, customerId);
    if (!p) return { found: false };
    const txn = p.transaction_id ? await store.getTransaction(p.transaction_id, customerId) : null;
    return {
      found: true,
      payout_id: p.payout_id,
      transaction_id: p.transaction_id,
      customer_id: p.customer_id,
      status: p.status,
      scheduled_for: p.scheduled_for,
      failure_reason: p.failure_reason,
      support_summary: txn?.support_summary ?? null,
    };
  },
};
