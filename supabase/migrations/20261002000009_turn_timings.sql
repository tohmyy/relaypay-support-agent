-- Iteration 3 (Build Plan V2): where a turn's time goes. One JSON object per model turn with the segments
-- (queue, history, retrieval, SDK start, model, MCP, save, first write, ...), written after the reply has gone out so
-- it adds no latency. Nullable, no backfill; conversation_turns.latency_ms keeps its meaning.

alter table conversation_turns
  add column if not exists timings jsonb;
