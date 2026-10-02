-- Live text chat with a human agent (extends Iteration 5). Idempotent; service role only like every other table.

-- Which way the customer chose to be helped when the AI offered a choice at escalation.
alter table escalations add column if not exists contact_preference text;
alter table escalations drop constraint if exists escalations_contact_preference_check;
alter table escalations
  add constraint escalations_contact_preference_check check (contact_preference is null or contact_preference in ('text_chat', 'callback'));

-- Staff availability: a staff member counts as online while "available" is on and they were seen recently
-- (the staff pages send a heartbeat every ~30 seconds).
alter table app_users
  add column if not exists available boolean not null default false,
  add column if not exists last_seen_at timestamptz;

-- When each side last looked at the chat (for "Seen" and unread counts), and when the conversation moved to a person
-- (for how long the customer has waited).
alter table conversations
  add column if not exists customer_last_read_at timestamptz,
  add column if not exists staff_last_read_at timestamptz,
  add column if not exists handoff_at timestamptz,
  -- When each side last wrote, so the staff queue can show unread chats without reading every message.
  add column if not exists last_customer_message_at timestamptz,
  add column if not exists last_staff_message_at timestamptz;

-- The browser gives every message an id before sending, so a retry after a timeout cannot store it twice.
alter table conversation_turns add column if not exists client_msg_id uuid;
-- A plain unique index (not a partial one) so the REST layer can use it for "ignore duplicates". Rows without a client id
-- (every voice-era row) have NULL there, and NULLs never collide in a unique index.
create unique index if not exists conversation_turns_client_msg_idx
  on conversation_turns (conversation_id, client_msg_id);
