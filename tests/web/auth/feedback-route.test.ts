import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/dal';
import { parseFeedback, stageReady } from '@/lib/feedback';

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConversation: vi.fn(),
  restSelect: vi.fn(),
  restInsert: vi.fn(),
  restPatch: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ getCurrentUser: () => h.getCurrentUser() }));
vi.mock('@/lib/dashboard/data.server', () => ({ getConversation: (...a: unknown[]) => h.getConversation(...a) }));
vi.mock('@/lib/supabase.server', () => ({
  restSelect: (...a: unknown[]) => h.restSelect(...a),
  restInsert: (...a: unknown[]) => h.restInsert(...a),
  restPatch: (...a: unknown[]) => h.restPatch(...a),
}));
vi.mock('@/lib/auth/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rate-limit')>('@/lib/auth/rate-limit');
  return { ...actual, rateLimit: (...a: unknown[]) => h.rateLimit(...a) };
});

import { POST } from '@/app/api/support/conversations/[id]/feedback/route';

const customer = (over: Partial<CurrentUser> = {}): CurrentUser => ({
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

const row = (over: Record<string, unknown> = {}) => ({
  conversation_id: 'vapi_abc',
  customer_id: 'CUS-1001',
  started_at: '2026-10-05T09:00:00Z',
  ended_at: '2026-10-05T09:05:00Z',
  final_status: 'resolved',
  end_reason: 'user-ended',
  support_mode: 'ai',
  assigned_staff_id: null,
  ...over,
});

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.getCurrentUser.mockResolvedValue(customer());
  h.getConversation.mockResolvedValue(row());
  h.restInsert.mockResolvedValue(undefined);
  h.restSelect.mockResolvedValue([]);
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
});

