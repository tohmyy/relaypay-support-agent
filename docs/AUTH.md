# Authentication and authorization

Build Plan V2, Iterations 6 and 7. Beyond the PRD minimum. There is no public page: `/` redirects to `/login`, or to the
signed-in person's own area (`proxy.ts` from the cookie, and `app/page.tsx` again from the real session). Accounts give a
customer area and a staff area, and every voice call is made by a signed-in customer on `/support`.

## What it is

Self-contained, with no new packages and no Supabase Auth: an `app_users` table, scrypt password hashes, and a signed
session cookie. Chosen so it can be built and tested without any outside service, and so staff messaging can later use
authorised server routes instead of Supabase Realtime.

| Role | Lands on | Can see |
|---|---|---|
| `customer` | `/dashboard` | Their own payments, payouts, invoices, profile and past conversations |
| `support_agent` | `/staff` | The queue and conversations that are open or escalated |
| `support_admin` | `/staff` | Everything the agent sees, plus resolved conversations, and the **Settings** page (`/staff/settings`) where the ways of reaching a person are switched on and off (`docs/HANDOFF.md`) |

Routes: customers use `/dashboard`, `/payments`, `/payouts`, `/invoices`, `/support`, `/support/history` (all their
conversations, ten to a page, newest first), `/support/<conversation id>` and `/settings`. Staff use `/staff`, `/staff/conversations` and `/staff/conversations/<id>`. Staff pages are read-only
in this round; replying, assigning and closing belong to Iteration 5.

## Setup

1. `npm run db:migrate` (adds `app_users` and the `conversations.customer_id` / `user_id` columns).
2. Set `SESSION_SECRET` (32 or more random characters) and `DEMO_USER_PASSWORD` (10 or more characters) in `.env.local`.
3. `npm run db:seed-users`, then restart `npm run dev`.

Demo accounts (all use `DEMO_USER_PASSWORD`; re-running the seed resets the password): one customer per seeded
customer, signing in with that customer's contact email (for example `amara@lagosledger.example`), staff
`sarah@relaypay.example` and `david@relaypay.example` (support agents) and `admin@relaypay.example`.

## How a request is checked

1. **Sign-in** (`app/(auth)/login/actions.ts`): the email and password are validated, a failed-attempt limit is
   checked (5 per 15 minutes per email and address), the password hash is verified, and a cookie is set. An unknown
   email, a wrong password and a disabled account give the same message and take about the same time.
2. **Cookie** (`rp_session`): `httpOnly`, `sameSite=lax`, `secure` in production, 8 hours. Its value is
   `<payload>.<signature>` (base64url, HMAC-SHA256 with `SESSION_SECRET`); the payload holds only the user id, role, customer
   id (customers) and issue and expiry times. There is no default secret: without one, nobody can sign in.
3. **`proxy.ts`**: a quick, cookie-only check on the protected paths. No valid cookie sends a visitor to
   `/login?next=...`; the wrong area sends them to their own home; a signed-in visitor on `/login` is sent home. It never
   reads the database, so it is **not** the security boundary.
4. **Data-access layer** (`lib/auth/dal.ts`): every page, route handler and server action calls `requireCustomer`,
   `requireStaff` or `getCurrentUser`. These re-read the user, so disabling an account or changing its role takes effect on
   the next request, and a cookie whose role no longer matches the account is rejected. If the user cannot be confirmed
   (for example the database is unreachable) the person is treated as signed out.
5. **Per-record rules** (`lib/auth/access.ts`): customers may open only conversations whose `customer_id` is theirs;
   agents may open open or escalated ones; admins any. Anything else, and anything that does not exist, looks the
   same (not found).

`safeNext()` only accepts same-site paths for the `next` parameter, so the login page cannot be used as an open redirect.

## Linking a call to a customer

The browser starts Vapi calls itself, and the call id only exists after the call starts. So, after the call has an id,
the customer's `/support` page calls `POST /api/support/link` with it. The server takes the customer from the session
(never from the request), creates the conversation row if the agent has not yet, and sets `customer_id` and `user_id`
only if they are empty. The same customer repeating it is fine; a call already tied to someone else is refused (409).
Preview mode never links.

The public state API (`/api/conversations/<id>/state`) follows the link: a **linked** conversation is readable only by
its owner and by staff, and everyone else receives the same neutral snapshot as for an unknown id, so ids cannot be
probed. An **unlinked** conversation (the moment before the link lands, or a call started straight against Vapi's public key)
answers with that same neutral snapshot: there are no anonymous callers, so nothing about an unlinked call is readable.

### The agent and the tools know who is calling (Build Plan V3, Iteration V3.3)

Linking is no longer only for web authorisation. Each turn the voice agent reads the link and puts the verified customer
(`customer_id`, display name, email, company) into the model's prompt as `<authenticated_customer>`; it is never part of the
public state API. The tool server reads the same link from `conversations` (keyed by `X-Conversation-Id`, never trusting a
customer id from the model) and scopes the account tools to that customer: another customer's records answer "not found", and
escalations carry the account's own name and email. The cookie is still never passed to the agent. See `docs/MCP.md` and
`docs/AGENT.md`.

### Signed-in callers only (Build Plan V3, Iteration V3.7)

- Voice support is only reachable from `/support`, inside the customer shell. `/` never hosts a call: signed out goes to
  `/login`, a customer to `/dashboard`, staff to `/staff`.
- Before a call, the page runs `GET /api/support/ready` (is support available) and `POST /api/support/start` (customer session,
  same origin, concurrent-session and creation-rate limits). Both answer 401 without a customer session.
- The call is then linked with `POST /api/support/link`. The link status is visible in the page
  (`linking | linked | failed`): a temporary failure is retried once automatically, a refusal (another owner) is not, and a
  failed link offers **Save this conversation to your account**.
- The voice agent enforces the rule on its side: when `AGENT_REQUIRE_LINK` is on (the default in production) a call that is
  still not linked to a customer after `LINK_GRACE_SECONDS` (default 10) is ended politely with end reason `error`, and no
  account lookup is answered for it.

## Known limits

- The cookie is stateless: there is no server-side list of revoked sessions. This is softened because the data-access
  layer re-checks the user on every request, and the lifetime is 8 hours.
- Sign-in attempts are limited in production (5 per 15 minutes per email and address) by a counter kept in Postgres (`rate_limit_hit`,
  `docs/ABUSE.md`), so the limit holds across server instances and restarts. If the database cannot be reached the
  in-memory counter is used instead (per instance, reset on restart). Outside production the limit is off.
- The Vapi public key is still public: someone can start a call against it without going through the site. That call is
  unlinked, so the agent ends it once the link grace period has passed (`AGENT_REQUIRE_LINK`); the greeting and the first
  seconds are still spoken. See `docs/ABUSE.md`.
- The first seconds of a signed-in call are unlinked, until the browser has the call id and the link request lands
  (inside the grace period).
- No password change or reset, no multi-factor sign-in, no avatar upload. Accounts come from `db:seed-users`.
- The live link and ownership behaviour during a real call has not been exercised (no Vapi credits at the time of
  writing); the rules are covered by offline tests.
