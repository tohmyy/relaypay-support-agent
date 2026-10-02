import { SLOW_FILLER } from './vapi';

/**
 * Spoken acknowledgements for a slow turn ("one moment..."). Short, natural and chosen by what the turn is doing,
 * from a fixed library: no model call, nothing generated per turn. They are transport only and never stored as the
 * answer.
 */
export const ACK_CATEGORIES = [
  'customer_lookup',
  'transaction_lookup',
  'payout_lookup',
  'knowledge_base',
  'compliance',
  'ticket_creation',
  'escalation',
  'generic',
] as const;
export type AckCategory = (typeof ACK_CATEGORIES)[number];

/** Phrases without the trailing space; `AckRotation.pick` adds it so they join cleanly with the reply. */
export const ACK_TEMPLATES: Record<AckCategory, readonly string[]> = {
  customer_lookup: [
    'Let me pull up your account details.',
    "I'll check your account information.",
    'Let me take a look at your account.',
    "I'll verify those account details.",
    'Let me check what I can see for your account.',
  ],
  transaction_lookup: [
    "I'll check that transaction for you.",
    'Let me pull up that transaction.',
    "I'll take a look at the transaction status.",
    'Let me check the latest details on that transaction.',
    "I'll verify that transaction for you.",
  ],
  payout_lookup: [
    'Let me check the payout status.',
    "I'll pull up the payout details.",
    'Let me take a look at that payout.',
    "I'll check what the latest payout information shows.",
    'Let me verify the payout status.',
  ],
  knowledge_base: [
    'Let me check the relevant RelayPay information.',
    "I'll check the current RelayPay guidance.",
    'Let me verify that against our support information.',
    "I'll check what our current policy says.",
    'Let me look into that for you.',
  ],
  compliance: [
    'Let me check the relevant support guidance.',
    "I'll verify what I can safely tell you about that.",
    'Let me check the current compliance guidance.',
    "I'll review the information available to me.",
  ],
  ticket_creation: [
    "I'll get that support request created for you.",
    'Let me open a support request.',
    "I'll create a support ticket so the team can review this.",
    'Let me get that request logged.',
  ],
  escalation: [
    'This needs a support specialist to take a closer look.',
    "I'll connect this with our support team.",
    'This is something a support specialist will need to review.',
    'Let me get this escalated to the support team.',
    "I'll arrange for a support specialist to continue with this.",
  ],
  // Today's single filler stays as the fallback, so a turn we cannot classify sounds exactly as before.
  generic: [SLOW_FILLER.trim(), 'One moment please.', 'Just a moment while I look into that.'],
};

/** What the turn is doing, as far as the agent has got. Filled in by `runTurn`, read by the server at fire time. */
export interface TurnProgress {
  /** From an MCP tool call the model has actually made: the strongest signal. */
  toolCategory?: AckCategory;
  /** Knowledge was found for the message. Weak on its own: it is found for almost any question. */
  knowledge?: boolean;
}

const TOOL_CATEGORY: Record<string, AckCategory> = {
  lookup_customer: 'customer_lookup',
  lookup_transaction: 'transaction_lookup',
  lookup_payout: 'payout_lookup',
  create_support_ticket: 'ticket_creation',
  create_escalation: 'escalation',
};

export function categoryForTool(tool: string): AckCategory | undefined {
  return TOOL_CATEGORY[tool];
}

/**
 * Only unambiguous cues in what the customer said: a reference they gave, or compliance wording. Anything else is
 * left unclassified, because a misleading acknowledgement ("I'll check that transaction" when there is none) is
 * worse than a plain one.
 */
export function predictCategory(message: string): AckCategory | undefined {
  if (/\bPAY-\d+/i.test(message)) return 'payout_lookup';
  if (/\bTXN-\d+/i.test(message)) return 'transaction_lookup';
  if (/\bCUS-\d+/i.test(message)) return 'customer_lookup';
  if (/\b(compliance|kyc|verification|under review|restricted|suspended|frozen)\b/i.test(message)) {
    return 'compliance';
  }
  return undefined;
}

/** Strongest signal first: what the model is really doing, then what the customer said, then the weak knowledge cue. */
export function chooseAckCategory(progress: TurnProgress | undefined, message: string): AckCategory {
  return progress?.toolCategory ?? predictCategory(message) ?? (progress?.knowledge ? 'knowledge_base' : 'generic');
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const MAX_TRACKED_CONVERSATIONS = 500;

/**
 * Rotates through each category's phrases per conversation: deterministic (the starting point comes from a hash of
 * the conversation id), never the same phrase twice in a row within a call, and forgotten when the call ends.
 */
export class AckRotation {
  private readonly state = new Map<string, { counters: Map<AckCategory, number>; last?: string }>();

  pick(conversationId: string, category: AckCategory): string {
    let s = this.state.get(conversationId);
    if (!s) {
      s = { counters: new Map() };
      this.state.set(conversationId, s);
      // A call that never ends cleanly must not leak: drop the oldest tracked conversation.
      if (this.state.size > MAX_TRACKED_CONVERSATIONS) {
        const oldest = this.state.keys().next().value;
        if (oldest !== undefined) this.state.delete(oldest);
      }
    }
    const list = ACK_TEMPLATES[category];
    let index = s.counters.get(category) ?? hash(`${conversationId}:${category}`) % list.length;
    let phrase = list[index % list.length];
    if (phrase === s.last && list.length > 1) {
      index += 1;
      phrase = list[index % list.length];
    }
    s.counters.set(category, index + 1);
    s.last = phrase;
    return `${phrase} `;
  }

  forget(conversationId: string): void {
    this.state.delete(conversationId);
  }

  get size(): number {
    return this.state.size;
  }
}
