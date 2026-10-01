import { Loader2, Mic, PhoneOff, RotateCcw } from 'lucide-react';
import { COPY } from '@/lib/copy';
import type { VoiceState } from '@/lib/voice/state';

interface Props {
  state: VoiceState;
  onStart(): void;
  onEnd(): void;
  /** True when voice support cannot be started (missing configuration). */
  unavailable?: boolean;
}

const BASE =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-64';
const PRIMARY = `${BASE} bg-primary text-white hover:bg-primary-hover active:bg-primary-hover`;
const OUTLINE = `${BASE} border border-ink-secondary bg-surface text-ink hover:bg-surface-subtle`;

/** The one primary action. Label, icon and enabled state follow the voice state. */
export default function VoiceControl({ state, onStart, onEnd, unavailable }: Props) {
  switch (state) {
    case 'idle':
      return (
        <button type="button" className={PRIMARY} onClick={onStart} disabled={unavailable}>
          <Mic aria-hidden className="h-5 w-5" />
          {COPY.buttons.start}
        </button>
      );
    case 'connecting':
      return (
        <button type="button" className={PRIMARY} disabled aria-busy="true">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin-slow" />
          {COPY.buttons.connecting}
        </button>
      );
    case 'ending':
      return (
        <button type="button" className={OUTLINE} disabled aria-busy="true">
          <PhoneOff aria-hidden className="h-5 w-5" />
          {COPY.buttons.end}
        </button>
      );
    case 'ended':
      return (
        <button type="button" className={PRIMARY} onClick={onStart}>
          <RotateCcw aria-hidden className="h-5 w-5" />
          {COPY.buttons.startAnother}
        </button>
      );
    case 'error':
      return (
        <button type="button" className={PRIMARY} onClick={onStart}>
          <RotateCcw aria-hidden className="h-5 w-5" />
          {COPY.buttons.tryAgain}
        </button>
      );
    default:
      return (
        <button type="button" className={OUTLINE} onClick={onEnd}>
          <PhoneOff aria-hidden className="h-5 w-5" />
          {COPY.buttons.end}
        </button>
      );
  }
}
