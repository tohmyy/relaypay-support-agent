import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  getHumanMessages: vi.fn(),
  getStaffProfiles: vi.fn(),
  rateLimit: vi.fn(),
  restInsert: vi.fn(),
  restPatch: vi.fn(),
  restSelect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/dashboard/data.server', () => ({
  getConversation: (...a: unknown[]) => h.getConversation(...a),
  getHumanMessages: (...a: unknown[]) => h.getHumanMessages(...a),
  getStaffProfiles: (...a: unknown[]) => h.getStaffProfiles(...a),
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => h.rateLimit(...a),
  CHAT_LIMITS: {
    customerMessages: { windowSeconds: 60, max: 30 },
    staffMessages: { windowSeconds: 60, max: 60 },
    typing: { windowSeconds: 60, max: 40 },
  },
}));
vi.mock('@/lib/supabase.server', () => ({
  restInsert: (...a: unknown[]) => h.restInsert(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
  restSelect: (...a: unknown[]) => h.restSelect(...a),
}));

import { POST as claim } from '@/app/api/staff/conversations/[id]/claim/route';
import { POST as close } from '@/app/api/staff/conversations/[id]/close/route';
import { GET as staffGet, POST as staffPost } from '@/app/api/staff/conversations/[id]/messages/route';
import { POST as staffTyping } from '@/app/api/staff/conversations/[id]/typing/route';
import { GET as customerGet, POST as customerPost } from '@/app/api/support/conversations/[id]/messages/route';
import { POST as customerTyping } from '@/app/api/support/conversations/[id]/typing/route';

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u-1',
  email: 'amara@lagosledger.example',
  role: 'customer',
  customerId: 'CUS-1001',
  displayName: 'Amara Okafor',
  title: null,
  avatarUrl: null,
  ...over,
});
const sarah = user({ id: 'u-9', role: 'support_agent', customerId: null, displayName: 'Sarah Adeyemi', title: 'Support Specialist' });
const david = user({ id: 'u-8', role: 'support_agent', customerId: null, displayName: 'David Karanja' });
const admin = user({ id: 'u-7', role: 'support_admin', customerId: null, displayName: 'Support Admin' });

const humanRow = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-03T11:55:00Z',
  ended_at: null,
  final_status: 'escalated',
  end_reason: null,
  support_mode: 'human',
  assigned_staff_id: null,
  staff_typing_at: null,
  customer_typing_at: null,
  ...over,
});

const ctx = (id = 'vapi_abc') => ({ params: Promise.resolve({ id }) });
const post = (fn: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, body?: unknown, headers: Record<string, string> = {}, id?: string) =>
  fn(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(id),
  );
