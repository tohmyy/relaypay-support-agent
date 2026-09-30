# Knowledge base

Source: `assets/relaypay-knowledge-base.md` (approved, unedited). `npm run kb:split` splits it by heading into
`knowledge/<category>/<slug>.md`, one file per section, word-for-word, with frontmatter
(`document_id`, `title`, `section`, `category`, `source_type`, `version`). Those files are what gets ingested.

Categories: product, faq, compliance, security, disputes, communications, release_notes.

## Commands

```bash
npm run kb:split    # regenerate knowledge/ from the source (overwrites)
npm run db:migrate  # creates kb_chunks and search_kb()
npm run kb:ingest   # idempotent upsert into kb_chunks; removes chunks with no file
```

## Retrieval

`retrieveKnowledge(query, { conversationId?, limit = 4 })` in `services/agent/retrieval/retrieve.ts`.
It builds an OR tsquery from the question (`query.ts`), calls the `search_kb` SQL function (Postgres full-text
search, title weighted above body) and returns chunks with metadata. `empty: true` means nothing relevant was
found, so the agent should decline or escalate instead of guessing. Each call writes a `retrieval_logs` row;
logging failures never break the answer. No embeddings: the KB is about 37 short chunks.

Tests: `tests/retrieval/query.test.ts` (offline) and `tests/retrieval/acceptance.test.ts` (live, uses `.env.local`,
skipped when Supabase credentials are absent).

## Known gaps in the source KB

- No fee figures: only "fees vary by transaction type, corridor and payment method". The agent must not invent numbers.
- Scenario 1 expects currency, recipient country and account setup as delay factors; the KB names transaction
  type, corridor and payment method. Keep answers to what the KB says.
