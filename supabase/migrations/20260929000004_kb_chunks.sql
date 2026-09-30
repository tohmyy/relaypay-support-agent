-- Knowledge base chunks with weighted full-text search (title > content).

create table kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id text not null,
  chunk_index integer not null default 0,
  title text not null,
  section text not null,
  category text not null check (category in
    ('product', 'faq', 'compliance', 'security', 'disputes', 'communications', 'release_notes')),
  source_type text not null,
  version text not null,
  content text not null,
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index kb_chunks_search_idx on kb_chunks using gin (search);
create index kb_chunks_category_idx on kb_chunks (category);

-- q is a tsquery string built by the caller from sanitized terms (for example 'charge | fee').
create function search_kb(q text, k integer default 4)
returns table (
  document_id text,
  chunk_index integer,
  title text,
  section text,
  category text,
  source_type text,
  version text,
  content text,
  score real
)
language sql stable as $$
  select c.document_id, c.chunk_index, c.title, c.section, c.category,
         c.source_type, c.version, c.content, ts_rank(c.search, query) as score
  from kb_chunks c, to_tsquery('english', q) query
  where c.search @@ query
  order by score desc, c.document_id
  limit k;
$$;

alter table kb_chunks enable row level security;
revoke all on kb_chunks from anon, authenticated;
revoke all on function search_kb(text, integer) from public, anon, authenticated;
grant execute on function search_kb(text, integer) to service_role;
