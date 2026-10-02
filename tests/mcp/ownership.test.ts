import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTool, tools } from '../../services/mcp/src/tools';
import { createFakeStore, type FakeStore } from './fake-store';

// Build Plan V4, Window 6: financial lookups and callback identity come from the linked account only (AC-45.1, AC-52.1,
// AC-52.2), and a ticket and its escalation are created together or not at all (AC-43.2).

const tool = (name: string) => tools.find((t) => t.name === name)!;
const A = { conversationId: 'conv_a' }; // CUS-1001 / user-1
const B = { conversationId: 'conv_b' }; // CUS-2002 / user-2

let store: FakeStore;
beforeEach(() => {
  store = createFakeStore();
  store.identities.set('conv_a', { customer_id: 'CUS-1001', user_id: 'user-1' });
  store.identities.set('conv_b', { customer_id: 'CUS-2002', user_id: 'user-2' });
  // A linked customer whose account row has no email, one whose account row is missing, and an unlinked call.
  store.identities.set('conv_blank', { customer_id: 'CUS-1001', user_id: 'user-blank' });
  store.identities.set('conv_noaccount', { customer_id: 'CUS-1001', user_id: null });
  store.identities.set('conv_unlinked', { customer_id: null, user_id: null });
});

const run = (name: string, input: unknown, ctx: Parameters<typeof executeTool>[3]) =>
  executeTool(tool(name), input, store, ctx);
const soon = () => new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

describe('cross-account lookups (AC-45.1)', () => {
  it("answers another customer's transaction exactly like one that does not exist", async () => {
    const theirs = await run('lookup_transaction', { transaction_id: 'TXN-9002' }, A);
    const missing = await run('lookup_transaction', { transaction_id: 'TXN-0000' }, A);
    expect(theirs).toEqual({ found: false });
    expect(theirs).toEqual(missing);
    // ...and the owner still sees it.
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9002' }, B)).toMatchObject({
      found: true,
      transaction_id: 'TXN-9002',
    });
  });

  it("answers another customer's payout, by payout id or by transaction id, like a missing one", async () => {
    for (const input of [{ payout_id: 'PAY-7009' }, { transaction_id: 'TXN-9002' }]) {
      expect(await run('lookup_payout', input, A)).toEqual({ found: false });
    }
    expect(await run('lookup_payout', { payout_id: 'PAY-7009' }, B)).toMatchObject({ found: true, payout_id: 'PAY-7009' });
    expect(await run('lookup_payout', { payout_id: 'PAY-0000' }, A)).toEqual({ found: false });
  });

  it('puts the signed-in customer into the query itself, not only into a check afterwards', async () => {
    await run('lookup_transaction', { transaction_id: 'TXN-9002' }, A);
    await run('lookup_payout', { payout_id: 'PAY-7009' }, A);
    expect(store.calls).toEqual(['getTransaction:CUS-1001', 'findPayout:CUS-1001']);
  });

  it('logs both outcomes the same way, so the log does not reveal which one it was', async () => {
    await run('lookup_transaction', { transaction_id: 'TXN-9002' }, A);
    await run('lookup_transaction', { transaction_id: 'TXN-0000' }, A);
    expect(store.toolCalls.map((c) => [c.status, c.result_summary])).toEqual([
      ['not_found', 'not found'],
      ['not_found', 'not found'],
    ]);
  });
});

describe('spoofed identity never wins (AC-52.1)', () => {
  it('takes the conversation from the request, not from a conversation id the model typed', async () => {
    const r = await run(
      'create_support_ticket',
      { category: 'payout', priority: 'low', summary: 's', conversation_id: 'conv_b', customer_id: 'CUS-2002' },
      A,
    );
    expect(r).toMatchObject({ ticket_id: 'TKT-000001' });
    expect(store.tickets).toEqual([expect.objectContaining({ conversation_id: 'conv_a', customer_id: 'CUS-1001' })]);
    expect(store.conversations.has('conv_b')).toBe(false);
  });

  it('stores the account name, email and customer whatever the arguments say', async () => {
    await run(
      'create_escalation',
      {
        customer_id: 'CUS-2002',
        user_name: 'Mallory',
        user_email: 'mallory@evil.example',
        ticket_id: 'TKT-999999',
        category: 'account',
        reason: 'r',
        contact_preference: 'text_chat',
      },
      A,
    );
    expect(store.escalations).toEqual([
      expect.objectContaining({
        conversation_id: 'conv_a',
        customer_id: 'CUS-1001',
        user_name: 'Amara Okafor',
        user_email: 'amara@lagosledger.example',
        ticket_id: 'TKT-000001',
      }),
    ]);
    expect(JSON.stringify(store.escalations)).not.toMatch(/Mallory|evil\.example|TKT-999999|CUS-2002/);
  });

  it('does not advertise customer, contact or ticket arguments to the model', () => {
    for (const name of ['create_escalation', 'create_support_ticket']) {
      const keys = Object.keys(tool(name).shape);
      for (const gone of ['customer_id', 'user_name', 'user_email', 'ticket_id']) expect(keys).not.toContain(gone);
    }
    expect(tool('create_escalation').description).toMatch(/do not ask for them and do not pass them/);
  });
});

