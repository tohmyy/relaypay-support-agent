import { errorMessage, logEvent } from '../logger';

/** The call handle the controller knows about: Vapi's call id and, when Vapi sends one, its live-control URL. */
export interface CallHandle {
  callId?: string;
  controlUrl?: string;
}

/**
 * Server-initiated actions on a live Vapi call. Both return true only when Vapi accepted the request; callers
 * treat false as "not available" and rely on the other enforcement layers (turn refusal, Vapi maxDurationSeconds,
 * client stop).
 */
export interface VapiCallControl {
  say(call: CallHandle, text: string, opts?: { endAfter?: boolean }): Promise<boolean>;
  endCall(call: CallHandle): Promise<boolean>;
}

export const noopCallControl: VapiCallControl = {
  say: async () => false,
  endCall: async () => false,
};

const VAPI_API = 'https://api.vapi.ai';

/** Live-control URLs only ever point at Vapi; refuse anything else even though the webhook is authenticated. */
function safeControlUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'vapi.ai' || u.hostname.endsWith('.vapi.ai'))
      ? u.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function createVapiCallControl(
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): VapiCallControl {
  const doFetch = opts.fetchImpl ?? fetch;

  async function post(url: string, body: unknown): Promise<boolean> {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch (error) {
      logEvent('warn', 'vapi control request failed', { message: errorMessage(error) });
      return false;
    }
  }

  return {
    async say(call, text, o = {}) {
      const url = safeControlUrl(call.controlUrl);
      if (!url) return false;
      return post(url, { type: 'say', content: text, endCallAfterSpoken: Boolean(o.endAfter) });
    },
    async endCall(call) {
      const url = safeControlUrl(call.controlUrl);
      if (url && (await post(url, { type: 'end-call' }))) return true;
      // Fallback: Vapi REST. UNVERIFIED for live web calls (see docs/VAPI.md, "Ending a call from the server").
      if (opts.apiKey && call.callId && /^[A-Za-z0-9_-]{1,64}$/.test(call.callId)) {
        try {
          const res = await doFetch(`${VAPI_API}/call/${encodeURIComponent(call.callId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${opts.apiKey}` },
          });
          return res.ok;
        } catch (error) {
          logEvent('warn', 'vapi end call failed', { message: errorMessage(error) });
        }
      }
      return false;
    },
  };
}
