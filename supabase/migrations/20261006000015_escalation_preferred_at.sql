-- Build Plan V3, Iteration V3.10 (concern 42): a callback is booked for a specific, validated moment, collected in the
-- conversation (voice or typed chat) and checked by the tool server (not now - 2 minutes <= preferred_at <= now + 1
-- calendar month, in the customer's timezone). `preferred_time` stays as the human-readable text shown to staff.
-- Idempotent; service role only like every other table.

alter table escalations add column if not exists preferred_at timestamptz;
alter table escalations add column if not exists preferred_timezone text;

comment on column escalations.preferred_at is 'Callback instant (UTC), validated by the tool server; null for text-chat escalations and rows from before this column.';
comment on column escalations.preferred_timezone is 'IANA timezone the customer gave for the callback, for example Africa/Lagos.';
