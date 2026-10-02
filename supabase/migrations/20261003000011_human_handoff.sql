-- Iteration 5 (Build Plan V2): human handoff. After an escalation the AI call can stop and the conversation continues as a
-- text chat with a member of staff. support_mode says who is talking; messages from people are stored one per row in
-- conversation_turns with a sender. Idempotent; service role only like every other table (RLS on, no policies).

alter table conversations
  add column if not exists support_mode text not null default 'ai',
  add column if not exists assigned_staff_id uuid references app_users (id),
  add column if not exists staff_typing_at timestamptz,
  add column if not exists customer_typing_at timestamptz;

alter table conversations drop constraint if exists conversations_support_mode_check;
alter table conversations
  add constraint conversations_support_mode_check check (support_mode in ('ai', 'human', 'ended'));

-- Conversations that already ended before this migration are 'ended', not 'ai'.
update conversations set support_mode = 'ended' where ended_at is not null and support_mode = 'ai';

create index if not exists conversations_support_mode_idx on conversations (support_mode);
create index if not exists conversations_assigned_staff_idx on conversations (assigned_staff_id);

-- A message from a person or the system. Legacy rows (sender null) are the AI-era "customer said / assistant replied"
-- pairs and keep working unchanged. A sender row is one message in body, with turn_number left null (turn numbers are
-- allocated by the agent and are not safe to assign from two writers); order by created_at.
alter table conversation_turns
  add column if not exists sender text,
  add column if not exists body text,
  add column if not exists staff_user_id uuid references app_users (id);

alter table conversation_turns drop constraint if exists conversation_turns_sender_check;
alter table conversation_turns
  add constraint conversation_turns_sender_check check (sender is null or sender in ('customer', 'ai', 'staff', 'system'));

create index if not exists conversation_turns_conversation_created_idx on conversation_turns (conversation_id, created_at);
