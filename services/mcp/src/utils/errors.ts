export type ErrorCode =
  | 'invalid_input'
  | 'reference_not_found'
  | 'not_authorized'
  | 'temporarily_unavailable';

/** An error whose message is safe to show to the caller. */
export class ToolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolErrorResult {
  error: { code: ErrorCode; message: string };
}

export const SAFE_UNAVAILABLE =
  'The support system is temporarily unavailable. Please try again shortly.';

export function errorResult(code: ErrorCode, message: string): ToolErrorResult {
  return { error: { code, message } };
}
