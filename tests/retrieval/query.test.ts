import { describe, expect, it } from 'vitest';
import { buildQuery } from '../../services/agent/retrieval/query';
import { chunkDoc, loadKnowledge, parseFile, toFile } from '../../scripts/kb/lib';

describe('buildQuery', () => {
  it('drops stopwords and joins terms with OR', () => {
    expect(buildQuery('How much does RelayPay charge?')).toBe('charge');
    expect(buildQuery('Why can a payout be delayed?')).toBe('payout | delayed');
  });

  it('keeps the brand term only when nothing else remains', () => {
    expect(buildQuery('What is RelayPay?')).toBe('relaypay');
    expect(buildQuery('relaypay fees')).toBe('fees');
  });

  it('strips characters that could break tsquery syntax', () => {
    expect(buildQuery("payout'; drop table & (x) | !y")).toBe('payout | drop | table');
  });

  it('returns an empty string for no content words', () => {
    expect(buildQuery('what is the?')).toBe('');
    expect(buildQuery('')).toBe('');
  });
});

describe('knowledge files', () => {
  const docs = loadKnowledge('knowledge');

  it('has all required metadata on every document', () => {
    expect(docs.length).toBeGreaterThan(30);
    for (const d of docs) {
      for (const v of [d.documentId, d.title, d.section, d.category, d.sourceType, d.version, d.content]) {
        expect(v).toBeTruthy();
      }
    }
  });

  it('has unique document ids', () => {
    expect(new Set(docs.map((d) => d.documentId)).size).toBe(docs.length);
  });

  it('round-trips frontmatter', () => {
    expect(parseFile(toFile(docs[0]))).toEqual(docs[0]);
  });

  it('splits oversized documents on paragraph boundaries', () => {
    const big = { ...docs[0], content: Array(10).fill('x'.repeat(400)).join('\n\n') };
    const chunks = chunkDoc(big, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.content.length <= 1000 + big.title.length + 2)).toBe(true);
    expect(chunkDoc(docs[0])).toHaveLength(1);
  });
});
