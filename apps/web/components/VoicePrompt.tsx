import { VOICE_PROMPT } from '@/lib/copy';
import type { VoiceState } from '@/lib/voice/state';

/** Contextual line under the status, for example after the assistant finishes speaking. */
export default function VoicePrompt({ state, hasConversation }: { state: VoiceState; hasConversation: boolean }) {
  const text = state === 'listening' && hasConversation ? VOICE_PROMPT.listening : undefined;
  if (!text) return null;
  return <p className="text-center text-sm text-ink-secondary">{text}</p>;
}
