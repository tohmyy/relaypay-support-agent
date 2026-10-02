import { describe, expect, it } from 'vitest';
import { parsePublicEnv, parseServerEnv } from '../apps/web/lib/env';
import { parseEnv as parseMcp } from '../services/mcp/src/env';
import { parseEnv as parseAgent } from '../services/agent/src/env';

const full = {
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_VAPI_PUBLIC_KEY: 'pub',
  VAPI_API_KEY: 'vk-secret',
  VAPI_ASSISTANT_ID: 'asst',
  ANTHROPIC_API_KEY: 'sk-secret',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
  MCP_SERVER_URL: 'http://localhost:4000',
  MCP_SERVER_AUTH_TOKEN: 'tok-secret',
};

describe('env validation', () => {
  it('accepts a complete environment', () => {
    expect(parsePublicEnv(full).NEXT_PUBLIC_APP_URL).toBe(full.NEXT_PUBLIC_APP_URL);
    expect(parseServerEnv(full).VAPI_API_KEY).toBe('vk-secret');
    expect(parseMcp(full).SUPABASE_URL).toBe(full.SUPABASE_URL);
    expect(parseAgent(full).ANTHROPIC_API_KEY).toBe('sk-secret');
  });

  it.each(Object.keys(full).filter((k) => k !== 'NEXT_PUBLIC_APP_URL'))('web rejects %s when missing or empty', (key) => {
    for (const value of [undefined, '']) {
      const env = { ...full, [key]: value };
      const parse = key.startsWith('NEXT_PUBLIC_') ? parsePublicEnv : parseServerEnv;
      expect(() => parse(env)).toThrow(key);
    }
  });

  it('treats NEXT_PUBLIC_APP_URL as optional but validates it when present', () => {
    const { NEXT_PUBLIC_APP_URL, ...rest } = full;
    void NEXT_PUBLIC_APP_URL;
    expect(() => parsePublicEnv(rest)).not.toThrow();
    expect(() => parsePublicEnv({ ...full, NEXT_PUBLIC_APP_URL: 'not a url' })).toThrow('NEXT_PUBLIC_APP_URL');
  });

  it('services require only their own variables', () => {
    const { VAPI_API_KEY, VAPI_ASSISTANT_ID, ...rest } = full;
    void VAPI_API_KEY; void VAPI_ASSISTANT_ID;
    expect(() => parseMcp(rest)).not.toThrow();
    expect(() => parseAgent(rest)).not.toThrow();
    expect(() => parseMcp({})).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(() => parseAgent({})).toThrow('ANTHROPIC_API_KEY');
  });

  it('gives the agent session limits sensible defaults and lets them be tuned', () => {
    const d = parseAgent(full);
    expect([d.SESSION_MAX_SECONDS, d.SESSION_WARNING_SECONDS, d.SILENCE_TIMEOUT_SECONDS, d.SILENCE_COUNTDOWN_SECONDS]).toEqual([360, 30, 10, 10]);
    const blank = parseAgent({ ...full, SILENCE_TIMEOUT_SECONDS: '' });
    expect(blank.SILENCE_TIMEOUT_SECONDS).toBe(10);
    const tuned = parseAgent({ ...full, SESSION_MAX_SECONDS: '60', SILENCE_TIMEOUT_SECONDS: '5' });
    expect([tuned.SESSION_MAX_SECONDS, tuned.SILENCE_TIMEOUT_SECONDS]).toEqual([60, 5]);
    expect(() => parseAgent({ ...full, SESSION_MAX_SECONDS: 'abc' })).toThrow('SESSION_MAX_SECONDS');
    expect(() => parseAgent({ ...full, SILENCE_COUNTDOWN_SECONDS: '0' })).toThrow('SILENCE_COUNTDOWN_SECONDS');
  });

  it('defaults the latency settings: acknowledgement after 2.5s, pre-start off', () => {
    const d = parseAgent(full);
    expect([d.ACK_AFTER_MS, d.AGENT_PREWARM, d.PREWARM_MAX, d.PREWARM_TTL_SECONDS]).toEqual([2500, '0', 8, 90]);
    expect(parseAgent({ ...full, ACK_AFTER_MS: '' }).ACK_AFTER_MS).toBe(2500);
    const tuned = parseAgent({ ...full, ACK_AFTER_MS: '1500', AGENT_PREWARM: '1', PREWARM_MAX: '3', PREWARM_TTL_SECONDS: '45' });
    expect([tuned.ACK_AFTER_MS, tuned.AGENT_PREWARM, tuned.PREWARM_MAX, tuned.PREWARM_TTL_SECONDS]).toEqual([1500, '1', 3, 45]);
  });

  it('rejects nonsense latency settings by name', () => {
    expect(() => parseAgent({ ...full, AGENT_PREWARM: 'yes' })).toThrow('AGENT_PREWARM');
    expect(() => parseAgent({ ...full, ACK_AFTER_MS: '50' })).toThrow('ACK_AFTER_MS');
    expect(() => parseAgent({ ...full, PREWARM_MAX: '0' })).toThrow('PREWARM_MAX');
    expect(() => parseAgent({ ...full, PREWARM_TTL_SECONDS: 'soon' })).toThrow('PREWARM_TTL_SECONDS');
  });

  it('never leaks values in errors', () => {
    const bad = { ...full, SUPABASE_URL: 'not-a-url-secret-value' };
    for (const fn of [() => parseServerEnv(bad), () => parseMcp(bad)]) {
      try { fn(); } catch (e) {
        expect((e as Error).message).toContain('SUPABASE_URL');
        expect((e as Error).message).not.toContain('secret-value');
      }
    }
  });
});
