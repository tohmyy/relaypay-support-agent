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
export const SERVER_MESSAGES = ['status-update', 'speech-update', 'end-of-call-report'];

/**
 * Whether an assistant's serverMessages include everything the agent depends on. `speech-update` is the one that is
 * easy to lose: without it silence detection and the end-after-goodbye hang-up quietly stop working.
 */
export function missingServerMessages(serverMessages: unknown): string[] {
  const have = Array.isArray(serverMessages) ? serverMessages : [];
  return SERVER_MESSAGES.filter((m) => !have.includes(m));
}

/** Throws when the patch about to be applied (or the one a dry run shows) would drop a required server message. */
export function assertServerMessages(patch: { serverMessages?: unknown }): void {
  const missing = missingServerMessages(patch.serverMessages);
  if (missing.length > 0) {
    throw new Error(`The assistant's serverMessages must include: ${missing.join(', ')}`);
  }
}
/** Margin between the controller's own time limit and Vapi's independent backstop. */
export const MAX_DURATION_MARGIN_SECONDS = 10;
/** Vapi's silence timeout is set high so the Session Controller (silence + countdown) is the authority. */
export const VAPI_SILENCE_BACKSTOP_SECONDS = 600;

/**
 * How readily the customer can talk over the assistant, and how much background noise counts as speech. Every field
 * is optional: a field that is not set leaves the assistant exactly as it is configured in Vapi.
 */
export interface InterruptionSettings {
  /** Words the customer must say before the assistant stops (0 = react at once; 0 to 10). Plain "okay" never interrupts. */
  numWords?: number;
  /** Seconds of voice before the assistant stops, when numWords is 0 (0 to 0.5; Vapi's default is 0.2). */
  voiceSeconds?: number;
  /** Seconds the assistant waits before speaking again after being interrupted (0 to 10; default 1). */
  backoffSeconds?: number;
  /** Seconds the assistant waits after the customer stops before it answers (0 to 5; default 0.4). */
  waitSeconds?: number;
  /** Krisp background-noise removal on Vapi's side. */
  smartDenoising?: boolean;
  /**
   * Smart endpointing: Vapi waits longer after a sentence that sounds unfinished ("more info. I made...") before it
   * decides the customer is done, so a thinking pause does not become its own turn.
   */
  smartEndpointing?: 'vapi' | 'livekit';
}

/** The plans the assistant has today (from GET), so changing one field does not reset the others. */
export interface CurrentPlans {
  stopSpeakingPlan?: Record<string, unknown> | null;
  startSpeakingPlan?: Record<string, unknown> | null;
  backgroundSpeechDenoisingPlan?: Record<string, unknown> | null;
}

const INTERRUPTION_VARIABLES = {
  numWords: { name: 'INTERRUPT_NUM_WORDS', min: 0, max: 10, integer: true },
  voiceSeconds: { name: 'INTERRUPT_VOICE_SECONDS', min: 0, max: 0.5, integer: false },
  backoffSeconds: { name: 'INTERRUPT_BACKOFF_SECONDS', min: 0, max: 10, integer: false },
  waitSeconds: { name: 'START_WAIT_SECONDS', min: 0, max: 5, integer: false },
} as const;

/**
 * Reads the optional tuning variables. Blank or missing means "leave it alone". Anything out of range is reported by
 * variable name only, so a typo cannot silently change how the assistant listens.
 */
export function interruptionFromEnv(env: Record<string, string | undefined>): InterruptionSettings {
  const out: InterruptionSettings = {};
  const bad: string[] = [];
  for (const [key, rule] of Object.entries(INTERRUPTION_VARIABLES)) {
    const raw = (env[rule.name] ?? '').trim();
    if (raw === '') continue;
    const n = Number(raw);
    const ok = Number.isFinite(n) && n >= rule.min && n <= rule.max && (!rule.integer || Number.isInteger(n));
    if (ok) (out as Record<string, number>)[key] = n;
    else bad.push(rule.name);
  }
  const denoise = (env.SMART_DENOISING ?? '').trim();
  if (denoise === '1' || denoise === '0') out.smartDenoising = denoise === '1';
  else if (denoise !== '') bad.push('SMART_DENOISING');
  const endpointing = (env.SMART_ENDPOINTING ?? '').trim();
  if (endpointing === 'vapi' || endpointing === 'livekit') out.smartEndpointing = endpointing;
  else if (endpointing !== '') bad.push('SMART_ENDPOINTING');
  if (bad.length > 0) throw new Error(`Missing or invalid environment variables: ${bad.join(', ')}`);
  return out;
}

/**
 * The assistant fields that apply the settings that were actually given. Each plan is the assistant's current plan
 * with only those fields changed, because a PATCH replaces a nested plan as a whole.
 */
export function interruptionPatch(settings: InterruptionSettings = {}, current: CurrentPlans = {}) {
  const stop: Record<string, unknown> = {};
  for (const key of ['numWords', 'voiceSeconds', 'backoffSeconds'] as const) {
    if (settings[key] !== undefined) stop[key] = settings[key];
  }
  return {
    ...(Object.keys(stop).length > 0 ? { stopSpeakingPlan: { ...current.stopSpeakingPlan, ...stop } } : {}),
    ...(settings.waitSeconds !== undefined || settings.smartEndpointing !== undefined
      ? {
          startSpeakingPlan: {
            ...current.startSpeakingPlan,
            ...(settings.waitSeconds !== undefined ? { waitSeconds: settings.waitSeconds } : {}),
            ...(settings.smartEndpointing !== undefined
              ? {
                  smartEndpointingPlan: {
                    ...(current.startSpeakingPlan?.smartEndpointingPlan as Record<string, unknown> | undefined),
                    provider: settings.smartEndpointing,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(settings.smartDenoising !== undefined
      ? {
          backgroundSpeechDenoisingPlan: {
            ...current.backgroundSpeechDenoisingPlan,
            smartDenoisingPlan: {
              ...(current.backgroundSpeechDenoisingPlan?.smartDenoisingPlan as Record<string, unknown> | undefined),
              enabled: settings.smartDenoising,
            },
          },
        }
      : {}),
  };
}

export function assistantPatch(opts: {
  baseUrl: string;
  credentialId: string;
  webhookSecret: string;
  firstMessage?: string;
  /** SESSION_MAX_SECONDS: when given, Vapi also enforces a slightly longer limit as a backstop. */
  sessionMaxSeconds?: number;
  /** Opt-in interruption and noise tuning. Nothing here is applied unless a field is set. */
  interruption?: InterruptionSettings;
  /** The assistant's current speaking and denoising plans, merged under the settings above. */
  current?: CurrentPlans;
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
    serverMessages: SERVER_MESSAGES,
    ...(opts.sessionMaxSeconds
      ? {
          maxDurationSeconds: opts.sessionMaxSeconds + MAX_DURATION_MARGIN_SECONDS,
          silenceTimeoutSeconds: VAPI_SILENCE_BACKSTOP_SECONDS,
        }
      : {}),
    ...(opts.firstMessage ? { firstMessage: opts.firstMessage } : {}),
    ...interruptionPatch(opts.interruption, opts.current),
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
