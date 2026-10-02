# Live text chat with a human agent (human handoff)

Build Plan V2, Iteration 5, extended. At an escalation the voice assistant **asks a signed-in customer whether they would
like to continue by live text chat with a support specialist, or prefer a callback**. If they choose the chat, the call is
hung up and the conversation continues as a text chat with a member of staff. It is switched on with `HUMAN_HANDOFF=1`
on the agent (default off). With it off, escalation is the callback flow only.

There is no public page any more: the site starts at sign-in (`/` redirects to `/login`, or to the dashboard or staff area
when already signed in), so every call comes from a signed-in customer on `/support`.

## The flow

1. A signed-in customer talks to the voice assistant on `/support`. The page ties the call to their account
   (`POST /api/support/link`, `docs/AUTH.md`), so the agent service can see `conversations.customer_id`.
2. On each turn the agent gives the assistant **who the customer is** (an `<authenticated_customer>` block read from the
   signed-in account, `docs/AUTH.md`), and, until an escalation exists, looks up in parallel with its knowledge search and
   cached for a short time **which contact methods are on** and **whether any staff member is online**
   (`<contact_methods ... staff_online="...">`).
3. The assistant **diagnoses before it escalates** (ask for a missing reference, look it up, summarise what it found), then
   says a specialist must handle it and **asks one question**: text chat now, or a callback. If a specialist is online it
   says one is available now; if not, that the team will reply as soon as someone is free and that the customer can ask for a
   callback instead at any time. While it waits for the answer it keeps `answer_type` as `clarification`.
