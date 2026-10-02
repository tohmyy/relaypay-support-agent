-- Iteration 10 (Build Plan V2): abuse prevention. A new end reason for sessions stopped by a limit, and a small shared
-- rate limiter for the web app (it runs on several instances, so it cannot keep counters in memory).

alter table conversations drop constraint if exists conversations_end_reason_check;
alter table conversations
  add constraint conversations_end_reason_check
  check (end_reason is null or end_reason in (
    'user-ended', 'silence-timeout', 'session-timeout', 'agent-ended',
    'human-closed', 'low-confidence', 'limit-reached', 'error'
  ));

-- Fixed-window counters. One row per key and window; the function below is the only writer.
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

-- Counts one hit for p_key in the current window and says whether it is still within p_max. Atomic (a single upsert),
-- so two requests cannot both take the last slot. Old windows are pruned now and then.
create or replace function rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into c;

  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  allowed := c <= p_max;
  hits := c;
  retry_after_seconds := case
    when c <= p_max then 0
    else greatest(1, ceil(extract(epoch from (w + make_interval(secs => p_window_seconds) - now())))::integer)
  end;
  return next;
end;
$$;

create or replace function rate_limit_reset(p_key text)
returns void
language sql
as $$
  delete from rate_limits where key = p_key;
$$;

revoke all on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function rate_limit_reset(text) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;
grant execute on function rate_limit_reset(text) to service_role;
