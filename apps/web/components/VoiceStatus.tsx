import { Loader2 } from 'lucide-react';
import { VOICE_STATUS } from '@/lib/copy';
import type { VoiceState } from '@/lib/voice/state';

/**
 * Visible state text plus a polite live region for screen readers. Rapid speaking changes are
 * announced as "Listening" only, so a screen reader is not interrupted while the customer talks.
 */
export default function VoiceStatus({ state }: { state: VoiceState }) {
  const { label } = VOICE_STATUS[state];
  const announced = VOICE_STATUS[state === 'user-speaking' ? 'listening' : state].screenReader;
  return (
    <div className="flex min-h-7 items-center justify-center gap-2 text-center" data-voice-state={state}>
      {(state === 'processing' || state === 'connecting' || state === 'ending') && (
        <Loader2 aria-hidden className="h-4 w-4 animate-spin-slow text-accent" />
      )}
      <p aria-hidden className="text-lg font-medium text-ink">
        {label}
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {announced}
      </div>
    </div>
  );
}
