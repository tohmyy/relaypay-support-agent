import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../services/agent/src/env';
import { sessionConfigFromEnv } from '../../services/agent/src/session/config';
import { SessionController } from '../../services/agent/src/session/controller';
import { DEFAULT_SESSION_CONFIG, SESSION_TEXT, type SessionConfig } from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';
import { fakeDb, type Row } from './fake-db';

const CALL = { id: 'call1' };
const ID = 'vapi_call1';
const NOW = new Date('2026-10-03T12:00:00Z');

const row = (over: Row = {}): Row => ({
  conversation_id: ID,
  started_at: NOW.toISOString(),
  ended_at: null,
  end_reason: null,
  final_status: null,
  support_mode: 'ai',
  customer_id: null,
  ...over,
});

function setup(config: Partial<SessionConfig> = {}, rows: Row[] = [row()]) {
  const fake = fakeDb({ conversations: rows });
  const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
  const full: SessionConfig = { ...DEFAULT_SESSION_CONFIG, requireLink: true, linkGraceSeconds: 10, silenceSeconds: 600, ...config };
  const session = new SessionController({ db: fake.db, control, config: full });
  const start = () => session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: CALL });
  const turn = (userMessage = 'where is my payout?') => session.beforeTurn({ conversationId: ID, callId: 'call1', userMessage });
  const conv = () => fake.tables.conversations.find((c) => c.conversation_id === ID)!;
  const events = (type: string) => fake.tables.conversation_events.filter((e) => e.event_type === type);
  return { ...fake, session, control, start, turn, conv, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('signed-in callers only: the link grace period', () => {
  it('ends a call that is still unlinked when the grace period runs out, with the "not signed in" line', async () => {
    const s = setup();
    await s.start();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(s.conv().end_reason).toBeNull();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(s.conv()).toMatchObject({ end_reason: 'error', final_status: 'error' });
    expect(s.control.say).toHaveBeenCalledWith(expect.anything(), SESSION_TEXT.notSignedIn, { endAfter: true });
    expect(s.events('unlinked_call')).toHaveLength(1);
  });

  it('leaves the call alone when the link lands inside the grace period', async () => {
    const s = setup();
    await s.start();
    await vi.advanceTimersByTimeAsync(4_000);
    s.conv().customer_id = 'CUS-1001'; // the web app's PATCH
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.conv().end_reason).toBeNull();
    expect(s.control.endCall).not.toHaveBeenCalled();
    expect(s.control.say).not.toHaveBeenCalled();
  });

  it('does not act on a call that is already linked when it starts', async () => {
    const s = setup({}, [row({ customer_id: 'CUS-1001' })]);
    await s.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.conv().end_reason).toBeNull();
  });

  it('lets turns through during the grace period and picks up a link that lands between turns', async () => {
    const s = setup();
    await s.start();
    expect(await s.turn()).toEqual({ kind: 'proceed' });
    s.conv().customer_id = 'CUS-1001';
    expect(await s.turn()).toEqual({ kind: 'proceed' });
  });

  it('refuses an account turn that arrives after the grace period, and ends the call', async () => {
    const s = setup();
    await s.start();
    // Stop the timer path so only the turn-time check is exercised.
    await vi.advanceTimersByTimeAsync(9_900);
    vi.setSystemTime(new Date(NOW.getTime() + 11_000));
    const decision = await s.turn();
    expect(decision).toEqual({ kind: 'reply', text: SESSION_TEXT.notSignedIn });
  });

  it('is off by default in the library so anonymous test calls still work', async () => {
    const s = setup({ requireLink: false });
    await s.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.conv().end_reason ?? null).toBeNull();
  });
});

describe('link grace configuration', () => {
  const base = {
    ANTHROPIC_API_KEY: 'k',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    MCP_SERVER_URL: 'http://127.0.0.1:4000/mcp',
    MCP_SERVER_AUTH_TOKEN: 't',
  };
  const original = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = original;
  });

  it('is on by default only in production, and AGENT_REQUIRE_LINK overrides either way', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(sessionConfigFromEnv(parseEnv(base)).requireLink).toBe(true);
    expect(sessionConfigFromEnv(parseEnv({ ...base, AGENT_REQUIRE_LINK: '0' })).requireLink).toBe(false);
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    expect(sessionConfigFromEnv(parseEnv(base)).requireLink).toBe(false);
    expect(sessionConfigFromEnv(parseEnv({ ...base, AGENT_REQUIRE_LINK: '1' })).requireLink).toBe(true);
  });

  it('reads the grace period, defaulting to 10 seconds', () => {
    expect(sessionConfigFromEnv(parseEnv(base)).linkGraceSeconds).toBe(10);
    expect(sessionConfigFromEnv(parseEnv({ ...base, LINK_GRACE_SECONDS: '5' })).linkGraceSeconds).toBe(5);
    expect(() => parseEnv({ ...base, LINK_GRACE_SECONDS: '0' })).toThrow(/LINK_GRACE_SECONDS/);
  });
});
