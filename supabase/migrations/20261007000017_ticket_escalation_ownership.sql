-- Build Plan V4, Window 6 (concerns 43, 44, 45, 46, 47, 48, 52): every escalation belongs to exactly one ticket of the same
-- conversation, escalation lifecycle changes are single transactions, a signed-in customer has at most one active AI
-- conversation, and each turn carries a stable id plus its display and spoken text. Idempotent; service role only like
-- every other table. `npm run db:migrate -- --dry-run` runs it in a rolled-back transaction and prints the backfill report.
--
-- Rollout order: apply this migration first, then deploy the tool server, the agent and the web app (they call the
-- functions and write the columns created here).

-- Nothing may insert an escalation or ticket between the backfill below and the constraints that follow it.
lock table escalations, support_tickets in share row exclusive mode;

-- What the backfill did, so a dry run (and a later audit) can see it. One row per step, replaced if the migration reruns.
create table if not exists migration_backfill_report (
  migration text not null,
  step text not null,
  row_count integer not null,
  recorded_at timestamptz not null default now(),
  primary key (migration, step)
);
alter table migration_backfill_report enable row level security;
revoke all on migration_backfill_report from anon, authenticated;

-- Escalations that could not be tied to a ticket. Kept whole (as JSON, so it survives later column changes) and removed
-- from escalations, which must never hold an orphan.
create table if not exists escalations_quarantine (
  id uuid primary key default gen_random_uuid(),
  escalation_id text,
  reason text not null,
  original jsonb not null,
  quarantined_at timestamptz not null default now()
);
alter table escalations_quarantine enable row level security;
revoke all on escalations_quarantine from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tickets and escalations: normalise, backfill, quarantine, then constrain.
-- ---------------------------------------------------------------------------------------------------------------------

-- Ticket and escalation status become a closed vocabulary. Anything unrecognised was never worked on, so it is open.
update support_tickets
set status = case lower(btrim(coalesce(status, '')))
  when 'in_progress' then 'in_progress'
  when 'in progress' then 'in_progress'
  when 'closed' then 'closed'
  when 'resolved' then 'closed'
  when 'done' then 'closed'
  else 'open'
end
where status is distinct from case lower(btrim(coalesce(status, '')))
  when 'in_progress' then 'in_progress'
  when 'in progress' then 'in_progress'
  when 'closed' then 'closed'
  when 'resolved' then 'closed'
  when 'done' then 'closed'
  else 'open'
end;
update escalations set status = 'open' where status is null;

alter table support_tickets alter column status set default 'open';
alter table support_tickets alter column status set not null;
alter table escalations alter column status set default 'open';
alter table escalations alter column status set not null;

alter table escalations add column if not exists updated_at timestamptz;
update escalations set updated_at = created_at where updated_at is null;
alter table escalations alter column updated_at set default now();
alter table escalations alter column updated_at set not null;

do $$
declare
  v_linked integer := 0;
  v_created integer := 0;
  v_linked_created integer := 0;
  v_quarantined integer := 0;
  v_closed_duplicates integer := 0;