4. **There are no forms.** The customer's name and email always come from their signed-in account; the assistant never asks
   for them, and the tool server (`create_escalation`) overwrites whatever it is given with the account's. **Text chat
   chosen**: it creates the ticket and the escalation with `contact_preference: "text_chat"`, then says a specialist will
   continue by text in the same window and that the call is ending. **Callback chosen**: it asks, by voice or in typed chat,
   for a **specific day, time and timezone** (never "later" or "no preference"), then creates the escalation with
   `contact_preference: "callback"`, `preferred_at` and `preferred_timezone`. The tool server rejects a time in the past or
   more than one calendar month ahead (measured in the customer's timezone) with a message the assistant uses to ask again;
   the call stays up.
5. The agent reads the choice from the `create_escalation` call itself (not from what the model says). Only
   `text_chat` moves the conversation (`controller.ts`, `armHandoff` / `handoff`): after the confirmation has finished
   playing (or after 10 seconds), `support_mode` becomes `human`, `handoff_at` is stamped, a system message and a
   `human_handoff` event are written, all timers stop, and the call is hung up. The conversation is **not** ended.
6. The customer's page notices (`supportMode: "human"` in the state API), stops its own call if still up, and shows the chat.
   Reloading `/support`, or opening the dashboard, finds the open conversation again.
7. Staff see it under **Waiting for staff** in a **live queue** (below), take it (or just reply, which takes it), and chat.
   They can **return it to the queue** or **close** it (`end_reason = human-closed`). The customer can **end the chat**. A
   customer who would rather be called says so in the message box and the specialist arranges it with them there; there is no
   callback form or button.

If the hand-over cannot be saved, the call simply carries on as an AI call. If the hang-up fails, the page still stops the
call and the conversation is already `human`. If the account has no contact details, or a lookup fails, no offer is made and
the normal callback procedure runs.

## Choosing which methods are on (administrators)

Administrators have a **Settings** page in the staff area (`/staff/settings`, linked in the navigation for administrators only;
agents are sent back to the queue). It lists the ways of reaching a person and lets the administrator switch each on or off:

| Method | Can be switched | What turning it off does |
|---|---|---|
| Live text chat | yes | The assistant stops offering the chat; a customer is never moved to one. Chats already under way carry on. |
| Callback request | yes | The assistant stops offering a callback; the waiting chat stops suggesting that the customer ask for one. |
| Live phone call | no (shown as "not available yet") | Nothing is built for it. |

At least one method must stay on, so a customer who needs a person always has a way to reach one (the page and the server both
refuse "everything off"). It is saved with one button; the page shows who changed it last and whether anyone is online now.

How it takes effect (`app_settings`, key `contact_methods`, `{"text_chat": true, "callback": true}`; no row means both on):

- **The assistant** reads it on each turn (cached for ~15 seconds) and is told which methods are on for this caller, so it asks
  "text chat or callback?" only when both are on, goes straight to the text chat when only that is on, uses the callback
  procedure when only that is on, and, if neither can be offered to this caller (for example text chat only, but the caller is
  not a signed-in customer), does not promise a person and logs a ticket instead.
- **The voice agent** also checks the setting before it moves anyone to a chat, so a model that ignores its instructions still
  cannot start a chat that is switched off.
- **The customer's chat** (`callbackAvailable` in the messages response, cached ~10 seconds on the web server) hides the
  wording that suggests asking for a callback.
- A change is used within roughly 15 seconds everywhere. If the setting cannot be read, both methods count as on. A stored value
  with both off (the page never saves one) is read as both on.
- Text chat also needs `HUMAN_HANDOFF=1` on the voice agent; the setting cannot turn on something the agent has off.

## What the customer sees while waiting

- If a specialist is online: "A specialist is online and will join you shortly." Otherwise: "Our team will reply as soon as
  someone is free. If you would rather have a callback, tell us a day and time in the message box."
- How long they have waited. After three minutes: "Still waiting? Tell us in the message box when you would like a callback
  and we will arrange it." There is no callback form or button (Build Plan V3, concern 18).
- Once a specialist joins: their name and title, a "typing" line, messages as they arrive, "Seen" under the latest message
  they have read, and "Sending… / Not sent. Try again" on the customer's own messages.

## Staff presence and the live queue

- **Available for chats** switch in the staff header. While it is on and a staff page is open, the page sends a heartbeat
  every ~30 seconds. A staff member counts as **online** when the switch is on and they were seen in the last 90 seconds
  (`lib/human/presence.ts`; the agent uses the same window). A closed tab or a sleeping laptop drops out by itself; switching
  off takes effect at once. Browsers slow timers in background tabs, so the window is generous.
- **Queue**: `/staff` and `/staff/conversations` show one live copy of the queue (`GET /api/staff/queue`, polled every 5 s,
  every 20 s when hidden) with counts, waiting time, an "New messages" mark on chats where the customer has written since this
  person last read, and who has each chat. The list shows only what the person may open.
- **Alerts** (all opt-in, none on load): the tab title and the "Queue" link show how many chats need attention (waiting, plus
  your own with unread messages); an optional chime and optional desktop notification fire when a new conversation starts
  waiting, only while the page is not in front. The browser's permission question is asked only when the box is ticked.
  Notifications never contain message text. New messages are announced to screen readers as "New message from <name>" in a
  polite status line.

## How the chat stays live and reliable

- **Polling, by design** (no Supabase Realtime: the browser never reads Supabase directly): about every 1.5–2 s while the page
  is in front, every ~10 s while hidden, immediately when it becomes visible again, paused while offline, with growing waits
  after failures, and a little randomness so tabs do not poll in step. It stops once the conversation is closed.
- **Optimistic send with safe retry**: the browser gives each message an id before sending. The message appears at once; if
  the request fails it stays on screen as "Not sent" with **Try again** (same id) and **Remove**. The id is a unique key in
  the database (`conversation_turns.client_msg_id`), so a retry that did get through the first time is stored once.
- **Read receipts**: each side reports reading the conversation (only when the page is visible and focused, and not more often
  than every few seconds); the other side shows "Seen". Only the person who has the conversation counts as having read it,
  so someone just looking at an unassigned chat does not show the customer "Seen".

## Why the guard in `endConversation`

When the controller hangs up, Vapi sends an end-of-call report, and the webhook handler would normally record the end of the
conversation. For a human conversation `persist.endConversation()` returns without writing, so the report cannot close it.
Only staff (or the customer) ending the chat through the web app ends a human conversation. A late `/chat/completions`
request for a human conversation gets a fixed line (`SESSION_TEXT.humanActive`), never the model.

## Data

- Migration `20261003000011_human_handoff.sql`: `conversations.support_mode` (`ai` / `human` / `ended`),
  `assigned_staff_id`, `staff_typing_at`, `customer_typing_at`; `conversation_turns.sender`, `body`, `staff_user_id` (one
  message per row, `turn_number` null, ordered by `created_at`).
- Migration `20261005000014_contact_methods.sql`: `app_settings` (`key`, `value`, `updated_at`, `updated_by`), service role only.
- Migration `20261004000013_live_chat.sql`: `escalations.contact_preference` (`text_chat` / `callback`);
  `app_users.available`, `last_seen_at`; `conversations.customer_last_read_at`, `staff_last_read_at`, `handoff_at`,
  `last_customer_message_at`, `last_staff_message_at`; `conversation_turns.client_msg_id` (unique with the conversation).
  **Apply it before deploying the web app**: the pages and routes read the new columns.

## Routes (all check the user and the record on the server; POSTs are same-origin only; nothing is cached)

| Route | Who | What |
|---|---|---|
| `GET/POST /api/support/conversations/[id]/messages` | the customer who owns it | read (`?after=` cursor; also the specialist, what they have read, wait time, whether anyone is online) and send (optional `clientId`); anyone else gets the same empty answer as for an unknown id |
| `POST …/typing`, `POST …/read` | the owner | typing signal; "I have read it" |
| `POST …/end` | the owner | end the chat |
| `GET/POST /api/staff/conversations/[id]/messages` | staff | read, and reply (replying to an unassigned conversation takes it) |
| `POST …/claim`, `POST …/release`, `POST …/close` | staff | `staff_claim_escalation` / `staff_release_escalation` / `staff_close_escalation` in one transaction (conversation, ticket, escalation, one event). A stale or double action answers 409 with `{ outcome, state }` instead of mutating. Close sets `support_mode=ended`, `end_reason=human-closed`, ticket/escalation `closed`, and leaves `final_status` as the historical outcome |
| `GET /api/support/conversations/[id]/transcript` and staff twin | owner / staff | incremental durable turns (`?after=` cursor of `created_at` + `turn_uid`) |
| `POST /api/support/conversations/[id]/activity` | owner, AI sessions | `{ type: start \| heartbeat \| stop }` forwarded to the agent `POST /activity` (3 s heartbeat, 5 s lease) |
| `POST …/typing`, `POST …/read` | staff | typing signal; "I have read it" (recorded only for the assignee) |
| `GET /api/staff/queue` | staff | the live queue as this person may see it |
| `GET/POST /api/staff/presence` | staff | the switch, and the heartbeat |
| `GET/PUT /api/staff/settings/contact-methods` | administrators only | read and save which methods are on (at least one must stay on; 10 changes a minute) |

Messages are limited to 2,000 characters and rate limited through the shared limiter in production (`docs/ABUSE.md`). Sends go
through `add_human_message`: if `support_mode` is not `human` or `ended_at` is set, the insert fails and the route answers 409
`closed`. Staff work from `/staff` (live queue), `/staff/conversations` (paginated archive) and `/staff/escalations` (ticket-keyed
inbox). The accept card shows customer, topic, ticket, age and an AI or generated summary.

## Roles

Support agents see open and escalated conversations and every conversation with a specialist; admins see everything;
customers see only their own (`lib/auth/access.ts`). A conversation assigned to one agent can be answered only by that
agent or an admin.

## Turning it on

1. `npm run db:migrate`.
2. Set `HUMAN_HANDOFF=1` where the **agent** runs (and in `.env.local` when running it locally), restart the agent.
   Nothing changes in the Vapi assistant, so `npm run vapi:setup` is not needed.
3. Sign in as a staff member (`sarah@relaypay.example`) in one browser and switch **Available for chats** on. Sign in as a
   customer (`amara@lagosledger.example`) in another, call from `/support`, and escalate.

## Known limits

- Only signed-in customers can be offered the chat (it needs an identity to authorise against). There is no guest chat.
- The callback time is agreed in the conversation and validated by the tool server (not in the past, within one calendar
  month, timezone-aware); the assistant's asking for a *specific* time is prompt behaviour, the validation is not.
- The assistant's wording and its use of `clarification` while asking are prompt behaviour, not enforced. The hand-over
  itself depends only on the recorded `contact_preference`: no recorded choice means the call stays up as a callback.
- "Live" means polling about every two seconds, not instant, and it costs requests per open chat.
- "Online" means a staff browser tab is open, sending heartbeats. Nothing closes a queued chat nobody picks up: the customer is
  nudged towards asking for a callback in the chat after three minutes, and can leave at any time.
- The link lands a second or two after the call starts. A conversation that escalates before the link exists is not offered
  the chat.
- No file attachments, no canned replies, no transfer between agents (only return-to-queue) and no avatar upload.
- **Rating the specialist** (Build Plan V3, V3.9): once the chat is closed the customer's page offers an optional 1 to 5 star
  rating with a comment (`stage = human`); the rating of the voice or typed leg is a separate one (`stage = ai`). Both are
  stored in `conversation_feedback`, shown to staff on the conversation page, and **never** change the conversation's status,
  end reason or a ticket (`POST /api/support/conversations/<id>/feedback`).
