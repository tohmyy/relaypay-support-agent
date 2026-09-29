# Supabase Schema And Seed Data

Use Supabase to store two categories of data:

- Seed data we provide: customers, transactions, and payouts
- Runtime records your system creates: conversations, turns, retrieval logs, tool calls, tickets, escalations, and evaluations

Students should create the tables, load the seed files from `assets/seed-data/`, and connect their MCP server to these tables.

## Customer Records

Suggested fields:

| Field | Notes |
| --- | --- |
| `customer_id` | Stable customer ID |
| `company_name` | Customer company |
| `contact_name` | Primary contact |
| `contact_email` | Support contact email |
| `plan` | Starter, Growth, or Scale |
| `account_status` | active, restricted, pending verification |
| `region` | Primary operating region |
| `kyc_status` | pending, approved, review required |
| `support_notes` | Short internal support note |

Seed file: `assets/seed-data/customers.csv`

## Transaction Records

Suggested fields:

| Field | Notes |
| --- | --- |
| `transaction_id` | Stable transaction reference |
| `customer_id` | Linked customer |
| `transaction_type` | incoming transfer, outgoing payout, invoice payment |
| `amount` | Transaction amount |
| `currency` | Currency |
| `destination_country` | Country if relevant |
| `status` | processing, completed, delayed, failed, review required |
| `created_at` | Timestamp |
| `estimated_arrival` | Expected arrival if known |
| `support_summary` | Customer-safe status summary |

Seed file: `assets/seed-data/transactions.csv`

## Payout Records

Suggested fields:

| Field | Notes |
| --- | --- |
| `payout_id` | Stable payout reference |
| `transaction_id` | Linked transaction |
| `customer_id` | Linked customer |
| `recipient_name` | Contractor or vendor name |
| `amount` | Payout amount |
| `currency` | Currency |
| `status` | scheduled, processing, completed, failed, review required |
| `scheduled_for` | Scheduled payout date |
| `failure_reason` | Customer-safe reason if failed |

Seed file: `assets/seed-data/payouts.csv`

## Support Tables

Students should also create:

- `conversations`
- `conversation_turns`
- `retrieval_logs`
- `tool_calls`
- `support_tickets`
- `escalations`
- `evaluations`

These tables should store the records required by the PRD.
