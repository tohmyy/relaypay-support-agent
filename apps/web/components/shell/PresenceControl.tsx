'use client';

import { useCallback, useState } from 'react';
import { usePolling, type PollResult } from '@/hooks/usePolling';
import { HEARTBEAT_MS } from '@/lib/human/presence';
import { STAFF_COPY } from '@/lib/shell-copy';

/**
 * The "available for chats" switch, and the heartbeat that makes it true. While it is on and a staff page is open, the
 * page tells the server every ~30 seconds that this person is here; a closed tab or a sleeping laptop simply stops, and
 * after about a minute and a half they no longer count as online. Switching it off takes effect at once.
 */
export default function PresenceControl({ initialAvailable }: { initialAvailable: boolean }) {
  const [available, setAvailable] = useState(initialAvailable);
  const [failed, setFailed] = useState(false);
  const copy = STAFF_COPY.presence;

  const beat = useCallback(async (): Promise<PollResult> => {
    try {
      const res = await fetch('/api/staff/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return res.ok ? 'ok' : 'failed';
    } catch {
      return 'failed';
    }
  }, []);

  // Browsers slow timers in hidden tabs, so the window is generous; the beat is the same hidden or not.
  usePolling(beat, { foregroundMs: HEARTBEAT_MS, hiddenMs: HEARTBEAT_MS, enabled: available });

  async function toggle() {
    const next = !available;
    setFailed(false);
    try {
      const res = await fetch('/api/staff/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAvailable(next);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={available}
        aria-describedby="presence-hint"
        onClick={() => void toggle()}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-subtle"
      >
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${available ? 'bg-success' : 'bg-ink-muted'}`} />
        <span>{copy.label}</span>
        <span className="text-ink-secondary">{available ? copy.on : copy.off}</span>
      </button>
      <span id="presence-hint" className="sr-only">
        {copy.hint}
      </span>
      {failed && (
        <span role="alert" className="text-xs text-danger">
          {copy.failed}
        </span>
      )}
    </div>
  );
}