const post = (body: unknown, id = 'vapi_abc', headers: Record<string, string> = {}) =>
  POST(
    new Request(`http://localhost/api/support/conversations/${id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('parseFeedback', () => {
  it('accepts a stage, a whole rating from 1 to 5 and an optional comment', () => {
    expect(parseFeedback({ stage: 'ai', rating: 5 })).toEqual({ ok: true, value: { stage: 'ai', rating: 5, comment: null } });
    expect(parseFeedback({ stage: 'human', rating: 1, comment: '  Slow\u0000 reply  ' })).toEqual({
      ok: true,
      value: { stage: 'human', rating: 1, comment: 'Slow reply' },
    });
    expect(parseFeedback({ stage: 'ai', rating: 3, comment: '   ' })).toMatchObject({ ok: true, value: { comment: null } });
  });

  it('rejects anything else', () => {
    expect(parseFeedback(null)).toMatchObject({ ok: false, error: 'invalid-stage' });
    expect(parseFeedback({ stage: 'voice', rating: 3 })).toMatchObject({ ok: false, error: 'invalid-stage' });
    for (const rating of [0, 6, 2.5, '4', null, undefined, NaN]) {
      expect(parseFeedback({ stage: 'ai', rating })).toMatchObject({ ok: false, error: 'invalid-rating' });
    }
    expect(parseFeedback({ stage: 'ai', rating: 3, comment: 42 })).toMatchObject({ ok: false, error: 'invalid-comment' });
    expect(parseFeedback({ stage: 'ai', rating: 3, comment: 'x'.repeat(1001) })).toMatchObject({ ok: false, error: 'invalid-comment' });
  });
});

describe('when each stage may be rated', () => {
  it('rates the AI stage once the voice leg is over (ended, or handed to a specialist)', () => {
    expect(stageReady('ai', { ended_at: null, support_mode: 'ai' })).toBe(false);
    expect(stageReady('ai', { ended_at: 'x', support_mode: 'ai' })).toBe(true);
    expect(stageReady('ai', { ended_at: null, support_mode: 'human' })).toBe(true);
    expect(stageReady('ai', { ended_at: 'x', support_mode: 'ended' })).toBe(true);
  });

  it('rates the human stage only after the specialist chat is closed', () => {
    expect(stageReady('human', { ended_at: null, support_mode: 'ai' })).toBe(false);
    expect(stageReady('human', { ended_at: null, support_mode: 'human' })).toBe(false);
    expect(stageReady('human', { ended_at: 'x', support_mode: 'ended' })).toBe(true);
  });
});

describe('POST /api/support/conversations/[id]/feedback', () => {
  it('requires a signed-in customer on this site', async () => {
    h.getCurrentUser.mockResolvedValue(null);
    expect((await post({ stage: 'ai', rating: 5 })).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(customer({ role: 'support_agent', customerId: null }));
    expect((await post({ stage: 'ai', rating: 5 })).status).toBe(401);
    h.getCurrentUser.mockResolvedValue(customer());
    expect((await post({ stage: 'ai', rating: 5 }, 'vapi_abc', { Origin: 'https://evil.example' })).status).toBe(403);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('validates the id and the body before reading anything', async () => {
    expect((await post({ stage: 'ai', rating: 5 }, 'a b')).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post({ stage: 'ai', rating: 9 })).status).toBe(400);
    expect(h.getConversation).not.toHaveBeenCalled();
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('records the AI-stage rating after the voice leg ended (AC-33.1)', async () => {
    h.restSelect.mockResolvedValue([{ stage: 'ai', rating: 5, comment: 'Great' }]);
    const res = await post({ stage: 'ai', rating: 5, comment: 'Great' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stage: 'ai', rating: 5, comment: 'Great', saved: true });
    expect(h.restInsert).toHaveBeenCalledWith(
      'conversation_feedback',
      { conversation_id: 'vapi_abc', stage: 'ai', rating: 5, comment: 'Great', user_id: 'u-1' },
      { onConflict: 'conversation_id,stage' },
    );
  });

  it('records the human-stage rating only after the specialist chat was closed (AC-33.2)', async () => {
    h.getConversation.mockResolvedValue(row({ support_mode: 'human', ended_at: null }));
    const early = await post({ stage: 'human', rating: 4 });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: 'not-ready' });
    expect(h.restInsert).not.toHaveBeenCalled();

    h.getConversation.mockResolvedValue(row({ support_mode: 'ended', ended_at: '2026-10-05T10:00:00Z', end_reason: 'human-closed' }));
    expect((await post({ stage: 'human', rating: 4 })).status).toBe(200);
    expect(h.restInsert.mock.calls[0][1]).toMatchObject({ stage: 'human', rating: 4 });
  });

  it('refuses the AI stage while the conversation is still going', async () => {
    h.getConversation.mockResolvedValue(row({ ended_at: null, final_status: null, end_reason: null }));
    expect((await post({ stage: 'ai', rating: 5 })).status).toBe(409);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('is idempotent: a second submit for the same stage keeps and returns the first answer (AC-33.3)', async () => {
    h.restSelect.mockResolvedValue([{ stage: 'ai', rating: 2, comment: 'First answer' }]);
    const res = await post({ stage: 'ai', rating: 5, comment: 'Changed my mind' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rating: 2, comment: 'First answer' });
    // Inserted with "ignore duplicates" semantics, so the stored row is never overwritten.
    expect(h.restInsert.mock.calls[0][2]).toEqual({ onConflict: 'conversation_id,stage' });
  });

  it("treats someone else's and unknown conversations as not found", async () => {
    h.getConversation.mockResolvedValue(row({ customer_id: 'CUS-1002' }));
    expect((await post({ stage: 'ai', rating: 5 })).status).toBe(404);
    h.getConversation.mockResolvedValue(null);
    expect((await post({ stage: 'ai', rating: 5 })).status).toBe(404);
    expect(h.restInsert).not.toHaveBeenCalled();
  });

  it('never changes the conversation or ticket status (AC-35.1, AC-35.2)', async () => {
    h.restSelect.mockResolvedValue([{ stage: 'ai', rating: 1, comment: null }]);
    await post({ stage: 'ai', rating: 1 });
    // The only write is the feedback row: no patch of any table, no insert anywhere else.
    expect(h.restPatch).not.toHaveBeenCalled();
    expect(h.restInsert.mock.calls.map((c) => c[0])).toEqual(['conversation_feedback']);
    expect(h.restSelect.mock.calls.every((c) => c[0] === 'conversation_feedback')).toBe(true);
  });

  it('is rate limited and fails without detail', async () => {
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 9, shared: true });
    expect((await post({ stage: 'ai', rating: 5 })).status).toBe(429);
    h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, shared: true });
    h.restInsert.mockRejectedValue(new Error('conversation_feedback insert failed (500) db.internal'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ stage: 'ai', rating: 5 });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/db\.internal|500/);
    spy.mockRestore();
  });
});
