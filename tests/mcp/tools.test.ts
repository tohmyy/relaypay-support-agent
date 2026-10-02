import { beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeLike } from '../../services/mcp/src/db/store';
import { executeTool, tools } from '../../services/mcp/src/tools';
import { sanitizeMetadata } from '../../services/mcp/src/tools/log-conversation-event';
import { isAuthorized } from '../../services/mcp/src/utils/auth';
import { createFakeStore, type FakeStore } from './fake-store';

/** A specific callback time a few days ahead: inside the one-month window. */
const soon = () => new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

const tool = (name: string) => tools.find((t) => t.name === name)!;

let store: FakeStore;
beforeEach(() => {
  store = createFakeStore();
});

const run = (name: string, input: unknown) => executeTool(tool(name), input, store);

describe('registry', () => {
  it('exposes exactly the six required tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_escalation',
      'create_support_ticket',
      'log_conversation_event',
      'lookup_customer',
      'lookup_payout',
      'lookup_transaction',
    ]);
  });
});

describe('input validation happens before any database access', () => {
  it.each([
    ['lookup_customer', {}],
    ['lookup_customer', { unknown_field: 'x' }],
    ['lookup_transaction', {}],
    ['lookup_transaction', { transaction_id: '' }],
    ['lookup_payout', {}],
    ['create_support_ticket', { category: 'payout', priority: 'high', summary: 's' }],
    ['create_support_ticket', { category: 'nope', priority: 'high', summary: 's', conversation_id: 'c' }],
    ['create_escalation', { user_name: 'A', category: 'account', reason: 'r' }],
    ['create_escalation', { user_name: 'A', user_email: 'not-an-email', category: 'account', reason: 'r' }],
    ['log_conversation_event', { conversation_id: 'c', event_type: 'bad type!', summary: 's' }],
  ])('%s rejects %j', async (name, input) => {
    const result = await run(name, input);
    expect(result).toMatchObject({ error: { code: 'invalid_input' } });
    expect(store.calls).toEqual([]);
  });
});

describe('read tools', () => {
  it('finds a customer by id, email and company name (case-insensitive)', async () => {
    for (const input of [
      { customer_id: 'CUS-1001' },
      { email: 'AMARA@lagosledger.example' },
      { company_name: 'lagosledger' },
    ]) {
      expect(await run('lookup_customer', input)).toMatchObject({
        found: true,
        customer_id: 'CUS-1001',
        account_status: 'active',
        kyc_status: 'approved',
      });
    }
  });

  it('does not return contact details', async () => {
    const r = await run('lookup_customer', { customer_id: 'CUS-1001' });
    expect(JSON.stringify(r)).not.toMatch(/lagosledger\.example|Okafor/);
  });

  it('returns found:false for missing records', async () => {
    expect(await run('lookup_customer', { customer_id: 'CUS-0000' })).toEqual({ found: false });
    expect(await run('lookup_transaction', { transaction_id: 'TXN-0000' })).toEqual({ found: false });
    expect(await run('lookup_payout', { payout_id: 'PAY-0000' })).toEqual({ found: false });
  });

  it('shapes transactions: numeric amount, type mapped, null arrival kept as null', async () => {
    expect(await run('lookup_transaction', { transaction_id: 'TXN-9001' })).toMatchObject({
      found: true,
      type: 'outgoing payout',
      amount: 2400,
      estimated_arrival: null,
    });
  });

  it('finds payouts by payout id or transaction id and borrows the transaction summary', async () => {
    for (const input of [{ payout_id: 'PAY-7001' }, { transaction_id: 'TXN-9001' }]) {
      expect(await run('lookup_payout', input)).toMatchObject({
        found: true,
        payout_id: 'PAY-7001',
        failure_reason: null,
        support_summary: 'Payout is processing.',
      });
    }
  });
});

