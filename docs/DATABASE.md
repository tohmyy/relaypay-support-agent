# Database

Supabase Postgres. Migrations are plain SQL in `supabase/migrations/` and are applied in filename order.

| Migration | Contents |
|---|---|
| `..._seed_tables.sql` | `customers`, `transactions`, `payouts` (text business keys are unique FK targets) |
| `..._runtime_tables.sql` | `conversations`, `conversation_turns`, `retrieval_logs`, `tool_calls`, `support_tickets`, `escalations`, `evaluations` |
| `..._app_users.sql` | `app_users` (sign-in accounts: email, scrypt hash, role, optional `customer_id`, display name, title, avatar, disabled flag) and `conversations.customer_id` / `user_id` (nullable; set when a signed-in customer's call is linked) |
| `..._human_handoff.sql` | `conversations.support_mode` (`ai`/`human`/`ended`), `assigned_staff_id`, `staff_typing_at`, `customer_typing_at`; `conversation_turns.sender` (`customer`/`ai`/`staff`/`system`; null = a voice-era pair), `body`, `staff_user_id` (one message per row, `turn_number` null, ordered by `created_at`) |
| `..._abuse_limits.sql` | `limit-reached` added to the `end_reason` check; `rate_limits` counters and the `rate_limit_hit` / `rate_limit_reset` functions the web app uses (service role only) |
| `..._indexes_and_access.sql` | lookup indexes; RLS enabled on all tables with no policies; `anon`/`authenticated` revoked |

- `conversation_events` (an 11th table, added in Phase 5) stores events from the MCP `log_conversation_event` tool.
- `escalations.conversation_id` (nullable, Phase 9) ties an escalation to the call it came from.
- Phase 10 adds nullable `conversation_turns.latency_ms` / `cost_usd` and `tool_calls.duration_ms`.
- Access is through the service-role key on the server only. Never use it in the browser.
- `ticket_id` and `escalation_id` default to `TKT-000001` / `ESC-000001` style values.
- Seed status values keep the CSV wording (for example `review required`), stored as free text.
- Empty CSV cells load as NULL (PAY-7001 `failure_reason`, blank `estimated_arrival`).

## Running

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` in `.env.local` (see `ENVIRONMENT.md`), then:

```bash
npm run db:migrate   # apply pending migrations (tracked in schema_migrations)
npm run db:seed      # idempotent upsert of the three seed CSVs
npm run db:verify    # lookups, FK chain, scenario records, anon access
```

Alternative: paste the SQL files into the Supabase dashboard SQL editor in order.
