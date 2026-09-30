-- Events written by the MCP log_conversation_event tool.

create table conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references conversations (conversation_id),
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index conversation_events_conversation_id_idx on conversation_events (conversation_id);

alter table conversation_events enable row level security;
revoke all on conversation_events from anon, authenticated;
