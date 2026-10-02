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
  /** Text of the segments the provider has finished in this turn; the open partial is shown after it, never kept. */
  committed?: string;
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

/**
 * Puts a segment after the text the provider has already finished. A segment that restates everything finished so far
 * (some providers resend the whole turn) replaces it instead of repeating it.
 */
function joinSegments(committed: string, segment: string): string {
  const a = committed.trim();
  const b = segment.trim();
  if (!a) return b;
  if (!b) return a;
  if (normalized(b).startsWith(normalized(a))) return b;
  return `${a} ${b}`.replace(/\s+/g, ' ').trim();
}

/**
 * Folds a transcript event into the list of turns. A partial replaces the open partial of the current turn (the
 * recognizer revises earlier words, so partials are never appended); a final is committed and the next segment from the
 * same speaker continues the same bubble. Anything else starts a new turn.
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
    // A turn made before `committed` existed (typed, restored) counts as fully committed when it is final.
    const committed = last.committed ?? (last.final ? last.text : '');
    let joined = joinSegments(committed, text);
    // A late, shorter partial that is only the start of what is already showing is stale: keep the longer text.
    if (!event.final && !last.final && normalized(last.text).startsWith(normalized(joined))) joined = last.text;
    return [
      ...turns.slice(0, -1),
      { ...last, text: joined, displayText: joined, committed: event.final ? joined : committed, final: event.final },
    ];
  }
  const numericIds = turns.map((turn) => (typeof turn.id === 'number' ? turn.id : 0));
  const id = Math.max(0, ...numericIds) + 1;
  return [
    ...turns,
    { id, speaker: event.role, text, displayText: text, source: 'live', committed: event.final ? text : '', final: event.final, timestamp: now },
  ];
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