describe('missing or incomplete account fails closed (AC-52.2)', () => {
  const escalate = (ctx: Parameters<typeof executeTool>[3]) =>
    run('create_escalation', { category: 'account', reason: 'r', contact_preference: 'text_chat' }, ctx);

  it('creates no ticket and no escalation without a linked account', async () => {
    for (const ctx of [{ conversationId: 'conv_unlinked' }, { conversationId: 'conv_missing' }, {}]) {
      expect(await escalate(ctx)).toMatchObject({ error: { code: 'not_authorized' } });
    }
    expect(store.tickets).toHaveLength(0);
    expect(store.escalations).toHaveLength(0);
    expect(store.calls).not.toContain('createTicketAndEscalation');
  });

  it('points the customer to their account settings instead of asking for a name or email', async () => {
    for (const conversationId of ['conv_blank', 'conv_noaccount']) {
      const r = await escalate({ conversationId });
      expect(r).toMatchObject({ error: { code: 'profile_incomplete' } });
      const message = (r as { error: { message: string } }).error.message;
      expect(message).toMatch(/account settings/);
      expect(message).toMatch(/Do not ask the customer for them here/);
    }
    expect(store.tickets).toHaveLength(0);
    expect(store.escalations).toHaveLength(0);
  });

  it('applies to tickets and lookups too', async () => {
    const ctx = { conversationId: 'conv_blank' };
    expect(
      await run('create_support_ticket', { category: 'payout', priority: 'low', summary: 's', conversation_id: 'conv_blank' }, ctx),
    ).toMatchObject({ error: { code: 'profile_incomplete' } });
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' }, ctx)).toMatchObject({
      error: { code: 'profile_incomplete' },
    });
    expect(store.tickets).toHaveLength(0);
    expect(store.calls).toEqual([]);
  });
});

describe('ticket and escalation are one operation (AC-43.2)', () => {
  const input = { category: 'compliance', reason: 'Payout under review', preferred_at: soon() };

  it('returns the same pair for a repeated or racing create', async () => {
    const [x, y] = await Promise.all([run('create_escalation', input, A), run('create_escalation', input, A)]);
    expect(x).toMatchObject({ ticket_id: 'TKT-000001', escalation_id: 'ESC-000001' });
    expect(y).toMatchObject({ ticket_id: 'TKT-000001', escalation_id: 'ESC-000001' });
    expect(store.tickets).toHaveLength(1);
    expect(store.escalations).toHaveLength(1);
  });

  it('gives every escalation a ticket of the same conversation', async () => {
    await run('create_escalation', input, A);
    await run('create_escalation', input, B);
    for (const e of store.escalations) {
      const ticket = store.tickets.find((t) => t.ticket_id === e.ticket_id);
      expect(ticket?.conversation_id).toBe(e.conversation_id);
      expect(ticket?.customer_id).toBe(e.customer_id);
    }
    expect(store.escalations).toHaveLength(2);
  });

  it('leaves nothing behind when the database call fails, and says so safely', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.createTicketAndEscalation = async () => {
      throw new Error('rpc failed: connection to db.internal refused');
    };
    const r = await run('create_escalation', input, A);
    expect(r).toMatchObject({ error: { code: 'temporarily_unavailable' } });
    expect(JSON.stringify(r)).not.toMatch(/db\.internal|rpc/);
    expect(store.tickets).toHaveLength(0);
    expect(store.escalations).toHaveLength(0);
    spy.mockRestore();
  });
});
