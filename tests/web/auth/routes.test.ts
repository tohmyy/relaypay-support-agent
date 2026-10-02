import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEUTRAL_STATE } from '@/lib/conversation-state';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  user: null as unknown,
  getCurrentUser: vi.fn(),
  restSelect: vi.fn(),
  restInsert: vi.fn(),
  restPatch: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/supabase.server', () => ({
  restSelect: (...a: unknown[]) => h.restSelect(...a),
  restInsert: (...a: unknown[]) => h.restInsert(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
}));

import { GET as getState } from '@/app/api/conversations/[id]/state/route';
import { POST as link } from '@/app/api/support/link/route';

const customer = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u-1',
  email: 'amara@lagosledger.example',
  role: 'customer',
  customerId: 'CUS-1001',
  displayName: 'Amara Okafor',
  title: null,
  avatarUrl: null,
  ...over,
});
const agent = customer({ id: 'u-9', role: 'support_agent', customerId: null });

beforeEach(() => {
  for (const f of [h.getCurrentUser, h.restSelect, h.restInsert, h.restPatch]) f.mockReset();
  h.restInsert.mockResolvedValue(undefined);
  h.restPatch.mockResolvedValue([]);
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  link(
    new Request('http://localhost/api/support/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('POST /api/support/link', () => {
  it('requires a signed-in customer', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await post({ conversationId: 'vapi_abc' })).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(agent);
    expect((await post({ conversationId: 'vapi_abc' })).status).toBe(403);
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('refuses requests from another site', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    const res = await post({ conversationId: 'vapi_abc' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(h.restPatch).not.toHaveBeenCalled();
    expect((await post({ conversationId: 'vapi_abc' }, { Origin: 'http://localhost' })).status).not.toBe(403);
  });

  it('validates the body and the conversation id before touching the database', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await post('not json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ conversationId: 'a b' })).status).toBe(400);
    expect((await post({ conversationId: 'x'.repeat(65) })).status).toBe(400);
    expect((await post({ conversationId: ['vapi_abc'] })).status).toBe(400);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('links using the customer from the session, never one supplied in the request', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restPatch.mockResolvedValue([{ conversation_id: 'vapi_abc' }]);
    const res = await post({ conversationId: 'vapi_abc', customerId: 'CUS-1002', customer_id: 'CUS-1002' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true });
    expect(h.restInsert).toHaveBeenCalledWith('conversations', { conversation_id: 'vapi_abc', channel: 'voice' }, { onConflict: 'conversation_id' });
    const [table, query, patch] = h.restPatch.mock.calls[0];
    expect(table).toBe('conversations');
    expect(query).toBe('conversation_id=eq.vapi_abc&customer_id=is.null');
    expect(patch).toEqual({ customer_id: 'CUS-1001', user_id: 'u-1' });
  });

  it('is harmless to repeat for the same customer', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restPatch.mockResolvedValue([]);
    h.restSelect.mockResolvedValue([{ customer_id: 'CUS-1001' }]);
    const res = await post({ conversationId: 'vapi_abc' });
    expect(res.status).toBe(200);
  });

  it('refuses a call that already belongs to someone else', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restPatch.mockResolvedValue([]);
    h.restSelect.mockResolvedValue([{ customer_id: 'CUS-1002' }]);
    const res = await post({ conversationId: 'vapi_abc' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain('CUS-1002');
  });

  it('reports a database failure without leaking detail, and does not cache', async () => {
    h.getCurrentUser.mockResolvedValue(customer());
    h.restInsert.mockRejectedValue(new Error('conversations insert failed (500)'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ conversationId: 'vapi_abc' });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await res.json())).not.toContain('500');
    expect(spy.mock.calls.join(' ')).not.toMatch(/CUS-1001|amara/);
    spy.mockRestore();
  });
});

describe('state route and linked conversations', () => {
  const call = (id = 'vapi_abc') => getState(new Request('http://localhost/x'), { params: Promise.resolve({ id }) });
  const rows = (conversation: Record<string, unknown>) =>
    h.restSelect.mockImplementation(async (table: string) => {
      if (table === 'conversation_turns') return [{ turn_number: 1, answer_type: 'direct_answer' }];
      if (table === 'support_tickets') return [{ ticket_id: 'TKT-000007' }];
      if (table === 'conversations') return [conversation];
      return [];
    });
  const openLinked = { ended_at: null, started_at: '2026-10-02T09:00:00Z', customer_id: 'CUS-1001', final_status: null };

  it('leaves an unlinked conversation exactly as before and never looks up the user', async () => {
    rows({ ended_at: null, started_at: '2026-10-02T09:00:00Z', customer_id: null });
    const body = await (await call()).json();
    expect(body).toMatchObject({ answerType: 'direct_answer', ticketReference: 'TKT-000007' });
    expect(h.getCurrentUser).not.toHaveBeenCalled();
  });

  it('shows a linked conversation to its owner and to staff', async () => {
    rows(openLinked);
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await (await call()).json()).ticketReference).toBe('TKT-000007');
    h.getCurrentUser.mockResolvedValue(agent);
    expect((await (await call()).json()).ticketReference).toBe('TKT-000007');
  });

  it('gives everyone else the same neutral answer as for an unknown id', async () => {
    rows(openLinked);
    const unknown = await (await (async () => {
      h.restSelect.mockResolvedValue([]);
      return call('vapi_unknown');
    })()).json();
    rows(openLinked);
    for (const viewer of [null, customer({ id: 'u-2', customerId: 'CUS-1002' }), customer({ customerId: null })]) {
      h.getCurrentUser.mockResolvedValue(viewer);
      const res = await call();
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(NEUTRAL_STATE);
    }
    expect(unknown).toMatchObject({ answerType: null, ticketReference: null, ended: false });
  });

  it('does not show a closed, non-escalated linked conversation to a support agent', async () => {
    rows({ ...openLinked, ended_at: '2026-10-02T09:05:00Z', final_status: 'resolved' });
    h.getCurrentUser.mockResolvedValue(agent);
    expect(await (await call()).json()).toEqual(NEUTRAL_STATE);
    h.getCurrentUser.mockResolvedValue({ ...agent, role: 'support_admin' });
    expect((await (await call()).json()).ticketReference).toBe('TKT-000007');
  });
});
