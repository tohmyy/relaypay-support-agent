/**
 * The Vapi organization may be shared, so the credential name is tied to this assistant. A generic name could
 * match someone else's credential, and refreshing its key would break their assistants.
 */
export function credentialName(assistantId: string): string {
  return `relaypay-agent-${assistantId.slice(0, 8)}`;
}
export const MODEL_NAME = 'relaypay-support-agent';

/** Base URL Vapi should call: https only, no trailing slash, no path. */
export function normalizePublicUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('--url must be a valid URL, for example https://example.trycloudflare.com');
  }
  if (url.protocol !== 'https:') throw new Error('--url must be https (Vapi cannot reach plain http)');
  return url.origin;
}

export function credentialPayload(name: string, apiKey: string) {
  return { provider: 'custom-llm', name, apiKey };
}

/**
 * The parts of the existing assistant this integration changes: the LLM (our endpoint), the webhook and the
 * server messages. Voice, transcriber and other settings are left as the user configured them.
 */
export function assistantPatch(opts: {
  baseUrl: string;
  credentialId: string;
  webhookSecret: string;
  firstMessage?: string;
}) {
  return {
    model: {
      provider: 'custom-llm',
      url: opts.baseUrl,
      model: MODEL_NAME,
      // The RelayPay agent owns its instructions; this only satisfies the assistant schema.
      messages: [{ role: 'system', content: 'The RelayPay support agent supplies its own instructions.' }],
      metadataSendMode: 'variable',
    },
    // The API rejects credentialId on the model; credentials are attached to the assistant instead.
    credentialIds: [opts.credentialId],
    server: { url: `${opts.baseUrl}/vapi/events`, secret: opts.webhookSecret },
    serverMessages: ['status-update', 'end-of-call-report'],
    ...(opts.firstMessage ? { firstMessage: opts.firstMessage } : {}),
  };
}

/** Copy of a payload that is safe to print. */
export function redact<T>(value: T): T {
  const SECRET = /secret|apikey|token|authorization/i;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET.test(k) ? '<hidden>' : walk(x)]),
      );
    }
    return v;
  };
  return walk(value) as T;
}
