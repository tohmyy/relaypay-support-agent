import { COPY } from '@/lib/copy';

/**
 * Quiet, polite notices about the customer's audio: muted, or a noisy room. Both are best effort and advisory only: they
 * never block the call and appear only when the browser could actually tell (nothing is shown otherwise). The container is
 * always in the page so a screen reader announces a notice when it appears.
 */
export default function AudioNotices({ muted, noisy }: { muted: boolean; noisy: boolean }) {
  return (
    <div role="status" aria-live="polite" data-testid="audio-notices">
      {muted && <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card">{COPY.audio.muted}</p>}
      {noisy && !muted && (
        <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-secondary shadow-card">{COPY.audio.noisy}</p>
      )}
    </div>
  );
}
