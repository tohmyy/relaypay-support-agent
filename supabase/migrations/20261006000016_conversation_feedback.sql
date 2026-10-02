-- Build Plan V3, Iteration V3.9 (concerns 33, 35, 36): optional star ratings, collected twice at most per conversation:
-- once after the AI voice (or typed) leg, once after human support closes. Satisfaction only: nothing here, and nothing
-- that writes here, ever changes conversations.final_status, end_reason or a ticket's status. Idempotent; service role
-- only like every other table.

create table if not exists conversation_feedback (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references conversations (conversation_id) on delete cascade,
  stage text not null check (stage in ('ai', 'human')),
  rating integer not null check (rating between 1 and 5),
  comment text,
  user_id uuid references app_users (id),
  created_at timestamptz not null default now(),
  unique (conversation_id, stage)
);

create index if not exists conversation_feedback_created_idx on conversation_feedback (created_at desc);

alter table conversation_feedback enable row level security;
revoke all on conversation_feedback from anon, authenticated;
