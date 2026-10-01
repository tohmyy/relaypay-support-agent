import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../src/supabase';
import { buildQuery } from './query';
import { errorMessage, logEvent } from '../src/logger';
import { redactPii } from '../src/redact';

export interface KbResult {
  documentId: string;
  title: string;
  section: string;
  category: string;
  version: string;
  content: string;
  score: number;
}

export interface Retrieval {
  chunks: KbResult[];
  sourceTitles: string[];
  /** True when nothing relevant was found: decline or escalate instead of guessing. */
  empty: boolean;
}

export interface RetrieveOptions {
  conversationId?: string;
  limit?: number;
  db?: SupabaseClient;
}

export async function retrieveKnowledge(
  query: string,
  { conversationId, limit = 4, db = getSupabase() }: RetrieveOptions = {},
): Promise<Retrieval> {
  const tsquery = buildQuery(query);
  let chunks: KbResult[] = [];

  if (tsquery) {
    const { data, error } = await db.rpc('search_kb', { q: tsquery, k: limit });
    if (error) throw new Error(`Knowledge search failed: ${error.message}`);
    chunks = (data ?? []).map((r: Record<string, unknown>) => ({
      documentId: r.document_id as string,
      title: r.title as string,
      section: r.section as string,
      category: r.category as string,
      version: r.version as string,
      content: r.content as string,
      score: r.score as number,
    }));
  }

  const sourceTitles = chunks.map((c) => c.title);
  await logRetrieval(db, { conversationId, query, chunks, sourceTitles });
  return { chunks, sourceTitles, empty: chunks.length === 0 };
}

// Logging must never break an answer.
async function logRetrieval(
  db: SupabaseClient,
  r: { conversationId?: string; query: string; chunks: KbResult[]; sourceTitles: string[] },
) {
  try {
    const { error } = await db.from('retrieval_logs').insert({
      conversation_id: r.conversationId ?? null,
      query: redactPii(r.query),
      kb_chunks: r.chunks.map((c) => ({ document_id: c.documentId, score: c.score })),
      source_titles: r.sourceTitles,
      source_summary: r.chunks.length
        ? `${r.chunks.length} chunk(s): ${r.sourceTitles.join('; ')}`
        : 'no relevant knowledge found',
    });
    if (error)
      logEvent('warn', 'retrieval log failed', {
        conversation_id: r.conversationId,
        message: error.message,
      });
  } catch (error) {
    logEvent('warn', 'retrieval log failed', {
      conversation_id: r.conversationId,
      message: errorMessage(error),
    });
  }
}
