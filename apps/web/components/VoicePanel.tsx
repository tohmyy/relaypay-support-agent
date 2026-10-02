import type { VoiceState } from '@/lib/voice/state';
import { COPY } from '@/lib/copy';
import VoiceControl from './VoiceControl';
import VoicePrompt from './VoicePrompt';
import VoiceStatus from './VoiceStatus';
import VoiceVisualizer from './VoiceVisualizer';

interface Props {
  state: VoiceState;
  level: number;
  hasConversation: boolean;
  onStart(): void;
  onEnd(): void;
  unavailable?: boolean;
  muted?: boolean;
  muteFailed?: boolean;
  onToggleMute?(): void;
}

/** Visualizer, state text, prompt and the primary control, stacked and centered. */
export default function VoicePanel({
  state,
  level,
  hasConversation,
  onStart,
  onEnd,
  unavailable,
  muted = false,
  muteFailed = false,
  onToggleMute,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <VoiceVisualizer state={state} level={level} />
      <VoiceStatus state={state} />
      <VoicePrompt state={state} hasConversation={hasConversation} />
      <div className="flex w-full justify-center pt-2">
        <VoiceControl state={state} onStart={onStart} onEnd={onEnd} unavailable={unavailable} />
      </div>
      {onToggleMute && !['idle', 'connecting', 'ending', 'ended', 'error'].includes(state) && (
        <button
          type="button"
          aria-pressed={muted}
          onClick={onToggleMute}
          className="min-h-11 rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-subtle"
        >
          {muted ? COPY.audio.unmute : COPY.audio.mute}
        </button>
      )}
      {muteFailed && (
        <p role="alert" className="text-sm text-danger">
          {COPY.audio.muteFailed}
        </p>
      )}
    </div>
  );
}
