/**
 * Deterministic detection of "the customer is done". Runs before the model so closers cost no agent call.
 * Conservative on purpose: anything that looks like a real question, mentions an identifier, or is long is left
 * to the agent.
 */
export type Completion = 'clear' | 'ambiguous' | 'none';

const MAX_WORDS = 10;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A question mark or any digit (transaction ids, amounts) means this is not a closer. */
function looksLikeRequest(raw: string): boolean {
  return /[?\d]/.test(raw);
}

const FILLER =
  "(?:(?:ok|okay|alright|all right|no|nope|nah|yeah|yes|great|perfect|cool|awesome|thanks|thank you|thank you very much|thanks a lot|thank you so much|cheers|well|so|right) )*";
const TAIL =
  "(?: (?:thanks|thank you|thank you very much|thanks a lot|thank you so much|bye|goodbye|bye bye|for your help|for the help|for helping|have a good day|take care))*";
const CORE = [
  "that'?s (?:all|everything|it)(?: for now| for today| i needed)?",
  "that is (?:all|everything|it)",
  "i'?m (?:done|all done|all set|finished)(?: now| for now)?",
  'i am (?:done|all done|all set|finished)',
  "i don'?t need anything else",
  'i do not need anything else',
  "(?:there'?s )?nothing else(?: for now)?",
  "we'?re (?:done|all set)",
  'all done',
  'all set',
  'goodbye',
  'bye bye',
  'bye',
  'have a good day',
  'take care',
].join('|');

const CLEAR = new RegExp(`^${FILLER}(?:${CORE})${TAIL}$`);

const ACK_WORDS = new Set(
  "ok okay alright great perfect cool awesome good nice wonderful brilliant thanks thank you very much so a lot cheers appreciate it that helps helpful that's thats got understood i see makes sense".split(
    ' ',
  ),
);
const THANKS_WORDS = new Set(['thanks', 'thank', 'cheers', 'appreciate', 'helps', 'helpful']);

/** Clear closers end the session; bare thanks ("okay, thanks") only earns an "anything else?" check. */
export function classifyCompletion(text: string): Completion {
  if (looksLikeRequest(text)) return 'none';
  const n = normalize(text);
  if (!n) return 'none';
  const words = n.split(' ');
  if (words.length > MAX_WORDS) return 'none';
  if (CLEAR.test(n)) return 'clear';
  if (words.length <= 6 && words.every((w) => ACK_WORDS.has(w)) && words.some((w) => THANKS_WORDS.has(w))) {
    return 'ambiguous';
  }
  return 'none';
}

/**
 * Sounds a speech recogniser produces for coughs, hums and background noise. They are made of letters but say nothing.
 */
const NOISE_SOUNDS = new Set(['uh', 'um', 'umm', 'uhh', 'hmm', 'hm', 'mm', 'mmm', 'mhm', 'huh', 'er', 'erm', 'ah', 'eh', 'oh', 'ugh']);

/** A token that could plausibly be a word: has a vowel, is not absurdly long, and has no long run of consonants or repeats. */
function wordLike(token: string): boolean {
  if (token.length === 1) return token === 'a' || token === 'i';
  if (NOISE_SOUNDS.has(token)) return false;
  if (token.length > 20) return false;
  if (!/[aeiouy]/.test(token)) return false;
  if (/[^aeiouy]{5,}/.test(token)) return false;
  if (/(.)\1{3,}/.test(token)) return false;
  return true;
}

/**
 * True when what the speech recogniser heard is noise or keyboard mash rather than language: nothing in it looks like a
 * word. Anything with a digit (a reference number) or a question mark is never gibberish. Deliberately conservative: a
 * real sentence with one odd word is not gibberish, so the customer is only ever ended on after several garbled turns
 * in a row (`SessionController`, concern 40).
 */
export function looksLikeGibberish(text: string): boolean {
  if (/\d|\?/.test(text)) return false;
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (tokens.length === 0) return true; // only punctuation or symbols
  return !tokens.some(wordLike);
}

const DECLINE = new RegExp(
  "^(?:(?:no|nope|nah|nothing|not really|not right now|not today|i'?m good|im good|all good|we'?re good|that'?s okay|that is okay|thanks|thank you) ?)+$",
);

/** The reply to "is there anything else?": a no / clear closer / another thanks ends the session. */
export function classifyConfirmation(text: string): 'end' | 'continue' {
  if (looksLikeRequest(text)) return 'continue';
  const c = classifyCompletion(text);
  if (c === 'clear' || c === 'ambiguous') return 'end';
  const n = normalize(text);
  if (n && n.split(' ').length <= 8 && DECLINE.test(n)) return 'end';
  return 'continue';
}
