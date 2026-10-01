import type { ErrorKind } from './state';
import type { VoiceClient, VoiceClientHandlers } from './client';

interface VapiMessage {
  type?: string;
  role?: string;
  status?: string;
  transcriptType?: string;
  transcript?: string;
}

/** Maps whatever the provider reports to a customer-safe error category. */
export function classifyVapiError(error: unknown): ErrorKind {
  const e = (error ?? {}) as { name?: unknown; message?: unknown };
  let json = '';
  try {
    json = JSON.stringify(error) ?? '';
  } catch {
    // Circular or unserializable errors are classified from name and message alone.
  }
  const text = `${String(e.name ?? '')} ${String(e.message ?? '')} ${json}`.toLowerCase();
  if (/notallowed|permission|microphone|notfound|device/.test(text)) return 'microphone';
  return 'connection';
}

/**
 * Wraps the Vapi web SDK. The SDK is imported only when a call starts, so nothing voice-related loads
 * with the page. The conversation id is the call id with the `vapi_` prefix, which is exactly what the
 * agent server derives from Vapi's requests.
 */
export function createVapiClient(opts: { publicKey: string; assistantId: string }): VoiceClient {
  let vapi: import('@vapi-ai/web').default | undefined;

  return {
    async start(h: VoiceClientHandlers) {
      const { default: Vapi } = await import('@vapi-ai/web');
      const instance = new Vapi(opts.publicKey);
      vapi = instance;

      instance.on('call-start', () => h.onCallStart());
      instance.on('call-end', () => h.onCallEnd());
      instance.on('speech-start', () => h.onAssistantSpeech(true));
      instance.on('speech-end', () => h.onAssistantSpeech(false));
      instance.on('volume-level', (level: number) => h.onVolume(level));
      instance.on('error', (error: unknown) => h.onError(classifyVapiError(error)));
      instance.on('message', (raw: unknown) => {
        const m = raw as VapiMessage;
        if (m.type === 'transcript' && (m.role === 'user' || m.role === 'assistant') && m.transcript) {
          h.onTranscript({ role: m.role, text: m.transcript, final: m.transcriptType === 'final' });
        } else if (m.type === 'speech-update' && m.role === 'user') {
          h.onUserSpeech(m.status === 'started');
        }
      });

      const call = await instance.start(opts.assistantId);
      if (!call?.id) throw new Error('call did not start');
      return { conversationId: `vapi_${call.id}`.slice(0, 64) };
    },

    async stop() {
      await vapi?.stop();
    },

    send(text: string) {
      vapi?.send({ type: 'add-message', message: { role: 'user', content: text } });
    },
  };
}
