-- Iterations 6 and 7 (Build Plan V2): people who can sign in to the RelayPay web app, and which customer a conversation
-- belongs to. Passwords are stored only as scrypt hashes. The web server (service role) is the only reader and writer,
-- like every other table: row level security is on with no policies, and anon/authenticated are revoked.

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  role text not null check (role in ('customer', 'support_agent', 'support_admin')),
  customer_id text references customers (customer_id),
  display_name text not null,
  -- Shown beside staff messages ("Sarah, Support Specialist"). These are the Build Plan section 39 staff profile
  -- fields, kept on the user rather than in a second table.
  title text,
  avatar_url text,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  -- A customer belongs to exactly one customer record; staff belong to none.
  constraint app_users_customer_link check ((role = 'customer') = (customer_id is not null))
);

create index if not exists app_users_role_idx on app_users (role);
create index if not exists app_users_customer_id_idx on app_users (customer_id);

alter table app_users enable row level security;
revoke all on app_users from anon, authenticated;

-- Which signed-in customer a conversation belongs to. Both nullable: the public voice page at / has no signed-in user.
alter table conversations
  add column if not exists customer_id text references customers (customer_id),
  add column if not exists user_id uuid references app_users (id);

create index if not exists conversations_customer_id_idx on conversations (customer_id);
