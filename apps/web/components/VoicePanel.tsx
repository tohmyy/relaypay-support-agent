import type { VoiceState } from '@/lib/voice/state';
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
}

/** Visualizer, state text, prompt and the primary control, stacked and centered. */
export default function VoicePanel({ state, level, hasConversation, onStart, onEnd, unavailable }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <VoiceVisualizer state={state} level={level} />
      <VoiceStatus state={state} />
      <VoicePrompt state={state} hasConversation={hasConversation} />
      <div className="flex w-full justify-center pt-2">
        <VoiceControl state={state} onStart={onStart} onEnd={onEnd} unavailable={unavailable} />
      </div>
    </div>
  );
}
