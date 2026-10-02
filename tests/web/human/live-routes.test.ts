import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  getHumanMessages: vi.fn(),
  getStaffProfiles: vi.fn(),
  getStaffQueueRows: vi.fn(),
  isAnyStaffOnline: vi.fn(),
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
  getStaffQueueRows: (...a: unknown[]) => h.getStaffQueueRows(...a),
  isAnyStaffOnline: (...a: unknown[]) => h.isAnyStaffOnline(...a),
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => h.rateLimit(...a),
  CHAT_LIMITS: {
    customerMessages: { windowSeconds: 60, max: 30 },
    staffMessages: { windowSeconds: 60, max: 60 },
    typing: { windowSeconds: 60, max: 40 },
    read: { windowSeconds: 60, max: 60 },
    presence: { windowSeconds: 60, max: 12 },
  },
}));
vi.mock('@/lib/supabase.server', () => ({
  restInsert: (...a: unknown[]) => h.restInsert(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
  restSelect: (...a: unknown[]) => h.restSelect(...a),
}));

import { POST as staffRead } from '@/app/api/staff/conversations/[id]/read/route';
import { POST as staffRelease } from '@/app/api/staff/conversations/[id]/release/route';
import { GET as staffGet, POST as staffPost } from '@/app/api/staff/conversations/[id]/messages/route';
import { GET as presenceGet, POST as presencePost } from '@/app/api/staff/presence/route';
import { GET as queueGet } from '@/app/api/staff/queue/route';
import { POST as callback } from '@/app/api/support/conversations/[id]/callback/route';
import { POST as endChat } from '@/app/api/support/conversations/[id]/end/route';
import { GET as customerGet, POST as customerPost } from '@/app/api/support/conversations/[id]/messages/route';
import { POST as customerRead } from '@/app/api/support/conversations/[id]/read/route';

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

const row = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-04T11:55:00Z',
  ended_at: null,
  final_status: 'escalated',
  end_reason: null,
  support_mode: 'human',
  assigned_staff_id: null,
  staff_typing_at: null,
  customer_typing_at: null,
  customer_last_read_at: null,
  staff_last_read_at: null,
  handoff_at: '2026-10-04T11:56:00Z',
  last_customer_message_at: null,
  ...over,
});