begin
  -- An escalation is "matched" when a ticket with its ticket_id exists in the same conversation. Everything else is
  -- missing a ticket or points at another conversation's ticket.

  -- (a) Link to the latest ticket already recorded for the same conversation.
  update escalations e
  set ticket_id = (
    select t.ticket_id
    from support_tickets t
    where t.conversation_id = e.conversation_id
    order by t.created_at desc, t.id desc
    limit 1
  )
  where e.conversation_id is not null
    and not exists (
      select 1 from support_tickets t where t.ticket_id = e.ticket_id and t.conversation_id = e.conversation_id
    )
    and exists (select 1 from support_tickets t where t.conversation_id = e.conversation_id);
  get diagnostics v_linked = row_count;

  -- (b) A conversation with escalations still unmatched and no ticket at all gets one, from its latest such escalation.
  insert into support_tickets (conversation_id, customer_id, category, priority, summary, status, created_at)
  select distinct on (e.conversation_id)
    e.conversation_id,
    e.customer_id,
    case e.category
      when 'compliance' then 'compliance'
      when 'account' then 'account'
      when 'payment' then 'payment'
      else 'other'
    end,
    'normal',
    coalesce(nullif(left(btrim(e.reason), 1000), ''), 'Escalation raised before tickets were required'),
    e.status,
    e.created_at
  from escalations e
  where e.conversation_id is not null
    and not exists (
      select 1 from support_tickets t where t.ticket_id = e.ticket_id and t.conversation_id = e.conversation_id
    )
  order by e.conversation_id, e.created_at desc, e.id desc;
  get diagnostics v_created = row_count;

  -- (c) Link what (b) just created.
  update escalations e
  set ticket_id = (
    select t.ticket_id
    from support_tickets t
    where t.conversation_id = e.conversation_id
    order by t.created_at desc, t.id desc
    limit 1
  )
  where e.conversation_id is not null
    and not exists (
      select 1 from support_tickets t where t.ticket_id = e.ticket_id and t.conversation_id = e.conversation_id
    )
    and exists (select 1 from support_tickets t where t.conversation_id = e.conversation_id);
  get diagnostics v_linked_created = row_count;

  -- (d) Whatever is left has no conversation to hang a ticket on.
  insert into escalations_quarantine (escalation_id, reason, original)
  select e.escalation_id,
    case when e.conversation_id is null then 'no conversation_id' else 'no matching ticket' end,
    to_jsonb(e)
  from escalations e
  where not exists (
    select 1 from support_tickets t where t.ticket_id = e.ticket_id and t.conversation_id = e.conversation_id
  );
  get diagnostics v_quarantined = row_count;
  delete from escalations e
  where not exists (
    select 1 from support_tickets t where t.ticket_id = e.ticket_id and t.conversation_id = e.conversation_id
  );

  -- (e) One open escalation per conversation (the index below): older open ones are closed, the latest stays.
  with ranked as (
    select id, row_number() over (partition by conversation_id order by created_at desc, id desc) as rn
    from escalations
    where status <> 'closed'
  )
  update escalations e
  set status = 'closed', updated_at = now()
  from ranked r
  where r.id = e.id and r.rn > 1;
  get diagnostics v_closed_duplicates = row_count;

  insert into migration_backfill_report (migration, step, row_count) values
    ('20261007000017_ticket_escalation_ownership', 'escalations linked to an existing ticket', v_linked),
    ('20261007000017_ticket_escalation_ownership', 'tickets created for orphan escalations', v_created),
    ('20261007000017_ticket_escalation_ownership', 'escalations linked to a created ticket', v_linked_created),
    ('20261007000017_ticket_escalation_ownership', 'escalations quarantined', v_quarantined),
    ('20261007000017_ticket_escalation_ownership', 'duplicate open escalations closed', v_closed_duplicates)
  on conflict (migration, step) do update set row_count = excluded.row_count, recorded_at = now();
end
$$;

-- Constraints. All rows now satisfy them; each is added NOT VALID and then validated in a guarded block, so a row this
-- script could not foresee leaves the constraint enforcing new writes (reported as a notice) instead of failing the migration.
alter table escalations alter column ticket_id set not null;
alter table escalations alter column conversation_id set not null;

alter table support_tickets drop constraint if exists support_tickets_status_check;
alter table support_tickets
  add constraint support_tickets_status_check check (status in ('open', 'in_progress', 'closed'));

alter table support_tickets drop constraint if exists support_tickets_ticket_id_format;
alter table support_tickets
  add constraint support_tickets_ticket_id_format check (ticket_id ~ '^TKT-[0-9]{6}$') not valid;

-- A composite foreign key needs a unique key on the referenced pair first. ticket_id alone is already unique; the pair
-- is what lets an escalation point at "this ticket, in this conversation".
create unique index if not exists support_tickets_ticket_conversation_key
  on support_tickets (ticket_id, conversation_id);

alter table escalations drop constraint if exists escalations_ticket_conversation_fkey;
alter table escalations
  add constraint escalations_ticket_conversation_fkey
  foreign key (ticket_id, conversation_id) references support_tickets (ticket_id, conversation_id) not valid;

