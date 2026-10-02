// Callback time rules (docs/BUILD-PLAN-V3.md V3.10, concern 42). Authoritative and server-side: the model only
// proposes a time; this decides whether it is acceptable. No date library: timezone maths uses Intl.

/** A requested time this far in the past still counts as "now" (clock skew and the time it takes to say it). */
export const PAST_SKEW_MS = 2 * 60 * 1000;

export interface CallbackWindowInput {
  /** ISO 8601. With an offset or Z it is an exact instant; without one it is wall-clock time in `preferred_timezone`. */
  preferred_at?: string;
  /** IANA zone such as Africa/Lagos. */
  preferred_timezone?: string;
}

export type CallbackWindowResult =
  | { ok: true; at: Date; timezone: string | null; display: string }
  | { ok: false; message: string };

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock parts of an instant in a zone. */
function partsIn(tz: string, utcMs: number): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const get = (type: string) => Number(fmt.formatToParts(new Date(utcMs)).find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** How far the zone is ahead of UTC at that instant, in ms. */
function offsetMs(tz: string, utcMs: number): number {
  const p = partsIn(tz, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which the zone's wall clock reads these parts (handles daylight-saving shifts). */
export function zonedTimeToUtc(p: Parts, tz: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  let result = guess - offsetMs(tz, guess);
  const corrected = guess - offsetMs(tz, result);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** One calendar month after `now` on the zone's wall clock (31 Jan + 1 month = 28/29 Feb). */
export function addCalendarMonth(now: Date, tz: string): Date {
  const p = partsIn(tz, now.getTime());
  let year = p.year;
  let month = p.month + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const day = Math.min(p.day, daysInMonth(year, month));
  return zonedTimeToUtc({ ...p, year, month, day }, tz);
}

export function formatCallbackTime(at: Date, tz: string | null): string {
  const zone = tz ?? 'UTC';
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);
  return `${text} (${zone})`;
}

/**
 * Parses the model's proposed callback time and checks it is no earlier than now (a 2 minute allowance) and no later
 * than one calendar month ahead, measured on the customer's wall clock. The messages are safe to hand back to the model
 * so it can ask the customer again.
 */
export function validateCallbackTime(input: CallbackWindowInput, now: Date = new Date()): CallbackWindowResult {
  const raw = input.preferred_at?.trim();
  if (!raw) {
    return {
      ok: false,
      message:
        'A specific date and time is required for a callback. Ask the customer for the exact day and time they want to be called (and their timezone).',
    };
  }

  const tzInput = input.preferred_timezone?.trim();
  if (tzInput && !isValidTimeZone(tzInput)) {
    return {
      ok: false,
      message: 'preferred_timezone must be an IANA timezone name such as Africa/Lagos or Europe/London. Ask the customer which timezone they are in.',
    };
  }

  let at: Date;
  if (HAS_OFFSET.test(raw)) {
    at = new Date(raw);
  } else {
    const m = LOCAL_ISO.exec(raw);
    if (!m) at = new Date(Number.NaN);
    else if (!tzInput) {
      return {
        ok: false,
        message: 'preferred_at has no timezone. Ask the customer which timezone they are in, or send the time with a UTC offset.',
      };
    } else {
      at = zonedTimeToUtc(
        { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: m[6] ? +m[6] : 0 },
        tzInput,
      );
    }
  }
  if (Number.isNaN(at.getTime())) {
    return {
      ok: false,
      message: 'preferred_at must be an ISO 8601 date and time such as 2026-10-08T14:00:00. Ask the customer for a specific day and time.',
    };
  }

  if (at.getTime() < now.getTime() - PAST_SKEW_MS) {
    return {
      ok: false,
      message: 'That time has already passed. Ask the customer for a time in the future.',
    };
  }
  const latest = addCalendarMonth(now, tzInput ?? 'UTC');
  if (at.getTime() > latest.getTime()) {
    return {
      ok: false,
      message: 'That is more than one month away. Callbacks can only be booked within the next month; ask the customer for an earlier time.',
    };
  }
  return { ok: true, at, timezone: tzInput ?? null, display: formatCallbackTime(at, tzInput ?? null) };
}
