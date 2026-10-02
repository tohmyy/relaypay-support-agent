# Database

Supabase Postgres. Migrations are plain SQL in `supabase/migrations/` and are applied in filename order.

| Migration | Contents |
|---|---|
| `..._seed_tables.sql` | `customers`, `transactions`, `payouts` (text business keys are unique FK targets) |
| `..._runtime_tables.sql` | `conversations`, `conversation_turns`, `retrieval_logs`, `tool_calls`, `support_tickets`, `escalations`, `evaluations` |
| `..._app_users.sql` | `app_users` (sign-in accounts: email, scrypt hash, role, optional `customer_id`, display name, title, avatar, disabled flag) and `conversations.customer_id` / `user_id` (nullable; set when a signed-in customer's call is linked) |
| `..._human_handoff.sql` | `conversations.support_mode` (`ai`/`human`/`ended`), `assigned_staff_id`, `staff_typing_at`, `customer_typing_at`; `conversation_turns.sender` (`customer`/`ai`/`staff`/`system`; null = a voice-era pair), `body`, `staff_user_id` (one message per row, `turn_number` null, ordered by `created_at`) |
| `..._live_chat.sql` | `escalations.contact_preference` (`text_chat`/`callback`); `app_users.available`, `last_seen_at` (staff presence); `conversations.customer_last_read_at`, `staff_last_read_at`, `handoff_at`, `last_customer_message_at`, `last_staff_message_at`; `conversation_turns.client_msg_id` (unique with the conversation, so a retried message is stored once) |
| `..._contact_methods.sql` | `app_settings` (`key`, `value` jsonb, `updated_at`, `updated_by`): administrator settings; `contact_methods` = `{"text_chat": bool, "callback": bool}`, no row = both on |
| `..._escalation_preferred_at.sql` | `escalations.preferred_at` (timestamptz, the validated callback instant) and `preferred_timezone` (IANA name); `preferred_time` remains the display text |
| `..._conversation_feedback.sql` | `conversation_feedback` (`conversation_id`, `stage` `ai`/`human`, `rating` 1 to 5, `comment`, `user_id`, `created_at`; unique per conversation and stage). Satisfaction only: it never changes `final_status`, `end_reason` or a ticket status |
| `..._ticket_escalation_ownership.sql` | Every escalation must share a `TKT-######` ticket with the same conversation. Backfills orphans, quarantines irreparable rows in `escalations_quarantine`, then adds the composite FK, ticket format/status checks, one open escalation per conversation, owner-pair check, one active AI conversation per customer, canonical `conversation_turns.turn_uid` / `display_text` / `spoken_text`, and the service-role RPCs (`create_ticket_and_escalation`, `create_support_ticket_once`, `staff_claim_escalation`, `staff_release_escalation`, `staff_close_escalation`, `customer_end_escalation`, `add_human_message`, `replace_active_conversation`) |
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
npm run db:migrate -- --dry-run   # apply each pending file in a rolled-back transaction and print the report
npm run db:migrate   # apply pending migrations (tracked in schema_migrations)
npm run db:seed      # idempotent upsert of the three seed CSVs
npm run db:verify    # lookups, FK chain, scenario records, anon access
```

`20261006000015`, `20261006000016` and `20261007000017` are written and covered by SQL unit tests. They are **not** applied to the shared database until an operator runs `db:migrate`.

Alternative: paste the SQL files into the Supabase dashboard SQL editor in order.
