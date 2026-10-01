import type { VoiceState } from '@/lib/voice/state';

const BARS = 5;
// Resting heights in pixels, and a fixed pattern for speaking so the state still reads without motion.
const REST = [10, 16, 22, 16, 10];
const SPEAKING = [18, 30, 42, 30, 18];

const LABEL: Partial<Record<VoiceState, string>> = {
  listening: 'Microphone is on',
  'user-speaking': 'You are speaking',
  processing: 'Waiting for the response',
  'assistant-speaking': 'RelayPay Support is speaking',
};

/**
 * Restrained activity indicator. Static when nothing is happening; it moves only while someone is
 * speaking. The status text carries the meaning, so this never has to be seen to use the page.
 */
export default function VoiceVisualizer({ state, level = 0 }: { state: VoiceState; level?: number }) {
  const speaking = state === 'user-speaking' || state === 'assistant-speaking';
  const active = speaking || state === 'listening';
  const scale = state === 'assistant-speaking' ? 0.55 + Math.min(Math.max(level, 0), 1) * 0.6 : 1;
  const pattern = speaking ? SPEAKING : REST;

  return (
    <div
      role="img"
      aria-label={LABEL[state] ?? 'Voice activity'}
      data-voice-visualizer={state}
      className={`flex h-20 w-20 items-center justify-center gap-1.5 rounded-full border ${
        active ? 'border-accent bg-accent-soft' : 'border-line bg-surface-subtle'
      }`}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          style={{
            height: `${Math.round(pattern[i] * scale)}px`,
            animationDelay: state === 'user-speaking' ? `${i * 110}ms` : undefined,
          }}
          className={`w-1.5 origin-center rounded-full transition-[height] duration-150 ${
            active ? 'bg-accent' : 'bg-ink-muted/60'
          } ${state === 'user-speaking' ? 'animate-voice-wave' : ''}`}
        />
      ))}
    </div>
  );
}