do $$
begin
  begin
    alter table support_tickets validate constraint support_tickets_ticket_id_format;
  exception when check_violation then
    raise notice 'support_tickets_ticket_id_format left NOT VALID: some existing ticket ids do not match TKT-000000';
  end;
  begin
    alter table escalations validate constraint escalations_ticket_conversation_fkey;
  exception when foreign_key_violation then
    raise notice 'escalations_ticket_conversation_fkey left NOT VALID: some escalations point at another conversation''s ticket';
  end;
end
$$;

-- At most one open escalation per conversation: a repeat create finds it instead of adding another.
create unique index if not exists escalations_one_open_per_conversation_key
  on escalations (conversation_id) where status <> 'closed';

create or replace function set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists escalations_set_updated_at on escalations;
create trigger escalations_set_updated_at before update on escalations
  for each row execute function set_updated_at();
drop trigger if exists support_tickets_set_updated_at on support_tickets;
create trigger support_tickets_set_updated_at before update on support_tickets
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Conversation ownership.
-- ---------------------------------------------------------------------------------------------------------------------

-- A conversation is owned by a signed-in account through both ids or by neither (the unlinked grace period). Rows with
-- only one of the two get the other from the account record when that is unambiguous.
update conversations c
set customer_id = u.customer_id
from app_users u
where c.customer_id is null and c.user_id = u.id and u.customer_id is not null;

update conversations c
set user_id = (
  select u.id from app_users u where u.customer_id = c.customer_id and u.role = 'customer' and not u.disabled
)
where c.user_id is null
  and c.customer_id is not null
  and (select count(*) from app_users u where u.customer_id = c.customer_id and u.role = 'customer' and not u.disabled) = 1;

-- NOT VALID, then validated if every row complies: a legacy row that still has only one id (an account shared by several
-- sign-ins) keeps working for reads, while new and updated rows must carry both or neither.
alter table conversations drop constraint if exists conversations_owner_pair;
alter table conversations
  add constraint conversations_owner_pair check ((user_id is null) = (customer_id is null)) not valid;

do $$
begin
  alter table conversations validate constraint conversations_owner_pair;
exception when check_violation then
  raise notice 'conversations_owner_pair left NOT VALID: some conversations have only one of user_id and customer_id';
end
$$;

-- One active AI conversation per signed-in customer (AC-44.1). Existing duplicates are ended first, keeping the most
-- recently active one, otherwise the index could not be built. This matches MAX_CONCURRENT_SESSIONS=1 (the default);
-- a deployment that raises it must not rely on more than one active AI conversation per customer.
with active as (
  select id,
    row_number() over (
      partition by customer_id
      order by coalesce(last_activity_at, started_at) desc, started_at desc, id desc
    ) as rn
  from conversations
  where support_mode = 'ai' and ended_at is null and customer_id is not null
),
ended as (
  update conversations c
  set support_mode = 'ended',
      ended_at = now(),
      end_reason = coalesce(c.end_reason, 'user-ended'),
      final_status = coalesce(c.final_status, 'abandoned'),
      last_activity_at = now()
  from active a
  where a.id = c.id and a.rn > 1
  returning c.id
)
insert into migration_backfill_report (migration, step, row_count)
select '20261007000017_ticket_escalation_ownership', 'duplicate active AI conversations ended', count(*)::integer
from ended
on conflict (migration, step) do update set row_count = excluded.row_count, recorded_at = now();

create unique index if not exists conversations_one_active_ai_per_customer_key
  on conversations (customer_id) where support_mode = 'ai' and ended_at is null;

