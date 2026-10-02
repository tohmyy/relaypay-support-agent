# Human handoff (Mode B)

Build Plan V2, Iteration 5. After an escalation, a **signed-in** customer can move from the AI voice call to a **text
chat with a support specialist**. It is off by default (`HUMAN_HANDOFF=1` on the agent turns it on). Mode A (the contact
form on the live call) is unchanged and is still what anonymous callers on `/` get.

## The flow

1. A signed-in customer talks to the voice assistant on `/support`. The page ties the call to their account
   (`POST /api/support/link`, `docs/AUTH.md`), so the agent service can see `conversations.customer_id`.
2. The assistant decides to escalate, collects the contact details and calls `create_escalation`. Because this customer is
   signed in and handoff is on, its instructions include `human_handoff_available`: it says a specialist will continue by
   text in the same window and that the call is about to end.
3. When the confirmation has finished playing (or after 10 seconds if that event never arrives) the Session Controller
   moves the conversation to staff and hangs up the call (`services/agent/src/session/controller.ts`, `handoff()`):
   - `conversations.support_mode` becomes `human` (conditional on it still being `ai`, so it happens once),
   - a `system` message with the hand-over notice is stored, and a `human_handoff` event is logged,
   - all timers stop (silence, the 6-minute limit), and the call is ended.
   The conversation is **not** ended: `ended_at` and `end_reason` stay empty.
4. The customer's page notices (`supportMode: "human"` in the state API), stops its own call if it is still up, and shows
   the text chat. Reloading `/support`, or opening the dashboard, finds the open conversation again.
5. Staff see it under **Waiting for staff**. They open it, **take** it (or just reply, which takes it), and exchange
   messages. Both sides see a typing line. The customer's name for the specialist comes from their staff profile
   (`app_users.display_name`, `title`, `avatar_url`).
6. Staff **close** the conversation: `support_mode = ended`, `ended_at`, `end_reason = human-closed`; `final_status`
   stays `escalated` because it was a hand-over. The customer sees the closed state. The AI never comes back.

If the hand-over cannot be saved, the call simply carries on as an AI call. If the hang-up fails, the page still stops
the call and the conversation is already `human`.

## Why the guard in `endConversation`

When the controller hangs up, Vapi sends an end-of-call report, and the webhook handler would normally record the end of the
conversation. For a human conversation `persist.endConversation()` returns without writing, so the report cannot close it.
Only staff closing it (the web app) ends a human conversation. A late `/chat/completions` request for a human
conversation gets a fixed line (`SESSION_TEXT.humanActive`), never the model.

## Data

Migration `20261003000011_human_handoff.sql`:

- `conversations`: `support_mode` (`ai` / `human` / `ended`), `assigned_staff_id`, `staff_typing_at`, `customer_typing_at`.
- `conversation_turns`: `sender` (`customer` / `ai` / `staff` / `system`, null for voice-era pairs), `body`, `staff_user_id`.
  One message per row; `turn_number` is left null (it is allocated by the agent and is not safe to assign from two writers);
  order by `created_at`. The agent's history ignores these rows.

## Routes (all check the user and the record on the server; POSTs are same-origin only; nothing is cached)

| Route | Who | What |
|---|---|---|
| `GET/POST /api/support/conversations/[id]/messages` | the customer who owns it | read (`?after=` cursor) and send; anyone else gets the same empty answer as for an unknown id |
| `POST /api/support/conversations/[id]/typing` | the owner | typing signal |
| `GET/POST /api/staff/conversations/[id]/messages` | staff | read, and reply (replying to an unassigned conversation takes it) |
| `POST /api/staff/conversations/[id]/claim` | staff | take an unassigned conversation; one winner, the other gets 409 `taken` |
| `POST /api/staff/conversations/[id]/close` | the assignee or an admin (anyone, if unassigned) | close; once |
| `POST /api/staff/conversations/[id]/typing` | the person allowed to reply | typing signal |

Messages are limited to 2,000 characters and rate limited (30 per minute per conversation for customers, 60 per minute per
staff member) through the shared limiter (`docs/ABUSE.md`). Every write is conditional on the conversation still being open,
so nothing is stored in a conversation that was closed a moment earlier.

Polling (every 2 seconds, slower after failures, stopped once closed) replaces Supabase Realtime by design: the browser
never reads Supabase directly (`docs/UI.md`).

## Roles

Support agents see open and escalated conversations and every conversation with a specialist; admins see everything;
customers see only their own (`lib/auth/access.ts`). A conversation assigned to one agent can be answered only by that
agent or an admin.

## Turning it on

1. `npm run db:migrate`.
2. Set `HUMAN_HANDOFF=1` where the **agent** runs (and in `.env.local` when running it locally), restart the agent.
   Nothing changes in the Vapi assistant, so `npm run vapi:setup` is not needed.
3. Sign in as a customer (`docs/AUTH.md`), call from `/support`, escalate, and watch `/staff` as `sarah@relaypay.example`.

## Known limits

- Only signed-in customers: the human chat needs an identity to authorise against, so anonymous callers on `/` stay on Mode A.
- The Mode A contact form still asks a signed-in customer for name, email and time before the hand-over.
- The link lands a second or two after the call starts. A conversation that escalates before the link exists stays on Mode A.
- Typing is approximate (a 5-second window). No file attachments, no read receipts, no avatar upload.
- The assistant's wording after `create_escalation` is a prompt instruction, not enforced. The hand-over itself does not
  depend on what it says.
