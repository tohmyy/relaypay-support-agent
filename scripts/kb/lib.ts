import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const CATEGORIES = [
  'product',
  'faq',
  'compliance',
  'security',
  'disputes',
  'communications',
  'release_notes',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface KbDoc {
  documentId: string;
  title: string;
  section: string;
  category: Category;
  sourceType: string;
  version: string;
  content: string;
}

export interface KbChunk extends KbDoc {
  chunkIndex: number;
}

export const MAX_CHUNK_CHARS = 1500;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toFile(doc: KbDoc): string {
  const front = [
    `document_id: "${doc.documentId}"`,
    `title: "${doc.title}"`,
    `section: "${doc.section}"`,
    `category: "${doc.category}"`,
    `source_type: "${doc.sourceType}"`,
    `version: "${doc.version}"`,
  ].join('\n');
  return `---\n${front}\n---\n\n${doc.content.trim()}\n`;
}

export function parseFile(text: string): KbDoc {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw new Error('Missing frontmatter');
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = /^(\w+):\s*"(.*)"$/.exec(line);
    if (m) meta[m[1]] = m[2];
  }
  const need = ['document_id', 'title', 'section', 'category', 'source_type', 'version'];
  for (const key of need) if (!meta[key]) throw new Error(`Missing frontmatter field: ${key}`);
  if (!CATEGORIES.includes(meta.category as Category)) {
    throw new Error(`Unknown category: ${meta.category}`);
  }
  return {
    documentId: meta.document_id,
    title: meta.title,
    section: meta.section,
    category: meta.category as Category,
    sourceType: meta.source_type,
    version: meta.version,
    content: match[2].trim(),
  };
}

// One chunk per document; oversized documents split on paragraph boundaries with the title repeated.
export function chunkDoc(doc: KbDoc, max = MAX_CHUNK_CHARS): KbChunk[] {
  if (doc.content.length <= max) return [{ ...doc, chunkIndex: 0 }];
  const parts: string[] = [];
  let current = '';
  for (const para of doc.content.split(/\n{2,}/)) {
    if (current && current.length + para.length + 2 > max) {
      parts.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) parts.push(current);
  return parts.map((content, i) => ({
    ...doc,
    content: i === 0 ? content : `${doc.title}\n\n${content}`,
    chunkIndex: i,
  }));
}

export function listMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listMarkdown(full);
    return full.endsWith('.md') ? [full] : [];
  });
}

export function loadKnowledge(dir: string): KbDoc[] {
  return listMarkdown(dir).map((f) => parseFile(readFileSync(f, 'utf8')));
}