-- Staff archive pages read newest first with a stable tie-break.
create index if not exists conversations_started_conversation_idx
  on conversations (started_at desc, conversation_id desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Canonical turns: a stable id, and the text as displayed and as spoken.
-- ---------------------------------------------------------------------------------------------------------------------

-- A volatile default is evaluated per row, so existing turns each get their own id. assistant_response stays as the
-- legacy / fallback text for rows written before display_text existed.
alter table conversation_turns
  add column if not exists turn_uid uuid not null default gen_random_uuid(),
  add column if not exists display_text text,
  add column if not exists spoken_text text;

create unique index if not exists conversation_turns_turn_uid_key on conversation_turns (turn_uid);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Functions. Each one is a single transaction that locks the conversation first, so two callers cannot both win.
--    Service role only, like the tables.
-- ---------------------------------------------------------------------------------------------------------------------

-- Current ticket and escalation of a conversation as JSON (null when the conversation does not exist). Internal helper.
create or replace function escalation_state(p_conversation_id text)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'support_mode', c.support_mode,
    'assigned_staff_id', c.assigned_staff_id,
    'ended_at', c.ended_at,
    'end_reason', c.end_reason,
    'final_status', c.final_status,
    'ticket_id', e.ticket_id,
    'ticket_status', t.status,
    'escalation_id', e.escalation_id,
    'escalation_status', e.status
  )
  from conversations c
  left join lateral (
    select x.ticket_id, x.escalation_id, x.status
    from escalations x
    where x.conversation_id = c.conversation_id
    order by (x.status <> 'closed') desc, x.created_at desc, x.id desc
    limit 1
  ) e on true
  left join support_tickets t on t.ticket_id = e.ticket_id
  where c.conversation_id = p_conversation_id
$fn$;

-- Moves the conversation's open escalation(s) and their tickets to one status together. Internal helper.
create or replace function set_escalation_status(p_conversation_id text, p_status text)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  with moved as (
    update escalations
    set status = p_status
    where conversation_id = p_conversation_id and status <> 'closed'
    returning ticket_id
  )
  update support_tickets t
  set status = p_status
  from moved
  where t.ticket_id = moved.ticket_id;
end;
$fn$;

