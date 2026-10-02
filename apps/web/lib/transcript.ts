import type { TranscriptEvent } from './voice/client';

export interface ConversationTurn {
  id: number | string;
  speaker: 'user' | 'assistant';
  text: string;
  /** Stable database identity once this live turn has been reconciled with persistence. */
  turnUid?: string;
  /** Canonical text for display; `text` remains the backwards-compatible render value. */
  displayText?: string;
  spokenText?: string | null;
  source?: 'live' | 'typed' | 'durable';
  /** True once the sentence is complete; a partial turn is updated in place. */
  final: boolean;
  timestamp: number;
}

export interface DurableTranscriptTurn {
  id: string;
  role: 'user' | 'assistant';
  displayText: string;
  spokenText?: string | null;
  createdAt: string;
}

const normalized = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function mergeChunk(previous: string, next: string): string {
  const a = previous.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b || normalized(a) === normalized(b)) return b || a;
  if (normalized(b).startsWith(normalized(a))) return b;
  if (normalized(a).startsWith(normalized(b))) return a;
  return `${a} ${b}`.replace(/\s+/g, ' ').trim();
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
  // Providers may emit a premature `final` at a pause and continue the same reply in another event. Until the other
  // speaker talks, all chunks belong to one logical/persisted turn and therefore one bubble.
  if (last && last.speaker === event.role && last.source !== 'durable') {
    return [
      ...turns.slice(0, -1),
      { ...last, text: mergeChunk(last.text, text), displayText: mergeChunk(last.displayText ?? last.text, text), final: event.final },
    ];
  }
  const numericIds = turns.map((turn) => (typeof turn.id === 'number' ? turn.id : 0));
  const id = Math.max(0, ...numericIds) + 1;
  return [...turns, { id, speaker: event.role, text, displayText: text, source: 'live', final: event.final, timestamp: now }];
}

/** Adds a turn the customer typed (for example the escalation form), already complete. */
export function addTypedTurn(turns: ConversationTurn[], text: string, now: number = Date.now()): ConversationTurn[] {
  const closed = closeOpenTurn(turns);
  const numericIds = closed.map((turn) => (typeof turn.id === 'number' ? turn.id : 0));
  const id = Math.max(0, ...numericIds) + 1;
  return [...closed, { id, speaker: 'user', text, displayText: text, source: 'typed', final: true, timestamp: now }];
}

function closeOpenTurn(turns: ConversationTurn[]): ConversationTurn[] {
  const last = turns.at(-1);
  return last && !last.final ? [...turns.slice(0, -1), { ...last, final: true }] : turns;
}

/**
 * Makes durable rows authoritative without duplicating optimistic/provider bubbles. Exact stable ids win; otherwise the
 * next same-role row with equivalent text replaces the live turn. Durable rows missing locally are appended.
 */
export function reconcileDurable(turns: ConversationTurn[], rows: DurableTranscriptTurn[]): ConversationTurn[] {
  const next = [...turns];
  const used = new Set<number>();
  for (const row of rows) {
    const byId = next.findIndex((turn) => turn.turnUid === row.id || turn.id === row.id);
    const byText =
      byId >= 0
        ? byId
        : next.findIndex(
            (turn, index) =>
              !used.has(index) &&
              turn.source !== 'durable' &&
              turn.speaker === row.role &&
              (normalized(turn.displayText ?? turn.text) === normalized(row.displayText) ||
                normalized(row.displayText).includes(normalized(turn.displayText ?? turn.text)) ||
                normalized(turn.displayText ?? turn.text).includes(normalized(row.displayText))),
          );
    const byOrder =
      byText >= 0
        ? byText
        : next.findIndex((turn, index) => !used.has(index) && turn.source !== 'durable' && turn.speaker === row.role);
    const match = byOrder;
    const durable: ConversationTurn = {
      id: row.id,
      turnUid: row.id,
      speaker: row.role,
      text: row.displayText,
      displayText: row.displayText,
      spokenText: row.spokenText,
      source: 'durable',
      final: true,
      timestamp: Date.parse(row.createdAt) || Date.now(),
    };
    if (match >= 0) {
      next[match] = durable;
      used.add(match);
    } else {
      next.push(durable);
      used.add(next.length - 1);
    }
  }
  return next.sort((a, b) => a.timestamp - b.timestamp);
}