const get = (fn: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, query = '') =>
  fn(new Request(`http://localhost/x${query}`), ctx());

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
  h.restInsert.mockResolvedValue(undefined);
  h.restPatch.mockResolvedValue([{ conversation_id: 'vapi_abc' }]);
  h.getHumanMessages.mockResolvedValue([]);
  h.getStaffProfiles.mockResolvedValue(new Map());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('customer messages', () => {
  it('requires a signed-in customer', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await get(customerGet)).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(sarah);
    expect((await get(customerGet)).status).toBe(401);
    expect((await post(customerPost, { body: 'hi' })).status).toBe(401);
  });

  it('returns the thread, the assigned specialist and the typing flag to the owner', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9', staff_typing_at: new Date().toISOString() }));
    h.getHumanMessages.mockResolvedValue([{ id: '1', sender: 'staff', body: 'Hi', at: '2026-10-03T12:00:00.000Z', author: null }]);
    h.getStaffProfiles.mockResolvedValue(new Map([['u-9', { name: 'Sarah', title: 'Support Specialist', avatarUrl: null }]]));
    const res = await get(customerGet, '?after=2026-10-03T11:59:00Z');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      supportMode: 'human',
      ended: false,
      staff: { name: 'Sarah', title: 'Support Specialist' },
      staffTyping: true,
      messages: [{ id: '1' }],
    });
    expect(h.getHumanMessages).toHaveBeenCalledWith('vapi_abc', '2026-10-03T11:59:00Z');
  });

  it('gives another customer, and an unknown id, the same empty answer', async () => {
    const neutral = { supportMode: 'ai', ended: false, messages: [], staff: null, staffTyping: false };
    h.getCurrentUser.mockResolvedValue(user({ id: 'u-2', customerId: 'CUS-1002' }));
    h.getConversation.mockResolvedValue(humanRow());
    expect(await (await get(customerGet)).json()).toEqual(neutral);
    h.getConversation.mockResolvedValue(null);
    expect(await (await get(customerGet)).json()).toEqual(neutral);
    expect(h.getHumanMessages).not.toHaveBeenCalled();
  });

  it('stores a message only while the conversation is open, using the gate write first', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow());
    const res = await post(customerPost, { body: '  Hello?  ' });
    expect(res.status).toBe(201);
    expect(h.restPatch.mock.calls[0][1]).toBe('conversation_id=eq.vapi_abc&support_mode=eq.human&ended_at=is.null');
    expect(h.restInsert).toHaveBeenCalledWith('conversation_turns', { conversation_id: 'vapi_abc', sender: 'customer', body: 'Hello?' });
    const patchOrder = h.restPatch.mock.invocationCallOrder[0];
    expect(patchOrder).toBeLessThan(h.restInsert.mock.invocationCallOrder[0]);
  });

  it('stores nothing if the conversation was closed in between', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow());
    h.restPatch.mockResolvedValue([]);
    expect((await post(customerPost, { body: 'late' })).status).toBe(409);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('refuses closed conversations, other customers, bad bodies, other sites and floods', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ended', ended_at: '2026-10-03T12:00:00Z' }));
    expect((await post(customerPost, { body: 'x' })).status).toBe(409);

    h.getConversation.mockResolvedValue(humanRow({ customer_id: 'CUS-1002' }));
    expect((await post(customerPost, { body: 'x' })).status).toBe(404);

    h.getConversation.mockResolvedValue(humanRow());
    expect((await post(customerPost, { body: '   ' })).status).toBe(400);
    expect((await post(customerPost, { body: 'x'.repeat(2001) })).status).toBe(413);
    expect((await post(customerPost, 'not json')).status).toBe(400);
    expect((await post(customerPost, { body: 'x' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(customerPost, { body: 'x' }, {}, 'bad id!')).status).toBe(400);

    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 12, shared: true });
    const limited = await post(customerPost, { body: 'x' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('12');
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('reports a database failure without detail', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockRejectedValue(new Error('conversations query failed (500)'));
    const res = await post(customerPost, { body: 'x' });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('500');
  });

  it('records the typing signal for the owner only, while open', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow());
    expect((await post(customerTyping)).status).toBe(200);
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ customer_typing_at: expect.any(String) });
    h.restPatch.mockClear();
    h.getConversation.mockResolvedValue(humanRow({ customer_id: 'CUS-1002' }));
    expect((await post(customerTyping)).status).toBe(404);
    expect(h.restPatch).not.toHaveBeenCalled();
  });
});

