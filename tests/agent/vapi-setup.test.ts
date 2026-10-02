import { describe, expect, it } from 'vitest';
import { assistantPatch, credentialName, credentialPayload, normalizePublicUrl, redact } from '../../scripts/vapi/payload';

describe('vapi setup payloads', () => {
  it('normalizes the public URL to an https origin', () => {
    expect(normalizePublicUrl('https://abc.trycloudflare.com/')).toBe('https://abc.trycloudflare.com');
    expect(normalizePublicUrl('https://abc.trycloudflare.com/chat/completions?x=1')).toBe('https://abc.trycloudflare.com');
    expect(() => normalizePublicUrl('http://abc.example.com')).toThrow(/https/);
    expect(() => normalizePublicUrl('')).toThrow(/valid URL/);
    expect(() => normalizePublicUrl('not a url')).toThrow(/valid URL/);
  });

  it('builds the assistant patch without touching voice or transcriber', () => {
    const p = assistantPatch({ baseUrl: 'https://a.example.com', credentialId: 'cred1', webhookSecret: 'whsec-12345678' });
    expect(p.model).toMatchObject({ provider: 'custom-llm', url: 'https://a.example.com' });
    expect(p.model).not.toHaveProperty('credentialId');
    expect(p.credentialIds).toEqual(['cred1']);
    expect(p.server).toEqual({ url: 'https://a.example.com/vapi/events', secret: 'whsec-12345678' });
    // speech-update feeds the Session Controller's silence detection.
    expect(p.serverMessages).toEqual(['status-update', 'speech-update', 'end-of-call-report']);
    expect(Object.keys(p).sort()).toEqual(['credentialIds', 'model', 'server', 'serverMessages']);
    // With a session limit, Vapi also gets a slightly longer backstop and a high silence timeout.
    const limited = assistantPatch({ baseUrl: 'https://a.example.com', credentialId: 'c', webhookSecret: 'whsec-12345678', sessionMaxSeconds: 360 });
    expect(limited).toMatchObject({ maxDurationSeconds: 370, silenceTimeoutSeconds: 600 });
    expect(assistantPatch({ baseUrl: 'https://a.example.com', credentialId: 'c', webhookSecret: 'whsec-12345678', firstMessage: 'Hi' }).firstMessage).toBe('Hi');
  });

  it('builds the credential payload', () => {
    expect(credentialPayload('relaypay-agent-ad68fe71', 'tok')).toEqual({ provider: 'custom-llm', name: 'relaypay-agent-ad68fe71', apiKey: 'tok' });
    expect(credentialName('ad68fe71-7b6a-460a-8013-5acfe8f8fd77')).toBe('relaypay-agent-ad68fe71');
  });

  it('redacts secrets at any depth', () => {
    const out = redact({ server: { url: 'u', secret: 's3cret' }, headers: { Authorization: 'Bearer x' }, apiKey: 'k', keep: 1 });
    expect(JSON.stringify(out)).not.toMatch(/s3cret|Bearer x|"k"/);
    expect(out).toMatchObject({ server: { url: 'u' }, keep: 1 });
  });
});
