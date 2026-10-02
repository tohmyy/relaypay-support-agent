import { beforeEach, describe, expect, it } from 'vitest';
import { executeTool, resolveIdentity, tools } from '../../services/mcp/src/tools';
import {
  addCalendarMonth,
  formatCallbackTime,
  validateCallbackTime,
  zonedTimeToUtc,
} from '../../services/mcp/src/validation/callback-window';
import { createFakeStore, type FakeStore } from './fake-store';

const tool = (name: string) => tools.find((t) => t.name === name)!;
const NOW = new Date('2026-10-05T12:00:00Z');

let store: FakeStore;
beforeEach(() => {
  store = createFakeStore();
  // The web app's link has landed: the conversation belongs to CUS-1001 / user-1.
  store.identities.set('vapi_linked', { customer_id: 'CUS-1001', user_id: 'user-1' });
  store.identities.set('vapi_other', { customer_id: 'CUS-2002', user_id: 'user-2' });
  store.identities.set('vapi_unlinked', { customer_id: null, user_id: null });
});

const run = (name: string, input: unknown, ctx: Parameters<typeof executeTool>[3] = {}) =>
  executeTool(tool(name), input, store, ctx);
const linked = { conversationId: 'vapi_linked' };
const soon = () => new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

describe('identity: tools are scoped to the signed-in customer (AC-29.2)', () => {
  it('reads the link from the conversation, never from the model', async () => {
    expect(await resolveIdentity(store, 'vapi_linked')).toEqual({
      customerId: 'CUS-1001',
      userId: 'user-1',
      name: 'Amara Okafor',
      email: 'amara@lagosledger.example',
    });
    expect(await resolveIdentity(store, 'vapi_unlinked')).toBeNull();
    expect(await resolveIdentity(store, 'vapi_missing')).toBeNull();
  });

  it('shows a linked customer their own transaction and payout', async () => {
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' }, linked)).toMatchObject({ found: true });
    expect(await run('lookup_payout', { payout_id: 'PAY-7001' }, linked)).toMatchObject({ found: true });
  });

  it("answers another customer's transaction and payout exactly like a missing one", async () => {
    const other = { conversationId: 'vapi_other' };
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' }, other)).toEqual({ found: false });
    expect(await run('lookup_payout', { payout_id: 'PAY-7001' }, other)).toEqual({ found: false });
    expect(await run('lookup_payout', { transaction_id: 'TXN-9001' }, other)).toEqual({ found: false });
  });

  it("looks up the signed-in customer's own account whatever email or company the model gave", async () => {
    const r = await run('lookup_customer', { company_name: 'Somebody Else Ltd' }, linked);
    expect(r).toMatchObject({ found: true, customer_id: 'CUS-1001' });
    expect(await run('lookup_customer', { customer_id: 'CUS-2002' }, linked)).toEqual({ found: false });
  });

  it('creates a ticket for the signed-in customer and ignores a customer id the model supplies', async () => {
    const r = await run(
      'create_support_ticket',
      { customer_id: 'CUS-2002', category: 'payout', priority: 'low', summary: 's', conversation_id: 'vapi_linked' },
      linked,
    );
    expect(r).toMatchObject({ ticket_id: 'TKT-000001', status: 'open' });
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]).toMatchObject({ customer_id: 'CUS-1001' });
  });

  it("ignores a customer id the model supplies on an escalation: it is the signed-in customer's", async () => {
    const r = await run(
      'create_escalation',
      { customer_id: 'CUS-2002', category: 'account', reason: 'r', contact_preference: 'text_chat' },
      linked,
    );
    expect(r).toMatchObject({ escalation_id: 'ESC-000001' });
    expect(store.escalations[0]).toMatchObject({ customer_id: 'CUS-1001' });
    expect(store.tickets[0]).toMatchObject({ customer_id: 'CUS-1001' });
  });

  it('refuses account tools for an unlinked conversation, whatever the environment (no unscoped fallback)', async () => {
    const ctx = { conversationId: 'vapi_unlinked' };
    for (const [name, input] of [
      ['lookup_customer', { customer_id: 'CUS-1001' }],
      ['lookup_transaction', { transaction_id: 'TXN-9001' }],
      ['lookup_payout', { payout_id: 'PAY-7001' }],
      ['create_support_ticket', { category: 'payout', priority: 'low', summary: 's', conversation_id: 'vapi_unlinked' }],
      ['create_escalation', { category: 'account', reason: 'r', contact_preference: 'text_chat' }],
    ] as const) {
      expect(await run(name, input, ctx)).toMatchObject({ error: { code: 'not_authorized' } });
    }
    // No conversation at all is no identity either.
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' }, {})).toMatchObject({
      error: { code: 'not_authorized' },
    });
    expect(store.calls).toEqual([]);
    expect(store.tickets).toHaveLength(0);
    expect(store.escalations).toHaveLength(0);
  });

  it('lets only an explicit test context run read-only tools unlinked, never tools that create records', async () => {
    const ctx = { conversationId: 'vapi_unlinked', allowUnlinked: true };
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' }, ctx)).toMatchObject({ found: true });
    expect(await run('create_escalation', { category: 'account', reason: 'r', contact_preference: 'text_chat' }, ctx)).toMatchObject({
      error: { code: 'not_authorized' },
    });
    expect(store.escalations).toHaveLength(0);
  });

  it('fails closed when the link cannot be read', async () => {
    store.failWith = new Error('db down');
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' }, linked)).toMatchObject({
      error: { code: 'temporarily_unavailable' },
    });
  });
});

