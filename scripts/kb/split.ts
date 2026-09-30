import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Category, type KbDoc, slugify, toFile } from './lib';

const SOURCE = 'assets/relaypay-knowledge-base.md';
const OUT = 'knowledge';
const KB_VERSION = '2.4';

const byH2: Record<string, Category> = {
  'Product Features Overview': 'product',
  'Frequently Asked Questions': 'faq',
  'Policies And Compliance': 'compliance',
  'Release Notes And Known Limitations': 'release_notes',
};
const byH3: Record<string, Category> = {
  'Data Security And Privacy': 'security',
  'Disputes, Refunds, And Cancellations': 'disputes',
  Communications: 'communications',
};

const lines = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n').split('\n');
const docs: KbDoc[] = [];
let h2 = '';
let h3 = '';
let buf: string[] = [];

function flush() {
  const content = buf.join('\n').trim();
  buf = [];
  if (!h2 || !content) return;
  const title = h3 || h2;
  const category = (h3 && byH3[h3]) || byH2[h2];
  if (!category) throw new Error(`No category for section: ${h2} > ${title}`);
  const release = /^Version (\d+\.\d+)$/.exec(h3);
  docs.push({
    documentId: `kb-${category}-${slugify(title)}`,
    title,
    section: h3 ? `${h2} > ${h3}` : h2,
    category,
    sourceType: 'knowledge_base',
    version: release ? release[1] : KB_VERSION,
    content,
  });
}

for (const line of lines) {
  const m2 = /^## (.+)$/.exec(line);
  const m3 = /^### (.+)$/.exec(line);
  if (m2) {
    flush();
    h2 = m2[1].trim();
    h3 = '';
  } else if (m3) {
    flush();
    h3 = m3[1].trim();
  } else if (h2) {
    buf.push(line);
  }
}
flush();

const seen = new Set<string>();
for (const d of docs) {
  if (seen.has(d.documentId)) throw new Error(`Duplicate document id: ${d.documentId}`);
  seen.add(d.documentId);
}

for (const c of new Set(docs.map((d) => d.category))) {
  rmSync(path.join(OUT, c), { recursive: true, force: true });
  mkdirSync(path.join(OUT, c), { recursive: true });
}
for (const d of docs) {
  writeFileSync(path.join(OUT, d.category, `${slugify(d.title)}.md`), toFile(d));
}
console.log(`wrote ${docs.length} documents`);
