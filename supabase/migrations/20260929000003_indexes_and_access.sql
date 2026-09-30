-- Lookup indexes (unique business keys are already indexed by their constraints).
create index customers_contact_email_idx on customers (lower(contact_email));
create index customers_company_name_idx on customers (lower(company_name));
create index transactions_customer_id_idx on transactions (customer_id);
create index payouts_transaction_id_idx on payouts (transaction_id);
create index payouts_customer_id_idx on payouts (customer_id);
create index conversation_turns_conversation_id_idx on conversation_turns (conversation_id);
create index retrieval_logs_conversation_id_idx on retrieval_logs (conversation_id);
create index tool_calls_conversation_id_idx on tool_calls (conversation_id);
create index support_tickets_conversation_id_idx on support_tickets (conversation_id);
create index support_tickets_customer_id_idx on support_tickets (customer_id);
create index escalations_ticket_id_idx on escalations (ticket_id);
create index escalations_customer_id_idx on escalations (customer_id);

-- Access: RLS on with no policies, so only the service-role key can read or write.
alter table customers enable row level security;
alter table transactions enable row level security;
alter table payouts enable row level security;
alter table conversations enable row level security;
alter table conversation_turns enable row level security;
alter table retrieval_logs enable row level security;
alter table tool_calls enable row level security;
alter table support_tickets enable row level security;
alter table escalations enable row level security;
alter table evaluations enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