describe('escalation contact details come from the account (AC-41.1)', () => {
  it('stores the account name and email even if the model omits them', async () => {
    await run('create_escalation', { category: 'account', reason: 'r', contact_preference: 'text_chat' }, linked);
    expect(store.escalations[0]).toMatchObject({
      customer_id: 'CUS-1001',
      user_name: 'Amara Okafor',
      user_email: 'amara@lagosledger.example',
    });
  });

  it('ignores a wrong name and email supplied by the model', async () => {
    await run(
      'create_escalation',
      {
        user_name: 'Someone Else',
        user_email: 'someone@else.example',
        category: 'account',
        reason: 'r',
        contact_preference: 'text_chat',
      },
      linked,
    );
    expect(store.escalations[0]).toMatchObject({ user_name: 'Amara Okafor', user_email: 'amara@lagosledger.example' });
  });

  it('never takes contact details from the model when no account is linked: nothing is created (AC-52.2)', async () => {
    const r = await run(
      'create_escalation',
      { user_name: 'A', user_email: 'a@b.co', category: 'account', reason: 'r', contact_preference: 'text_chat' },
      { conversationId: 'vapi_unlinked' },
    );
    expect(r).toMatchObject({ error: { code: 'not_authorized' } });
    expect(JSON.stringify(r)).not.toMatch(/a@b\.co/);
    expect(store.escalations).toHaveLength(0);
    expect(store.tickets).toHaveLength(0);
  });
});

describe('callback date and time (AC-42.*)', () => {
  const callback = (extra: Record<string, unknown>) =>
    run('create_escalation', { category: 'account', reason: 'r', contact_preference: 'callback', ...extra }, linked);

  it('accepts a specific future time and stores the instant, the zone and a readable display', async () => {
    const at = soon();
    const r = await callback({ preferred_at: at, preferred_timezone: 'Africa/Lagos' });
    expect(r).toMatchObject({ escalation_id: 'ESC-000001', status: 'open' });
    expect(JSON.stringify(r)).toContain('They will call you on');
    expect(store.escalations[0]).toMatchObject({
      preferred_at: new Date(at).toISOString(),
      preferred_timezone: 'Africa/Lagos',
      contact_preference: 'callback',
    });
    expect((store.escalations[0] as { preferred_time: string }).preferred_time).toContain('Africa/Lagos');
  });

  it('rejects a time in the past with a message the agent can use to ask again', async () => {
    const r = await callback({ preferred_at: new Date(Date.now() - 3600_000).toISOString() });
    expect(r).toMatchObject({ error: { code: 'invalid_input', message: expect.stringContaining('already passed') } });
    expect(store.escalations).toHaveLength(0);
  });

  it('rejects a time more than one month ahead', async () => {
    const r = await callback({ preferred_at: new Date(Date.now() + 45 * 24 * 3600_000).toISOString() });
    expect(r).toMatchObject({ error: { code: 'invalid_input', message: expect.stringContaining('one month') } });
    expect(store.escalations).toHaveLength(0);
  });

  it('requires a specific time: nothing, or "later", is not accepted', async () => {
    expect(await callback({})).toMatchObject({ error: { code: 'invalid_input' } });
    expect(await callback({ preferred_at: 'later' })).toMatchObject({ error: { code: 'invalid_input' } });
    expect(await callback({ preferred_time: 'whenever' })).toMatchObject({ error: { code: 'invalid_input' } });
    expect(store.escalations).toHaveLength(0);
  });

  it('does not ask a text-chat escalation for a time', async () => {
    await run('create_escalation', { category: 'account', reason: 'r', contact_preference: 'text_chat' }, linked);
    expect((store.escalations[0] as { preferred_at?: string }).preferred_at).toBeUndefined();
  });
});

