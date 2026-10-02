'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { titleWithCount } from '@/lib/human/notify';

/** Puts a count in the browser tab's title while there is something to look at. Restores the title when it clears. */
export function useTabTitle(count: number): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.title.replace(/^\(\d+(\+)?\)\s*/, '');
    document.title = titleWithCount(original, count);
    return () => {
      document.title = original;
    };
  }, [count]);
}

/** Same-page changes to a saved choice reach every component reading it (the browser only announces other tabs'). */
const flagListeners = new Set<() => void>();
/** Used when storage is blocked: the choice then lasts for this visit only. */
const memoryFlags = new Map<string, boolean>();

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return memoryFlags.get(key) ?? false;
  }
}

function subscribeFlags(onChange: () => void): () => void {
  flagListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    flagListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** A saved on/off choice (in this browser only). Nothing is on until the person turns it on, and the server renders it off. */
export function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    subscribeFlags,
    () => readFlag(key),
    () => false,
  );
  const set = useCallback(
    (value: boolean) => {
      memoryFlags.set(key, value);
      try {
        window.localStorage.setItem(key, value ? '1' : '0');
      } catch {
        // see above
      }
      flagListeners.forEach((listener) => listener());
    },
    [key],
  );
  return [on, set];
}

type AudioContextCtor = typeof AudioContext;

/**
 * A short, quiet two-note chime. It only works after the person has turned it on (browsers refuse sound before a click),
 * so the audio context is created from the click that switches it on, by `prepare`.
 */
export function useChime() {
  const ctx = useRef<AudioContext | null>(null);

  const prepare = useCallback(() => {
    if (ctx.current || typeof window === 'undefined') return;
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    try {
      ctx.current = new Ctor();
    } catch {
      ctx.current = null;
    }
  }, []);

  const play = useCallback(() => {
    const audio = ctx.current;
    if (!audio) return;
    try {
      if (audio.state === 'suspended') void audio.resume();
      const now = audio.currentTime;
      [660, 880].forEach((hz, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, now + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.16 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.14);
        osc.connect(gain).connect(audio.destination);
        osc.start(now + i * 0.16);
        osc.stop(now + i * 0.16 + 0.15);
      });
    } catch {
      // A missing sound is not worth an error.
    }
  }, []);

  return { prepare, play };
}

const permissionListeners = new Set<() => void>();

function readPermission(): 'unsupported' | NotificationPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Desktop notifications: asked for only from a click, shown only while the page is hidden, never with message text. */
export function useDesktopNotifications() {
  const permission = useSyncExternalStore(
    (onChange) => {
      permissionListeners.add(onChange);
      return () => void permissionListeners.delete(onChange);
    },
    readPermission,
    () => 'unsupported' as const,
  );

  const request = useCallback(async (): Promise<boolean> => {
    if (typeof Notification === 'undefined') return false;
    const result = await Notification.requestPermission();
    permissionListeners.forEach((listener) => listener());
    return result === 'granted';
  }, []);

  const show = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
    try {
      new Notification(title, { body, tag: 'relaypay-inbox' });
    } catch {
      // Some browsers only allow notifications from a service worker; skip quietly.
    }
  }, []);

  return { permission, request, show };
}
