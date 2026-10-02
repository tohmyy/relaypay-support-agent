-- Admin-configurable settings. The first one is `contact_methods`: which ways of reaching a person the assistant may offer
-- (a live text chat, a callback). Stored as {"text_chat": true, "callback": true}; no row means both are on. Idempotent;
-- service role only like every other table.

create table if not exists app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users (id)
);

alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;
