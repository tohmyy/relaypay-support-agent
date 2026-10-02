-- Iteration 1 (Build Plan V2): session lifecycle. Why a conversation ended, and when it last had activity.
-- final_status stays the coarse outcome; end_reason says why the session stopped. Both nullable, no backfill.

alter table conversations
  add column if not exists end_reason text,
  add column if not exists last_activity_at timestamptz;

alter table conversations
  drop constraint if exists conversations_end_reason_check;
alter table conversations
  add constraint conversations_end_reason_check
  check (end_reason is null or end_reason in (
    'user-ended', 'silence-timeout', 'session-timeout', 'agent-ended',
    'human-closed', 'low-confidence', 'error'
  ));

create index if not exists conversations_end_reason_idx on conversations (end_reason);
