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
  restRpc: vi.fn(),
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
  restRpc: (...a: unknown[]) => h.restRpc(...a),
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
  available: false,
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
  h.restRpc.mockImplementation(async (name: string) => {
    if (name === 'add_human_message') return { outcome: 'ok' };
    if (name === 'staff_claim_escalation') return { outcome: 'claimed', state: null };
    if (name === 'staff_release_escalation') return { outcome: 'released', state: null };
    if (name === 'staff_close_escalation') return { outcome: 'closed', state: null };
    if (name === 'customer_end_escalation') return { outcome: 'ended', state: null };
    throw new Error(`unexpected RPC ${name}`);
  });
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
    const neutral = {
      supportMode: 'ai',
      ended: false,
      messages: [],
      staff: null,
      staffTyping: false,
      staffReadAt: null,
      waitingSince: null,
      staffOnline: false,
      callbackAvailable: true,
    };
    h.getCurrentUser.mockResolvedValue(user({ id: 'u-2', customerId: 'CUS-1002' }));
    h.getConversation.mockResolvedValue(humanRow());
    expect(await (await get(customerGet)).json()).toEqual(neutral);
    h.getConversation.mockResolvedValue(null);
    expect(await (await get(customerGet)).json()).toEqual(neutral);
    expect(h.getHumanMessages).not.toHaveBeenCalled();
  });

  it('stores a message atomically only while the conversation is open', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow());
    const res = await post(customerPost, { body: '  Hello?  ' });
    expect(res.status).toBe(201);
    expect(h.restRpc).toHaveBeenCalledWith('add_human_message', {
      p_conversation_id: 'vapi_abc',
      p_sender: 'customer',
      p_body: 'Hello?',
      p_staff_user_id: null,
      p_client_msg_id: null,
    });
  });

  it('stores nothing if the conversation was closed in between', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(humanRow());
    h.restRpc.mockResolvedValue({ outcome: 'closed' });
    expect((await post(customerPost, { body: 'late' })).status).toBe(409);
    expect(h.restRpc).toHaveBeenCalledOnce();
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
    expect(h.restRpc).not.toHaveBeenCalled();
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
    expect(h.restRpc.mock.calls).toEqual([
      ['staff_claim_escalation', { p_conversation_id: 'vapi_abc', p_staff_id: 'u-9' }],
      ['add_human_message', {
        p_conversation_id: 'vapi_abc',
        p_sender: 'staff',
        p_body: 'Hi Amara, I am looking at this now.',
        p_staff_user_id: 'u-9',
        p_client_msg_id: null,
      }],
    ]);
  });

  it('does not claim again for the person who already has it', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    expect((await post(staffPost, { body: 'More' })).status).toBe(201);
    expect(h.restRpc).toHaveBeenCalledTimes(1);
    expect(h.restRpc).toHaveBeenCalledWith('add_human_message', {
      p_conversation_id: 'vapi_abc',
      p_sender: 'staff',
      p_body: 'More',
      p_staff_user_id: 'u-9',
      p_client_msg_id: null,
    });
  });

  it('refuses a different agent, lets an admin in, and reports a lost race', async () => {
    h.getCurrentUser.mockResolvedValue(david);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    expect(await (await post(staffPost, { body: 'x' })).json()).toEqual({ error: 'taken' });
    expect(h.restRpc).not.toHaveBeenCalled();

    h.getCurrentUser.mockResolvedValue(admin);
    expect((await post(staffPost, { body: 'x' })).status).toBe(201);

    // Both read "unassigned"; the lifecycle RPC only lets one win.
    h.getCurrentUser.mockResolvedValue(david);
    h.restRpc.mockReset();
    h.getConversation.mockResolvedValue(humanRow());
    h.restRpc.mockResolvedValueOnce({ outcome: 'taken', state: { assigned_staff_id: 'u-9' } });
    const lost = await post(staffPost, { body: 'x' });
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: 'taken' });
    expect(h.restRpc).toHaveBeenCalledTimes(1);

    // Lost because it was closed in the meantime: not "taken".
    h.restRpc.mockResolvedValueOnce({ outcome: 'not-open', state: { support_mode: 'ended', ended_at: 'x' } });
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
    h.restRpc.mockResolvedValueOnce({ outcome: 'already-mine', state: null });
    expect((await post(claim)).status).toBe(200);
    h.getCurrentUser.mockResolvedValue(david);
    h.restRpc.mockResolvedValueOnce({ outcome: 'taken', state: { assigned_staff_id: 'u-9' } });
    const taken = await post(claim);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: 'taken', state: { assigned_staff_id: 'u-9' } });
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ended', ended_at: 'x' }));
    h.restRpc.mockResolvedValueOnce({ outcome: 'not-open', state: { support_mode: 'ended' } });
    expect(await (await post(claim)).json()).toMatchObject({ error: 'not-open', state: { support_mode: 'ended' } });
  });

  it('close: ends it as human-closed, once, by the right person', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(humanRow({ assigned_staff_id: 'u-9' }));
    const res = await post(close);
    expect(res.status).toBe(200);
    expect(h.restRpc).toHaveBeenCalledWith('staff_close_escalation', {
      p_conversation_id: 'vapi_abc',
      p_staff_id: 'u-9',
    });

    // Someone else's conversation: refused. An admin may. A second close changes nothing.
    h.getCurrentUser.mockResolvedValue(david);
    h.restRpc.mockResolvedValueOnce({ outcome: 'taken', state: { assigned_staff_id: 'u-9' } });
    expect((await post(close)).status).toBe(409);
    h.getCurrentUser.mockResolvedValue(admin);
    h.restRpc.mockResolvedValueOnce({ outcome: 'not-open', state: { support_mode: 'ended' } });
    expect((await post(close)).status).toBe(409);
    h.getConversation.mockResolvedValue(humanRow({ support_mode: 'ai' }));
    h.restRpc.mockResolvedValueOnce({ outcome: 'not-open', state: { support_mode: 'ai' } });
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
