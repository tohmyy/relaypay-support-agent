/**
 * Helpers for the developer-only voice lab (/dev/voice-lab). The lab logs what a real call does when it is muted, left
 * and rejoined. It must be safe to paste that log into a document, so a message is summarised by its *shape* only:
 * a few short labels, never what anyone said.
 */
export type LabKind = 'action' | 'event' | 'message' | 'error' | 'note';

export interface LabEntry {
  /** Milliseconds since the lab's first entry. */
  at: number;
  kind: LabKind;
  text: string;
  /** How many identical entries in a row this stands for (a stream of partial transcripts is one line, not fifty). */
  count?: number;
  /** When the last of those repeats happened. */
  until?: number;
}

/** The only message fields that are ever shown, and only when they look like a short label. */
const SHOWN_FIELDS = ['type', 'role', 'status', 'transcriptType', 'endedReason', 'control'] as const;
const SAFE_LABEL = /^[A-Za-z0-9._ -]{1,60}$/;

/** "speech-update role=user status=started": the shape of a Vapi message, with no speech text and no payload. */
export function summarizeMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return typeof message;
  const m = message as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of SHOWN_FIELDS) {
    const value = m[key];
    if (typeof value === 'string' && SAFE_LABEL.test(value)) parts.push(key === 'type' ? value : `${key}=${value}`);
  }
  return parts.length > 0 ? parts.join(' ') : 'message (unrecognised shape)';
}

/** A readable form of one value: strings as they are, objects as short JSON (never "[object Object]"). */
function readable(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value || undefined;
  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return undefined;
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return String(value);
}

/**
 * A short, safe description of an error from the SDK or the browser. The SDK often wraps the real reason in objects
 * (`{ error: { type, msg } }`), so look through the usual places and fall back to the whole thing as JSON. Links are
 * replaced, because room links can carry access tokens.
 */
export function summarizeError(error: unknown): string {
  let raw: string | undefined;
  if (error instanceof Error) raw = error.message;
  else if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const inner = (e.error && typeof e.error === 'object' ? e.error : {}) as Record<string, unknown>;
    raw =
      readable(e.message) ??
      readable(inner.message) ??
      readable(e.errorMsg) ??
      readable(inner.msg) ??
      readable(inner.errorMsg) ??
      readable(inner.type) ??
      readable(e.type) ??
      readable(error);
  } else raw = readable(error);
  return (raw ?? 'error')
    .replace(/https?:\/\/\S+/g, '<link>')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

/** "+12.3s" */
export function formatElapsed(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** Adds an entry, folding it into the previous one when it is the same thing again. */
export function appendEntry(entries: LabEntry[], entry: LabEntry): LabEntry[] {
  const last = entries.at(-1);
  if (last && last.kind === entry.kind && last.text === entry.text) {
    return [...entries.slice(0, -1), { ...last, count: (last.count ?? 1) + 1, until: entry.at }];
  }
  return [...entries, entry];
}

/** The whole log as plain text, ready to paste into docs/PAUSE-RESUME.md. */
export function formatLog(entries: LabEntry[]): string {
  return entries
    .map((e) => {
      const repeat = e.count && e.count > 1 ? ` x${e.count} (until ${formatElapsed(e.until ?? e.at)})` : '';
      return `${formatElapsed(e.at).padStart(8)}  ${e.kind.padEnd(7)} ${e.text}${repeat}`;
    })
    .join('\n');
}