describe('staff messages', () => {
  it('is for staff only', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    expect((await get(staffGet)).status).toBe(401);
    expect((await post(staffPost, { body: 'x' })).status).toBe(401);
    expect((await post(claim)).status).toBe(401);
    expect((await post(close)).status).toBe(401);
    expect((await post(staffTyping)).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(null);
    expect((await get(staffGet)).status).toBe(401);
  });

  it('shows the thread, who has it, and whether the viewer can reply', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9', customer_typing_at: new Date().toISOString() }));
    h.getStaffProfiles.mockResolvedValue(new Map([['u-9', { name: 'Sarah', title: null, avatarUrl: null }]]));
    expect(await (await get(staffGet)).json()).toMatchObject({
      supportMode: 'human',
      assignedTo: { name: 'Sarah' },
      assignedToMe: true,
      canReply: true,
      customerTyping: true,
    });
    h.getCurrentUser.mockResolvedValue(david);
    expect(await (await get(staffGet)).json()).toMatchObject({ assignedToMe: false, canReply: false });
  });

  it('hides a conversation an agent may not open', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ended', ended_at: 'x', final_status: 'resolved' }));
    expect((await get(staffGet)).status).toBe(404);
    h.getConversation.mockResolvedValue(null);
    expect((await get(staffGet)).status).toBe(404);
  });

  it('writing to an unassigned conversation takes it, then stores the message', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow());
    const res = await post(staffPost, { body: 'Hi Amara, I am looking at this now.' });
    expect(res.status).toBe(201);
    const queries = h.restPatch.mock.calls.map((c) => c[1] as string);
    expect(queries[0]).toContain('assigned_staff_id=is.null');
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ assigned_staff_id: 'u-9' });
    // The "joined" note, then the message with the writer's id.
    expect(h.restInsert.mock.calls[0][1]).toMatchObject({ sender: 'system', body: expect.stringContaining('Sarah Adeyemi, Support Specialist, has joined') });
    expect(h.restInsert.mock.calls[1][1]).toEqual({
      conversation_id: 'vapi_abc',
      sender: 'staff',
      body: 'Hi Amara, I am looking at this now.',
      staff_user_id: 'u-9',
    });
  });

  it('does not take or join again for the person who already has it', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    expect((await post(staffPost, { body: 'More' })).status).toBe(201);
    expect(h.restInsert).toHaveBeenCalledTimes(1);
    expect(h.restInsert.mock.calls[0][1]).toMatchObject({ sender: 'staff' });
  });

  it('refuses a different agent, lets an admin in, and reports a lost race', async () => {
    h.getCurrentUser.mockResolvedValue(david);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    expect(await (await post(staffPost, { body: 'x' })).json()).toEqual({ error: 'taken' });
    expect(h.restInsert).not.toHaveBeenCalled();

    h.getCurrentUser.mockResolvedValue(admin);
    expect((await post(staffPost, { body: 'x' })).status).toBe(201);

    // Both read "unassigned"; the conditional write only lets one win.
    h.getCurrentUser.mockResolvedValue(david);
    h.restInsert.mockClear();
    h.getConversation.mockResolvedValue(humanRow());
    h.restPatch.mockResolvedValueOnce([]);
    h.restSelect.mockResolvedValueOnce([{ assigned_staff_id: 'u-9', support_mode: 'human', ended_at: null }]);
    const lost = await post(staffPost, { body: 'x' });
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: 'taken' });
    expect(h.restInsert).not.toHaveBeenCalled();

    // Lost because it was closed in the meantime: not "taken".
    h.restPatch.mockResolvedValueOnce([]);
    h.restSelect.mockResolvedValueOnce([{ assigned_staff_id: null, support_mode: 'ended', ended_at: 'x' }]);
    expect(await (await post(staffPost, { body: 'x' })).json()).toEqual({ error: 'not-open' });
  });

  it('refuses a closed conversation, a bad body, another site and a flood', async () => {
    h.getCurrentUser.mockResolvedValue(admin);
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ended', ended_at: 'x' }));
    expect((await post(staffPost, { body: 'x' })).status).toBe(409);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-7' }));
    expect((await post(staffPost, { body: '' })).status).toBe(400);
    expect((await post(staffPost, { body: 'x' }, { Origin: 'https://evil.example' })).status).toBe(403);
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 3, shared: true });
    expect((await post(staffPost, { body: 'x' })).status).toBe(429);
  });

  it('claim: one winner, idempotent for the winner, 409 for the rest', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow());
    expect(await (await post(claim)).json()).toEqual({ assigned: true });
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    expect((await post(claim)).status).toBe(200);
    h.getCurrentUser.mockResolvedValue(david);
    h.restPatch.mockResolvedValue([]);
    h.restSelect.mockResolvedValue([{ assigned_staff_id: 'u-9', support_mode: 'human', ended_at: null }]);
    const taken = await post(claim);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'taken' });
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ended', ended_at: 'x' }));
    expect(await (await post(claim)).json()).toEqual({ error: 'not-open' });
  });

  it('close: ends it as human-closed, once, by the right person', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    const res = await post(close);
    expect(res.status).toBe(200);
    expect(h.restPatch.mock.calls[0][1]).toBe('conversation_id=eq.vapi_abc&support_mode=eq.human&ended_at=is.null');
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ support_mode: 'ended', end_reason: 'human-closed', ended_at: expect.any(String) });
    expect(h.restPatch.mock.calls[0][2]).not.toHaveProperty('final_status');
    expect(h.restInsert.mock.calls.map((c) => (c[1] as { sender?: string; event_type?: string }).sender ?? (c[1] as { event_type?: string }).event_type)).toEqual([
      'system',
      'human_closed',
    ]);

    // Someone else's conversation: refused. An admin may. A second close changes nothing.
    h.getCurrentUser.mockResolvedValue(david);
    expect((await post(close)).status).toBe(409);
    h.getCurrentUser.mockResolvedValue(admin);
    h.restPatch.mockResolvedValue([]);
    h.restInsert.mockClear();
    expect((await post(close)).status).toBe(409);
    expect(h.restInsert).not.toHaveBeenCalled();
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ai' }));
    expect((await post(close)).status).toBe(409);
  });

  it('typing: only the person who may reply', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    expect((await post(staffTyping)).status).toBe(200);
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ staff_typing_at: expect.any(String) });
    h.getCurrentUser.mockResolvedValue(david);
    expect((await post(staffTyping)).status).toBe(409);
  });

  it('never leaks internals in failures', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockRejectedValue(new Error('conversations query failed (500)'));
    for (const res of [await get(staffGet), await post(staffPost, { body: 'x' }), await post(claim), await post(close)]) {
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).not.toMatch(/500|conversations/);
    }
  });
});
