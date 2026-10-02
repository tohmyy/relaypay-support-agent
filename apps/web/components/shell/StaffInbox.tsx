'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChime, useDesktopNotifications, useStoredFlag, useTabTitle } from '@/hooks/useAttention';
import { usePolling, type PollResult } from '@/hooks/usePolling';
import type { QueueItem, StaffQueue } from '@/lib/dashboard/staff';
import { attentionCount, newlyWaiting, waitingIds } from '@/lib/human/notify';
import { STAFF_COPY } from '@/lib/shell-copy';

export type InboxData = StaffQueue & { waitingCount: number; unreadCount: number };

interface InboxValue {
  data: InboxData | null;
  trouble: boolean;
  /** Chats nobody has taken, plus this person's own with unread messages: the number shown beside "Queue". */
  attention: number;
  refresh: () => Promise<PollResult>;
  soundOn: boolean;
  setSound: (on: boolean) => void;
  desktopOn: boolean;
  desktopPermission: 'unsupported' | NotificationPermission;
  setDesktop: (on: boolean) => Promise<void>;
}

const InboxContext = createContext<InboxValue | null>(null);

/** The inbox, if the page is inside a provider; pages outside it (and tests) get null. */
export function useOptionalInbox(): InboxValue | null {
  return useContext(InboxContext);
}

export function useStaffInbox(): InboxValue {
  const value = useContext(InboxContext);
  if (!value) throw new Error('useStaffInbox needs a StaffInboxProvider');
  return value;
}

/**
 * One live copy of the staff queue for every staff page: polled once (every few seconds, slower when the tab is hidden),
 * shared by the queue tables, the navigation count and the tab title. When a conversation newly starts waiting it can
 * chime and show a desktop notification, but only if this person turned those on, and only while they are not already
 * looking at the page. Nothing here asks for a permission by itself.
 */
export function StaffInboxProvider({
  initial,
  pollMs = 5000,
  hiddenPollMs = 20_000,
  children,
}: {
  initial: InboxData | null;
  pollMs?: number;
  hiddenPollMs?: number;
  children: ReactNode;
}) {
  const [data, setData] = useState<InboxData | null>(initial);
  const [trouble, setTrouble] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [soundOn, setSound] = useStoredFlag('rp_staff_sound');
  const [desktopOn, setDesktopFlag] = useStoredFlag('rp_staff_desktop');
  const chime = useChime();
  const desktop = useDesktopNotifications();

  const seen = useRef<Set<string> | null>(initial ? waitingIds(initial.items) : null);
  const prefs = useRef({ soundOn, desktopOn });
  useEffect(() => {
    prefs.current = { soundOn, desktopOn };
  });

  const refresh = useCallback(async (): Promise<PollResult> => {
    try {
      const res = await fetch('/api/staff/queue', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as InboxData;
      setTrouble(false);
      const fresh = newlyWaiting(seen.current, next.items);
      seen.current = waitingIds(next.items);
      setData(next);
      if (fresh.length > 0) {
        setAnnouncement(STAFF_COPY.queue.newWaiting);
        const looking = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
        if (!looking && prefs.current.soundOn) chime.play();
        if (prefs.current.desktopOn) desktop.show(STAFF_COPY.alerts.desktopTitle, STAFF_COPY.queue.newWaiting);
      }
      return 'ok';
    } catch {
      setTrouble(true);
      return 'failed';
    }
  }, [chime, desktop]);

  usePolling(refresh, { foregroundMs: pollMs, hiddenMs: hiddenPollMs });

  const attention = useMemo(() => (data ? attentionCount(data.items) : 0), [data]);
  useTabTitle(attention);

  const setDesktop = useCallback(
    async (on: boolean) => {
      if (!on) return setDesktopFlag(false);
      // The browser's permission question is asked only now, from the click that turned this on.
      setDesktopFlag(await desktop.request());
    },
    [desktop, setDesktopFlag],
  );

  const turnSound = useCallback(
    (on: boolean) => {
      if (on) chime.prepare();
      setSound(on);
    },
    [chime, setSound],
  );

  const value: InboxValue = {
    data,
    trouble,
    attention,
    refresh,
    soundOn,
    setSound: turnSound,
    desktopOn,
    desktopPermission: desktop.permission,
    setDesktop,
  };
  return (
    <InboxContext.Provider value={value}>
      {children}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </InboxContext.Provider>
  );
}

export type { QueueItem };
