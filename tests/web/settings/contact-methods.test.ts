import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';
import { DEFAULT_METHODS, parseContactMethods, toStored, validateContactMethods } from '@/lib/settings/contact-methods';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  getHumanMessages: vi.fn(),
  getStaffProfiles: vi.fn(),
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
  isAnyStaffOnline: (...a: unknown[]) => h.isAnyStaffOnline(...a),
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => h.rateLimit(...a),
  CHAT_LIMITS: { settings: { windowSeconds: 60, max: 10 } },
}));
vi.mock('@/lib/supabase.server', () => ({
  restInsert: (...a: unknown[]) => h.restInsert(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
  restSelect: (...a: unknown[]) => h.restSelect(...a),
}));

import { GET as customerMessages } from '@/app/api/support/conversations/[id]/messages/route';
import { POST as callback } from '@/app/api/support/conversations/[id]/callback/route';
import { GET as settingsGet, PUT as settingsPut } from '@/app/api/staff/settings/contact-methods/route';
import {
  getContactMethods,
  resetContactMethodsCache,
  saveContactMethods,
} from '@/lib/settings/contact-methods.server';

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
const admin = user({ id: 'u-7', role: 'support_admin', customerId: null, displayName: 'Support Admin' });
const agent = user({ id: 'u-9', role: 'support_agent', customerId: null, displayName: 'Sarah Adeyemi' });

const stored = (value: unknown, extra: Record<string, unknown> = {}) => [{ value, updated_at: '2026-10-05T09:00:00Z', updated_by: 'u-7', ...extra }];
const putRequest = (body: unknown, headers: Record<string, string> = {}) =>
  settingsPut(
    new Request('http://localhost/x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  resetContactMethodsCache();
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
  h.restInsert.mockResolvedValue(undefined);
  h.restPatch.mockResolvedValue([{ key: 'contact_methods' }]);
  h.restSelect.mockResolvedValue([]);
  h.getHumanMessages.mockResolvedValue([]);
  h.getStaffProfiles.mockResolvedValue(new Map());
  h.isAnyStaffOnline.mockResolvedValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('reading and checking the setting', () => {
  it('is on unless a method was explicitly turned off', () => {
    expect(parseContactMethods(undefined)).toEqual(DEFAULT_METHODS);
    expect(parseContactMethods({})).toEqual(DEFAULT_METHODS);
    expect(parseContactMethods({ text_chat: false })).toEqual({ textChat: false, callback: true });
    expect(parseContactMethods({ callback: false })).toEqual({ textChat: true, callback: false });
    expect(parseContactMethods({ text_chat: 'no', callback: null })).toEqual(DEFAULT_METHODS);
  });

  it('reads a saved value with both off as both on, so customers are never left with nothing', () => {
    expect(parseContactMethods({ text_chat: false, callback: false })).toEqual(DEFAULT_METHODS);
  });

  it('stores with the same names the voice agent reads', () => {
    expect(toStored({ textChat: false, callback: true })).toEqual({ text_chat: false, callback: true });
  });

  it('accepts a choice of booleans with at least one method on', () => {
    expect(validateContactMethods({ textChat: true, callback: false })).toEqual({ ok: true, methods: { textChat: true, callback: false } });
    expect(validateContactMethods({ textChat: false, callback: true, extra: 1 })).toEqual({ ok: true, methods: { textChat: false, callback: true } });
  });

  it('refuses everything off, and anything that is not a pair of booleans', () => {
    expect(validateContactMethods({ textChat: false, callback: false })).toEqual({ ok: false, error: 'none-enabled' });
    for (const bad of [null, undefined, 'yes', 3, [], {}, { textChat: true }, { textChat: 'true', callback: true }, { textChat: 1, callback: 0 }]) {
      expect(validateContactMethods(bad)).toEqual({ ok: false, error: 'invalid' });
    }
  });
});

describe('the saved setting', () => {
  it('is read from the database and remembered for a few seconds', async () => {
    h.restSelect.mockResolvedValue(stored({ text_chat: false, callback: true }));
    expect(await getContactMethods(1000)).toEqual({ textChat: false, callback: true });
    h.restSelect.mockResolvedValue(stored({ text_chat: true, callback: true }));
    expect(await getContactMethods(5000)).toEqual({ textChat: false, callback: true }); // still remembered
    expect(h.restSelect).toHaveBeenCalledTimes(1);
    expect(await getContactMethods(12_000)).toEqual({ textChat: true, callback: true });
    expect(h.restSelect).toHaveBeenCalledTimes(2);
  });

  it('is both on when nothing was saved or it cannot be read', async () => {
    expect(await getContactMethods(1000)).toEqual(DEFAULT_METHODS);
    resetContactMethodsCache();
    h.restSelect.mockRejectedValue(new Error('app_settings query failed (500)'));
    expect(await getContactMethods(1000)).toEqual(DEFAULT_METHODS);
  });

  it('updates the saved row, and creates it the first time', async () => {
    await saveContactMethods({ textChat: false, callback: true }, 'u-7');
    expect(h.restPatch).toHaveBeenCalledWith('app_settings', 'key=eq.contact_methods', {
      value: { text_chat: false, callback: true },
      updated_at: expect.any(String),
      updated_by: 'u-7',
    });
    expect(h.restInsert).not.toHaveBeenCalled();

    h.restPatch.mockReset();
    h.restPatch.mockResolvedValueOnce([]).mockResolvedValueOnce([{ key: 'contact_methods' }]);
    await saveContactMethods({ textChat: true, callback: false }, 'u-7');
    expect(h.restInsert).toHaveBeenCalledWith('app_settings', expect.objectContaining({ key: 'contact_methods', updated_by: 'u-7' }), { onConflict: 'key' });
    expect(h.restPatch).toHaveBeenCalledTimes(2);
  });

  it('is used straight away on this instance after it is saved', async () => {
    h.restSelect.mockResolvedValue(stored({ text_chat: true, callback: true }));
    await getContactMethods(1000);
    await saveContactMethods({ textChat: true, callback: false }, 'u-7');
    h.restSelect.mockResolvedValue(stored({ text_chat: true, callback: false }));
    expect(await getContactMethods(1500)).toEqual({ textChat: true, callback: false });
  });
});

describe('the settings API', () => {
  it('is for administrators only', async () => {
    for (const who of [null, user(), agent]) {
      h.getCurrentUser.mockResolvedValue(who);
      expect((await settingsGet()).status).toBe(401);
      expect((await putRequest({ textChat: true, callback: true })).status).toBe(401);
    }
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('shows the saved choice, who changed it, and whether anyone is online', async () => {
    h.getCurrentUser.mockResolvedValue(admin);
    h.isAnyStaffOnline.mockResolvedValue(true);
    h.restSelect.mockImplementation(async (table: string) =>
      table === 'app_settings' ? stored({ text_chat: false, callback: true }) : [{ display_name: 'Support Admin' }],
    );
    const res = await settingsGet();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      methods: { textChat: false, callback: true },
      updatedAt: '2026-10-05T09:00:00Z',
      updatedBy: 'Support Admin',
      staffOnline: true,
    });
  });

  it('shows both on when nothing has been saved yet', async () => {
    h.getCurrentUser.mockResolvedValue(admin);
    expect(await (await settingsGet()).json()).toMatchObject({ methods: DEFAULT_METHODS, updatedAt: null, updatedBy: null });
  });

  it('saves a valid choice, recording who made it', async () => {
    h.getCurrentUser.mockResolvedValue(admin);
    const res = await putRequest({ textChat: false, callback: true, updated_by: 'someone-else' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ methods: { textChat: false, callback: true } });
    expect(h.restPatch.mock.calls[0][2]).toMatchObject({ value: { text_chat: false, callback: true }, updated_by: 'u-7' });
  });

  it('refuses everything off, bad bodies, other sites and floods, saving nothing', async () => {
    h.getCurrentUser.mockResolvedValue(admin);
    expect(await (await putRequest({ textChat: false, callback: false })).json()).toEqual({ error: 'none-enabled' });
    expect((await putRequest({ textChat: 'yes', callback: true })).status).toBe(400);
    expect((await putRequest('not json')).status).toBe(400);
    expect((await putRequest({ textChat: true, callback: true }, { Origin: 'https://evil.example' })).status).toBe(403);
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 7, shared: true });
    const limited = await putRequest({ textChat: true, callback: true });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('7');
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('fails without detail', async () => {
    h.getCurrentUser.mockResolvedValue(admin);
    h.restPatch.mockRejectedValue(new Error('app_settings update failed (500)'));
    const res = await putRequest({ textChat: true, callback: false });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/500|app_settings/);
    h.restSelect.mockRejectedValue(new Error('app_settings query failed (500)'));
    expect((await settingsGet()).status).toBe(503);
  });
});

describe('what customers experience', () => {
  const row = {
    conversation_id: 'vapi_abc',
    customer_id: 'CUS-1001',
    started_at: '2026-10-05T08:55:00Z',
    ended_at: null,
    final_status: 'escalated',
    end_reason: null,
    support_mode: 'human',
    assigned_staff_id: null,
    staff_typing_at: null,
    customer_typing_at: null,
    customer_last_read_at: null,
    staff_last_read_at: null,
    handoff_at: '2026-10-05T08:56:00Z',
  };
  const ctx = { params: Promise.resolve({ id: 'vapi_abc' }) };
  const setting = (value: unknown) => h.restSelect.mockImplementation(async (table: string) => (table === 'app_settings' ? stored(value) : [{ contact_name: 'Amara Okafor', contact_email: 'amara@lagosledger.example' }]));

  beforeEach(() => {
    h.getCurrentUser.mockResolvedValue(user());
    h.getConversation.mockResolvedValue(row);
  });

  it('tells the chat whether a callback can be asked for', async () => {
    setting({ text_chat: true, callback: false });
    expect((await (await customerMessages(new Request('http://localhost/x'), ctx)).json()).callbackAvailable).toBe(false);
    resetContactMethodsCache();
    setting({ text_chat: true, callback: true });
    expect((await (await customerMessages(new Request('http://localhost/x'), ctx)).json()).callbackAvailable).toBe(true);
  });

  it('refuses a callback request when callbacks are off, and records nothing', async () => {
    setting({ text_chat: true, callback: false });
    const res = await callback(new Request('http://localhost/x', { method: 'POST', body: '{}' }), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'method-disabled' });
    expect(h.restInsert).not.toHaveBeenCalled();
    expect(h.restPatch).not.toHaveBeenCalled();
  });

  it('still takes a callback request when callbacks are on', async () => {
    setting({ text_chat: false, callback: true });
    const res = await callback(new Request('http://localhost/x', { method: 'POST', body: '{}' }), ctx);
    expect(res.status).toBe(200);
    expect(h.restInsert.mock.calls.some((c) => c[0] === 'escalations')).toBe(true);
  });
});
