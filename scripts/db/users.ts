/**
 * The demo accounts, as plain data. Kept apart from the script that writes them so what gets created is easy to read
 * and test. No password lives here: the seed script hashes one supplied through the environment.
 */
export interface DemoAccount {
  email: string;
  role: 'customer' | 'support_agent' | 'support_admin';
  customerId: string | null;
  displayName: string;
  title: string | null;
}

export const STAFF_ACCOUNTS: DemoAccount[] = [
  { email: 'sarah@relaypay.example', role: 'support_agent', customerId: null, displayName: 'Sarah Adeyemi', title: 'Support Agent' },
  { email: 'david@relaypay.example', role: 'support_agent', customerId: null, displayName: 'David Karanja', title: 'Support Agent' },
  { email: 'admin@relaypay.example', role: 'support_admin', customerId: null, displayName: 'Support Admin', title: 'Support Lead' },
];

type CustomerSeedRow = Record<string, string | null | undefined>;

/** One customer account per seeded customer, signing in with the contact email already in the data. */
export function buildDemoAccounts(customers: CustomerSeedRow[]): DemoAccount[] {
  const customerAccounts: DemoAccount[] = customers
    .filter((c) => c.customer_id && c.contact_email)
    .map((c) => ({
      email: (c.contact_email as string).trim().toLowerCase(),
      role: 'customer',
      customerId: c.customer_id as string,
      displayName: c.contact_name ?? c.company_name ?? (c.customer_id as string),
      title: null,
    }));
  return [...customerAccounts, ...STAFF_ACCOUNTS];
}