-- Creates the ticket and the escalation together, or returns the pair that already exists for the conversation. The
-- conversation row is created if missing and locked, so a repeat or racing call finds the first one's result.
-- Returns {ticket_id, escalation_id, created}.
create or replace function create_ticket_and_escalation(
  p_conversation_id text,
  p_customer_id text,
  p_category text,
  p_priority text,
  p_summary text,
  p_escalation_category text,
  p_reason text,
  p_user_name text,
  p_user_email text,
  p_contact_preference text default null,
  p_preferred_time text default null,
  p_preferred_at timestamptz default null,
  p_preferred_timezone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  ex escalations%rowtype;
  v_ticket text;
  v_escalation text;
begin
  insert into conversations (conversation_id, channel) values (p_conversation_id, 'voice')
  on conflict (conversation_id) do nothing;
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if c.customer_id is not null and c.customer_id is distinct from p_customer_id then
    raise exception 'conversation belongs to another customer' using errcode = '42501';
  end if;

  select * into ex
  from escalations e
  where e.conversation_id = p_conversation_id and e.status <> 'closed'
  order by e.created_at desc, e.id desc
  limit 1;
  if found then
    return jsonb_build_object('ticket_id', ex.ticket_id, 'escalation_id', ex.escalation_id, 'created', false);
  end if;

  -- A ticket already logged for this conversation (create_support_ticket) is the escalation's ticket.
  select t.ticket_id into v_ticket
  from support_tickets t
  where t.conversation_id = p_conversation_id and t.status <> 'closed'
  order by t.created_at desc, t.id desc
  limit 1;
  if v_ticket is null then
    insert into support_tickets (conversation_id, customer_id, category, priority, summary, status)
    values (p_conversation_id, p_customer_id, p_category, p_priority, p_summary, 'open')
    returning ticket_id into v_ticket;
  end if;

  insert into escalations (
    ticket_id, conversation_id, customer_id, user_name, user_email, category, reason,
    preferred_time, preferred_at, preferred_timezone, contact_preference, status
  )
  values (
    v_ticket, p_conversation_id, p_customer_id, p_user_name, p_user_email, p_escalation_category, p_reason,
    p_preferred_time, p_preferred_at, p_preferred_timezone, p_contact_preference, 'open'
  )
  returning escalation_id into v_escalation;

  return jsonb_build_object('ticket_id', v_ticket, 'escalation_id', v_escalation, 'created', true);
end;
$fn$;

-- Logs a ticket for follow-up, once per conversation and summary: a repeat returns the same ticket.
-- Returns {ticket_id, status, created}.
create or replace function create_support_ticket_once(
  p_conversation_id text,
  p_customer_id text,
  p_category text,
  p_priority text,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  v_ticket text;
  v_status text;
begin
  insert into conversations (conversation_id, channel) values (p_conversation_id, 'voice')
  on conflict (conversation_id) do nothing;
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if c.customer_id is not null and c.customer_id is distinct from p_customer_id then
    raise exception 'conversation belongs to another customer' using errcode = '42501';
  end if;

  select t.ticket_id, t.status into v_ticket, v_status
  from support_tickets t
  where t.conversation_id = p_conversation_id and lower(btrim(t.summary)) = lower(btrim(p_summary))
  order by t.created_at desc, t.id desc
  limit 1;
  if v_ticket is not null then
    return jsonb_build_object('ticket_id', v_ticket, 'status', v_status, 'created', false);
  end if;

  insert into support_tickets (conversation_id, customer_id, category, priority, summary, status)
  values (p_conversation_id, p_customer_id, p_category, p_priority, p_summary, 'open')
  returning ticket_id into v_ticket;
  return jsonb_build_object('ticket_id', v_ticket, 'status', 'open', 'created', true);
end;
$fn$;

-- Staff takes an unassigned conversation: conversation, ticket, escalation, a customer-visible note and one event, or
-- nothing. A stale or repeated click changes nothing and returns the current state. Returns {outcome, state}; outcome is
-- claimed | already-mine | taken | not-open | not-found | not-authorized.
create or replace function staff_claim_escalation(p_conversation_id text, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  s app_users%rowtype;
begin
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found', 'state', null);
  end if;
  select * into s from app_users where id = p_staff_id and role in ('support_agent', 'support_admin') and not disabled;
  if not found then
    return jsonb_build_object('outcome', 'not-authorized', 'state', escalation_state(p_conversation_id));
  end if;
  if c.support_mode <> 'human' or c.ended_at is not null then
    return jsonb_build_object('outcome', 'not-open', 'state', escalation_state(p_conversation_id));
  end if;
  if c.assigned_staff_id = p_staff_id then
    return jsonb_build_object('outcome', 'already-mine', 'state', escalation_state(p_conversation_id));
  end if;
  if c.assigned_staff_id is not null then
    return jsonb_build_object('outcome', 'taken', 'state', escalation_state(p_conversation_id));
  end if;

  update conversations set assigned_staff_id = p_staff_id, last_activity_at = now() where id = c.id;
  perform set_escalation_status(p_conversation_id, 'in_progress');
  insert into conversation_turns (conversation_id, sender, body)
  values (
    p_conversation_id, 'system',
    s.display_name || case when s.title is not null and s.title <> '' then ', ' || s.title || ',' else '' end
      || ' has joined the conversation.'
  );
  insert into conversation_events (conversation_id, event_type, summary, metadata)
  values (p_conversation_id, 'human_claimed', 'conversation accepted by staff', jsonb_build_object('claimed_by', p_staff_id));
  return jsonb_build_object('outcome', 'claimed', 'state', escalation_state(p_conversation_id));
end;
$fn$;

-- The person who has the conversation (or an admin) gives it back to the queue. outcome is released | not-assigned |
-- taken | not-open | not-found | not-authorized.
create or replace function staff_release_escalation(p_conversation_id text, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  s app_users%rowtype;
begin
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found', 'state', null);
  end if;
  select * into s from app_users where id = p_staff_id and role in ('support_agent', 'support_admin') and not disabled;
  if not found then
    return jsonb_build_object('outcome', 'not-authorized', 'state', escalation_state(p_conversation_id));
  end if;
  if c.support_mode <> 'human' or c.ended_at is not null then
    return jsonb_build_object('outcome', 'not-open', 'state', escalation_state(p_conversation_id));
  end if;
  if c.assigned_staff_id is null then
    return jsonb_build_object('outcome', 'not-assigned', 'state', escalation_state(p_conversation_id));
  end if;
  if c.assigned_staff_id <> p_staff_id and s.role <> 'support_admin' then
    return jsonb_build_object('outcome', 'taken', 'state', escalation_state(p_conversation_id));
  end if;

  update conversations
  set assigned_staff_id = null, staff_typing_at = null, last_activity_at = now()
  where id = c.id;
  perform set_escalation_status(p_conversation_id, 'open');
  insert into conversation_turns (conversation_id, sender, body)
  values (
    p_conversation_id, 'system',
    'Your specialist has returned this conversation to the queue. Another specialist will join you shortly.'
  );
  insert into conversation_events (conversation_id, event_type, summary, metadata)
  values (p_conversation_id, 'human_released', 'conversation returned to the queue', jsonb_build_object('released_by', p_staff_id));
  return jsonb_build_object('outcome', 'released', 'state', escalation_state(p_conversation_id));
end;
$fn$;

-- Staff closes the escalation: ticket and escalation closed together. A chat that is still open ends with it
-- (support_mode ended, end_reason human-closed, ended_at); a callback whose conversation already ended only has its
-- ticket and escalation closed. final_status keeps the AI's outcome (escalated). outcome is closed | taken | not-open |
-- not-found | not-authorized.
create or replace function staff_close_escalation(p_conversation_id text, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  s app_users%rowtype;
  v_open boolean;
begin
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found', 'state', null);
  end if;
  select * into s from app_users where id = p_staff_id and role in ('support_agent', 'support_admin') and not disabled;
  if not found then
    return jsonb_build_object('outcome', 'not-authorized', 'state', escalation_state(p_conversation_id));
  end if;

  v_open := c.support_mode = 'human' and c.ended_at is null;
  if v_open then
    if c.assigned_staff_id is not null and c.assigned_staff_id <> p_staff_id and s.role <> 'support_admin' then
      return jsonb_build_object('outcome', 'taken', 'state', escalation_state(p_conversation_id));
    end if;
    update conversations
    set support_mode = 'ended',
        ended_at = now(),
        end_reason = 'human-closed',
        last_activity_at = now(),
        staff_typing_at = null,
        customer_typing_at = null
    where id = c.id;
  elsif c.support_mode = 'ai' and c.ended_at is null then
    -- The AI call is still going; there is nothing for staff to close yet.
    return jsonb_build_object('outcome', 'not-open', 'state', escalation_state(p_conversation_id));
  elsif not exists (select 1 from escalations e where e.conversation_id = p_conversation_id and e.status <> 'closed') then
    -- Already closed: a repeat changes nothing.
    return jsonb_build_object('outcome', 'not-open', 'state', escalation_state(p_conversation_id));
  end if;

  perform set_escalation_status(p_conversation_id, 'closed');
  if v_open then
    insert into conversation_turns (conversation_id, sender, body)
    values (p_conversation_id, 'system', s.display_name || ' has closed this conversation.');
  end if;
  insert into conversation_events (conversation_id, event_type, summary, metadata)
  values (p_conversation_id, 'human_closed', 'conversation closed by staff', jsonb_build_object('closed_by', p_staff_id));
  return jsonb_build_object('outcome', 'closed', 'state', escalation_state(p_conversation_id));
end;
$fn$;

-- The customer ends their own open chat with a specialist; the ticket and escalation close with it. Only the owner:
-- anyone else gets not-found, the same as a conversation that does not exist. outcome is ended | not-open | not-found.
create or replace function customer_end_escalation(p_conversation_id text, p_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
begin
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if not found or c.customer_id is distinct from p_customer_id then
    return jsonb_build_object('outcome', 'not-found', 'state', null);
  end if;
  if c.support_mode <> 'human' or c.ended_at is not null then
    return jsonb_build_object('outcome', 'not-open', 'state', escalation_state(p_conversation_id));
  end if;

  update conversations
  set support_mode = 'ended',
      ended_at = now(),
      end_reason = 'user-ended',
      last_activity_at = now(),
      staff_typing_at = null,
      customer_typing_at = null
  where id = c.id;
  perform set_escalation_status(p_conversation_id, 'closed');
  insert into conversation_turns (conversation_id, sender, body)
  values (p_conversation_id, 'system', 'The customer ended the conversation.');
  insert into conversation_events (conversation_id, event_type, summary, metadata)
  values (p_conversation_id, 'customer_ended', 'conversation ended by the customer', '{}'::jsonb);
  return jsonb_build_object('outcome', 'ended', 'state', escalation_state(p_conversation_id));
end;
$fn$;

-- Stores one message in a chat with a specialist only while the chat is open. The conversation row is locked, so a close
-- that wins the race makes the message fail with `closed` instead of landing after it. A retry with the same
-- p_client_msg_id is stored once (`duplicate`). outcome is ok | duplicate | closed | not-found.
create or replace function add_human_message(
  p_conversation_id text,
  p_sender text,
  p_body text,
  p_staff_user_id uuid default null,
  p_client_msg_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  v_id uuid;
begin
  if p_sender not in ('customer', 'staff') then
    raise exception 'sender must be customer or staff' using errcode = '22023';
  end if;
  select * into c from conversations where conversation_id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;
  if c.support_mode <> 'human' or c.ended_at is not null then
    return jsonb_build_object('outcome', 'closed');
  end if;

  insert into conversation_turns (conversation_id, sender, body, staff_user_id, client_msg_id)
  values (p_conversation_id, p_sender, p_body, case when p_sender = 'staff' then p_staff_user_id end, p_client_msg_id)
  on conflict (conversation_id, client_msg_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  update conversations
  set last_activity_at = now(),
      customer_typing_at = case when p_sender = 'customer' then null else customer_typing_at end,
      staff_typing_at = case when p_sender = 'staff' then null else staff_typing_at end,
      last_customer_message_at = case when p_sender = 'customer' then now() else last_customer_message_at end,
      last_staff_message_at = case when p_sender = 'staff' then now() else last_staff_message_at end
  where id = c.id;
  return jsonb_build_object('outcome', 'ok', 'id', v_id);
end;
$fn$;

-- The owner replaces their active AI conversation: the customer row is locked so two requests are serialised, the old
-- AI conversation is ended, and the caller then starts one fresh conversation. outcome is replaced | already-ended |
-- human | not-found (not theirs, or no such conversation).
create or replace function replace_active_conversation(p_customer_id text, p_old_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c conversations%rowtype;
  v_turns integer;
begin
  perform 1 from customers where customer_id = p_customer_id for update;
  select * into c from conversations where conversation_id = p_old_id and customer_id = p_customer_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;
  if c.support_mode = 'human' and c.ended_at is null then
    return jsonb_build_object('outcome', 'human');
  end if;
  if c.ended_at is not null or c.support_mode = 'ended' then
    return jsonb_build_object('outcome', 'already-ended');
  end if;

  select count(*) into v_turns from conversation_turns where conversation_id = p_old_id and turn_number is not null;
  update conversations
  set support_mode = 'ended',
      ended_at = now(),
      end_reason = coalesce(end_reason, 'user-ended'),
      final_status = coalesce(final_status, case when v_turns > 0 then 'resolved' else 'abandoned' end),
      last_activity_at = now()
  where id = c.id;
  insert into conversation_events (conversation_id, event_type, summary, metadata)
  values (p_old_id, 'session_replaced', 'ended so the customer could start a new conversation', '{}'::jsonb);
  return jsonb_build_object('outcome', 'replaced');
end;
$fn$;

-- Service role only, like the tables.
revoke all on function escalation_state(text) from public, anon, authenticated;
revoke all on function set_escalation_status(text, text) from public, anon, authenticated;
revoke all on function create_ticket_and_escalation(text, text, text, text, text, text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function create_support_ticket_once(text, text, text, text, text) from public, anon, authenticated;
revoke all on function staff_claim_escalation(text, uuid) from public, anon, authenticated;
revoke all on function staff_release_escalation(text, uuid) from public, anon, authenticated;
revoke all on function staff_close_escalation(text, uuid) from public, anon, authenticated;
revoke all on function customer_end_escalation(text, text) from public, anon, authenticated;
revoke all on function add_human_message(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function replace_active_conversation(text, text) from public, anon, authenticated;

grant execute on function create_ticket_and_escalation(text, text, text, text, text, text, text, text, text, text, text, timestamptz, text) to service_role;
grant execute on function create_support_ticket_once(text, text, text, text, text) to service_role;
grant execute on function staff_claim_escalation(text, uuid) to service_role;
grant execute on function staff_release_escalation(text, uuid) to service_role;
grant execute on function staff_close_escalation(text, uuid) to service_role;
grant execute on function customer_end_escalation(text, text) to service_role;
grant execute on function add_human_message(text, text, text, uuid, uuid) to service_role;
grant execute on function replace_active_conversation(text, text) to service_role;
