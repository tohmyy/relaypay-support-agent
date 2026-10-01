import { redactPii } from './redact';

/**
 * One JSON line per event on stderr. Technical detail goes here only; it is never returned to the caller.
 * Messages are redacted, and callers must not pass secrets.
 */
export function logTechnical(
  context: string,
  error: unknown,
  fields: { conversation_id?: string } = {},
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      service: 'mcp',
      event: context,
      message: redactPii(message).slice(0, 500),
      ...fields,
    }),
  );
}

const REDACTED_KEYS = new Set([
  'email',
  'user_email',
  'user_name',
  'reason',
  'summary',
  'preferred_time',
]);

/** Short, low-sensitivity description of a tool input for the tool_calls log. */
export function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => {
      if (v === undefined || v === null) return '';
      if (REDACTED_KEYS.has(k) || typeof v === 'object') return `${k}=<provided>`;
      return `${k}=${String(v).slice(0, 60)}`;
    })
    .filter(Boolean)
    .join(', ');
}

/** Safe one-line description of a tool result: ids and statuses only, never free text. */
export function pick(value: unknown): string {
  return redactPii(String(value ?? 'unknown'))
    .replace(/[^\w .:-]/g, '')
    .slice(0, 40);
}
