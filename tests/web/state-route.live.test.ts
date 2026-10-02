import { afterAll, describe, expect, it, vi } from 'vitest';
import { createSupabase } from '../../services/mcp/src/db/client';

vi.mock('server-only', () => ({}));

const live = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// The state route against the real database with rows shaped like a real escalated call. Cleans up.
describe.skipIf(!live)('conversation state route (live Supabase)', () => {
  const db = live ? createSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : null!;
  const id = `test-web-state-${Date.now()}`;

  afterAll(async () => {
    if (!live) return;
    await db.from('escalations').delete().eq('conversation_id', id);
    await db.from('support_tickets').delete().eq('conversation_id', id);
    await db.from('conversation_turns').delete().eq('conversation_id', id);
    await db.from('conversations').delete().eq('conversation_id', id);
  });

  async function state() {
    const { GET } = await import('@/app/api/conversations/[id]/state/route');
    const res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
  }

  it('follows a call from nothing, to a clarification, to a ticket, to an escalation, to the end', async () => {
    // Needs migration 20261001000008 (end_reason) applied to the database under test.
    expect((await state()).body).toMatchObject({
      answerType: null,
      ticketReference: null,
      escalation: null,
      ended: false,
      endReason: null,
      startedAt: null,
    });

    await db.from('conversations').insert({ conversation_id: id, channel: 'voice' });
    await db.from('conversation_turns').insert({
      conversation_id: id,
      turn_number: 1,
      user_transcript: 'My payment is stuck',
      assistant_response: 'Is it a payout or an invoice?',
      answer_type: 'clarification',
    });
    expect((await state()).body.answerType).toBe('clarification');

    const { data: ticket } = await db
      .from('support_tickets')
      .insert({ conversation_id: id, category: 'payment', priority: 'normal', summary: 'internal summary text', status: 'open' })
      .select('ticket_id')
      .single();
    const s2 = await state();
    expect(s2.body.ticketReference).toBe(ticket!.ticket_id);
    expect(s2.body.ticketReference).toMatch(/^TKT-\d{6}$/);

    await db.from('conversation_turns').insert({
      conversation_id: id,
      turn_number: 2,
      user_transcript: 'my email is secret@example.com',
      assistant_response: 'A specialist will help.',
      answer_type: 'escalation',
    });
    await db.from('escalations').insert({
      conversation_id: id,
      ticket_id: ticket!.ticket_id,
      user_name: 'Private Name',
      user_email: 'secret@example.com',
      category: 'payment',
      reason: 'internal reason',
      preferred_time: 'Tuesday at 2:00 PM',
      status: 'open',
    });
    const s3 = await state();
    expect(s3.body).toMatchObject({ answerType: 'escalation', escalation: { requestedTime: 'Tuesday at 2:00 PM' }, ended: false });
    expect(JSON.stringify(s3.body)).not.toMatch(/Private Name|secret@example|internal reason|internal summary|stuck/);

    await db.from('conversations').update({ ended_at: new Date().toISOString() }).eq('conversation_id', id);
    expect((await state()).body.ended).toBe(true);
  }, 60_000);
});
