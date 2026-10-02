import { describe, expect, it } from 'vitest';
import {
  ACK_CATEGORIES,
  ACK_TEMPLATES,
  AckRotation,
  categoryForTool,
  chooseAckCategory,
  predictCategory,
} from '../../services/agent/src/acks';
import { SLOW_FILLER } from '../../services/agent/src/vapi';

describe('acknowledgement library', () => {
  const all = ACK_CATEGORIES.flatMap((c) => ACK_TEMPLATES[c].map((phrase) => ({ c, phrase })));

  it('has phrases for every category, several per category except where the plan lists fewer', () => {
    for (const c of ACK_CATEGORIES) expect(ACK_TEMPLATES[c].length).toBeGreaterThanOrEqual(3);
    expect(ACK_TEMPLATES.customer_lookup).toHaveLength(5);
    expect(ACK_TEMPLATES.transaction_lookup).toHaveLength(5);
    expect(ACK_TEMPLATES.payout_lookup).toHaveLength(5);
    expect(ACK_TEMPLATES.knowledge_base).toHaveLength(5);
    expect(ACK_TEMPLATES.escalation).toHaveLength(5);
  });

  it('keeps today\'s filler as the generic fallback', () => {
    expect(ACK_TEMPLATES.generic).toContain(SLOW_FILLER.trim());
  });

  it('is short, plain spoken English with no technical words', () => {
    for (const { phrase } of all) {
      expect(phrase.length, phrase).toBeLessThanOrEqual(80);
      expect(phrase, phrase).toMatch(/[.]$/);
      expect(phrase, phrase).not.toMatch(/\b(agent|mcp|rag|claude|vapi|supabase|sdk|database|tool|api|ai)\b/i);
      expect(phrase, phrase).not.toMatch(/\b(guarantee|promise|will arrive|scheduled|booked)\b/i);
      expect(phrase, phrase).toBe(phrase.trim());
    }
  });

  it('has no duplicates within a category', () => {
    for (const c of ACK_CATEGORIES) expect(new Set(ACK_TEMPLATES[c]).size).toBe(ACK_TEMPLATES[c].length);
  });

  it('maps only the tools that have a fitting acknowledgement', () => {
    expect(categoryForTool('lookup_customer')).toBe('customer_lookup');
    expect(categoryForTool('lookup_transaction')).toBe('transaction_lookup');
    expect(categoryForTool('lookup_payout')).toBe('payout_lookup');
    expect(categoryForTool('create_support_ticket')).toBe('ticket_creation');
    expect(categoryForTool('create_escalation')).toBe('escalation');
    // Logging an event is bookkeeping, not something to announce.
    expect(categoryForTool('log_conversation_event')).toBeUndefined();
    expect(categoryForTool('nope')).toBeUndefined();
  });
});

describe('choosing the category', () => {
  it('predicts only from unambiguous cues in what the customer said', () => {
    expect(predictCategory('Can you check transaction TXN-9001?')).toBe('transaction_lookup');
    expect(predictCategory('what is happening with payout pay-7002')).toBe('payout_lookup');
    expect(predictCategory('my account is CUS-1001')).toBe('customer_lookup');
    expect(predictCategory('Why is my account restricted?')).toBe('compliance');
    expect(predictCategory('I need help with KYC verification')).toBe('compliance');
    expect(predictCategory('How much are international payment fees?')).toBeUndefined();
    expect(predictCategory('I need to speak to a person')).toBeUndefined();
    expect(predictCategory('')).toBeUndefined();
  });

  it('prefers what the model is really doing over everything else', () => {
    expect(chooseAckCategory({ toolCategory: 'ticket_creation', knowledge: true }, 'check TXN-9001')).toBe('ticket_creation');
  });

  it('then what the customer said, then the weak knowledge cue, then generic', () => {
    expect(chooseAckCategory({ knowledge: true }, 'check TXN-9001')).toBe('transaction_lookup');
    expect(chooseAckCategory({ knowledge: true }, 'how long do payouts take')).toBe('knowledge_base');
    expect(chooseAckCategory({}, 'how long do payouts take')).toBe('generic');
    expect(chooseAckCategory(undefined, 'hello')).toBe('generic');
  });

  it('never claims a lookup that nothing suggests', () => {
    for (const msg of ['hello', 'how long do payouts take', 'what are your fees', 'ok', 'I need help']) {
      const c = chooseAckCategory({}, msg);
      expect(['customer_lookup', 'transaction_lookup', 'payout_lookup', 'ticket_creation', 'escalation']).not.toContain(c);
    }
  });
});

describe('AckRotation', () => {
  it('returns a phrase from the right category, with a trailing space so it joins the reply cleanly', () => {
    const r = new AckRotation();
    const phrase = r.pick('vapi_a', 'payout_lookup');
    expect(phrase.endsWith(' ')).toBe(true);
    expect(ACK_TEMPLATES.payout_lookup).toContain(phrase.trim());
  });

  it('is deterministic for a conversation and category', () => {
    const run = () => {
      const r = new AckRotation();
      return Array.from({ length: 8 }, () => r.pick('vapi_call1', 'transaction_lookup'));
    };
    expect(run()).toEqual(run());
  });

  it('walks through every phrase before repeating, and never repeats back to back', () => {
    const r = new AckRotation();
    const list = ACK_TEMPLATES.knowledge_base;
    const seen = Array.from({ length: list.length }, () => r.pick('vapi_a', 'knowledge_base').trim());
    expect(new Set(seen).size).toBe(list.length);
    let previous = seen.at(-1);
    for (let i = 0; i < 30; i++) {
      const next = r.pick('vapi_a', 'knowledge_base').trim();
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('does not repeat the previous phrase even when the category changes', () => {
    const r = new AckRotation();
    let previous = '';
    for (let i = 0; i < 60; i++) {
      const category = i % 2 ? 'generic' : 'knowledge_base';
      const next = r.pick('vapi_a', category).trim();
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('starts different calls at different phrases (so callers do not all hear the same first one)', () => {
    const starts = new Set(
      Array.from({ length: 40 }, (_, i) => new AckRotation().pick(`vapi_call${i}`, 'transaction_lookup')),
    );
    expect(starts.size).toBeGreaterThan(1);
  });

  it('keeps conversations separate and forgets a finished call', () => {
    const r = new AckRotation();
    r.pick('vapi_a', 'generic');
    r.pick('vapi_b', 'generic');
    expect(r.size).toBe(2);
    r.forget('vapi_a');
    expect(r.size).toBe(1);
    r.forget('unknown');
    expect(r.size).toBe(1);
  });

  it('cannot grow without bound when calls never end cleanly', () => {
    const r = new AckRotation();
    for (let i = 0; i < 700; i++) r.pick(`vapi_${i}`, 'generic');
    expect(r.size).toBeLessThanOrEqual(500);
  });

  it('copes with a category that has only one phrase worth of choice', () => {
    const r = new AckRotation();
    expect(() => Array.from({ length: 20 }, () => r.pick('vapi_a', 'compliance'))).not.toThrow();
  });
});
