import type { AnswerType } from './schema';

export const LEAK_FALLBACK =
  'A specialist will need to help with that. I can arrange a callback if you would like.';

/** Removes markdown so the text is safe to speak. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface GuardInput {
  response: string;
  answerType: AnswerType;
  /** Internal notes returned by tools during this turn. They must never be spoken. */
  internalTexts: string[];
}

export interface GuardResult {
  response: string;
  answerType: AnswerType;
  leaked: boolean;
}

/**
 * Deterministic output checks that do not depend on the model behaving:
 * markdown is stripped, and a response that repeats internal support notes is replaced.
 */
export function applyGuard({ response, answerType, internalTexts }: GuardInput): GuardResult {
  const cleaned = stripMarkdown(response);
  const spoken = normalize(cleaned);
  const leaked = internalTexts.some((t) => t.trim().length >= 12 && spoken.includes(normalize(t)));
  if (leaked) return { response: LEAK_FALLBACK, answerType: 'escalation', leaked: true };
  return { response: cleaned, answerType, leaked: false };
}
