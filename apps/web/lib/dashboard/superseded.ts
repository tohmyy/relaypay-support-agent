/**
 * A turn the caller abandoned. When a customer keeps talking, Vapi gives up on the request it had sent and sends a new one
 * that carries everything said so far; the agent still finishes the first turn and saves it, but its reply was never
 * played (`timings.delivered === false`). Showing it in a transcript is a reply nobody heard, beside the newer turn that
 * already holds the customer's words, so such a turn is left out when a later turn exists. An undelivered last turn is
 * kept: the caller may simply have hung up, and nothing else holds what they said.
 */
export function dropSupersededTurns<T extends { timings?: { delivered?: unknown } | null }>(rows: T[]): T[] {
  return rows.filter((row, index) => !(row.timings?.delivered === false && index < rows.length - 1));
}