const UUID = '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b';
type Handler = (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
const ctx = (id = 'vapi_abc') => ({ params: Promise.resolve({ id }) });
const post = (fn: Handler, body?: unknown, headers: Record<string, string> = {}) =>
  fn(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(),
  );
const get = (fn: Handler) => fn(new Request('http://localhost/x'), ctx());

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
  h.restInsert.mockResolvedValue(undefined);
  h.restPatch.mockResolvedValue([{ conversation_id: 'vapi_abc' }]);
  h.getHumanMessages.mockResolvedValue([]);
  h.getStaffProfiles.mockResolvedValue(new Map());
  h.isAnyStaffOnline.mockResolvedValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('message ids and receipts', () => {
  it('stores a retried message once: the client id goes to the database as an ignore-duplicates key', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    expect((await post(customerPost as Handler, { body: 'Hi', clientId: UUID })).status).toBe(201);
    expect(h.restInsert).toHaveBeenCalledWith(
      'conversation_turns',
      { conversation_id: 'vapi_abc', sender: 'customer', body: 'Hi', client_msg_id: UUID },
      { onConflict: 'conversation_id,client_msg_id' },
    );
    // The same request again is accepted the same way (the database ignores the duplicate).
    expect((await post(customerPost as Handler, { body: 'Hi', clientId: UUID })).status).toBe(201);
  });

  it('refuses a client id that is not a uuid, for both sides', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    expect((await post(customerPost as Handler, { body: 'Hi', clientId: 'abc' })).status).toBe(400);
    h.getCurrentUser.mockResolvedValue(sarah);
    expect((await post(staffPost as Handler, { body: 'Hi', clientId: "x'; drop table" })).status).toBe(400);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('stamps when each side last wrote, for the unread marks', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    await post(customerPost as Handler, { body: 'Hi' });
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ last_customer_message_at: expect.any(String), customer_typing_at: null });

    h.restPatch.mockClear();
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: 'u-9' }));
    await post(staffPost as Handler, { body: 'Hello' });
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ last_staff_message_at: expect.any(String), staff_typing_at: null });
  });

  it('tells the customer what staff have read, how long they have waited, and whether anyone is online', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.isAnyStaffOnline.mockResolvedValue(true);
    h.getConversation.mockResolvedValue(row());
    expect(await (await get(customerGet as Handler)).json()).toMatchObject({
      waitingSince: '2026-10-04T11:56:00Z',
      staffOnline: true,
      staffReadAt: null,
    });
    // Once someone has the conversation the presence question is not asked.
    h.isAnyStaffOnline.mockClear();
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: 'u-9', staff_last_read_at: '2026-10-04T12:00:00Z' }));
    h.getStaffProfiles.mockResolvedValue(new Map([['u-9', { name: 'Sarah', title: null, avatarUrl: null }]]));
    expect(await (await get(customerGet as Handler)).json()).toMatchObject({
      waitingSince: null,
      staffOnline: false,
      staffReadAt: '2026-10-04T12:00:00Z',
      staff: { name: 'Sarah' },
    });
    expect(h.isAnyStaffOnline).not.toHaveBeenCalled();
  });

  it('survives the presence check failing', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    h.isAnyStaffOnline.mockRejectedValue(new Error('down'));
    const res = await get(customerGet as Handler);
    expect(res.status).toBe(200);
    expect((await res.json()).staffOnline).toBe(false);
  });

  it('tells staff what the customer has read and how long they have waited', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(row({ customer_last_read_at: '2026-10-04T12:00:00Z' }));
    expect(await (await get(staffGet as Handler)).json()).toMatchObject({
      customerReadAt: '2026-10-04T12:00:00Z',
      waitingSince: '2026-10-04T11:56:00Z',
    });
  });
});

describe('read routes', () => {
  it('the customer records reading their own conversation', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    expect((await post(customerRead as Handler)).status).toBe(200);
    expect(h.restPatch.mock.calls[0][2]).toEqual({ customer_last_read_at: expect.any(String) });
    h.restPatch.mockClear();
    h.getConversation.mockResolvedValue(row({ customer_id: 'CUS-1002' }));
    expect((await post(customerRead as Handler)).status).toBe(404);
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('only the person who has the conversation counts as having read it', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: 'u-9' }));
    expect(await (await post(staffRead as Handler)).json()).toEqual({ ok: true, recorded: true });
    expect(h.restPatch.mock.calls[0][2]).toEqual({ staff_last_read_at: expect.any(String) });

    h.restPatch.mockClear();
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: null }));
    expect(await (await post(staffRead as Handler)).json()).toEqual({ ok: true, recorded: false });
    h.getCurrentUser.mockResolvedValue(david);
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: 'u-9' }));
    expect(await (await post(staffRead as Handler)).json()).toEqual({ ok: true, recorded: false });
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('are for the right people, from this site, and limited', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    expect((await post(customerRead as Handler)).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(user());
    expect((await post(staffRead as Handler)).status).toBe(401);
    expect((await post(customerRead as Handler, undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    h.getConversation.mockResolvedValue(row());
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 5, shared: true });
    expect((await post(customerRead as Handler)).status).toBe(429);
  });
});

describe('customer ends the chat', () => {
  it('ends their own open chat once, with a note for staff', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    const res = await post(endChat as Handler);
    expect(res.status).toBe(200);
    expect(h.restPatch.mock.calls[0][1]).toBe('conversation_id=eq.vapi_abc&support_mode=eq.human&ended_at=is.null');
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ support_mode: 'ended', end_reason: 'user-ended' });
    expect(h.restInsert.mock.calls[0][1]).toMatchObject({ sender: 'system' });

    h.restPatch.mockResolvedValue([]); // a second end finds nothing open
    h.restInsert.mockClear();
    expect((await post(endChat as Handler)).status).toBe(409);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('refuses someone else\'s chat, a closed chat, and staff', async () => {
    h.getCurrentUser.mockResolvedValue(user({ id: 'u-2', customerId: 'CUS-1002' }));
    h.getConversation.mockResolvedValue(row());
    expect((await post(endChat as Handler)).status).toBe(404);
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row({ support_mode: 'ended', ended_at: 'x' }));
    expect((await post(endChat as Handler)).status).toBe(409);
    h.getCurrentUser.mockResolvedValue(sarah);
    expect((await post(endChat as Handler)).status).toBe(401);
  });
});

