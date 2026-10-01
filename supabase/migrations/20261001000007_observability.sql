-- Timing and cost for observability. All columns are nullable, so existing rows and writers keep working.

alter table conversation_turns add column latency_ms integer;
alter table conversation_turns add column cost_usd numeric(10, 6);
alter table tool_calls add column duration_ms integer;

create index conversation_events_type_created_idx on conversation_events (event_type, created_at);
create index tool_calls_created_at_idx on tool_calls (created_at);