describe('validateCallbackTime', () => {
  it('treats a time without an offset as wall-clock time in the given zone', () => {
    const r = validateCallbackTime({ preferred_at: '2026-10-08T14:00:00', preferred_timezone: 'Africa/Lagos' }, NOW);
    expect(r.ok && r.at.toISOString()).toBe('2026-10-08T13:00:00.000Z'); // Lagos is UTC+1
    const ny = validateCallbackTime({ preferred_at: '2026-10-08T14:00:00', preferred_timezone: 'America/New_York' }, NOW);
    expect(ny.ok && ny.at.toISOString()).toBe('2026-10-08T18:00:00.000Z'); // EDT, UTC-4
  });

  it('asks for the timezone when the time has no offset and no zone', () => {
    const r = validateCallbackTime({ preferred_at: '2026-10-08T14:00:00' }, NOW);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('timezone') });
  });

  it('rejects an unknown timezone', () => {
    const r = validateCallbackTime({ preferred_at: '2026-10-08T14:00:00', preferred_timezone: 'Mars/Olympus' }, NOW);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('IANA') });
  });

  it('allows a 2 minute skew into the past, no more', () => {
    expect(validateCallbackTime({ preferred_at: new Date(NOW.getTime() - 90_000).toISOString() }, NOW).ok).toBe(true);
    expect(validateCallbackTime({ preferred_at: new Date(NOW.getTime() - 150_000).toISOString() }, NOW).ok).toBe(false);
  });

  it('draws the one-month line on the customer wall clock, to the minute', () => {
    const tz = 'Africa/Lagos';
    const limit = addCalendarMonth(NOW, tz); // 13:00 in Lagos on 5 Nov, which is 12:00 UTC (no daylight saving there)
    expect(limit.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    expect(validateCallbackTime({ preferred_at: limit.toISOString(), preferred_timezone: tz }, NOW).ok).toBe(true);
    expect(validateCallbackTime({ preferred_at: new Date(limit.getTime() + 60_000).toISOString(), preferred_timezone: tz }, NOW).ok).toBe(false);
  });

  it('clamps month ends (31 Jan + 1 month = 28 Feb) and crosses year ends', () => {
    expect(addCalendarMonth(new Date('2026-01-31T10:00:00Z'), 'UTC').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addCalendarMonth(new Date('2026-12-15T10:00:00Z'), 'UTC').toISOString()).toBe('2027-01-15T10:00:00.000Z');
  });

  it('handles a daylight-saving change between now and the limit', () => {
    // New York leaves daylight time on 2026-11-01: 12:00 EDT now is 12:00 EST a month on.
    const limit = addCalendarMonth(new Date('2026-10-15T16:00:00Z'), 'America/New_York'); // 12:00 EDT
    expect(limit.toISOString()).toBe('2026-11-15T17:00:00.000Z'); // 12:00 EST
  });

  it('converts wall-clock time across a daylight-saving boundary', () => {
    const t = zonedTimeToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 0, second: 0 }, 'America/New_York');
    expect(t.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('formats a readable time with its zone', () => {
    expect(formatCallbackTime(new Date('2026-10-08T13:00:00Z'), 'Africa/Lagos')).toMatch(/8 Oct 2026.*2:00.*pm.*Africa\/Lagos/i);
  });
});