describe('customer asks for a callback instead', () => {
  const account = [{ contact_name: 'Amara Okafor', contact_email: 'amara@lagosledger.example' }];

  it('records a callback request from the account details, then ends the chat', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    h.restSelect.mockResolvedValue(account);
    const res = await post(callback as Handler, { preferredTime: '  Friday morning  ', customerId: 'CUS-1002', user_email: 'evil@x.example' });
    expect(res.status).toBe(200);
    const [table, escalation] = h.restInsert.mock.calls[0];
    expect(table).toBe('escalations');
    expect(escalation).toMatchObject({
      customer_id: 'CUS-1001',
      conversation_id: 'vapi_abc',
      user_name: 'Amara Okafor',
      user_email: 'amara@lagosledger.example',
      preferred_time: 'Friday morning',
      contact_preference: 'callback',
      status: 'open',
    });
    expect(JSON.stringify(escalation)).not.toContain('evil@x.example');
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ support_mode: 'ended', end_reason: 'user-ended' });
    // The request is recorded before the chat is closed, so a failure never loses it.
    expect(h.restInsert.mock.invocationCallOrder[0]).toBeLessThan(h.restPatch.mock.invocationCallOrder[0]);
  });

  it('works without a preferred time, and bounds a long one', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    h.restSelect.mockResolvedValue(account);
    const escalations = () => h.restInsert.mock.calls.filter((c) => c[0] === 'escalations').map((c) => c[1] as { preferred_time: string | null });
    await post(callback as Handler, {});
    expect(escalations()[0]).toMatchObject({ preferred_time: null });
    await post(callback as Handler, { preferredTime: 'x'.repeat(500) });
    expect(escalations()[1].preferred_time).toHaveLength(100);
  });

  it('refuses bad input, other people\'s chats, closed chats and other sites; records nothing then', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    h.restSelect.mockResolvedValue(account);
    expect((await post(callback as Handler, { preferredTime: 42 })).status).toBe(400);
    expect((await post(callback as Handler, {}, { Origin: 'https://evil.example' })).status).toBe(403);
    h.getConversation.mockResolvedValue(row({ support_mode: 'ended', ended_at: 'x' }));
    expect((await post(callback as Handler, {})).status).toBe(409);
    h.getConversation.mockResolvedValue(row({ customer_id: 'CUS-1002' }));
    expect((await post(callback as Handler, {})).status).toBe(404);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('does not leak detail when the database fails', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row());
    h.restSelect.mockResolvedValue(account);
    h.restInsert.mockRejectedValue(new Error('escalations insert failed (500)'));
    const res = await post(callback as Handler, {});
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/500|escalations/);
    expect(h.restPatch).not.toHaveBeenCalled();
  });
});

describe('staff return a conversation to the queue', () => {
  it('lets the person who has it give it back, once, with a note to the customer', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: 'u-9' }));
    const res = await post(staffRelease as Handler);
    expect(res.status).toBe(200);
    expect(h.restPatch.mock.calls[0][1]).toContain('assigned_staff_id=eq.u-9');
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ assigned_staff_id: null });
    expect(h.restInsert.mock.calls[0][1]).toMatchObject({ sender: 'system', body: expect.stringContaining('returned this conversation') });

    h.restPatch.mockResolvedValue([]);
    h.restInsert.mockClear();
    expect((await post(staffRelease as Handler)).status).toBe(409);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('lets an admin, refuses another agent, and needs something to give back', async () => {
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: 'u-9' }));
    h.getCurrentUser.mockResolvedValue(david);
    expect((await post(staffRelease as Handler)).status).toBe(409);
    h.getCurrentUser.mockResolvedValue(admin);
    expect((await post(staffRelease as Handler)).status).toBe(200);
    h.getConversation.mockResolvedValue(row({ assigned_staff_id: null }));
    expect(await (await post(staffRelease as Handler)).json()).toEqual({ error: 'not-assigned' });
    h.getConversation.mockResolvedValue(row({ support_mode: 'ended', ended_at: 'x', assigned_staff_id: 'u-9' }));
    expect(await (await post(staffRelease as Handler)).json()).toEqual({ error: 'not-open' });
    h.getCurrentUser.mockResolvedValue(user());
    expect((await post(staffRelease as Handler)).status).toBe(401);
  });
});

