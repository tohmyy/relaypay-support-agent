import { redactPii } from './redact';

export type LogLevel = 'info' | 'warn' | 'error';

const SECRET_KEY = /token|key|secret|password|authorization|cookie/i;

/** Drops secret-looking fields and scrubs personal data from string values. */
export function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([k]) => !SECRET_KEY.test(k))
      .map(([k, v]) => [k, typeof v === 'string' ? redactPii(v).slice(0, 500) : v]),
  );
}

/** One JSON line per event: errors and warnings on stderr, info on stdout. Never pass secrets. */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'agent',
    event,
    ...safeFields(fields),
  });
  (level === 'info' ? console.log : console.error)(line);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
