import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeIdentifiers } from '../../services/agent/src/display';
import { saveTurn } from '../../services/agent/src/history';
import { fakeDb } from './fake-db';

// Build Plan V4, V4.19 (AC-48.2, persistence part): the transcript keeps reference numbers exact while the spoken text may
// stay speech-friendly.

describe('canonicalizeIdentifiers', () => {
  it.each([
    ['TXN minus 9 00 1', 'TXN-9001'],
    ['TXN minus 9001', 'TXN-9001'],
    ['TXN dash 9001', 'TXN-9001'],
    ['TXN - 9001', 'TXN-9001'],
    ['TXN 9001', 'TXN-9001'],
    ['TXN minus nine zero zero one', 'TXN-9001'],
    ['TXN minus nine oh oh one', 'TXN-9001'],
    ['T X N minus 9 0 0 1', 'TXN-9001'],
    ['PAY minus 7 0 0 2', 'PAY-7002'],
    ['CUS minus 1 0 0 1', 'CUS-1001'],
    ['TKT minus 0 0 0 0 0 7', 'TKT-000007'],
    ['TKT minus 000 007', 'TKT-000007'],
    ['ESC minus zero zero zero zero one two', 'ESC-000012'],
  ])('rewrites %j to %j', (spoken, display) => {
    expect(canonicalizeIdentifiers(spoken)).toBe(display);
  });

  it('rewrites inside a sentence and keeps the punctuation around the reference', () => {
    expect(canonicalizeIdentifiers('I checked TXN minus 9 00 1, and it is processing.')).toBe(
      'I checked TXN-9001, and it is processing.',
    );
    expect(canonicalizeIdentifiers('Your ticket is TKT minus 000 007.')).toBe('Your ticket is TKT-000007.');
    expect(canonicalizeIdentifiers('Both TXN minus 9001 and PAY minus 7 0 0 2 are fine.')).toBe(
      'Both TXN-9001 and PAY-7002 are fine.',
    );
  });

  it('leaves text that is already canonical, and ordinary words, alone', () => {
    for (const text of [
      'TXN-9001 is processing.',
      'Payout PAY-7002 is under review, and TKT-000007 tracks it.',
      'We pay 2400 dollars on the 9th.',
      'The transaction is complete.',
      'No reference numbers here.',
    ]) {
      expect(canonicalizeIdentifiers(text)).toBe(text);
    }
  });

  it('does not run numbers that follow a reference into it, or rewrite one with the wrong number of digits', () => {
    expect(canonicalizeIdentifiers('TXN-9001 2 days ago')).toBe('TXN-9001 2 days ago');
    expect(canonicalizeIdentifiers('TXN minus 9 00 1 2 days ago')).toBe('TXN-9001 2 days ago');
    expect(canonicalizeIdentifiers('TXN minus 90012')).toBe('TXN minus 90012');
    expect(canonicalizeIdentifiers('TXN minus 90')).toBe('TXN minus 90');
    expect(canonicalizeIdentifiers('TKT minus 12')).toBe('TKT minus 12');
  });

  it('is idempotent', () => {
    const once = canonicalizeIdentifiers('TXN minus 9 00 1 and TKT minus 0 0 0 0 0 7');
    expect(once).toBe('TXN-9001 and TKT-000007');
    expect(canonicalizeIdentifiers(once)).toBe(once);
  });
});

describe('saveTurn display and spoken text', () => {
  const save = async (response: string) => {
    const { db, tables } = fakeDb();
    await saveTurn(db, {
      conversationId: 'c1',
      turnNumber: 1,
      userMessage: 'Where is it?',
      response,
      answerType: 'direct_answer',
    });
    return tables.conversation_turns[0];
  };

  it('stores the canonical reference as display_text and the words as spoken_text', async () => {
    const row = await save('Transaction TXN minus 9 00 1 is processing.');
    expect(row).toMatchObject({
      display_text: 'Transaction TXN-9001 is processing.',
      spoken_text: 'Transaction TXN minus 9 00 1 is processing.',
      // The legacy column keeps the spoken reply, as before.
      assistant_response: 'Transaction TXN minus 9 00 1 is processing.',
      user_transcript: 'Where is it?',
    });
  });

  it('stores the same text twice when nothing needs rewriting', async () => {
    const row = await save('Transaction TXN-9001 is processing.');
    expect(row).toMatchObject({
      display_text: 'Transaction TXN-9001 is processing.',
      spoken_text: 'Transaction TXN-9001 is processing.',
    });
  });
});

describe('the assistant prompt', () => {
  const prompt = readFileSync('services/agent/prompts/system.md', 'utf8');

  it('asks for reference numbers in their display form and never spelled out', () => {
    expect(prompt).toMatch(/Write every reference number exactly as RelayPay shows it/);
    expect(prompt).toContain('TXN-9001');
    expect(prompt).toMatch(/"TXN minus 9 00 1" is wrong/);
  });

  it('no longer tells the model to pass a customer, contact details or a ticket id to the tools', () => {
    expect(prompt).not.toMatch(/optional customer_id/);
    expect(prompt).not.toMatch(/optional ticket_id/);
    expect(prompt).not.toMatch(/Include `customer_id`/);
    expect(prompt).toMatch(/do not pass a customer id, name, email or ticket id/);
  });
});
