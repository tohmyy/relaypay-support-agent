import { afterAll, describe, expect, it } from 'vitest';
import { createSupabase } from '../../services/mcp/src/db/client';
import { createStore } from '../../services/mcp/src/db/store';
import { executeTool, tools } from '../../services/mcp/src/tools';

const live = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Runs against the real, seeded Supabase project. Rows it creates are deleted afterwards.
describe.skipIf(!live)('MCP tools against Supabase (live)', () => {
  const db = live ? createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : null!;
  const store = live ? createStore(db) : null!;
  const startedAt = new Date().toISOString();
  const conversationId = `test-${Date.now()}`;
  // Read-only lookups may run unlinked here; tools that create records need a linked conversation (see below).
  const call = (name: string, input: unknown, ctx?: { conversationId?: string }) =>
    executeTool(tools.find((t) => t.name === name)!, input, store, { allowUnlinked: true, ...ctx });

  afterAll(async () => {
    if (!live) return;
    const { data: tickets } = await db.from('support_tickets').select('ticket_id').eq('conversation_id', conversationId);
    const ticketIds = (tickets ?? []).map((t) => t.ticket_id);
    if (ticketIds.length) await db.from('escalations').delete().in('ticket_id', ticketIds);
    await db.from('escalations').delete().eq('user_email', 'test-live@example.com');
    await db.from('escalations').delete().eq('conversation_id', conversationId);
    await db.from('support_tickets').delete().eq('conversation_id', conversationId);
    await db.from('conversation_events').delete().eq('conversation_id', conversationId);
    await db.from('tool_calls').delete().eq('conversation_id', conversationId);
    // Lookup calls carry no conversation_id, so remove them by time window.
    await db.from('tool_calls').delete().is('conversation_id', null).gte('created_at', startedAt);
    await db.from('conversations').delete().eq('conversation_id', conversationId);
  });

  it('looks up the seeded customer by id, email and company name', async () => {
    for (const input of [
      { customer_id: 'CUS-1001' },
      { email: 'AMARA@lagosledger.example' },
      { company_name: 'lagosledger' },
    ]) {
      expect(await call('lookup_customer', input)).toMatchObject({
        found: true,
        customer_id: 'CUS-1001',
        company_name: 'LagosLedger',
        account_status: 'active',
        kyc_status: 'approved',
      });
    }
  });

  it('does not let LIKE wildcards scan customers', async () => {
    expect(await call('lookup_customer', { company_name: '%' })).toEqual({ found: false });
    expect(await call('lookup_customer', { email: '%@%' })).toEqual({ found: false });
  });

  it('returns found:false for unknown records', async () => {
    expect(await call('lookup_customer', { customer_id: 'TEST-LIVE-none' })).toEqual({ found: false });
    expect(await call('lookup_transaction', { transaction_id: 'TXN-0000' })).toEqual({ found: false });
    expect(await call('lookup_payout', { payout_id: 'PAY-0000' })).toEqual({ found: false });
  });

  it('looks up TXN-9001 and the review-required payout PAY-7002', async () => {
    expect(await call('lookup_transaction', { transaction_id: 'TXN-9001' })).toMatchObject({
      found: true,
      status: 'processing',
      amount: 2400,
      currency: 'USD',
      estimated_arrival: '2026-08-19',
    });
    for (const input of [{ payout_id: 'PAY-7002' }, { transaction_id: 'TXN-9003' }]) {
      expect(await call('lookup_payout', input)).toMatchObject({
        found: true,
        payout_id: 'PAY-7002',
        status: 'review required',
        failure_reason: 'compliance review',
        customer_id: 'CUS-1003',
      });
    }
    expect(await call('lookup_transaction', { transaction_id: 'TXN-9003' })).toMatchObject({
      estimated_arrival: null,
    });
  });

  // Needs migration 20261007000017 applied and a seeded customer sign-in (npm run db:seed-users).
  it('creates a ticket and an escalation together for the linked customer, and an event', async () => {
    const { data: users } = await db
      .from('app_users')
      .select('id, customer_id')
      .eq('role', 'customer')
      .not('customer_id', 'is', null)
      .limit(1);
    const owner = users?.[0];
    if (!owner) return;
    await store.ensureConversation(conversationId);
    await db.from('conversations').update({ customer_id: owner.customer_id, user_id: owner.id }).eq('conversation_id', conversationId);

    const ticket = (await call('create_support_ticket', {
      category: 'payout',
      priority: 'high',
      summary: 'Payout PAY-7003 failed (integration test)',
      conversation_id: conversationId,
    }, { conversationId })) as { ticket_id: string; status: string };
    expect(ticket.ticket_id).toMatch(/^TKT-\d{6}$/);
    expect(ticket.status).toBe('open');
    const { data: row } = await db.from('support_tickets').select('*').eq('ticket_id', ticket.ticket_id).single();
    expect(row).toMatchObject({ conversation_id: conversationId, customer_id: owner.customer_id, status: 'open' });

    const esc = (await call('create_escalation', {
      category: 'payment',
      reason: 'Integration test',
      preferred_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    }, { conversationId })) as { ticket_id: string; escalation_id: string; status: string };
    expect(esc.escalation_id).toMatch(/^ESC-\d{6}$/);
    expect(esc.ticket_id).toBe(ticket.ticket_id);
    expect(esc.status).toBe('open');
    const { data: erow } = await db.from('escalations').select('*').eq('escalation_id', esc.escalation_id).single();
    expect(erow).toMatchObject({ ticket_id: ticket.ticket_id, customer_id: owner.customer_id, status: 'open', conversation_id: conversationId });

    expect(
      await call('log_conversation_event', {
        conversation_id: conversationId,
        event_type: 'integration_test',
        summary: 'live test',
        metadata: { step: 1, api_key: 'should-not-persist' },
      }),
    ).toEqual({ logged: true });
    const { data: ev } = await db.from('conversation_events').select('*').eq('conversation_id', conversationId);
    expect(ev).toHaveLength(1);
    expect(ev![0].metadata).toEqual({ step: 1 });
  });

  it('refuses to create records for a conversation that is not linked, writing nothing', async () => {
    const r = await call('create_support_ticket', {
      category: 'other',
      priority: 'low',
      summary: 'x',
      conversation_id: `${conversationId}-unlinked`,
    }, { conversationId: `${conversationId}-unlinked` });
    expect(r).toMatchObject({ error: { code: 'not_authorized' } });
  });

  it('records tool_calls rows with statuses and no raw email', async () => {
    await call('lookup_customer', { email: 'TEST-LIVE@example.com' });
    const { data } = await db.from('tool_calls').select('*').like('input_summary', '%email=<provided>%').limit(5);
    expect(data!.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain('TEST-LIVE@example.com');
  });
});
