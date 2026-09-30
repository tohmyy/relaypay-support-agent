-- Seed/business tables: customers, transactions, payouts.
-- Status columns are free text: the supplied CSVs use spaces ("review required").

create table customers (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null unique,
  company_name text not null,
  contact_name text,
  contact_email text,
  plan text,
  account_status text,
  region text,
  kyc_status text,
  support_notes text
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,
  customer_id text not null references customers (customer_id),
  transaction_type text,
  amount numeric(14, 2),
  currency text,
  destination_country text,
  status text,
  created_at date,
  estimated_arrival date,
  support_summary text
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  payout_id text not null unique,
  transaction_id text references transactions (transaction_id),
  customer_id text not null references customers (customer_id),
  recipient_name text,
  amount numeric(14, 2),
  currency text,
  status text,
  scheduled_for date,
  failure_reason text
);