describe('staff presence', () => {
  it('a heartbeat refreshes last seen and leaves the switch alone', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    const res = await post(presencePost as unknown as Handler, {});
    expect(res.status).toBe(200);
    expect(h.restPatch).toHaveBeenCalledWith('app_users', 'id=eq.u-9', { last_seen_at: expect.any(String) });
  });

  it('the switch changes availability, and only for the signed-in person', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    const res = await post(presencePost as unknown as Handler, { available: true, id: 'u-1' });
    expect(await res.json()).toEqual({ ok: true, available: true });
    expect(h.restPatch).toHaveBeenCalledWith('app_users', 'id=eq.u-9', { last_seen_at: expect.any(String), available: true });
  });

  it('is for staff only, from this site, well formed and limited', async () => {
    h.getCurrentUser.mockResolvedValue(user());
    expect((await post(presencePost as unknown as Handler, {})).status).toBe(401);
    expect((await get(presenceGet as unknown as Handler)).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(sarah);
    expect((await post(presencePost as unknown as Handler, {}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(presencePost as unknown as Handler, { available: 'yes' })).status).toBe(400);
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 3, shared: true });
    expect((await post(presencePost as unknown as Handler, {})).status).toBe(429);
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('reports the saved switch, and fails without detail', async () => {
    h.getCurrentUser.mockResolvedValue({ ...sarah, available: true });
    expect(await (await get(presenceGet as unknown as Handler)).json()).toEqual({ available: true });
    h.getCurrentUser.mockResolvedValue(sarah);
    h.restPatch.mockRejectedValue(new Error('app_users update failed (500)'));
    const res = await post(presencePost as unknown as Handler, {});
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/500|app_users/);
  });
});

describe('the live queue route', () => {
  const rows = {
    conversations: [
      { ...row({ conversation_id: 'a' }) },
      { ...row({ conversation_id: 'b', support_mode: 'ended', ended_at: 'x', final_status: 'resolved' }) },
    ],
    tickets: [],
    customers: [{ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara' }],
  };

  it('is for staff, and shows each only what they may open', async () => {
    h.getStaffQueueRows.mockResolvedValue(rows);
    h.getCurrentUser.mockResolvedValue(user());
    expect((await (queueGet as unknown as () => Promise<Response>)()).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(sarah);
    const agent = await (await (queueGet as unknown as () => Promise<Response>)()).json();
    expect(agent.items.map((i: { conversationId: string }) => i.conversationId)).toEqual(['a']);
    expect(agent).toMatchObject({ waitingCount: 1, counts: { waiting: 1 }, at: expect.any(String) });
    h.getCurrentUser.mockResolvedValue(admin);
    const all = await (await (queueGet as unknown as () => Promise<Response>)()).json();
    expect(all.items).toHaveLength(2);
  });

  it('is never cached and fails without detail', async () => {
    h.getCurrentUser.mockResolvedValue(sarah);
    h.getStaffQueueRows.mockResolvedValue(rows);
    expect((await (queueGet as unknown as () => Promise<Response>)()).headers.get('cache-control')).toBe('no-store');
    h.getStaffQueueRows.mockRejectedValue(new Error('conversations query failed (500)'));
    const res = await (queueGet as unknown as () => Promise<Response>)();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/500|conversations/);
  });
});
