import { z } from 'zod';
import { pick } from '../utils/logging';
import { lookupCustomerSchema } from '../validation/schemas';
import type { ToolDef } from './types';

export const lookupCustomer: ToolDef<z.infer<typeof lookupCustomerSchema>> = {
  name: 'lookup_customer',
  purpose: 'Look up a customer account to answer an account question',
  summarize: (r) =>
    r.found === true
      ? `found ${pick(r.customer_id)}, account ${pick(r.account_status)}`
      : 'not found',
  description:
    'Find a RelayPay customer account by customer_id, email or company_name (at least one). ' +
    'Returns account status and internal support notes. Never read support_notes aloud.',
  shape: {
    customer_id: z.string().optional().describe('e.g. CUS-1001'),
    email: z.string().optional(),
    company_name: z.string().optional(),
  },
  schema: lookupCustomerSchema,
  async run(input, store) {
    const c = await store.findCustomer(input);
    if (!c) return { found: false };
    return {
      found: true,
      customer_id: c.customer_id,
      company_name: c.company_name,
      plan: c.plan,
      account_status: c.account_status,
      kyc_status: c.kyc_status,
      support_notes: c.support_notes,
    };
  },
};
