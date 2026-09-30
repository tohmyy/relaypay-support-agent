-- Runtime/support tables (TDD section 18).

create sequence ticket_id_seq;
create sequence escalation_id_seq;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null unique,
  channel text not null,
  caller_identifier text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  final_status text check (final_status in
    ('resolved', 'clarification', 'escalated', 'declined', 'abandoned', 'error')),
  summary text,
  created_at timestamptz not null default now()
);

create table conversation_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references conversations (conversation_id),
  turn_number integer,
  user_transcript text,
  assistant_response text,
  answer_type text check (answer_type in
    ('direct_answer', 'clarification', 'escalation', 'decline', 'tool_result')),
  confidence_note text,
  created_at timestamptz not null default now()
);

create table retrieval_logs (
  id uuid primary key default gen_random_uuid(),
  conversation_id text references conversations (conversation_id),
  query text,
  kb_chunks jsonb,
  source_titles jsonb,
  source_summary text,
  created_at timestamptz not null default now()
);

create table tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id text references conversations (conversation_id),
  tool_name text,
  purpose text,
  input_summary text,
  result_summary text,
  status text check (status in ('success', 'failed', 'not_found')),
  error text,
  created_at timestamptz not null default now()
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null unique
    default 'TKT-' || lpad(nextval('ticket_id_seq')::text, 6, '0'),
  conversation_id text references conversations (conversation_id),
  customer_id text references customers (customer_id),
  category text check (category in
    ('payment', 'payout', 'invoice', 'account', 'compliance', 'technical', 'other')),
  priority text check (priority in ('low', 'normal', 'high', 'urgent')),
  summary text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  escalation_id text not null unique
    default 'ESC-' || lpad(nextval('escalation_id_seq')::text, 6, '0'),
  ticket_id text references support_tickets (ticket_id),
  customer_id text references customers (customer_id),
  user_name text,
  user_email text,
  category text check (category in ('compliance', 'account', 'dispute', 'payment', 'other')),
  reason text,
  call_booked boolean not null default false,
  preferred_time text,
  status text check (status in ('open', 'in_progress', 'closed')),
  created_at timestamptz not null default now()
);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  test_scenario text,
  expected_behavior text,
  actual_behavior text,
  pass boolean,
  notes text,
  created_at timestamptz not null default now()
);
