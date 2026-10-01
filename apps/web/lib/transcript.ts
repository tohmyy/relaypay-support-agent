import type { TranscriptEvent } from './voice/client';

export interface ConversationTurn {
  id: number;
  speaker: 'user' | 'assistant';
  text: string;
  /** True once the sentence is complete; a partial turn is updated in place. */
  final: boolean;
  timestamp: number;
}

/**
 * Folds a transcript event into the list of turns. A partial update replaces the text of the open
 * turn from the same speaker (no flicker, no duplicates); a final event closes it. Anything else
 * starts a new turn.
 */
export function applyTranscript(
  turns: ConversationTurn[],
  event: TranscriptEvent,
  now: number = Date.now(),
): ConversationTurn[] {
  const text = event.text.trim();
  if (!text) return turns;
  const last = turns.at(-1);
  if (last && last.speaker === event.role && !last.final) {
    return [...turns.slice(0, -1), { ...last, text, final: event.final }];
  }
  const id = (last?.id ?? 0) + 1;
  return [...turns, { id, speaker: event.role, text, final: event.final, timestamp: now }];
}

/** Adds a turn the customer typed (for example the escalation form), already complete. */
export function addTypedTurn(turns: ConversationTurn[], text: string, now: number = Date.now()): ConversationTurn[] {
  return applyTranscript(closeOpenTurn(turns), { role: 'user', text, final: true }, now);
}

function closeOpenTurn(turns: ConversationTurn[]): ConversationTurn[] {
  const last = turns.at(-1);
  return last && !last.final ? [...turns.slice(0, -1), { ...last, final: true }] : turns;
}
