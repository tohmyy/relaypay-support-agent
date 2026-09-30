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

  it.each(Object.keys(full))('web rejects %s when missing or empty', (key) => {
    for (const value of [undefined, '']) {
      const env = { ...full, [key]: value };
      const parse = key.startsWith('NEXT_PUBLIC_') ? parsePublicEnv : parseServerEnv;
      expect(() => parse(env)).toThrow(key);
    }
  });

  it('services require only their own variables', () => {
    const { VAPI_API_KEY, VAPI_ASSISTANT_ID, ...rest } = full;
    void VAPI_API_KEY; void VAPI_ASSISTANT_ID;
    expect(() => parseMcp(rest)).not.toThrow();
    expect(() => parseAgent(rest)).not.toThrow();
    expect(() => parseMcp({})).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(() => parseAgent({})).toThrow('ANTHROPIC_API_KEY');
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