describe('write tools', () => {
  it('creates a ticket with status open and creates the conversation first', async () => {
    const r = await run('create_support_ticket', {
      customer_id: 'CUS-1001',
      category: 'payout',
      priority: 'high',
      summary: 'Payout failed',
      conversation_id: 'test-c1',
    });
    expect(r).toEqual({ ticket_id: 'TKT-000001', status: 'open' });
    expect(store.tickets).toHaveLength(1);
    expect(store.conversations.has('test-c1')).toBe(true);
  });

  it('rejects unknown customers and tickets with a structured error', async () => {
    expect(
      await run('create_support_ticket', {
        customer_id: 'CUS-9999',
        category: 'other',
        priority: 'low',
        summary: 's',
        conversation_id: 'test-c1',
      }),
    ).toMatchObject({ error: { code: 'reference_not_found' } });
    expect(
      await run('create_escalation', {
        ticket_id: 'TKT-404',
        user_name: 'A',
        user_email: 'a@b.co',
        category: 'account',
        reason: 'r',
      }),
    ).toMatchObject({ error: { code: 'reference_not_found' } });
    expect(store.tickets).toHaveLength(0);
    expect(store.escalations).toHaveLength(0);
  });

  it('creates an escalation without echoing the email back', async () => {
    const r = await run('create_escalation', {
      ticket_id: 'TKT-000001',
      customer_id: 'CUS-1001',
      user_name: 'Amara',
      user_email: 'amara@lagosledger.example',
      category: 'compliance',
      reason: 'Payout under review',
      preferred_at: soon(),
    });
    expect(r).toMatchObject({ escalation_id: 'ESC-000001', status: 'open' });
    expect(JSON.stringify(r)).not.toContain('lagosledger');
  });

  it('stores the request conversation id on the escalation and creates the conversation first', async () => {
    const r = await executeTool(
      tool('create_escalation'),
      { user_name: 'A', user_email: 'a@b.co', category: 'account', reason: 'r', preferred_at: soon() },
      store,
      { conversationId: 'conv_ctx-1' },
    );
    expect(r).toMatchObject({ escalation_id: 'ESC-000001' });
    expect(store.escalations[0]).toMatchObject({ conversation_id: 'conv_ctx-1' });
    expect(store.conversations.has('conv_ctx-1')).toBe(true);
  });

  it('records how the customer chose to be helped, and words the summary for a text chat', async () => {
    const chat = await run('create_escalation', {
      user_name: 'A',
      user_email: 'a@b.co',
      category: 'payment',
      reason: 'r',
      contact_preference: 'text_chat',
    });
    expect(store.escalations[0]).toMatchObject({ contact_preference: 'text_chat' });
    expect(JSON.stringify(chat)).toContain('text chat');
    expect(JSON.stringify(chat)).not.toContain('call you on');

    const callback = await run('create_escalation', {
      user_name: 'A',
      user_email: 'a@b.co',
      category: 'payment',
      reason: 'r',
      contact_preference: 'callback',
      preferred_at: soon(),
    });
    expect(JSON.stringify(callback)).toContain('contact details on your account');
  });

  it('refuses an unknown contact preference and treats it as optional', async () => {
    expect(
      await run('create_escalation', {
        user_name: 'A',
        user_email: 'a@b.co',
        category: 'payment',
        reason: 'r',
        contact_preference: 'smoke_signal',
      }),
    ).toMatchObject({ error: { code: expect.any(String) } });
    await run('create_escalation', {
      user_name: 'A',
      user_email: 'a@b.co',
      category: 'payment',
      reason: 'r',
      preferred_at: soon(),
    });
    expect((store.escalations.at(-1) as { contact_preference?: string }).contact_preference).toBeUndefined();
  });

  it('leaves conversation_id unset when the request carries none', async () => {
    await run('create_escalation', {
      user_name: 'A',
      user_email: 'a@b.co',
      category: 'account',
      reason: 'r',
      preferred_at: soon(),
    });
    expect(store.escalations[0]).toMatchObject({ conversation_id: undefined });
  });

  it('logs events and strips secret-looking metadata keys', async () => {
    const r = await run('log_conversation_event', {
      conversation_id: 'test-c1',
      event_type: 'escalation_triggered',
      summary: 'Escalated',
      metadata: { reason: 'compliance', api_key: 'sk-1', nested: { authToken: 'x', ok: 1 } },
    });
    expect(r).toEqual({ logged: true });
    expect(store.events[0]).toMatchObject({ metadata: { reason: 'compliance', nested: { ok: 1 } } });
    expect(JSON.stringify(store.events[0])).not.toMatch(/sk-1|authToken|api_key/);
  });

  it('rejects oversized metadata', async () => {
    const r = await run('log_conversation_event', {
      conversation_id: 'c',
      event_type: 'big',
      summary: 's',
      metadata: { blob: 'x'.repeat(5000) },
    });
    expect(r).toMatchObject({ error: { code: 'invalid_input' } });
    expect(store.events).toHaveLength(0);
  });
});

describe('failure handling', () => {
  it('returns a safe error and never leaks the database message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.failWith = new Error('connection to db.internal:5432 refused (password=hunter2)');
    const r = await run('lookup_customer', { customer_id: 'CUS-1001' });
    expect(r).toMatchObject({ error: { code: 'temporarily_unavailable' } });
    expect(JSON.stringify(r)).not.toMatch(/db\.internal|hunter2|5432/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('records success, not_found and failed statuses without raw values', async () => {
    await run('lookup_customer', { email: 'amara@lagosledger.example' });
    await run('lookup_transaction', { transaction_id: 'TXN-0000' });
    await run('lookup_transaction', {});
    expect(store.toolCalls.map((c) => c.status)).toEqual(['success', 'not_found', 'failed']);
    expect(store.toolCalls[0].input_summary).toBe('email=<provided>');
  });
});

describe('helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('sanitizeMetadata handles arrays and primitives', () => {
    expect(sanitizeMetadata([{ password: 'x', a: 1 }, 2])).toEqual([{ a: 1 }, 2]);
  });

  it('checks bearer tokens in a strict way', () => {
    expect(isAuthorized('Bearer secret', 'secret')).toBe(true);
    expect(isAuthorized('Bearer secre', 'secret')).toBe(false);
    expect(isAuthorized('Bearer secret2', 'secret')).toBe(false);
    expect(isAuthorized('secret', 'secret')).toBe(false);
    expect(isAuthorized(undefined, 'secret')).toBe(false);
    expect(isAuthorized('Bearer ', 'secret')).toBe(false);
  });
});
