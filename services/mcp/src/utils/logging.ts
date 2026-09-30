// Technical detail goes to stderr only; it is never returned to the caller.
export function logTechnical(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp] ${context}: ${message}`);
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
