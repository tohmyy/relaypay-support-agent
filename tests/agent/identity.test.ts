import { describe, expect, it } from 'vitest';
import { IdentitySource } from '../../services/agent/src/identity';
import { buildPrompt, formatAuthenticated } from '../../services/agent/src/prompt';
import { readFileSync } from 'node:fs';
import { fakeDb } from './fake-db';

const SYSTEM = readFileSync(new URL('../../services/agent/prompts/system.md', import.meta.url), 'utf8');

describe('IdentitySource', () => {
  const seed = () =>
    fakeDb({
      app_users: [{ id: 'user-1', display_name: 'Amara Okafor', email: 'amara@lagosledger.example' }],
      customers: [{ customer_id: 'CUS-1001', company_name: 'LagosLedger' }],
    });

  it('returns nothing for an unlinked conversation, and does not query', async () => {
    const f = seed();
    expect(await new IdentitySource(f.db).get(null, null)).toBeNull();
    expect(f.queries).toEqual([]);
  });

  it('reads the account name, email and company', async () => {
    const f = seed();
    expect(await new IdentitySource(f.db).get('CUS-1001', 'user-1')).toEqual({
      customerId: 'CUS-1001',
      displayName: 'Amara Okafor',
      email: 'amara@lagosledger.example',
      companyName: 'LagosLedger',
    });
  });

  it('remembers a found customer for a few minutes', async () => {
    const f = seed();
    let now = 1_000;
    const source = new IdentitySource(f.db, () => now);
    await source.get('CUS-1001', 'user-1');
    const queried = f.queries.length;
    now += 60_000;
    await source.get('CUS-1001', 'user-1');
    expect(f.queries.length).toBe(queried);
    now += 5 * 60_000;
    await source.get('CUS-1001', 'user-1');
    expect(f.queries.length).toBeGreaterThan(queried);
  });

  it('still tells the model the customer id when the details cannot be read, and tries again next time', async () => {
    const f = seed();
    f.failNext('app_users');
    const source = new IdentitySource(f.db);
    expect(await source.get('CUS-1001', 'user-1')).toEqual({ customerId: 'CUS-1001', displayName: null, email: null, companyName: null });
    expect(await source.get('CUS-1001', 'user-1')).toMatchObject({ displayName: 'Amara Okafor' });
  });
});

describe('<authenticated_customer> block and the system prompt', () => {
  it('formats only what is known and escapes markup', () => {
    expect(formatAuthenticated({ customerId: 'CUS-1', displayName: 'A <b>', email: null, companyName: null })).toBe(
      '<authenticated_customer>\ncustomer_id: CUS-1\ndisplay_name: A &lt;b&gt;\n</authenticated_customer>',
    );
  });

  it('is part of the built prompt only when a customer is linked', () => {
    const base = { conversationId: 'c', userMessage: 'hi', history: [], knowledge: [], escalationRaised: false };
    expect(buildPrompt(base)).not.toContain('authenticated_customer');
    expect(buildPrompt({ ...base, authenticated: { customerId: 'CUS-1', displayName: null, email: null, companyName: null } })).toContain(
      'customer_id: CUS-1',
    );
  });

  // AC-41.3 / AC-15.* / AC-18: the rules the model is held to live in prompts/system.md.
  it('tells the model to use the signed-in customer and never to ask for a name or email (AC-41.3)', () => {
    expect(SYSTEM).toContain('`authenticated_customer`');
    expect(SYSTEM).toMatch(/Never ask for the customer's name or email/);
    expect(SYSTEM).not.toContain('signed_in_customer');
    expect(SYSTEM).not.toMatch(/Collect the customer's full name, email/);
  });

  it('requires a specific callback date and time, in the future and within a month (AC-42)', () => {
    expect(SYSTEM).toMatch(/specific day and time/);
    expect(SYSTEM).toMatch(/"later", "anytime", "whenever" or "no preference" is not enough/);
    expect(SYSTEM).toMatch(/no more than one month ahead/);
    expect(SYSTEM).toContain('preferred_at');
    expect(SYSTEM).toContain('preferred_timezone');
    expect(SYSTEM).toContain('current_time');
  });

  it('puts diagnosis before escalation, with explicit exceptions (AC-15.1, AC-15.2)', () => {
    expect(SYSTEM).toMatch(/Diagnose before you escalate/);
    const ask = SYSTEM.indexOf('**Ask for what is missing.**');
    const look = SYSTEM.indexOf('**Look it up.**');
    const summarize = SYSTEM.indexOf('**Summarize what you found.**');
    const escalate = SYSTEM.indexOf('**Then escalate if a person is still needed**');
    expect([ask, look, summarize, escalate].every((i) => i > 0)).toBe(true);
    expect(ask).toBeLessThan(look);
    expect(look).toBeLessThan(summarize);
    expect(summarize).toBeLessThan(escalate);
    expect(SYSTEM).toMatch(/frustrated is not enough, on its own, to skip these steps/);
    expect(SYSTEM).toMatch(/Escalate straight away/);
  });

  it('explains a lookup that finds nothing without revealing another account\'s record', () => {
    expect(SYSTEM).toMatch(/## When a lookup finds nothing/);
    expect(SYSTEM).toMatch(/no transaction \(or payout\) with that reference on their account/);
    expect(SYSTEM).toMatch(/Never say or hint that the record exists under another account/);
    expect(SYSTEM).toMatch(/Do not create a ticket on a first miss/);
  });

  it('declines questions that have nothing to do with RelayPay and says what it can help with', () => {
    expect(SYSTEM).toMatch(/# Questions outside RelayPay/);
    expect(SYSTEM).toMatch(/Do not search, call any tool, create a ticket, escalate or offer a specialist, and never say you are having trouble/);
    expect(SYSTEM).toMatch(/payments, payouts, invoices, transactions, their account and verification/);
  });

  it('says the platform ends the session and the model never closes the case (AC-34, AC-35)', () => {
    expect(SYSTEM).toMatch(/You never end the call, close the case or mark anything resolved yourself/);
    expect(SYSTEM).toMatch(/platform ends the session/);
  });
});

